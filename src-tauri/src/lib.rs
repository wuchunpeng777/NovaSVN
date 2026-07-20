mod branch_pool;
mod diagnostics;
mod diff;
mod error;
mod executable;
mod external_tool;
mod path_utils;
pub mod performance_benchmark;
mod redaction;
mod shadow;
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
    OpenGeneratedFileLocation, OpenGeneratedFileLocationRequest, OpenLocalPathLocation,
    OpenLocalPathLocationRequest, OpenRepositoryTempFile, OpenRepositoryTempFileRequest,
    OpenWorkspaceFile, OpenWorkspaceFileRequest,
};
use shadow::{ShadowWorkspaceRequest, ShadowWorkspaceStatus};
use svn::{
    ConfigureSvnAuthenticationRequest, ConfigureSvnCertificateTrustRequest, DetectSvnRequest,
    SvnAuthenticationStatus, SvnCertificateTrustStatus, SvnClient, SvnDetection,
};
use system_integration::StartupIntent;
use task::{
    CreateApplyPatchTaskRequest, CreateBranchCheckoutTaskRequest, CreateCommitTaskRequest,
    CreateMergeTaskRequest, CreateMockTaskRequest, CreatePartialCommitTaskRequest,
    CreateRepositoryCheckoutTaskRequest, CreateRepositoryCopyTaskRequest,
    CreateRepositoryDeleteTaskRequest, CreateRepositoryDragExportTaskRequest,
    CreateRepositoryExportTaskRequest, CreateRepositoryFileTaskRequest,
    CreateRepositoryImportTaskRequest, CreateRepositoryListTaskRequest,
    CreateRepositoryMkdirTaskRequest, CreateRepositoryMoveTaskRequest,
    CreateRevertRevisionTaskRequest, CreateRevisionDiffTaskRequest,
    CreateShadowWorkspaceTaskRequest, CreateSvnBatchOperationTaskRequest,
    CreateSvnOperationTaskRequest, CreateSvnSwitchTaskRequest, Task, TaskQueue, TaskSnapshot,
};
use task_workspace::{RemoveTaskWorkspaceRequest, SaveTaskWorkspaceRequest, TaskWorkspaceList};
use tauri::{Emitter, Manager};
use workspace::{
    FileContentDiff, FileDiff, GetFileContentDiffRequest, GetFileDiffRequest, GetPathSvnLogRequest,
    GetRepositoryFileBlameRequest, GetRepositoryFileLogRequest, GetRepositoryFilePropertiesRequest,
    GetSvnBlameRequest, GetSvnLogRequest, GetSvnPropertiesRequest, IgnoreWorkspacePathRequest,
    InspectUpdateTargetRequest, ListWorkspaceFilesRequest, OpenWorkspaceRequest, RecentWorkspace,
    ScanWorkspaceStatusRequest, SetSvnPropertyRequest, SvnBlame, SvnLog, SvnProperties,
    UpdateTargetSummary, WorkingCopyStatus, WorkspaceFileTree, WorkspaceSummary,
};

#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
struct AppMenuState {
    workspace_open: bool,
    workspace_busy: bool,
    active_path: Option<String>,
    active_label: Option<String>,
    commit_selected: bool,
    can_open: bool,
    can_show: bool,
    can_commit: bool,
    can_update: bool,
    can_add: bool,
    can_resolve: bool,
    can_revert: bool,
    can_move: bool,
    can_copy: bool,
    can_ignore: bool,
    can_delete: bool,
}

fn app_menu_error(message: impl Into<String>, detail: impl Into<String>) -> NovaError {
    NovaError::command("APP_MENU_UPDATE_FAILED", message, Some(detail.into()), true)
}

fn app_submenu<R: tauri::Runtime>(
    parent: &tauri::menu::Menu<R>,
    id: &str,
) -> Result<tauri::menu::Submenu<R>, NovaError> {
    parent
        .get(id)
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| app_menu_error("无法更新应用菜单", format!("缺少原生子菜单：{id}")))
}

fn nested_submenu<R: tauri::Runtime>(
    parent: &tauri::menu::Submenu<R>,
    id: &str,
) -> Result<tauri::menu::Submenu<R>, NovaError> {
    parent
        .get(id)
        .and_then(|item| item.as_submenu().cloned())
        .ok_or_else(|| app_menu_error("无法更新应用菜单", format!("缺少原生子菜单：{id}")))
}

