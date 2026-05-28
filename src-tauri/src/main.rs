#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};

fn ok(command: &str, payload: Option<Value>) -> Value {
    json!({
        "ok": true,
        "command": command,
        "payload": payload.unwrap_or_else(|| json!({}))
    })
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
fn provider_test(payload: Option<Value>) -> Value {
    ok("provider.test", payload)
}

#[tauri::command]
fn provider_save(payload: Option<Value>) -> Value {
    ok("provider.save", payload)
}

#[tauri::command]
fn memory_search(payload: Option<Value>) -> Value {
    ok("memory.search", payload)
}

#[tauri::command]
fn memory_update(payload: Option<Value>) -> Value {
    ok("memory.update", payload)
}

#[tauri::command]
fn mcp_install(payload: Option<Value>) -> Value {
    ok("mcp.install", payload)
}

#[tauri::command]
fn mcp_enable(payload: Option<Value>) -> Value {
    ok("mcp.enable", payload)
}

#[tauri::command]
fn skill_install(payload: Option<Value>) -> Value {
    ok("skill.install", payload)
}

#[tauri::command]
fn skill_enable(payload: Option<Value>) -> Value {
    ok("skill.enable", payload)
}

#[tauri::command]
fn usage_report(payload: Option<Value>) -> Value {
    ok("usage.report", payload)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            task_create,
            task_approve_plan,
            task_pause,
            task_resume,
            task_cancel,
            provider_test,
            provider_save,
            memory_search,
            memory_update,
            mcp_install,
            mcp_enable,
            skill_install,
            skill_enable,
            usage_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running AstraFlow Agent Studio");
}
