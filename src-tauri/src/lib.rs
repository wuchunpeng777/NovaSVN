mod error;
mod staging;
mod svn;
mod task;
mod workspace;

use error::{CommandResponse, CommandResult, HealthPayload, NovaError};
use svn::{DetectSvnRequest, SvnClient, SvnDetection};
use task::{CreateMockTaskRequest, Task, TaskQueue, TaskSnapshot};

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

#[tauri::command]
fn create_mock_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateMockTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_mock_task command received");
    Ok(CommandResponse::success(queue.create_mock_task(request)))
}

#[tauri::command]
fn list_tasks(queue: tauri::State<'_, TaskQueue>) -> CommandResult<TaskSnapshot> {
    Ok(CommandResponse::success(queue.list_tasks()))
}

#[tauri::command]
fn get_task(queue: tauri::State<'_, TaskQueue>, task_id: String) -> CommandResult<Task> {
    Ok(CommandResponse::success(queue.get_task(&task_id)?))
}

#[tauri::command]
fn cancel_task(queue: tauri::State<'_, TaskQueue>, task_id: String) -> CommandResult<Task> {
    Ok(CommandResponse::success(queue.cancel_task(&task_id)?))
}

#[tauri::command]
fn detect_svn(request: DetectSvnRequest) -> CommandResult<SvnDetection> {
    println!("[NovaSVN] detect_svn command received");
    Ok(CommandResponse::success(SvnClient::detect(request)?))
}

pub fn run() {
    tauri::Builder::default()
        .manage(TaskQueue::new())
        .invoke_handler(tauri::generate_handler![
            ping,
            fail_for_preview,
            create_mock_task,
            list_tasks,
            get_task,
            cancel_task,
            detect_svn,
        ])
        .run(tauri::generate_context!())
        .expect("启动 NovaSVN 失败");
}