fn set_menu_item_enabled<R: tauri::Runtime>(
    menu: &tauri::menu::Submenu<R>,
    id: &str,
    enabled: bool,
) -> Result<(), NovaError> {
    let item = menu
        .get(id)
        .and_then(|item| item.as_menuitem().cloned())
        .ok_or_else(|| app_menu_error("无法更新应用菜单", format!("缺少原生菜单项：{id}")))?;
    item.set_enabled(enabled)
        .map_err(|error| app_menu_error("无法更新应用菜单状态", error.to_string()))
}

fn set_menu_item_text<R: tauri::Runtime>(
    menu: &tauri::menu::Submenu<R>,
    id: &str,
    text: &str,
) -> Result<(), NovaError> {
    let item = menu
        .get(id)
        .and_then(|item| item.as_menuitem().cloned())
        .ok_or_else(|| app_menu_error("无法更新应用菜单", format!("缺少原生菜单项：{id}")))?;
    item.set_text(text)
        .map_err(|error| app_menu_error("无法更新应用菜单文本", error.to_string()))
}

fn normalized_menu_path_label(label: Option<&str>) -> String {
    let cleaned = label
        .unwrap_or("未选择路径")
        .replace(['\r', '\n'], " ")
        .replace('&', "&&");
    let mut chars = cleaned.chars();
    let visible: String = chars.by_ref().take(64).collect();
    if chars.next().is_some() {
        format!("当前：{visible}...")
    } else {
        format!("当前：{visible}")
    }
}

#[cfg(test)]
mod app_menu_tests {
    use super::normalized_menu_path_label;

    #[test]
    fn path_label_escapes_mnemonics_and_limits_length() {
        assert_eq!(
            normalized_menu_path_label(Some("release&notes.txt\nnext")),
            "当前：release&&notes.txt next"
        );
        let long_label = "a".repeat(80);
        let normalized = normalized_menu_path_label(Some(&long_label));
        assert!(normalized.ends_with("..."));
        assert_eq!(normalized.chars().count(), 70);
    }
}

fn apply_app_menu_state<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state: &AppMenuState,
) -> Result<(), NovaError> {
    let app_menu = app
        .menu()
        .ok_or_else(|| app_menu_error("无法更新应用菜单", "应用菜单尚未创建"))?;
    let file_menu = app_submenu(&app_menu, "file_menu")?;
    let working_copy_menu = app_submenu(&app_menu, "working_copy_menu")?;
    let current_path_menu = nested_submenu(&working_copy_menu, "current_path_menu")?;
    let workspace_available = state.workspace_open && !state.workspace_busy;

    set_menu_item_enabled(&file_menu, "refresh_status", workspace_available)?;
    for id in [
        "update_workspace",
        "cleanup_workspace",
        "refresh_log",
        "prepare_commit",
    ] {
        set_menu_item_enabled(&working_copy_menu, id, workspace_available)?;
    }

    let has_active_path = state.active_path.is_some();
    current_path_menu
        .set_enabled(has_active_path)
        .map_err(|error| app_menu_error("无法更新当前路径菜单状态", error.to_string()))?;
    set_menu_item_text(
        &current_path_menu,
        "path_label",
        &normalized_menu_path_label(state.active_label.as_deref()),
    )?;
    set_menu_item_text(
        &current_path_menu,
        "path_commit",
        if state.commit_selected {
            "移出 Commit(&M)"
        } else {
            "加入 Commit(&M)"
        },
    )?;

    for (id, enabled) in [
        ("path_open", state.can_open),
        ("path_show", state.can_show),
        ("path_commit", state.can_commit),
        ("path_update", state.can_update),
        ("path_add", state.can_add),
        ("path_resolve", state.can_resolve),
        ("path_revert", state.can_revert),
        ("path_move", state.can_move),
        ("path_copy", state.can_copy),
        ("path_ignore", state.can_ignore),
        ("path_delete", state.can_delete),
    ] {
        set_menu_item_enabled(&current_path_menu, id, has_active_path && enabled)?;
    }
    Ok(())
}

