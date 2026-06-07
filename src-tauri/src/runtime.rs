use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
    time::SystemTime,
};

pub struct RuntimeState {
    db: Mutex<Connection>,
    mcp_processes: Mutex<HashMap<String, McpProcess>>,
    sidecar: Mutex<Option<ManagedSidecar>>,
}

struct McpProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_request_id: u64,
}

struct ManagedSidecar {
    child: Child,
    _stdin: ChildStdin,
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
struct McpListToolsPayload {
    server: McpServerManifest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpCallToolPayload {
    server: McpServerManifest,
    tool_name: String,
    arguments: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCheckpointPayload {
    id: String,
    status: String,
    task: Value,
    plan: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageEntryRecord {
    id: String,
    task_id: String,
    provider_id: String,
    model: String,
    prompt_tokens: i64,
    completion_tokens: i64,
    embedding_tokens: i64,
    cached_tokens: i64,
    cache_cost_usd: Option<f64>,
    cost_usd: f64,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLogRecord {
    id: String,
    task_id: Option<String>,
    level: String,
    message: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListPayload {
    task_id: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionAuditRecord {
    id: String,
    task_id: Option<String>,
    actor: String,
    permission_id: String,
    resource: String,
    decision: String,
    payload_hash: Option<String>,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentJobRecord {
    id: String,
    task_id: String,
    status: String,
    cursor_step_id: Option<String>,
    failure_reason: Option<String>,
    retry_count: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentStepRecord {
    id: String,
    job_id: String,
    step_id: String,
    status: String,
    input_json: Option<Value>,
    output_json: Option<Value>,
    error: Option<String>,
    started_at: Option<String>,
    finished_at: Option<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatusResult {
    ok: bool,
    running: bool,
    message: String,
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
            CREATE TABLE IF NOT EXISTS schema_migrations (
              id TEXT PRIMARY KEY,
              applied_at TEXT NOT NULL
            );
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
            CREATE TABLE IF NOT EXISTS task_checkpoints (
              id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              task_json TEXT NOT NULL,
              plan_json TEXT,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              task_json TEXT NOT NULL,
              plan_json TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS usage_entries (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              provider_id TEXT NOT NULL,
              model TEXT NOT NULL,
              prompt_tokens INTEGER NOT NULL,
              completion_tokens INTEGER NOT NULL,
              embedding_tokens INTEGER NOT NULL,
              cached_tokens INTEGER NOT NULL,
              cache_cost_usd REAL,
              cost_usd REAL NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS runtime_logs (
              id TEXT PRIMARY KEY,
              task_id TEXT,
              level TEXT NOT NULL,
              message TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS permission_audit_events (
              id TEXT PRIMARY KEY,
              task_id TEXT,
              actor TEXT NOT NULL,
              permission_id TEXT NOT NULL,
              resource TEXT NOT NULL,
              decision TEXT NOT NULL,
              payload_hash TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS agent_jobs (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              status TEXT NOT NULL,
              cursor_step_id TEXT,
              failure_reason TEXT,
              retry_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS agent_steps (
              id TEXT PRIMARY KEY,
              job_id TEXT NOT NULL,
              step_id TEXT NOT NULL,
              status TEXT NOT NULL,
              input_json TEXT,
              output_json TEXT,
              error TEXT,
              started_at TEXT,
              finished_at TEXT,
              FOREIGN KEY(job_id) REFERENCES agent_jobs(id) ON DELETE CASCADE
            );
            INSERT OR IGNORE INTO schema_migrations (id, applied_at)
            VALUES ('2026-06-03-runtime-persistence', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            ",
        )
        .map_err(|error| format!("初始化 SQLite schema 失败：{error}"))?;

        Ok(Self {
            db: Mutex::new(db),
            mcp_processes: Mutex::new(HashMap::new()),
            sidecar: Mutex::new(if cfg!(test) {
                None
            } else {
                start_sidecar().ok()
            }),
        })
    }
}

impl Drop for RuntimeState {
    fn drop(&mut self) {
        if let Ok(processes) = self.mcp_processes.get_mut() {
            for (_, process) in processes.iter_mut() {
                let _ = process.child.kill();
                let _ = process.child.wait();
            }
        }
        if let Ok(sidecar) = self.sidecar.get_mut() {
            stop_sidecar(sidecar);
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
    let task_count: i64 = db
        .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
        .map_err(|error| format!("读取任务数量失败：{error}"))?;
    let usage_count: i64 = db
        .query_row("SELECT COUNT(*) FROM usage_entries", [], |row| row.get(0))
        .map_err(|error| format!("读取 Usage 数量失败：{error}"))?;
    let runtime_log_count: i64 = db
        .query_row("SELECT COUNT(*) FROM runtime_logs", [], |row| row.get(0))
        .map_err(|error| format!("读取运行日志数量失败：{error}"))?;
    let audit_count: i64 = db
        .query_row("SELECT COUNT(*) FROM permission_audit_events", [], |row| {
            row.get(0)
        })
        .map_err(|error| format!("读取权限审计数量失败：{error}"))?;
    let agent_job_count: i64 = db
        .query_row("SELECT COUNT(*) FROM agent_jobs", [], |row| row.get(0))
        .map_err(|error| format!("读取 Agent Job 数量失败：{error}"))?;
    let running_mcp = state
        .mcp_processes
        .lock()
        .map_err(|_| "MCP 进程锁不可用。".to_string())?
        .len();
    let sidecar_running = match state
        .sidecar
        .lock()
        .map_err(|_| "sidecar 进程锁不可用。".to_string())?
        .as_mut()
    {
        Some(managed) => matches!(managed.child.try_wait(), Ok(None)),
        None => false,
    };

    Ok(json!({
        "ok": true,
        "storage": "sqlite",
        "memoryCount": memory_count,
        "mcpCount": mcp_count,
        "taskCount": task_count,
        "usageCount": usage_count,
        "runtimeLogCount": runtime_log_count,
        "permissionAuditCount": audit_count,
        "agentJobCount": agent_job_count,
        "runningMcp": running_mcp,
        "sidecarRunning": sidecar_running,
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

fn start_stdio_mcp(server: &McpServerManifest) -> Result<McpProcess, String> {
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

    let mut child = Command::new(executable)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("启动 MCP Server 失败：{error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "MCP stdin 不可用。".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "MCP stdout 不可用。".to_string())?;
    let mut process = McpProcess {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        next_request_id: 1,
    };
    initialize_stdio_mcp(&mut process)?;
    Ok(process)
}

fn stdio_json_rpc(process: &mut McpProcess, method: &str, params: Value) -> Result<Value, String> {
    let request_id = process.next_request_id;
    process.next_request_id += 1;
    writeln!(
        process.stdin,
        "{}",
        json!({ "jsonrpc": "2.0", "id": request_id, "method": method, "params": params })
    )
    .map_err(|error| format!("写入 MCP 请求失败：{error}"))?;
    process
        .stdin
        .flush()
        .map_err(|error| format!("刷新 MCP 请求失败：{error}"))?;

    loop {
        let mut line = String::new();
        let read = process
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("读取 MCP 响应失败：{error}"))?;
        if read == 0 {
            return Err("MCP Server 已关闭 stdout。".to_string());
        }
        let response: Value = serde_json::from_str(line.trim())
            .map_err(|error| format!("MCP 响应不是合法 JSON：{error}"))?;
        if response["id"] == request_id {
            if !response["error"].is_null() {
                return Err(format!("MCP JSON-RPC 错误：{}", response["error"]));
            }
            return Ok(response["result"].clone());
        }
    }
}

fn initialize_stdio_mcp(process: &mut McpProcess) -> Result<(), String> {
    stdio_json_rpc(
        process,
        "initialize",
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "astraflow-agent-studio", "version": "0.1.0" }
        }),
    )?;
    writeln!(
        process.stdin,
        "{}",
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
    )
    .map_err(|error| format!("写入 MCP initialized 通知失败：{error}"))?;
    process
        .stdin
        .flush()
        .map_err(|error| format!("刷新 MCP initialized 通知失败：{error}"))
}

fn ensure_stdio_mcp<'a>(
    processes: &'a mut HashMap<String, McpProcess>,
    server: &McpServerManifest,
) -> Result<&'a mut McpProcess, String> {
    let should_start = match processes.get_mut(&server.name) {
        Some(process) => !matches!(process.child.try_wait(), Ok(None)),
        None => true,
    };

    if should_start {
        if let Some(mut previous) = processes.remove(&server.name) {
            let _ = previous.child.kill();
            let _ = previous.child.wait();
        }
        processes.insert(server.name.clone(), start_stdio_mcp(server)?);
    }

    processes
        .get_mut(&server.name)
        .ok_or_else(|| "stdio MCP Server 尚未启动。".to_string())
}

fn restart_stdio_mcp<'a>(
    processes: &'a mut HashMap<String, McpProcess>,
    server: &McpServerManifest,
) -> Result<&'a mut McpProcess, String> {
    if let Some(mut previous) = processes.remove(&server.name) {
        let _ = previous.child.kill();
        let _ = previous.child.wait();
    }
    processes.insert(server.name.clone(), start_stdio_mcp(server)?);
    processes
        .get_mut(&server.name)
        .ok_or_else(|| "stdio MCP Server 重启失败。".to_string())
}

async fn http_json_rpc(
    server: &McpServerManifest,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let url = server
        .url
        .as_deref()
        .ok_or_else(|| "HTTP MCP 缺少 URL。".to_string())?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| format!("创建 MCP Client 失败：{error}"))?
        .post(url)
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }))
        .send()
        .await
        .map_err(|error| format!("调用 HTTP MCP 失败：{error}"))?;
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("解析 HTTP MCP 响应失败：{error}"))?;
    if !body["error"].is_null() {
        return Err(format!("MCP JSON-RPC 错误：{}", body["error"]));
    }
    Ok(body["result"].clone())
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
            let process = start_stdio_mcp(&server)?;
            let mut processes = state
                .mcp_processes
                .lock()
                .map_err(|_| "MCP 进程锁不可用。".to_string())?;
            if let Some(mut previous) = processes.insert(server.name.clone(), process) {
                let _ = previous.child.kill();
                let _ = previous.child.wait();
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
        if let Some(mut process) = state
            .mcp_processes
            .lock()
            .map_err(|_| "MCP 进程锁不可用。".to_string())?
            .remove(&server.name)
        {
            let _ = process.child.kill();
            let _ = process.child.wait();
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
        Some(process) => match process.child.try_wait() {
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

#[tauri::command]
pub async fn mcp_list_tools(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let payload: McpListToolsPayload = parse_payload(payload)?;
    if payload.server.transport == "stdio" {
        let mut processes = state
            .mcp_processes
            .lock()
            .map_err(|_| "MCP 进程锁不可用。".to_string())?;
        let result = stdio_json_rpc(
            ensure_stdio_mcp(&mut processes, &payload.server)?,
            "tools/list",
            json!({}),
        );
        return match result {
            Ok(value) => Ok(value),
            Err(_) => stdio_json_rpc(
                restart_stdio_mcp(&mut processes, &payload.server)?,
                "tools/list",
                json!({}),
            ),
        };
    }
    http_json_rpc(&payload.server, "tools/list", json!({})).await
}

#[tauri::command]
pub async fn mcp_call_tool(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let payload: McpCallToolPayload = parse_payload(payload)?;
    let params = json!({
        "name": payload.tool_name,
        "arguments": payload.arguments.unwrap_or_else(|| json!({}))
    });
    if payload.server.transport == "stdio" {
        let mut processes = state
            .mcp_processes
            .lock()
            .map_err(|_| "MCP 进程锁不可用。".to_string())?;
        let result = stdio_json_rpc(
            ensure_stdio_mcp(&mut processes, &payload.server)?,
            "tools/call",
            params.clone(),
        );
        return match result {
            Ok(value) => Ok(value),
            Err(_) => stdio_json_rpc(
                restart_stdio_mcp(&mut processes, &payload.server)?,
                "tools/call",
                params,
            ),
        };
    }
    http_json_rpc(&payload.server, "tools/call", params).await
}

fn upsert_task_checkpoint(db: &Connection, payload: &TaskCheckpointPayload) -> Result<(), String> {
    let created_at = payload
        .task
        .get("createdAt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let updated_at = payload
        .task
        .get("updatedAt")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| now_epoch_ms().to_string());
    let plan_json = payload.plan.as_ref().map(Value::to_string);

    db.execute(
        "INSERT INTO task_checkpoints (id, status, task_json, plan_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, task_json = excluded.task_json,
         plan_json = excluded.plan_json, updated_at = excluded.updated_at",
        params![
            payload.id,
            payload.status,
            payload.task.to_string(),
            plan_json,
            updated_at
        ],
    )
    .map_err(|error| format!("保存任务 checkpoint 失败：{error}"))?;

    db.execute(
        "INSERT INTO tasks (id, status, task_json, plan_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, task_json = excluded.task_json,
         plan_json = excluded.plan_json, updated_at = excluded.updated_at",
        params![
            payload.id,
            payload.status,
            payload.task.to_string(),
            payload.plan.as_ref().map(Value::to_string),
            if created_at.is_empty() {
                updated_at.clone()
            } else {
                created_at
            },
            updated_at
        ],
    )
    .map_err(|error| format!("保存任务记录失败：{error}"))?;
    Ok(())
}

#[tauri::command]
pub fn task_checkpoint(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let payload: TaskCheckpointPayload = parse_payload(payload)?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    upsert_task_checkpoint(&db, &payload)?;
    record_event(&db, "task", "task.checkpoint")?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn usage_report(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let usage: UsageEntryRecord = parse_payload(payload)?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    db.execute(
        "INSERT INTO usage_entries (
          id, task_id, provider_id, model, prompt_tokens, completion_tokens,
          embedding_tokens, cached_tokens, cache_cost_usd, cost_usd, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
          task_id = excluded.task_id,
          provider_id = excluded.provider_id,
          model = excluded.model,
          prompt_tokens = excluded.prompt_tokens,
          completion_tokens = excluded.completion_tokens,
          embedding_tokens = excluded.embedding_tokens,
          cached_tokens = excluded.cached_tokens,
          cache_cost_usd = excluded.cache_cost_usd,
          cost_usd = excluded.cost_usd,
          created_at = excluded.created_at",
        params![
            usage.id,
            usage.task_id,
            usage.provider_id,
            usage.model,
            usage.prompt_tokens,
            usage.completion_tokens,
            usage.embedding_tokens,
            usage.cached_tokens,
            usage.cache_cost_usd,
            usage.cost_usd,
            usage.created_at,
        ],
    )
    .map_err(|error| format!("写入 Usage 失败：{error}"))?;
    record_event(&db, "usage", "usage.report")?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn runtime_log_append(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let log: RuntimeLogRecord = parse_payload(payload)?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    db.execute(
        "INSERT INTO runtime_logs (id, task_id, level, message, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, level = excluded.level,
         message = excluded.message, created_at = excluded.created_at",
        params![log.id, log.task_id, log.level, log.message, log.created_at],
    )
    .map_err(|error| format!("写入运行日志失败：{error}"))?;
    record_event(&db, "runtime", "runtime.log")?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn task_list(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Vec<Value>, String> {
    let payload: ListPayload = payload
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("Runtime payload 格式错误：{error}"))?
        .unwrap_or(ListPayload {
            task_id: None,
            limit: Some(100),
        });
    let limit = payload.limit.unwrap_or(100).min(500) as i64;
    let task_id = payload.task_id.unwrap_or_default();
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    let mut statement = db
        .prepare(
            "SELECT id, status, task_json, plan_json, created_at, updated_at FROM tasks
             WHERE (?1 = '' OR id = ?1)
             ORDER BY updated_at DESC LIMIT ?2",
        )
        .map_err(|error| format!("准备任务列表失败：{error}"))?;
    let rows = statement
        .query_map(params![task_id, limit], |row| {
            let task_json: String = row.get(2)?;
            let plan_json: Option<String> = row.get(3)?;
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "status": row.get::<_, String>(1)?,
                "task": serde_json::from_str::<Value>(&task_json).unwrap_or(Value::Null),
                "plan": plan_json.and_then(|value| serde_json::from_str::<Value>(&value).ok()),
                "createdAt": row.get::<_, String>(4)?,
                "updatedAt": row.get::<_, String>(5)?,
            }))
        })
        .map_err(|error| format!("执行任务列表失败：{error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取任务列表失败：{error}"))
}

#[tauri::command]
pub fn usage_list(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Vec<Value>, String> {
    let payload: ListPayload = payload
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("Runtime payload 格式错误：{error}"))?
        .unwrap_or(ListPayload {
            task_id: None,
            limit: Some(200),
        });
    let limit = payload.limit.unwrap_or(200).min(1_000) as i64;
    let task_id = payload.task_id.unwrap_or_default();
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    let mut statement = db
        .prepare(
            "SELECT id, task_id, provider_id, model, prompt_tokens, completion_tokens,
             embedding_tokens, cached_tokens, cache_cost_usd, cost_usd, created_at
             FROM usage_entries WHERE (?1 = '' OR task_id = ?1)
             ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(|error| format!("准备 Usage 列表失败：{error}"))?;
    let rows = statement
        .query_map(params![task_id, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "taskId": row.get::<_, String>(1)?,
                "providerId": row.get::<_, String>(2)?,
                "model": row.get::<_, String>(3)?,
                "promptTokens": row.get::<_, i64>(4)?,
                "completionTokens": row.get::<_, i64>(5)?,
                "embeddingTokens": row.get::<_, i64>(6)?,
                "cachedTokens": row.get::<_, i64>(7)?,
                "cacheCostUsd": row.get::<_, Option<f64>>(8)?,
                "costUsd": row.get::<_, f64>(9)?,
                "createdAt": row.get::<_, String>(10)?,
            }))
        })
        .map_err(|error| format!("执行 Usage 列表失败：{error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取 Usage 列表失败：{error}"))
}

#[tauri::command]
pub fn runtime_logs_list(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Vec<Value>, String> {
    let payload: ListPayload = payload
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("Runtime payload 格式错误：{error}"))?
        .unwrap_or(ListPayload {
            task_id: None,
            limit: Some(200),
        });
    let limit = payload.limit.unwrap_or(200).min(1_000) as i64;
    let task_id = payload.task_id.unwrap_or_default();
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    let mut statement = db
        .prepare(
            "SELECT id, task_id, level, message, created_at FROM runtime_logs
             WHERE (?1 = '' OR task_id = ?1)
             ORDER BY created_at DESC LIMIT ?2",
        )
        .map_err(|error| format!("准备运行日志列表失败：{error}"))?;
    let rows = statement
        .query_map(params![task_id, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "taskId": row.get::<_, Option<String>>(1)?,
                "level": row.get::<_, String>(2)?,
                "message": row.get::<_, String>(3)?,
                "createdAt": row.get::<_, String>(4)?,
            }))
        })
        .map_err(|error| format!("执行运行日志列表失败：{error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取运行日志列表失败：{error}"))
}

#[tauri::command]
pub fn permission_audit_append(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let audit: PermissionAuditRecord = parse_payload(payload)?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    db.execute(
        "INSERT INTO permission_audit_events (
          id, task_id, actor, permission_id, resource, decision, payload_hash, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
          task_id = excluded.task_id,
          actor = excluded.actor,
          permission_id = excluded.permission_id,
          resource = excluded.resource,
          decision = excluded.decision,
          payload_hash = excluded.payload_hash,
          created_at = excluded.created_at",
        params![
            audit.id,
            audit.task_id,
            audit.actor,
            audit.permission_id,
            audit.resource,
            audit.decision,
            audit.payload_hash,
            audit.created_at,
        ],
    )
    .map_err(|error| format!("写入权限审计失败：{error}"))?;
    record_event(&db, "permission", "permission.audit")?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn agent_job_upsert(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let job: AgentJobRecord = parse_payload(payload)?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    db.execute(
        "INSERT INTO agent_jobs (
          id, task_id, status, cursor_step_id, failure_reason, retry_count, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
          task_id = excluded.task_id,
          status = excluded.status,
          cursor_step_id = excluded.cursor_step_id,
          failure_reason = excluded.failure_reason,
          retry_count = excluded.retry_count,
          updated_at = excluded.updated_at",
        params![
            job.id,
            job.task_id,
            job.status,
            job.cursor_step_id,
            job.failure_reason,
            job.retry_count,
            job.created_at,
            job.updated_at,
        ],
    )
    .map_err(|error| format!("写入 Agent Job 失败：{error}"))?;
    record_event(&db, "agent", "agent.job.upsert")?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn agent_step_upsert(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Value, String> {
    let step: AgentStepRecord = parse_payload(payload)?;
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    db.execute(
        "INSERT INTO agent_steps (
          id, job_id, step_id, status, input_json, output_json, error, started_at, finished_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          input_json = excluded.input_json,
          output_json = excluded.output_json,
          error = excluded.error,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at",
        params![
            step.id,
            step.job_id,
            step.step_id,
            step.status,
            step.input_json.as_ref().map(Value::to_string),
            step.output_json.as_ref().map(Value::to_string),
            step.error,
            step.started_at,
            step.finished_at,
        ],
    )
    .map_err(|error| format!("写入 Agent Step 失败：{error}"))?;
    record_event(&db, "agent", "agent.step.upsert")?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
pub fn agent_jobs_list(
    payload: Option<Value>,
    state: tauri::State<'_, RuntimeState>,
) -> Result<Vec<Value>, String> {
    let payload: ListPayload = payload
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| format!("Runtime payload 格式错误：{error}"))?
        .unwrap_or(ListPayload {
            task_id: None,
            limit: Some(100),
        });
    let limit = payload.limit.unwrap_or(100).min(500) as i64;
    let task_id = payload.task_id.unwrap_or_default();
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    let mut statement = db
        .prepare(
            "SELECT id, task_id, status, cursor_step_id, failure_reason, retry_count,
             created_at, updated_at FROM agent_jobs
             WHERE (?1 = '' OR task_id = ?1)
             ORDER BY updated_at DESC LIMIT ?2",
        )
        .map_err(|error| format!("准备 Agent Job 列表失败：{error}"))?;
    let rows = statement
        .query_map(params![task_id, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "taskId": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "cursorStepId": row.get::<_, Option<String>>(3)?,
                "failureReason": row.get::<_, Option<String>>(4)?,
                "retryCount": row.get::<_, i64>(5)?,
                "createdAt": row.get::<_, String>(6)?,
                "updatedAt": row.get::<_, String>(7)?,
            }))
        })
        .map_err(|error| format!("执行 Agent Job 列表失败：{error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取 Agent Job 列表失败：{error}"))
}

#[tauri::command]
pub fn task_restore(state: tauri::State<'_, RuntimeState>) -> Result<Vec<Value>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "SQLite 锁不可用。".to_string())?;
    let mut statement = db
        .prepare(
            "SELECT id, status, task_json, plan_json, updated_at FROM task_checkpoints
             WHERE status IN ('planned', 'running', 'paused', 'blocked') ORDER BY updated_at DESC",
        )
        .map_err(|error| format!("准备任务恢复失败：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            let task_json: String = row.get(2)?;
            let plan_json: Option<String> = row.get(3)?;
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "status": row.get::<_, String>(1)?,
                "task": serde_json::from_str::<Value>(&task_json).unwrap_or(Value::Null),
                "plan": plan_json.and_then(|value| serde_json::from_str::<Value>(&value).ok()),
                "updatedAt": row.get::<_, String>(4)?,
            }))
        })
        .map_err(|error| format!("执行任务恢复失败：{error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取任务恢复结果失败：{error}"))
}

fn sidecar_project_root() -> Option<PathBuf> {
    std::env::var_os("ASTRAFLOW_PROJECT_ROOT")
        .map(PathBuf::from)
        .or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(Path::to_path_buf)
        })
        .filter(|root| root.join("sidecar/agent-runtime.ts").is_file())
}

fn start_sidecar() -> Result<ManagedSidecar, String> {
    let root = sidecar_project_root().ok_or_else(|| "未找到 sidecar 目录。".to_string())?;
    let mut child = Command::new("npm")
        .args(["run", "runtime:dev", "--silent"])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("启动 sidecar 失败：{error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "sidecar stdin 不可用。".to_string())?;
    Ok(ManagedSidecar {
        child,
        _stdin: stdin,
    })
}

fn stop_sidecar(sidecar: &mut Option<ManagedSidecar>) {
    if let Some(mut managed) = sidecar.take() {
        let _ = managed.child.kill();
        let _ = managed.child.wait();
    }
}

#[tauri::command]
pub fn sidecar_status(
    state: tauri::State<'_, RuntimeState>,
) -> Result<SidecarStatusResult, String> {
    let mut sidecar = state
        .sidecar
        .lock()
        .map_err(|_| "sidecar 进程锁不可用。".to_string())?;
    let running = match sidecar.as_mut() {
        Some(managed) => matches!(managed.child.try_wait(), Ok(None)),
        None => false,
    };
    Ok(SidecarStatusResult {
        ok: true,
        running,
        message: if running {
            "sidecar 由 Tauri 托管并正在运行。"
        } else {
            "sidecar 当前未运行。"
        }
        .to_string(),
    })
}

#[tauri::command]
pub fn sidecar_restart(
    state: tauri::State<'_, RuntimeState>,
) -> Result<SidecarStatusResult, String> {
    let mut sidecar = state
        .sidecar
        .lock()
        .map_err(|_| "sidecar 进程锁不可用。".to_string())?;
    stop_sidecar(&mut sidecar);
    *sidecar = Some(start_sidecar()?);
    Ok(SidecarStatusResult {
        ok: true,
        running: true,
        message: "sidecar 已由 Tauri 重启。".to_string(),
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

    fn test_directory(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("astraflow-{name}-{}-{nanos}", std::process::id()))
    }

    #[test]
    fn initializes_sqlite_schema() {
        let directory = test_directory("schema");
        let runtime = RuntimeState::new(directory.clone()).expect("runtime should initialize");
        let db = runtime.db.lock().expect("sqlite should be available");
        let table_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (
                    'schema_migrations', 'memories', 'mcp_servers', 'audit_events',
                    'task_checkpoints', 'tasks', 'usage_entries', 'runtime_logs',
                    'permission_audit_events', 'agent_jobs', 'agent_steps'
                )",
                [],
                |row| row.get(0),
            )
            .expect("schema query should work");
        assert_eq!(table_count, 11);
        let migration_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE id = '2026-06-03-runtime-persistence'",
                [],
                |row| row.get(0),
            )
            .expect("migration query should work");
        assert_eq!(migration_count, 1);
        drop(db);
        if directory.exists() {
            std::fs::remove_dir_all(directory)
                .expect("temporary runtime directory should be removable");
        }
    }

    #[test]
    fn persists_task_usage_and_logs() {
        let directory = test_directory("persistence");
        let runtime = RuntimeState::new(directory.clone()).expect("runtime should initialize");
        let db = runtime.db.lock().expect("sqlite should be available");
        let task = json!({
            "id": "task-test",
            "title": "test",
            "input": "test",
            "executionMode": "plan",
            "status": "planned",
            "riskLevel": "low",
            "createdAt": "2026-06-03T00:00:00Z",
            "updatedAt": "2026-06-03T00:00:01Z"
        });
        upsert_task_checkpoint(
            &db,
            &TaskCheckpointPayload {
                id: "task-test".to_string(),
                status: "planned".to_string(),
                task,
                plan: Some(json!({ "taskId": "task-test", "steps": [] })),
            },
        )
        .expect("task checkpoint should persist");
        db.execute(
            "INSERT INTO usage_entries (
              id, task_id, provider_id, model, prompt_tokens, completion_tokens,
              embedding_tokens, cached_tokens, cache_cost_usd, cost_usd, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                "usage-test",
                "task-test",
                "provider",
                "model",
                10,
                5,
                0,
                2,
                0.1,
                0.2,
                "2026-06-03T00:00:02Z"
            ],
        )
        .expect("usage should persist");
        db.execute(
            "INSERT INTO runtime_logs (id, task_id, level, message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                "log-test",
                "task-test",
                "info",
                "hello",
                "2026-06-03T00:00:03Z"
            ],
        )
        .expect("log should persist");

        let task_count: i64 = db
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .expect("task count should work");
        let usage_count: i64 = db
            .query_row("SELECT COUNT(*) FROM usage_entries", [], |row| row.get(0))
            .expect("usage count should work");
        let log_count: i64 = db
            .query_row("SELECT COUNT(*) FROM runtime_logs", [], |row| row.get(0))
            .expect("log count should work");
        assert_eq!(task_count, 1);
        assert_eq!(usage_count, 1);
        assert_eq!(log_count, 1);
        drop(db);
        if directory.exists() {
            std::fs::remove_dir_all(directory)
                .expect("temporary runtime directory should be removable");
        }
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
