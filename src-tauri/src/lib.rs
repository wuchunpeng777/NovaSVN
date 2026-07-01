mod error;
mod staging;
mod svn;
mod task;
mod workspace;

use error::{CommandResponse, CommandResult, HealthPayload, NovaError};

#[tauri::command]
fn ping() -> CommandResult<HealthPayload> {
    println!("[NovaSVN] ping command received");
    Ok(CommandResponse::success(HealthPayload {
        message: "Rust 后端已连接".to_string(),
        backend: "tauri-rust".to_string(),
    }))
}

#[tauri::command]
fn fail_for_preview() -> CommandResult<()> {
    println!("[NovaSVN] fail_for_preview command received");
    Err(NovaError::command(
        "PREVIEW_ERROR",
        "这是用于验证 UI 错误展示的开发错误",
        Some("后续真实 SVN 错误会复用同一结构。".to_string()),
        true,
    ))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping, fail_for_preview])
        .run(tauri::generate_context!())
        .expect("启动 NovaSVN 失败");
}