fn create_app_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let open_workspace = MenuItem::with_id(
        app,
        "open_workspace",
        "打开工作副本(&O)...",
        true,
        Some("Ctrl+O"),
    )?;
    let refresh_status =
        MenuItem::with_id(app, "refresh_status", "刷新状态(&R)", false, Some("Ctrl+R"))?;
    let export_diagnostics = MenuItem::with_id(
        app,
        "export_diagnostics",
        "导出诊断日志(&D)",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "退出(&X)", true, Some("Alt+F4"))?;
    let file_separator_a = PredefinedMenuItem::separator(app)?;
    let file_separator_b = PredefinedMenuItem::separator(app)?;
    let file_menu = Submenu::with_id_and_items(
        app,
        "file_menu",
        "文件(&F)",
        true,
        &[
            &open_workspace,
            &refresh_status,
            &file_separator_a,
            &export_diagnostics,
            &file_separator_b,
            &quit,
        ],
    )?;

    let undo = PredefinedMenuItem::undo(app, Some("撤销(&U)"))?;
    let redo = PredefinedMenuItem::redo(app, Some("重做(&R)"))?;
    let cut = PredefinedMenuItem::cut(app, Some("剪切(&T)"))?;
    let copy = PredefinedMenuItem::copy(app, Some("复制(&C)"))?;
    let paste = PredefinedMenuItem::paste(app, Some("粘贴(&P)"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("全选(&A)"))?;
    let edit_separator_a = PredefinedMenuItem::separator(app)?;
    let edit_separator_b = PredefinedMenuItem::separator(app)?;
    let edit_menu = Submenu::with_items(
        app,
        "编辑(&E)",
        true,
        &[
            &undo,
            &redo,
            &edit_separator_a,
            &cut,
            &copy,
            &paste,
            &edit_separator_b,
            &select_all,
        ],
    )?;

    let view_changes =
        MenuItem::with_id(app, "view_changes", "工作副本(&W)", true, Some("Ctrl+1"))?;
    let view_history = MenuItem::with_id(app, "view_history", "时间线(&T)", true, Some("Ctrl+2"))?;
    let view_repository =
        MenuItem::with_id(app, "view_repository", "仓库(&R)", true, Some("Ctrl+3"))?;
    let view_branches =
        MenuItem::with_id(app, "view_branches", "分支池(&B)", true, Some("Ctrl+4"))?;
    let view_settings = MenuItem::with_id(app, "view_settings", "设置(&S)", true, Some("Ctrl+,"))?;
    let view_menu = Submenu::with_items(
        app,
        "视图(&V)",
        true,
        &[
            &view_changes,
            &view_history,
            &view_repository,
            &view_branches,
            &view_settings,
        ],
    )?;

    let update_workspace =
        MenuItem::with_id(app, "update_workspace", "更新(&U)", false, Some("Ctrl+U"))?;
    let cleanup_workspace =
        MenuItem::with_id(app, "cleanup_workspace", "清理(&C)", false, None::<&str>)?;
    let refresh_log = MenuItem::with_id(app, "refresh_log", "刷新日志(&L)", false, Some("Ctrl+L"))?;
    let prepare_commit = MenuItem::with_id(app, "prepare_commit", "提交(&M)", false, None::<&str>)?;
    let working_copy_separator = PredefinedMenuItem::separator(app)?;
    let path_label = MenuItem::with_id(app, "path_label", "当前：未选择路径", false, None::<&str>)?;
    let path_open = MenuItem::with_id(app, "path_open", "打开(&O)", false, None::<&str>)?;
    let path_show = MenuItem::with_id(app, "path_show", "在文件夹中显示(&F)", false, None::<&str>)?;
    let path_commit =
        MenuItem::with_id(app, "path_commit", "加入 Commit(&M)", false, None::<&str>)?;
    let path_update = MenuItem::with_id(app, "path_update", "Update(&U)", false, None::<&str>)?;
    let path_add = MenuItem::with_id(app, "path_add", "Add(&A)", false, None::<&str>)?;
    let path_resolve = MenuItem::with_id(app, "path_resolve", "Resolve(&S)", false, None::<&str>)?;
    let path_revert = MenuItem::with_id(app, "path_revert", "Revert(&R)", false, None::<&str>)?;
    let path_move = MenuItem::with_id(app, "path_move", "Move(&V)", false, None::<&str>)?;
    let path_copy = MenuItem::with_id(app, "path_copy", "Copy(&C)", false, None::<&str>)?;
    let path_ignore = MenuItem::with_id(app, "path_ignore", "Ignore(&I)", false, None::<&str>)?;
    let path_delete = MenuItem::with_id(app, "path_delete", "Delete(&D)", false, None::<&str>)?;
    let path_separator_a = PredefinedMenuItem::separator(app)?;
    let path_separator_b = PredefinedMenuItem::separator(app)?;
    let path_separator_c = PredefinedMenuItem::separator(app)?;
    let current_path_menu = Submenu::with_id_and_items(
        app,
        "current_path_menu",
        "当前路径(&P)",
        false,
        &[
            &path_label,
            &path_separator_a,
            &path_open,
            &path_show,
            &path_separator_b,
            &path_commit,
            &path_update,
            &path_add,
            &path_resolve,
            &path_separator_c,
            &path_revert,
            &path_move,
            &path_copy,
            &path_ignore,
            &path_delete,
        ],
    )?;
    let working_copy_menu = Submenu::with_id_and_items(
        app,
        "working_copy_menu",
        "工作副本(&W)",
        true,
        &[
            &update_workspace,
            &cleanup_workspace,
            &working_copy_separator,
            &refresh_log,
            &prepare_commit,
            &current_path_menu,
        ],
    )?;

    let about = MenuItem::with_id(app, "about", "关于 NovaSVN(&A)", true, None::<&str>)?;
    let help_menu = Submenu::with_items(app, "帮助(&H)", true, &[&about])?;

    Menu::with_items(
        app,
        &[
            &file_menu,
            &edit_menu,
            &view_menu,
            &working_copy_menu,
            &help_menu,
        ],
    )
}

