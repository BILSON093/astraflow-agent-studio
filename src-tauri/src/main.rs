#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Instant;
use tauri::Manager;

mod runtime;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "studio.astraflow.agent.provider";

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProviderConfig {
    id: String,
    name: String,
    kind: String,
    base_url: String,
    model: String,
    context_window: u64,
    input_price_per_m_tok: f64,
    output_price_per_m_tok: f64,
    cache_read_price_per_m_tok: Option<f64>,
    tags: Vec<String>,
    enabled: bool,
    masked_key: Option<String>,
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderCommandPayload {
    provider: ProviderConfig,
    api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderTestResult {
    ok: bool,
    message: String,
    latency_ms: u128,
    prompt_tokens: u64,
    completion_tokens: u64,
    cost_usd: f64,
    masked_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderSaveResult {
    ok: bool,
    message: String,
    masked_key: String,
    stored_in_keychain: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderDeleteSecretResult {
    ok: bool,
    message: String,
    masked_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderDeleteSecretPayload {
    provider_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
}

#[derive(Debug)]
struct ProviderRequest {
    url: String,
    headers: Vec<(String, String)>,
    body: Value,
}

fn ok(command: &str, payload: Option<Value>) -> Value {
    json!({
        "ok": true,
        "command": command,
        "payload": payload.unwrap_or_else(|| json!({}))
    })
}

fn provider_account(provider_id: &str) -> String {
    format!("provider:{provider_id}:api-key")
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn keychain_entry(provider_id: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, &provider_account(provider_id))
        .map_err(|error| format!("系统钥匙串不可用：{error}"))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn save_provider_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    keychain_entry(provider_id)?
        .set_password(api_key)
        .map_err(|error| format!("保存 API Key 失败：{error}"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn save_provider_key(_provider_id: &str, _api_key: &str) -> Result<(), String> {
    Err("当前平台尚未启用系统钥匙串。".to_string())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn load_provider_key(provider_id: &str) -> Result<Option<String>, String> {
    match keychain_entry(provider_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取 API Key 失败：{error}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn load_provider_key(_provider_id: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn delete_provider_key(provider_id: &str) -> Result<(), String> {
    match keychain_entry(provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("删除 API Key 失败：{error}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn delete_provider_key(_provider_id: &str) -> Result<(), String> {
    Ok(())
}

fn mask_key(api_key: &str) -> String {
    let chars: Vec<char> = api_key.chars().collect();

    if chars.len() <= 8 {
        return "***".to_string();
    }

    let prefix: String = chars.iter().take(3).collect();
    let suffix: String = chars
        .iter()
        .rev()
        .take(4)
        .collect::<Vec<&char>>()
        .into_iter()
        .rev()
        .collect();

    format!("{prefix}...{suffix}")
}

fn provider_needs_api_key(provider: &ProviderConfig) -> bool {
    provider.kind != "ollama"
}

fn join_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn build_provider_request(provider: &ProviderConfig, api_key: Option<&str>) -> ProviderRequest {
    match provider.kind.as_str() {
        "anthropic" => ProviderRequest {
            url: join_url(&provider.base_url, "/v1/messages"),
            headers: vec![
                ("content-type".to_string(), "application/json".to_string()),
                (
                    "x-api-key".to_string(),
                    api_key.unwrap_or_default().to_string(),
                ),
                ("anthropic-version".to_string(), "2023-06-01".to_string()),
            ],
            body: json!({
                "model": provider.model,
                "max_tokens": 16,
                "messages": [{ "role": "user", "content": "ping" }]
            }),
        },
        "gemini" => ProviderRequest {
            url: join_url(
                &provider.base_url,
                &format!("/models/{}:generateContent", provider.model),
            ),
            headers: vec![
                ("content-type".to_string(), "application/json".to_string()),
                (
                    "x-goog-api-key".to_string(),
                    api_key.unwrap_or_default().to_string(),
                ),
            ],
            body: json!({
                "contents": [{ "parts": [{ "text": "ping" }] }]
            }),
        },
        _ => {
            let mut headers = vec![("content-type".to_string(), "application/json".to_string())];

            if let Some(key) = api_key {
                if provider.kind == "mimo" {
                    headers.push(("api-key".to_string(), key.to_string()));
                } else if provider.kind != "ollama" {
                    headers.push(("authorization".to_string(), format!("Bearer {key}")));
                }
            }

            ProviderRequest {
                url: join_url(&provider.base_url, "/chat/completions"),
                headers,
                body: json!({
                    "model": provider.model,
                    "messages": [{ "role": "user", "content": "ping" }],
                    "max_tokens": 16,
                    "temperature": 0
                }),
            }
        }
    }
}

fn parse_usage(provider: &ProviderConfig, json: &Value) -> ProviderUsage {
    match provider.kind.as_str() {
        "anthropic" => {
            let usage = &json["usage"];
            ProviderUsage {
                prompt_tokens: usage["input_tokens"].as_u64().unwrap_or(0),
                completion_tokens: usage["output_tokens"].as_u64().unwrap_or(0),
            }
        }
        "gemini" => {
            let usage = &json["usageMetadata"];
            ProviderUsage {
                prompt_tokens: usage["promptTokenCount"].as_u64().unwrap_or(0),
                completion_tokens: usage["candidatesTokenCount"].as_u64().unwrap_or(0),
            }
        }
        _ => {
            let usage = &json["usage"];
            ProviderUsage {
                prompt_tokens: usage["prompt_tokens"].as_u64().unwrap_or(0),
                completion_tokens: usage["completion_tokens"].as_u64().unwrap_or(0),
            }
        }
    }
}

fn calculate_cost(provider: &ProviderConfig, prompt_tokens: u64, completion_tokens: u64) -> f64 {
    (prompt_tokens as f64 / 1_000_000.0 * provider.input_price_per_m_tok)
        + (completion_tokens as f64 / 1_000_000.0 * provider.output_price_per_m_tok)
}

fn read_provider_payload(payload: Option<Value>) -> Result<ProviderCommandPayload, String> {
    let payload = payload.ok_or_else(|| "缺少 Provider payload。".to_string())?;
    serde_json::from_value(payload).map_err(|error| format!("Provider payload 格式错误：{error}"))
}

fn extract_error_message(json: &Value, fallback: &str) -> String {
    if let Some(message) = json["error"]["message"].as_str() {
        return message.to_string();
    }

    if let Some(error) = json["error"].as_str() {
        return error.to_string();
    }

    fallback.to_string()
}

#[tauri::command]
fn task_create(payload: Option<Value>) -> Value {
    ok("task.create", payload)
}

#[tauri::command]
fn task_approve_plan(payload: Option<Value>) -> Value {
    ok("task.approvePlan", payload)
}

#[tauri::command]
fn task_pause(payload: Option<Value>) -> Value {
    ok("task.pause", payload)
}

#[tauri::command]
fn task_resume(payload: Option<Value>) -> Value {
    ok("task.resume", payload)
}

#[tauri::command]
fn task_cancel(payload: Option<Value>) -> Value {
    ok("task.cancel", payload)
}

#[tauri::command]
async fn provider_test(payload: Option<Value>) -> Result<ProviderTestResult, String> {
    let payload = read_provider_payload(payload)?;
    let provider = payload.provider;
    let started_at = Instant::now();
    let api_key = match payload.api_key.filter(|key| !key.trim().is_empty()) {
        Some(key) => Some(key),
        None => load_provider_key(&provider.id)?,
    };

    if provider_needs_api_key(&provider) && api_key.is_none() {
        return Ok(ProviderTestResult {
            ok: false,
            message: "需要先保存 API Key 到系统钥匙串，才能进行真实连通测试。".to_string(),
            latency_ms: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            cost_usd: 0.0,
            masked_key: None,
        });
    }

    let request = build_provider_request(&provider, api_key.as_deref());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("创建 HTTP Client 失败：{error}"))?;
    let mut builder = client.post(request.url);

    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }

    let response = match builder.json(&request.body).send().await {
        Ok(response) => response,
        Err(error) => {
            return Ok(ProviderTestResult {
                ok: false,
                message: format!("连接失败：{error}"),
                latency_ms: started_at.elapsed().as_millis(),
                prompt_tokens: 0,
                completion_tokens: 0,
                cost_usd: 0.0,
                masked_key: api_key.as_deref().map(mask_key),
            });
        }
    };
    let latency_ms = started_at.elapsed().as_millis();
    let status = response.status();
    let json = response
        .json::<Value>()
        .await
        .unwrap_or_else(|_| json!({ "error": { "message": status.to_string() } }));

    if !status.is_success() {
        return Ok(ProviderTestResult {
            ok: false,
            message: extract_error_message(&json, &status.to_string()),
            latency_ms,
            prompt_tokens: 0,
            completion_tokens: 0,
            cost_usd: 0.0,
            masked_key: api_key.as_deref().map(mask_key),
        });
    }

    let usage = parse_usage(&provider, &json);

    Ok(ProviderTestResult {
        ok: true,
        message: format!("连接成功，延迟 {latency_ms}ms。"),
        latency_ms,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        cost_usd: calculate_cost(&provider, usage.prompt_tokens, usage.completion_tokens),
        masked_key: api_key.as_deref().map(mask_key),
    })
}

#[tauri::command]
fn provider_save(payload: Option<Value>) -> Result<ProviderSaveResult, String> {
    let payload = read_provider_payload(payload)?;
    let api_key = payload
        .api_key
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());

    if let Some(key) = api_key {
        save_provider_key(&payload.provider.id, &key)?;

        return Ok(ProviderSaveResult {
            ok: true,
            message: "API Key 已保存到系统钥匙串。".to_string(),
            masked_key: mask_key(&key),
            stored_in_keychain: true,
        });
    }

    Ok(ProviderSaveResult {
        ok: true,
        message: "未提供新的 API Key，保留现有钥匙串记录。".to_string(),
        masked_key: payload
            .provider
            .masked_key
            .unwrap_or_else(|| "未配置".to_string()),
        stored_in_keychain: false,
    })
}

#[tauri::command]
fn provider_delete_secret(payload: Option<Value>) -> Result<ProviderDeleteSecretResult, String> {
    let payload = payload.ok_or_else(|| "缺少 Provider payload。".to_string())?;
    let payload: ProviderDeleteSecretPayload = serde_json::from_value(payload)
        .map_err(|error| format!("Provider payload 格式错误：{error}"))?;

    delete_provider_key(&payload.provider_id)?;

    Ok(ProviderDeleteSecretResult {
        ok: true,
        message: "API Key 已从系统钥匙串删除。".to_string(),
        masked_key: "未配置".to_string(),
    })
}

#[tauri::command]
fn skill_install(payload: Option<Value>) -> Value {
    ok("skill.install", payload)
}

#[tauri::command]
fn skill_enable(payload: Option<Value>) -> Value {
    ok("skill.enable", payload)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("解析应用数据目录失败：{error}"))?;
            app.manage(runtime::RuntimeState::new(data_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            task_create,
            task_approve_plan,
            task_pause,
            task_resume,
            task_cancel,
            provider_test,
            provider_save,
            provider_delete_secret,
            runtime::runtime_status,
            runtime::memory_search,
            runtime::memory_update,
            runtime::memory_delete,
            runtime::mcp_install,
            runtime::mcp_enable,
            runtime::mcp_status,
            runtime::mcp_list_tools,
            runtime::mcp_call_tool,
            runtime::task_checkpoint,
            runtime::task_restore,
            runtime::task_list,
            runtime::usage_report,
            runtime::usage_list,
            runtime::runtime_log_append,
            runtime::runtime_logs_list,
            runtime::permission_audit_append,
            runtime::agent_job_upsert,
            runtime::agent_step_upsert,
            runtime::agent_jobs_list,
            runtime::sidecar_status,
            runtime::sidecar_restart,
            runtime::shell_execute,
            skill_install,
            skill_enable
        ])
        .run(tauri::generate_context!())
        .expect("error while running AstraFlow Agent Studio");
}
