mod diff;
mod error;
mod shadow;
mod staging;
mod svn;
mod task;
mod workspace;

use diff::{GenerateSelectedPatchRequest, ParsedDiff, SelectedPatch};
use error::{CommandResponse, CommandResult, HealthPayload, NovaError};
use shadow::{ShadowWorkspaceRequest, ShadowWorkspaceStatus};
use svn::{DetectSvnRequest, SvnClient, SvnDetection};
use task::{
    CreateCommitTaskRequest, CreateMockTaskRequest, CreateShadowWorkspaceTaskRequest,
    CreateSvnOperationTaskRequest, Task, TaskQueue, TaskSnapshot,
};
use workspace::{
    FileContentDiff, FileDiff, GetFileContentDiffRequest, GetFileDiffRequest, OpenWorkspaceRequest,
    RecentWorkspace, ScanWorkspaceStatusRequest, WorkingCopyStatus, WorkspaceSummary,
};

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
fn create_commit_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateCommitTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_commit_task command received");
    Ok(CommandResponse::success(queue.create_commit_task(request)?))
}

#[tauri::command]
fn create_svn_operation_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateSvnOperationTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_svn_operation_task command received");
    Ok(CommandResponse::success(
        queue.create_svn_operation_task(request)?,
    ))
}

#[tauri::command]
fn create_shadow_workspace_task(
    app: tauri::AppHandle,
    queue: tauri::State<'_, TaskQueue>,
    request: CreateShadowWorkspaceTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_shadow_workspace_task command received");
    Ok(CommandResponse::success(
        queue.create_shadow_workspace_task(&app, request)?,
    ))
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

#[tauri::command]
fn open_workspace(
    app: tauri::AppHandle,
    request: OpenWorkspaceRequest,
) -> CommandResult<WorkspaceSummary> {
    println!("[NovaSVN] open_workspace command received");
    Ok(CommandResponse::success(workspace::open_workspace(
        &app, request,
    )?))
}

#[tauri::command]
fn get_recent_workspace(app: tauri::AppHandle) -> CommandResult<RecentWorkspace> {
    Ok(CommandResponse::success(workspace::read_recent_workspace(
        &app,
    )?))
}

#[tauri::command]
fn scan_workspace_status(request: ScanWorkspaceStatusRequest) -> CommandResult<WorkingCopyStatus> {
    println!("[NovaSVN] scan_workspace_status command received");
    Ok(CommandResponse::success(workspace::scan_workspace_status(
        request,
    )?))
}

#[tauri::command]
fn get_file_diff(request: GetFileDiffRequest) -> CommandResult<FileDiff> {
    println!("[NovaSVN] get_file_diff command received");
    Ok(CommandResponse::success(workspace::get_file_diff(request)?))
}

#[tauri::command]
fn get_file_content_diff(request: GetFileContentDiffRequest) -> CommandResult<FileContentDiff> {
    println!("[NovaSVN] get_file_content_diff command received");
    Ok(CommandResponse::success(workspace::get_file_content_diff(
        request,
    )?))
}

#[tauri::command]
fn parse_unified_diff(diff_text: String) -> CommandResult<ParsedDiff> {
    println!("[NovaSVN] parse_unified_diff command received");
    Ok(CommandResponse::success(diff::parse_unified_diff(&diff_text)))
}

#[tauri::command]
fn generate_selected_patch(request: GenerateSelectedPatchRequest) -> CommandResult<SelectedPatch> {
    println!("[NovaSVN] generate_selected_patch command received");
    Ok(CommandResponse::success(diff::generate_selected_patch(
        request,
    )))
}

#[tauri::command]
fn get_shadow_workspace_status(
    app: tauri::AppHandle,
    request: ShadowWorkspaceRequest,
) -> CommandResult<ShadowWorkspaceStatus> {
    println!("[NovaSVN] get_shadow_workspace_status command received");
    Ok(CommandResponse::success(shadow::shadow_status(&app, &request)?))
}

pub fn run() {
    tauri::Builder::default()
        .manage(TaskQueue::new())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            fail_for_preview,
            create_mock_task,
            create_commit_task,
            create_svn_operation_task,
            create_shadow_workspace_task,
            list_tasks,
            get_task,
            cancel_task,
            detect_svn,
            open_workspace,
            get_recent_workspace,
            scan_workspace_status,
            get_file_diff,
            get_file_content_diff,
            parse_unified_diff,
            generate_selected_patch,
            get_shadow_workspace_status,
        ])
        .run(tauri::generate_context!())
        .expect("启动 NovaSVN 失败");
}