#[tauri::command]
fn sync_app_menu_state(app: tauri::AppHandle, state: AppMenuState) -> CommandResult<()> {
    apply_app_menu_state(&app, &state)?;
    Ok(CommandResponse::success(()))
}

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
fn open_local_path_location(
    request: OpenLocalPathLocationRequest,
) -> CommandResult<OpenLocalPathLocation> {
    println!("[NovaSVN] open_local_path_location command received");
    Ok(CommandResponse::success(
        external_tool::open_local_path_location(request)?,
    ))
}

#[tauri::command]
fn open_repository_temp_file(
    app: tauri::AppHandle,
    request: OpenRepositoryTempFileRequest,
) -> CommandResult<OpenRepositoryTempFile> {
    println!("[NovaSVN] open_repository_temp_file command received");
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
        .join("repository-files");
    Ok(CommandResponse::success(
        external_tool::open_repository_temp_file(&generated_root, request)?,
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
fn create_svn_batch_operation_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateSvnBatchOperationTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_svn_batch_operation_task command received");
    Ok(CommandResponse::success(
        queue.create_svn_batch_operation_task(request)?,
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
fn create_repository_file_task(
    app: tauri::AppHandle,
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryFileTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_file_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_file_task(&app, request)?,
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
fn create_repository_mkdir_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryMkdirTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_mkdir_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_mkdir_task(request)?,
    ))
}

#[tauri::command]
fn create_repository_import_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryImportTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_import_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_import_task(request)?,
    ))
}

#[tauri::command]
fn create_repository_move_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryMoveTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_move_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_move_task(request)?,
    ))
}

#[tauri::command]
fn create_repository_delete_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryDeleteTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_delete_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_delete_task(request)?,
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
fn create_repository_checkout_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryCheckoutTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_checkout_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_checkout_task(request)?,
    ))
}

#[tauri::command]
fn create_repository_export_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryExportTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_export_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_export_task(request)?,
    ))
}

