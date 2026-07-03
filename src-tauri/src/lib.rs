mod branch_pool;
mod diagnostics;
mod diff;
mod error;
mod executable;
mod external_tool;
mod path_utils;
mod shadow;
mod staging;
mod svn;
mod system_integration;
mod task;
mod task_workspace;
mod workspace;

use branch_pool::{BranchPool, RemoveBranchPoolEntryRequest, SaveBranchPoolEntryRequest};
use diagnostics::DiagnosticExport;
use diff::{GenerateSelectedPatchRequest, ParsedDiff, SelectedPatch};
use error::{CommandResponse, CommandResult, HealthPayload, NovaError};
use external_tool::{
    ExternalToolLaunch, LaunchExternalToolRequest, OpenFileLocation, OpenFileLocationRequest,
    OpenGeneratedFileLocation, OpenGeneratedFileLocationRequest, OpenWorkspaceFile,
    OpenWorkspaceFileRequest,
};
use shadow::{ShadowWorkspaceRequest, ShadowWorkspaceStatus};
use svn::{DetectSvnRequest, SvnClient, SvnDetection};
use system_integration::StartupIntent;
use task::{
    CreateBranchCheckoutTaskRequest, CreateCommitTaskRequest, CreateMergeTaskRequest,
    CreateMockTaskRequest, CreatePartialCommitTaskRequest, CreateRepositoryCopyTaskRequest,
    CreateRepositoryListTaskRequest, CreateRevisionDiffTaskRequest,
    CreateShadowWorkspaceTaskRequest, CreateSvnOperationTaskRequest, CreateSvnSwitchTaskRequest,
    Task, TaskQueue, TaskSnapshot,
};
use task_workspace::{RemoveTaskWorkspaceRequest, SaveTaskWorkspaceRequest, TaskWorkspaceList};
use tauri::Manager;
use workspace::{
    FileContentDiff, FileDiff, GetFileContentDiffRequest, GetFileDiffRequest, GetSvnLogRequest,
    GetSvnPropertiesRequest, OpenWorkspaceRequest, RecentWorkspace, ScanWorkspaceStatusRequest,
    SetSvnPropertyRequest, SvnLog, SvnProperties, WorkingCopyStatus, WorkspaceSummary,
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
fn get_startup_intent() -> CommandResult<StartupIntent> {
    Ok(CommandResponse::success(
        system_integration::startup_intent(),
    ))
}

#[tauri::command]
fn launch_external_tool(request: LaunchExternalToolRequest) -> CommandResult<ExternalToolLaunch> {
    println!("[NovaSVN] launch_external_tool command received");
    Ok(CommandResponse::success(
        external_tool::launch_external_tool(request)?,
    ))
}

#[tauri::command]
fn open_file_location(request: OpenFileLocationRequest) -> CommandResult<OpenFileLocation> {
    println!("[NovaSVN] open_file_location command received");
    Ok(CommandResponse::success(external_tool::open_file_location(
        request,
    )?))
}

#[tauri::command]
fn open_workspace_file(request: OpenWorkspaceFileRequest) -> CommandResult<OpenWorkspaceFile> {
    println!("[NovaSVN] open_workspace_file command received");
    Ok(CommandResponse::success(
        external_tool::open_workspace_file(request)?,
    ))
}

#[tauri::command]
fn open_generated_file_location(
    app: tauri::AppHandle,
    request: OpenGeneratedFileLocationRequest,
) -> CommandResult<OpenGeneratedFileLocation> {
    println!("[NovaSVN] open_generated_file_location command received");
    let generated_root = app
        .path()
        .app_data_dir()
        .map_err(|error| {
            NovaError::command(
                "APP_DATA_DIR_FAILED",
                "无法获取应用数据目录",
                Some(error.to_string()),
                true,
            )
        })?
        .join("revision-diff-patches");
    Ok(CommandResponse::success(
        external_tool::open_generated_file_location(&generated_root, request)?,
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
fn create_partial_commit_task(
    app: tauri::AppHandle,
    queue: tauri::State<'_, TaskQueue>,
    request: CreatePartialCommitTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_partial_commit_task command received");
    Ok(CommandResponse::success(
        queue.create_partial_commit_task(&app, request)?,
    ))
}

#[tauri::command]
fn create_repository_list_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryListTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_list_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_list_task(request)?,
    ))
}

#[tauri::command]
fn create_repository_copy_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryCopyTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_copy_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_copy_task(request)?,
    ))
}

#[tauri::command]
fn create_branch_checkout_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateBranchCheckoutTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_branch_checkout_task command received");
    Ok(CommandResponse::success(
        queue.create_branch_checkout_task(request)?,
    ))
}

#[tauri::command]
fn create_svn_switch_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateSvnSwitchTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_svn_switch_task command received");
    Ok(CommandResponse::success(
        queue.create_svn_switch_task(request)?,
    ))
}

