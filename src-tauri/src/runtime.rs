use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::SystemTime,
};

pub struct RuntimeState {
    db: Mutex<Connection>,
    mcp_processes: Mutex<HashMap<String, Child>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryRecord {
    id: String,
    kind: String,
    content: String,
    source: String,
    confidence: f64,
    enabled: bool,
    created_at: String,
    updated_at: String,
    embedding_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct McpServerManifest {
    name: String,
    transport: String,
    command: Option<String>,
    url: Option<String>,
    env_schema: Option<Value>,
    permissions: Value,
    enabled: Option<bool>,
    health: Option<String>,
    installed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemorySearchPayload {
    query: Option<String>,
    kind: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryDeletePayload {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpEnablePayload {
    server: McpServerManifest,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpStatusPayload {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellExecutePayload {
    workspace: String,
    executable: String,
    args: Vec<String>,
    approved: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusResult {
    ok: bool,
    name: String,
    health: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellExecuteResult {
    ok: bool,
    executable: String,
    args: Vec<String>,
    status_code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn now_epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn parse_payload<T: for<'de> Deserialize<'de>>(payload: Option<Value>) -> Result<T, String> {
    let payload = payload.ok_or_else(|| "缺少 Runtime payload。".to_string())?;
    serde_json::from_value(payload).map_err(|error| format!("Runtime payload 格式错误：{error}"))
}

fn truncate_output(bytes: &[u8]) -> String {
    const LIMIT: usize = 12_000;
    let end = bytes.len().min(LIMIT);
    let mut output = String::from_utf8_lossy(&bytes[..end]).to_string();
    if bytes.len() > LIMIT {
        output.push_str("\n...[输出已截断]");
    }
    output
}

fn record_event(db: &Connection, category: &str, message: &str) -> Result<(), String> {
    db.execute(
        "INSERT INTO audit_events (category, message, created_at) VALUES (?1, ?2, ?3)",
        params![category, message, now_epoch_ms().to_string()],
    )
    .map_err(|error| format!("写入审计事件失败：{error}"))?;
    Ok(())
}

impl RuntimeState {
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&data_dir)
            .map_err(|error| format!("创建本地数据目录失败：{error}"))?;
        let db_path = data_dir.join("astraflow.sqlite3");
        let db = Connection::open(db_path).map_err(|error| format!("打开 SQLite 失败：{error}"))?;
        db.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS memories (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              content TEXT NOT NULL,
              source TEXT NOT NULL,
              confidence REAL NOT NULL,
              enabled INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              embedding_id TEXT
            );
            CREATE TABLE IF NOT EXISTS mcp_servers (
              name TEXT PRIMARY KEY,
              manifest_json TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 0,
              health TEXT NOT NULL DEFAULT 'offline',
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              category TEXT NOT NULL,
              message TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| format!("初始化 SQLite schema 失败：{error}"))?;

        Ok(Self {
            db: Mutex::new(db),
            mcp_processes: Mutex::new(HashMap::new()),
        })
    }
}

impl Drop for RuntimeState {
    fn drop(&mut self) {
        if let Ok(processes) = self.mcp_processes.get_mut() {
            for (_, child) in processes.iter_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
pub fn runtime_status(state: tauri::State<'_, RuntimeState>) -> Result<Value, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    let memory_count: i64 = db
        .query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))
        .map_err(|error| format!("读取记忆数量失败：{error}"))?;
    let mcp_count: i64 = db
        .query_row("SELECT COUNT(*) FROM mcp_servers", [], |row| row.get(0))
        .map_err(|error| format!("读取 MCP 数量失败：{error}"))?;
    let running_mcp = state
        .mcp_processes
        .lock()
        .map_err(|_| "MCP 进程锁不可用。".to_string())?
        .len();

    Ok(json!({
        "ok": true,
        "storage": "sqlite",
        "memoryCount": memory_count,
        "mcpCount": mcp_count,
        "runningMcp": running_mcp,
    }))
}

#[tauri::command]
pub fn memory_update(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let memory: MemoryRecord = parse_payload(payload)?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    db.execute(
        "
        INSERT INTO memories (
          id, kind, content, source, confidence, enabled, created_at, updated_at, embedding_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          content = excluded.content,
          source = excluded.source,
          confidence = excluded.confidence,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at,
          embedding_id = excluded.embedding_id
        ",
        params![
            memory.id,
            memory.kind,
            memory.content,
            memory.source,
            memory.confidence,
            memory.enabled,
            memory.created_at,
            memory.updated_at,
            memory.embedding_id,
        ],
    )
    .map_err(|error| format!("写入记忆失败：{error}"))?;
    record_event(&db, "memory", "memory.update")?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn memory_delete(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let payload: MemoryDeletePayload = parse_payload(payload)?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    db.execute("DELETE FROM memories WHERE id = ?1", params![payload.id])
        .map_err(|error| format!("删除记忆失败：{error}"))?;
    record_event(&db, "memory", "memory.delete")?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn memory_search(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Vec<Value>, String> {
    let payload: MemorySearchPayload = parse_payload(payload)?;
    let query = payload.query.unwrap_or_default();
    let kind = payload.kind.unwrap_or_default();
    let limit = payload.limit.unwrap_or(40).min(200) as i64;
    let like_query = format!("%{}%", query.trim());
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    let mut statement = db
        .prepare(
            "
            SELECT id, kind, content, source, confidence, enabled, created_at, updated_at, embedding_id
            FROM memories
            WHERE (?1 = '' OR kind = ?1)
              AND (?2 = '%%' OR content LIKE ?2 OR source LIKE ?2)
            ORDER BY updated_at DESC
            LIMIT ?3
            ",
        )
        .map_err(|error| format!("准备记忆检索失败：{error}"))?;
    let rows = statement
        .query_map(params![kind, like_query, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "kind": row.get::<_, String>(1)?,
                "content": row.get::<_, String>(2)?,
                "source": row.get::<_, String>(3)?,
                "confidence": row.get::<_, f64>(4)?,
                "enabled": row.get::<_, bool>(5)?,
                "createdAt": row.get::<_, String>(6)?,
                "updatedAt": row.get::<_, String>(7)?,
                "embeddingId": row.get::<_, Option<String>>(8)?,
            }))
        })
        .map_err(|error| format!("执行记忆检索失败：{error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取记忆结果失败：{error}"))
}

#[tauri::command]
pub fn mcp_install(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let server: McpServerManifest = parse_payload(payload)?;
    let manifest =
        serde_json::to_string(&server).map_err(|error| format!("序列化 MCP 配置失败：{error}"))?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    db.execute(
        "
        INSERT INTO mcp_servers (name, manifest_json, enabled, health, updated_at)
        VALUES (?1, ?2, 0, 'offline', ?3)
        ON CONFLICT(name) DO UPDATE SET manifest_json = excluded.manifest_json, updated_at = excluded.updated_at
        ",
        params![server.name, manifest, now_epoch_ms().to_string()],
    )
    .map_err(|error| format!("保存 MCP 配置失败：{error}"))?;
    record_event(&db, "mcp", "mcp.install")?;
    Ok(json!({ "ok": true, "health": "offline" }))
}

fn start_stdio_mcp(server: &McpServerManifest) -> Result<Child, String> {
    let command = server
        .command
        .as_deref()
        .ok_or_else(|| "stdio MCP 缺少启动命令。".to_string())?;
    let parts = shlex::split(command).ok_or_else(|| "MCP 启动命令格式错误。".to_string())?;
    let (executable, args) = parts
        .split_first()
        .ok_or_else(|| "MCP 启动命令不能为空。".to_string())?;
    let allowed = ["npx", "node", "uvx", "python", "python3", "bun", "deno"];
    if !allowed.contains(&executable.as_str()) {
        return Err(format!("MCP 启动器不在白名单中：{executable}"));
    }

    Command::new(executable)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("启动 MCP Server 失败：{error}"))
}

#[tauri::command]
pub async fn mcp_enable(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<McpStatusResult, String> {
    let payload: McpEnablePayload = parse_payload(payload)?;
    let server = payload.server;
    let health;
    let message;

    if payload.enabled {
        if server.transport == "stdio" {
            let child = start_stdio_mcp(&server)?;
            let mut processes = state
                .mcp_processes
                .lock()
                .map_err(|_| "MCP 进程锁不可用。".to_string())?;
            if let Some(mut previous) = processes.insert(server.name.clone(), child) {
                let _ = previous.kill();
                let _ = previous.wait();
            }
            health = "healthy".to_string();
            message = "stdio MCP Server 已启动。".to_string();
        } else {
            let url = server
                .url
                .as_deref()
                .ok_or_else(|| "HTTP MCP 缺少 URL。".to_string())?;
            let response = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(3))
                .build()
                .map_err(|error| format!("创建 MCP 探测客户端失败：{error}"))?
                .get(url)
                .send()
                .await;
            health = if response.is_ok() {
                "healthy"
            } else {
                "degraded"
            }
            .to_string();
            message = if response.is_ok() {
                "HTTP MCP 端点可访问。".to_string()
            } else {
                "HTTP MCP 端点暂不可访问，已保留配置。".to_string()
            };
        }
    } else {
        if let Some(mut child) = state
            .mcp_processes
            .lock()
            .map_err(|_| "MCP 进程锁不可用。".to_string())?
            .remove(&server.name)
        {
            let _ = child.kill();
            let _ = child.wait();
        }
        health = "offline".to_string();
        message = "MCP Server 已停止。".to_string();
    }

    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    db.execute(
        "UPDATE mcp_servers SET enabled = ?1, health = ?2, updated_at = ?3 WHERE name = ?4",
        params![
            payload.enabled,
            health,
            now_epoch_ms().to_string(),
            server.name
        ],
    )
    .map_err(|error| format!("更新 MCP 状态失败：{error}"))?;
    record_event(&db, "mcp", "mcp.enable")?;

    Ok(McpStatusResult {
        ok: true,
        name: server.name,
        health,
        message,
    })
}

#[tauri::command]
pub fn mcp_status(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<McpStatusResult, String> {
    let payload: McpStatusPayload = parse_payload(payload)?;
    let mut processes = state
        .mcp_processes
        .lock()
        .map_err(|_| "MCP 进程锁不可用。".to_string())?;
    let health = match processes.get_mut(&payload.name) {
        Some(child) => match child.try_wait() {
            Ok(None) => "healthy",
            Ok(Some(_)) | Err(_) => "offline",
        },
        None => "offline",
    }
    .to_string();

    Ok(McpStatusResult {
        ok: true,
        name: payload.name,
        health,
        message: "已读取本地 MCP 进程状态。".to_string(),
    })
}

fn validate_workspace(workspace: &str) -> Result<PathBuf, String> {
    let workspace = Path::new(workspace);
    let canonical = workspace
        .canonicalize()
        .map_err(|error| format!("工作区路径不可用：{error}"))?;
    if !canonical.is_dir() {
        return Err("工作区必须是目录。".to_string());
    }
    Ok(canonical)
}

fn validate_shell_command(executable: &str, args: &[String]) -> Result<(), String> {
    let allowed = [
        "pwd", "ls", "rg", "git", "npm", "npx", "node", "cargo", "rustc",
    ];
    if !allowed.contains(&executable) {
        return Err(format!("命令不在受限执行器白名单中：{executable}"));
    }
    if args
        .iter()
        .any(|arg| arg.contains('\0') || arg.contains('\n'))
    {
        return Err("命令参数包含非法控制字符。".to_string());
    }
    if executable == "git"
        && args
            .iter()
            .any(|arg| ["push", "reset", "clean"].contains(&arg.as_str()))
    {
        return Err("受限执行器禁止 Git push/reset/clean。".to_string());
    }
    if executable == "npm" && args.iter().any(|arg| arg == "publish") {
        return Err("受限执行器禁止 npm publish。".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn shell_execute(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<ShellExecuteResult, String> {
    let payload: ShellExecutePayload = parse_payload(payload)?;
    if !payload.approved {
        return Err("Shell 命令必须经过人工审批。".to_string());
    }
    validate_shell_command(&payload.executable, &payload.args)?;
    let workspace = validate_workspace(&payload.workspace)?;
    let output = Command::new(&payload.executable)
        .args(&payload.args)
        .current_dir(workspace)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("执行命令失败：{error}"))?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    record_event(
        &db,
        "shell",
        &format!("shell.execute {}", payload.executable),
    )?;

    Ok(ShellExecuteResult {
        ok: output.status.success(),
        executable: payload.executable,
        args: payload.args,
        status_code: output.status.code(),
        stdout: truncate_output(&output.stdout),
        stderr: truncate_output(&output.stderr),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_sqlite_schema() {
        let directory = std::env::temp_dir().join(format!("astraflow-test-{}", now_epoch_ms()));
        let runtime = RuntimeState::new(directory.clone()).expect("runtime should initialize");
        let db = runtime.db.lock().expect("sqlite should be available");
        let table_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('memories', 'mcp_servers', 'audit_events')",
                [],
                |row| row.get(0),
            )
            .expect("schema query should work");
        assert_eq!(table_count, 3);
        drop(db);
        std::fs::remove_dir_all(directory)
            .expect("temporary runtime directory should be removable");
    }

    #[test]
    fn rejects_dangerous_shell_commands() {
        assert!(validate_shell_command("rm", &["-rf".to_string(), ".".to_string()]).is_err());
        assert!(validate_shell_command("git", &["push".to_string()]).is_err());
        assert!(validate_shell_command("npm", &["publish".to_string()]).is_err());
        assert!(
            validate_shell_command("git", &["status".to_string(), "--short".to_string()]).is_ok()
        );
    }
}