#[tauri::command]
fn create_repository_drag_export_task(
    app: tauri::AppHandle,
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRepositoryDragExportTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_repository_drag_export_task command received");
    Ok(CommandResponse::success(
        queue.create_repository_drag_export_task(&app, request)?,
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
fn create_revert_revision_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateRevertRevisionTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_revert_revision_task command received");
    Ok(CommandResponse::success(
        queue.create_revert_revision_task(request)?,
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
fn create_apply_patch_task(
    queue: tauri::State<'_, TaskQueue>,
    request: CreateApplyPatchTaskRequest,
) -> CommandResult<Task> {
    println!("[NovaSVN] create_apply_patch_task command received");
    Ok(CommandResponse::success(
        queue.create_apply_patch_task(request)?,
    ))
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

async fn run_blocking_command<T, F>(label: &'static str, operation: F) -> Result<T, NovaError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, NovaError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            NovaError::command(
                "BACKGROUND_COMMAND_FAILED",
                format!("{label}异常结束"),
                Some(error.to_string()),
                true,
            )
        })?
}

#[tauri::command]
async fn detect_svn(request: DetectSvnRequest) -> CommandResult<SvnDetection> {
    println!("[NovaSVN] detect_svn command received");
    let detection = run_blocking_command("检测 SVN", move || SvnClient::detect(request)).await?;
    Ok(CommandResponse::success(detection))
}

#[tauri::command]
fn configure_svn_authentication(
    request: ConfigureSvnAuthenticationRequest,
) -> CommandResult<SvnAuthenticationStatus> {
    Ok(CommandResponse::success(svn::configure_authentication(
        request,
    )?))
}

#[tauri::command]
fn configure_svn_certificate_trust(
    request: ConfigureSvnCertificateTrustRequest,
) -> CommandResult<SvnCertificateTrustStatus> {
    Ok(CommandResponse::success(svn::configure_certificate_trust(
        request,
    )?))
}

#[tauri::command]
fn clear_svn_certificate_trust() -> CommandResult<SvnCertificateTrustStatus> {
    Ok(CommandResponse::success(svn::clear_certificate_trust()))
}

#[tauri::command]
async fn open_workspace(
    app: tauri::AppHandle,
    request: OpenWorkspaceRequest,
) -> CommandResult<WorkspaceSummary> {
    println!("[NovaSVN] open_workspace command received");
    let workspace = run_blocking_command("打开工作副本", move || {
        workspace::open_workspace(&app, request)
    })
    .await?;
    Ok(CommandResponse::success(workspace))
}

#[tauri::command]
async fn inspect_update_target(
    request: InspectUpdateTargetRequest,
) -> CommandResult<UpdateTargetSummary> {
    println!("[NovaSVN] inspect_update_target command received");
    let target = run_blocking_command("检查 Update 目标", move || {
        workspace::inspect_update_target(request)
    })
    .await?;
    Ok(CommandResponse::success(target))
}

#[tauri::command]
fn get_recent_workspace(app: tauri::AppHandle) -> CommandResult<RecentWorkspace> {
    Ok(CommandResponse::success(workspace::read_recent_workspace(
        &app,
    )?))
}

#[tauri::command]
async fn scan_workspace_status(
    request: ScanWorkspaceStatusRequest,
) -> CommandResult<WorkingCopyStatus> {
    println!("[NovaSVN] scan_workspace_status command received");
    let status = run_blocking_command("扫描工作副本状态", move || {
        workspace::scan_workspace_status(request)
    })
    .await?;
    Ok(CommandResponse::success(status))
}

#[tauri::command]
async fn list_workspace_files(
    request: ListWorkspaceFilesRequest,
) -> CommandResult<WorkspaceFileTree> {
    println!("[NovaSVN] list_workspace_files command received");
    let tree = run_blocking_command("读取工作副本文件树", move || {
        workspace::list_workspace_files(request)
    })
    .await?;
    Ok(CommandResponse::success(tree))
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
async fn get_svn_log(request: GetSvnLogRequest) -> CommandResult<SvnLog> {
    println!("[NovaSVN] get_svn_log command received");
    let log =
        run_blocking_command("读取 SVN 日志", move || workspace::get_svn_log(request)).await?;
    Ok(CommandResponse::success(log))
}

#[tauri::command]
async fn get_path_svn_log(request: GetPathSvnLogRequest) -> CommandResult<SvnLog> {
    println!("[NovaSVN] get_path_svn_log command received");
    let log = run_blocking_command("读取路径 SVN 日志", move || {
        workspace::get_path_svn_log(request)
    })
    .await?;
    Ok(CommandResponse::success(log))
}

#[tauri::command]
fn get_repository_file_log(request: GetRepositoryFileLogRequest) -> CommandResult<SvnLog> {
    println!("[NovaSVN] get_repository_file_log command received");
    Ok(CommandResponse::success(
        workspace::get_repository_file_log(request)?,
    ))
}

#[tauri::command]
fn get_svn_blame(request: GetSvnBlameRequest) -> CommandResult<SvnBlame> {
    println!("[NovaSVN] get_svn_blame command received");
    Ok(CommandResponse::success(workspace::get_svn_blame(request)?))
}

#[tauri::command]
fn get_repository_file_blame(request: GetRepositoryFileBlameRequest) -> CommandResult<SvnBlame> {
    println!("[NovaSVN] get_repository_file_blame command received");
    Ok(CommandResponse::success(
        workspace::get_repository_file_blame(request)?,
    ))
}

#[tauri::command]
fn get_svn_properties(request: GetSvnPropertiesRequest) -> CommandResult<SvnProperties> {
    println!("[NovaSVN] get_svn_properties command received");
    Ok(CommandResponse::success(workspace::get_svn_properties(
        request,
    )?))
}

#[tauri::command]
fn get_repository_file_properties(
    request: GetRepositoryFilePropertiesRequest,
) -> CommandResult<SvnProperties> {
    println!("[NovaSVN] get_repository_file_properties command received");
    Ok(CommandResponse::success(
        workspace::get_repository_file_properties(request)?,
    ))
}

#[tauri::command]
fn set_svn_property(request: SetSvnPropertyRequest) -> CommandResult<SvnProperties> {
    println!("[NovaSVN] set_svn_property command received");
    Ok(CommandResponse::success(workspace::set_svn_property(
        request,
    )?))
}

#[tauri::command]
fn ignore_workspace_path(request: IgnoreWorkspacePathRequest) -> CommandResult<SvnProperties> {
    println!("[NovaSVN] ignore_workspace_path command received");
    Ok(CommandResponse::success(workspace::ignore_workspace_path(
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
        .menu(create_app_menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "quit" {
                app.exit(0);
                return;
            }

            let _ = app.emit("novasvn-menu", id.to_string());
        })
        .setup(|app| {
            let startup_intent = system_integration::startup_intent();
            let standalone_title = match startup_intent.action.as_deref() {
                Some("commit") => Some("NovaSVN Commit"),
                Some("log") => Some("NovaSVN Log"),
                Some("blame") => Some("NovaSVN Blame"),
                Some("update") => Some("NovaSVN Update"),
                _ => None,
            };
            let app_data_dir = app.path().app_data_dir()?;
            app.manage(TaskQueue::persistent(
                app_data_dir.join("task-history.json"),
            ));
            diagnostics::install_panic_hook(app_data_dir);
            if standalone_title.is_some() {
                let _ = app.remove_menu();
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Some(title) = standalone_title {
                    let _ = window.set_title(title);
                    let _ = window.set_size(tauri::LogicalSize::new(1120.0, 760.0));
                }
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            fail_for_preview,
            sync_app_menu_state,
            get_startup_intent,
            launch_external_tool,
            open_file_location,
            open_workspace_file,
            open_generated_file_location,
            open_local_path_location,
            open_repository_temp_file,
            create_mock_task,
            create_commit_task,
            create_svn_operation_task,
            create_svn_batch_operation_task,
            create_shadow_workspace_task,
            create_partial_commit_task,
            create_repository_list_task,
            create_repository_file_task,
            create_repository_copy_task,
            create_repository_mkdir_task,
            create_repository_import_task,
            create_repository_move_task,
            create_repository_delete_task,
            create_branch_checkout_task,
            create_repository_checkout_task,
            create_repository_export_task,
            create_repository_drag_export_task,
            create_svn_switch_task,
            create_revision_diff_task,
            create_revert_revision_task,
            create_merge_task,
            create_apply_patch_task,
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
            configure_svn_authentication,
            configure_svn_certificate_trust,
            clear_svn_certificate_trust,
            open_workspace,
            inspect_update_target,
            get_recent_workspace,
            scan_workspace_status,
            list_workspace_files,
            get_file_diff,
            get_file_content_diff,
            get_svn_log,
            get_path_svn_log,
            get_repository_file_log,
            get_svn_blame,
            get_repository_file_blame,
            get_svn_properties,
            get_repository_file_properties,
            set_svn_property,
            ignore_workspace_path,
            parse_unified_diff,
            generate_selected_patch,
            get_shadow_workspace_status,
            export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("启动 NovaSVN 失败");
}