#[tauri::command]
fn create_revision_diff_task(
    app: tauri::AppHandle,
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRevisionDiffTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_revision_diff_task command received");
    Ok(CommandResponse::success(
        queue.create_revision_diff_task(&app, request)?,
    ))
}

#[tauri::command]
fn create_merge_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateMergeTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_merge_task command received");
    Ok(CommandResponse::success(queue.create_merge_task(request)?))
}

#[tauri::command]
fn get_branch_pool(app: tauri::AppHandle) -> CommandResult<BranchPool> {
    Ok(CommandResponse::success(branch_pool::read_branch_pool(
        &app,
    )?))
}

#[tauri::command]
fn save_branch_pool_entry(
    app: tauri::AppHandle,
    request: SaveBranchPoolEntryRequest,
) -> CommandResult<BranchPool> {
    Ok(CommandResponse::success(
        branch_pool::save_branch_pool_entry(&app, request)?,
    ))
}

#[tauri::command]
fn remove_branch_pool_entry(
    app: tauri::AppHandle,
    request: RemoveBranchPoolEntryRequest,
) -> CommandResult<BranchPool> {
    Ok(CommandResponse::success(
        branch_pool::remove_branch_pool_entry(&app, request)?,
    ))
}

#[tauri::command]
fn get_task_workspaces(app: tauri::AppHandle) -> CommandResult<TaskWorkspaceList> {
    Ok(CommandResponse::success(
        task_workspace::read_task_workspaces(&app)?,
    ))
}

#[tauri::command]
fn save_task_workspace(
    app: tauri::AppHandle,
    request: SaveTaskWorkspaceRequest,
) -> CommandResult<TaskWorkspaceList> {
    Ok(CommandResponse::success(
        task_workspace::save_task_workspace(&app, request)?,
    ))
}

#[tauri::command]
fn remove_task_workspace(
    app: tauri::AppHandle,
    request: RemoveTaskWorkspaceRequest,
) -> CommandResult<TaskWorkspaceList> {
    Ok(CommandResponse::success(
        task_workspace::remove_task_workspace(&app, request)?,
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
fn get_svn_log(request: GetSvnLogRequest) -> CommandResult<SvnLog> {
    println!("[NovaSVN] get_svn_log command received");
    Ok(CommandResponse::success(workspace::get_svn_log(request)?))
}

#[tauri::command]
fn get_svn_properties(request: GetSvnPropertiesRequest) -> CommandResult<SvnProperties> {
    println!("[NovaSVN] get_svn_properties command received");
    Ok(CommandResponse::success(workspace::get_svn_properties(
        request,
    )?))
}

#[tauri::command]
fn set_svn_property(request: SetSvnPropertyRequest) -> CommandResult<SvnProperties> {
    println!("[NovaSVN] set_svn_property command received");
    Ok(CommandResponse::success(workspace::set_svn_property(
        request,
    )?))
}

#[tauri::command]
fn parse_unified_diff(diff_text: String) -> CommandResult<ParsedDiff> {
    println!("[NovaSVN] parse_unified_diff command received");
    Ok(CommandResponse::success(diff::parse_unified_diff(
        &diff_text,
    )))
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
    Ok(CommandResponse::success(shadow::shadow_status(
        &app, &request,
    )?))
}

#[tauri::command]
fn export_diagnostics(
    app: tauri::AppHandle,
    queue: tauri::State<'_, TaskQueue>,
) -> CommandResult<DiagnosticExport> {
    println!("[NovaSVN] export_diagnostics command received");
    Ok(CommandResponse::success(diagnostics::export_diagnostics(
        &app, &queue,
    )?))
}

pub fn run() {
    tauri::Builder::default()
        .manage(TaskQueue::new())
        .setup(|app| {
            diagnostics::install_panic_hook(app.path().app_data_dir()?);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            fail_for_preview,
            get_startup_intent,
            launch_external_tool,
            open_file_location,
            open_workspace_file,
            open_generated_file_location,
            create_mock_task,
            create_commit_task,
            create_svn_operation_task,
            create_shadow_workspace_task,
            create_partial_commit_task,
            create_repository_list_task,
            create_repository_copy_task,
            create_branch_checkout_task,
            create_svn_switch_task,
            create_revision_diff_task,
            create_merge_task,
            get_branch_pool,
            save_branch_pool_entry,
            remove_branch_pool_entry,
            get_task_workspaces,
            save_task_workspace,
            remove_task_workspace,
            list_tasks,
            get_task,
            cancel_task,
            detect_svn,
            open_workspace,
            get_recent_workspace,
            scan_workspace_status,
            get_file_diff,
            get_file_content_diff,
            get_svn_log,
            get_svn_properties,
            set_svn_property,
            parse_unified_diff,
            generate_selected_patch,
            get_shadow_workspace_status,
            export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("启动 NovaSVN 失败");
}
