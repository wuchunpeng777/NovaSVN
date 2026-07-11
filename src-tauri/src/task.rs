#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{
    collections::{HashSet, VecDeque},
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use roxmltree::Document;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::{
    error::NovaError,
    executable::normalize_executable_setting,
    path_utils,
    shadow::{self, ShadowWorkspaceRequest},
};

const REVISION_DIFF_PREVIEW_MAX_BYTES: usize = 2 * 1024 * 1024;
const APPLY_PATCH_MAX_BYTES: u64 = 32 * 1024 * 1024;
const MAX_BATCH_OPERATION_PATHS: usize = 500;
const MAX_BATCH_OPERATION_PATH_BYTES: usize = 24 * 1024;
static APPLY_PATCH_SNAPSHOT_NONCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskLog {
    pub message: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Task {
    pub task_id: String,
    pub title: String,
    pub status: TaskStatus,
    pub logs: Vec<TaskLog>,
    pub error: Option<String>,
    pub result: Option<TaskResult>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(skip_serializing)]
    payload: TaskPayload,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskSummary {
    pub task_id: String,
    pub title: String,
    pub status: TaskStatus,
    pub error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskSnapshot {
    pub tasks: Vec<TaskSummary>,
    pub running_task_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MockTaskOutcome {
    Success,
    Failed,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMockTaskRequest {
    pub title: Option<String>,
    pub outcome: MockTaskOutcome,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCommitTaskRequest {
    pub working_copy_root: String,
    pub message: String,
    pub files: Vec<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SvnOperationKind {
    Update,
    UpdatePath,
    Cleanup,
    AddFile,
    DeletePath,
    MovePath,
    CopyPath,
    RevertFile,
    LockFile,
    UnlockFile,
    ForceUnlockFile,
    ResolveWorking,
    ResolveMineFull,
    ResolveTheirsFull,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSvnOperationTaskRequest {
    pub working_copy_root: String,
    pub kind: SvnOperationKind,
    pub file_path: Option<String>,
    pub target_path: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SvnBatchOperationKind {
    #[serde(rename = "revert_paths")]
    Revert,
    #[serde(rename = "delete_paths")]
    Delete,
    #[serde(rename = "move_paths")]
    Move,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSvnBatchOperationTaskRequest {
    pub working_copy_root: String,
    pub kind: SvnBatchOperationKind,
    pub file_paths: Vec<String>,
    pub target_path: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShadowWorkspaceOperationKind {
    CreateOrUpdate,
    Rebuild,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateShadowWorkspaceTaskRequest {
    pub working_copy_root: String,
    pub repository_url: String,
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
    pub kind: ShadowWorkspaceOperationKind,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreatePartialCommitTaskRequest {
    pub working_copy_root: String,
    pub repository_url: String,
    pub revision: Option<String>,
    pub message: String,
    pub selected_patch: String,
    pub files: Vec<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepositoryListTaskRequest {
    pub url: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryCopyKind {
    Branch,
    Tag,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepositoryCopyTaskRequest {
    pub kind: RepositoryCopyKind,
    pub source_url: String,
    pub target_url: String,
    pub revision: Option<String>,
    pub message: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateBranchCheckoutTaskRequest {
    pub branch_url: String,
    pub local_path: String,
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSvnSwitchTaskRequest {
    pub working_copy_root: String,
    pub target_url: String,
    pub allow_local_changes: Option<bool>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionDiffMode {
    Revisions,
    WorkingCopyToRevision,
    Urls,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRevisionDiffTaskRequest {
    pub mode: RevisionDiffMode,
    pub working_copy_root: Option<String>,
    pub target_url: Option<String>,
    pub left_revision: Option<String>,
    pub right_revision: Option<String>,
    pub left_url: Option<String>,
    pub right_url: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMergeTaskRequest {
    pub working_copy_root: String,
    pub source_url: String,
    pub start_revision: Option<String>,
    pub end_revision: Option<String>,
    pub dry_run: bool,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateApplyPatchTaskRequest {
    pub working_copy_root: String,
    pub patch_file_path: String,
    pub dry_run: bool,
    pub expected_patch_digest: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskResult {
    pub repository_list: Option<RepositoryListResult>,
    pub revision_diff: Option<RevisionDiffResult>,
    pub merge_result: Option<MergeResult>,
    pub apply_patch_result: Option<ApplyPatchResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepositoryListResult {
    pub url: String,
    pub entries: Vec<RepositoryListEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepositoryListEntry {
    pub name: String,
    pub kind: String,
    pub revision: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RevisionDiffResult {
    pub mode: String,
    pub target: String,
    pub diff_text: String,
    pub file_count: usize,
    pub line_count: usize,
    pub truncated: bool,
    pub max_bytes: usize,
    pub patch_file_path: Option<String>,
    pub patch_file_dir: Option<String>,
    pub patch_file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergeResult {
    pub dry_run: bool,
    pub source_url: String,
    pub revision_range: String,
    pub output_text: String,
    pub file_count: usize,
    pub line_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyPatchResult {
    pub dry_run: bool,
    pub patch_file_path: String,
    pub patch_digest: String,
    pub output_text: String,
    pub applied: usize,
    pub rejected: usize,
    pub skipped: usize,
    pub conflicted: usize,
}

#[derive(Debug, Clone)]
enum TaskPayload {
    Mock(MockTaskOutcome),
    SvnCommit(CommitTaskPayload),
    SvnOperation(SvnOperationTaskPayload),
    SvnBatchOperation(SvnBatchOperationTaskPayload),
    ShadowWorkspace(ShadowWorkspaceTaskPayload),
    PartialCommit(PartialCommitTaskPayload),
    RepositoryList(RepositoryListTaskPayload),
    RepositoryCopy(RepositoryCopyTaskPayload),
    BranchCheckout(BranchCheckoutTaskPayload),
    SvnSwitch(SvnSwitchTaskPayload),
    RevisionDiff(RevisionDiffTaskPayload),
    Merge(MergeTaskPayload),
    ApplyPatch(ApplyPatchTaskPayload),
}

#[derive(Debug, Clone)]
struct CommitTaskPayload {
    working_copy_root: String,
    message: String,
    files: Vec<String>,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct SvnOperationTaskPayload {
    working_copy_root: String,
    kind: SvnOperationKind,
    file_path: Option<String>,
    target_path: Option<String>,
    svn_executable: String,
    delete_target_identity: Option<Box<DeleteTargetIdentity>>,
    destination_identity: Option<Box<WorkingCopyDestinationIdentity>>,
}

#[derive(Debug, Clone)]
struct SvnBatchOperationTaskPayload {
    working_copy_root: String,
    kind: SvnBatchOperationKind,
    file_paths: Vec<String>,
    target_path: Option<String>,
    svn_executable: String,
    source_identities: Vec<DeleteTargetIdentity>,
    destination_identities: Vec<WorkingCopyDestinationIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkingCopyDestinationIdentity {
    parent_path: Option<String>,
    parent_identity: Option<DeleteTargetIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DeleteTargetIdentity {
    entry_kind: String,
    entry_revision: Option<String>,
    url: String,
    relative_url: Option<String>,
    repository_uuid: Option<String>,
    schedule: String,
    depth: Option<String>,
    copy_from_url: Option<String>,
    copy_from_revision: Option<String>,
    filesystem_kind: DeleteFilesystemNodeKind,
    final_node_is_symlink: bool,
    final_node_is_reparse_point: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DeleteFilesystemNodeKind {
    Missing,
    File,
    Directory,
    Symlink,
    ReparsePoint,
    Other,
}

#[derive(Debug, Clone)]
struct ShadowWorkspaceTaskPayload {
    app: AppHandle,
    request: ShadowWorkspaceRequest,
    kind: ShadowWorkspaceOperationKind,
}

#[derive(Debug, Clone)]
struct PartialCommitTaskPayload {
    app: AppHandle,
    shadow_request: ShadowWorkspaceRequest,
    message: String,
    selected_patch: String,
    files: Vec<String>,
}

#[derive(Debug, Clone)]
struct RepositoryListTaskPayload {
    url: String,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct RepositoryCopyTaskPayload {
    kind: RepositoryCopyKind,
    source_url: String,
    target_url: String,
    revision: Option<String>,
    message: String,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct BranchCheckoutTaskPayload {
    branch_url: String,
    local_path: String,
    revision: Option<String>,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct SvnSwitchTaskPayload {
    working_copy_root: String,
    target_url: String,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct RevisionDiffTaskPayload {
    mode: RevisionDiffMode,
    working_copy_root: Option<String>,
    target_url: Option<String>,
    left_revision: Option<String>,
    right_revision: Option<String>,
    left_url: Option<String>,
    right_url: Option<String>,
    svn_executable: String,
    patch_output_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct MergeTaskPayload {
    working_copy_root: String,
    source_url: String,
    start_revision: Option<String>,
    end_revision: Option<String>,
    dry_run: bool,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct ApplyPatchTaskPayload {
    working_copy_root: String,
    patch_file_path: String,
    patch_digest: String,
    patch_snapshot: Arc<[u8]>,
    dry_run: bool,
    svn_executable: String,
}

#[derive(Debug)]
pub struct TaskQueue {
    state: Arc<Mutex<TaskQueueState>>,
    next_id: AtomicU64,
    worker_running: Arc<AtomicBool>,
}

#[derive(Debug, Default)]
struct TaskQueueState {
    tasks: Vec<Task>,
    pending: VecDeque<String>,
    running_task_id: Option<String>,
}

impl TaskQueue {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(TaskQueueState::default())),
            next_id: AtomicU64::new(1),
            worker_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn create_mock_task(&self, request: CreateMockTaskRequest) -> Task {
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let title = request.title.unwrap_or_else(|| match request.outcome {
            MockTaskOutcome::Success => "模拟成功任务".to_string(),
            MockTaskOutcome::Failed => "模拟失败任务".to_string(),
        });

        let task = Task {
            task_id: task_id.clone(),
            title,
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::Mock(request.outcome.clone()),
        };

        self.enqueue(task_id, task.clone());

        task
    }

    pub fn create_commit_task(&self, request: CreateCommitTaskRequest) -> Result<Task, NovaError> {
        let working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        let files = normalize_commit_files(&request.files)?;
        let message = request.message.trim().to_string();
        if message.is_empty() {
            return Err(NovaError::command(
                "COMMIT_MESSAGE_REQUIRED",
                "请输入提交信息",
                None,
                true,
            ));
        }

        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("提交 {} 个文件", files.len()),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "提交任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::SvnCommit(CommitTaskPayload {
                working_copy_root: working_copy_root.display().to_string(),
                message,
                files,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_svn_operation_task(
        &self,
        request: CreateSvnOperationTaskRequest,
    ) -> Result<Task, NovaError> {
        let mut working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        let file_path = match request.kind {
            SvnOperationKind::UpdatePath => Some(normalize_relative_file_path(
                request.file_path.as_deref().unwrap_or_default(),
                "UPDATE_PATH_INVALID",
                "Update 路径无效",
            )?),
            SvnOperationKind::AddFile => Some(normalize_relative_file_path(
                request.file_path.as_deref().unwrap_or_default(),
                "ADD_FILE_PATH_INVALID",
                "Add 文件路径无效",
            )?),
            SvnOperationKind::DeletePath => Some(normalize_delete_path(
                request.file_path.as_deref().unwrap_or_default(),
            )?),
            SvnOperationKind::MovePath => Some(normalize_move_path(
                request.file_path.as_deref().unwrap_or_default(),
                "MOVE_SOURCE_PATH_INVALID",
                "Move 源路径无效",
            )?),
            SvnOperationKind::CopyPath => Some(normalize_move_path(
                request.file_path.as_deref().unwrap_or_default(),
                "COPY_SOURCE_PATH_INVALID",
                "Copy 源路径无效",
            )?),
            SvnOperationKind::RevertFile => Some(normalize_relative_file_path(
                request.file_path.as_deref().unwrap_or_default(),
                "REVERT_FILE_PATH_INVALID",
                "Revert 文件路径无效",
            )?),
            SvnOperationKind::LockFile => Some(normalize_relative_file_path(
                request.file_path.as_deref().unwrap_or_default(),
                "LOCK_FILE_PATH_INVALID",
                "Lock 文件路径无效",
            )?),
            SvnOperationKind::UnlockFile | SvnOperationKind::ForceUnlockFile => {
                Some(normalize_relative_file_path(
                    request.file_path.as_deref().unwrap_or_default(),
                    "UNLOCK_FILE_PATH_INVALID",
                    "Unlock 文件路径无效",
                )?)
            }
            SvnOperationKind::ResolveWorking
            | SvnOperationKind::ResolveMineFull
            | SvnOperationKind::ResolveTheirsFull => Some(normalize_relative_file_path(
                request.file_path.as_deref().unwrap_or_default(),
                "RESOLVE_FILE_PATH_INVALID",
                "Resolve 文件路径无效",
            )?),
            SvnOperationKind::Update | SvnOperationKind::Cleanup => None,
        };
        let target_path = match &request.kind {
            SvnOperationKind::MovePath => Some(normalize_move_path(
                request.target_path.as_deref().unwrap_or_default(),
                "MOVE_TARGET_PATH_INVALID",
                "Move 目标路径无效",
            )?),
            SvnOperationKind::CopyPath => Some(normalize_move_path(
                request.target_path.as_deref().unwrap_or_default(),
                "COPY_TARGET_PATH_INVALID",
                "Copy 目标路径无效",
            )?),
            _ => None,
        };
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let delete_target_identity = if matches!(
            &request.kind,
            SvnOperationKind::DeletePath | SvnOperationKind::MovePath | SvnOperationKind::CopyPath
        ) {
            working_copy_root = canonicalize_delete_working_copy_root(&working_copy_root)?;
            let identity = if matches!(
                &request.kind,
                SvnOperationKind::MovePath | SvnOperationKind::CopyPath
            ) {
                let (code_prefix, label) = match &request.kind {
                    SvnOperationKind::MovePath => ("MOVE", "Move"),
                    SvnOperationKind::CopyPath => ("COPY", "Copy"),
                    _ => unreachable!(),
                };
                validate_working_copy_transfer_source(
                    &svn_executable,
                    &working_copy_root,
                    file_path.as_deref().unwrap_or_default(),
                    code_prefix,
                    label,
                )?
            } else {
                validate_delete_target(
                    &svn_executable,
                    &working_copy_root,
                    file_path.as_deref().unwrap_or_default(),
                )?
            };
            Some(Box::new(identity))
        } else {
            None
        };
        let destination_identity = if matches!(
            &request.kind,
            SvnOperationKind::MovePath | SvnOperationKind::CopyPath
        ) {
            let (code_prefix, label) = match &request.kind {
                SvnOperationKind::MovePath => ("MOVE", "Move"),
                SvnOperationKind::CopyPath => ("COPY", "Copy"),
                _ => unreachable!(),
            };
            Some(Box::new(validate_working_copy_destination(
                &svn_executable,
                &working_copy_root,
                file_path.as_deref().unwrap_or_default(),
                delete_target_identity.as_deref().ok_or_else(|| {
                    NovaError::command(
                        format!("{code_prefix}_SOURCE_INVALID"),
                        format!("{label} 源路径身份缺失"),
                        None,
                        true,
                    )
                })?,
                target_path.as_deref().unwrap_or_default(),
                code_prefix,
                label,
            )?))
        } else {
            None
        };
        let title = operation_title(&request.kind, file_path.as_deref(), target_path.as_deref());
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title,
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "SVN 操作已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::SvnOperation(SvnOperationTaskPayload {
                working_copy_root: working_copy_root.display().to_string(),
                kind: request.kind,
                file_path,
                target_path,
                svn_executable,
                delete_target_identity,
                destination_identity,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_svn_batch_operation_task(
        &self,
        request: CreateSvnBatchOperationTaskRequest,
    ) -> Result<Task, NovaError> {
        let mut working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let file_paths = match &request.kind {
            SvnBatchOperationKind::Revert => normalize_batch_operation_paths(
                &request.file_paths,
                "BATCH_REVERT_PATHS_INVALID",
                "批量 Revert 路径无效",
                |path| {
                    normalize_relative_file_path(
                        path,
                        "BATCH_REVERT_PATH_INVALID",
                        "批量 Revert 路径无效",
                    )
                },
            )?,
            SvnBatchOperationKind::Delete => {
                collapse_descendant_paths(normalize_batch_operation_paths(
                    &request.file_paths,
                    "BATCH_DELETE_PATHS_INVALID",
                    "批量 Delete 路径无效",
                    normalize_delete_path,
                )?)
            }
            SvnBatchOperationKind::Move => {
                collapse_descendant_paths(normalize_batch_operation_paths(
                    &request.file_paths,
                    "BATCH_MOVE_PATHS_INVALID",
                    "批量 Move 路径无效",
                    |path| {
                        normalize_move_path(
                            path,
                            "BATCH_MOVE_SOURCE_PATH_INVALID",
                            "批量 Move 源路径无效",
                        )
                    },
                )?)
            }
        };
        let target_path = if matches!(&request.kind, SvnBatchOperationKind::Move) {
            Some(normalize_batch_move_target(
                request.target_path.as_deref().unwrap_or_default(),
            )?)
        } else {
            None
        };

        let destructive = matches!(
            &request.kind,
            SvnBatchOperationKind::Delete | SvnBatchOperationKind::Move
        );
        if destructive {
            working_copy_root = canonicalize_delete_working_copy_root(&working_copy_root)?;
        }

        let source_identities = match &request.kind {
            SvnBatchOperationKind::Delete => file_paths
                .iter()
                .map(|path| validate_delete_target(&svn_executable, &working_copy_root, path))
                .collect::<Result<Vec<_>, _>>()?,
            SvnBatchOperationKind::Move => file_paths
                .iter()
                .map(|path| {
                    validate_working_copy_transfer_source(
                        &svn_executable,
                        &working_copy_root,
                        path,
                        "BATCH_MOVE",
                        "批量 Move",
                    )
                })
                .collect::<Result<Vec<_>, _>>()?,
            SvnBatchOperationKind::Revert => Vec::new(),
        };
        let destination_paths = if matches!(&request.kind, SvnBatchOperationKind::Move) {
            let target_directory = target_path.as_deref().unwrap_or_default();
            ensure_unique_batch_move_destinations(
                file_paths
                    .iter()
                    .map(|source_path| batch_move_destination_path(target_directory, source_path))
                    .collect(),
            )?
        } else {
            Vec::new()
        };
        let destination_identities = if matches!(&request.kind, SvnBatchOperationKind::Move) {
            file_paths
                .iter()
                .zip(source_identities.iter())
                .zip(destination_paths.iter())
                .map(|((source_path, source_identity), destination_path)| {
                    validate_working_copy_destination(
                        &svn_executable,
                        &working_copy_root,
                        source_path,
                        source_identity,
                        destination_path,
                        "BATCH_MOVE",
                        "批量 Move",
                    )
                })
                .collect::<Result<Vec<_>, _>>()?
        } else {
            Vec::new()
        };

        let title = batch_operation_title(&request.kind, file_paths.len(), target_path.as_deref());
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title,
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "批量 SVN 操作已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::SvnBatchOperation(SvnBatchOperationTaskPayload {
                working_copy_root: working_copy_root.display().to_string(),
                kind: request.kind,
                file_paths,
                target_path,
                svn_executable,
                source_identities,
                destination_identities,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_shadow_workspace_task(
        &self,
        app: &AppHandle,
        request: CreateShadowWorkspaceTaskRequest,
    ) -> Result<Task, NovaError> {
        let working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        if request.repository_url.trim().is_empty() {
            return Err(NovaError::command(
                "SHADOW_REPOSITORY_URL_REQUIRED",
                "缺少仓库 URL",
                None,
                true,
            ));
        }

        let shadow_request = ShadowWorkspaceRequest {
            working_copy_root: working_copy_root.display().to_string(),
            repository_url: request.repository_url,
            revision: request.revision,
            svn_executable: request.svn_executable,
        };
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let title = match request.kind {
            ShadowWorkspaceOperationKind::CreateOrUpdate => "准备影子工作副本",
            ShadowWorkspaceOperationKind::Rebuild => "重建影子工作副本",
        }
        .to_string();
        let task = Task {
            task_id: task_id.clone(),
            title,
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "影子工作副本任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::ShadowWorkspace(ShadowWorkspaceTaskPayload {
                app: app.clone(),
                request: shadow_request,
                kind: request.kind,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_partial_commit_task(
        &self,
        app: &AppHandle,
        request: CreatePartialCommitTaskRequest,
    ) -> Result<Task, NovaError> {
        let working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        let files = normalize_commit_files(&request.files)?;
        let message = request.message.trim().to_string();
        if message.is_empty() {
            return Err(NovaError::command(
                "COMMIT_MESSAGE_REQUIRED",
                "请输入提交信息",
                None,
                true,
            ));
        }
        if request.selected_patch.trim().is_empty() {
            return Err(NovaError::command(
                "SELECTED_PATCH_REQUIRED",
                "缺少要提交的 selected patch",
                None,
                true,
            ));
        }
        if request.repository_url.trim().is_empty() {
            return Err(NovaError::command(
                "SHADOW_REPOSITORY_URL_REQUIRED",
                "缺少仓库 URL",
                None,
                true,
            ));
        }
        validate_selected_patch_files(&request.selected_patch, &files)?;

        let shadow_request = ShadowWorkspaceRequest {
            working_copy_root: working_copy_root.display().to_string(),
            repository_url: request.repository_url,
            revision: request.revision,
            svn_executable: request.svn_executable,
        };
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("部分提交 {} 个文件", files.len()),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "Hunk 级部分提交任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::PartialCommit(PartialCommitTaskPayload {
                app: app.clone(),
                shadow_request,
                message,
                selected_patch: request.selected_patch,
                files,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_repository_list_task(
        &self,
        request: CreateRepositoryListTaskRequest,
    ) -> Result<Task, NovaError> {
        let url = normalize_repository_url(&request.url)?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("浏览仓库 {}", compact_repository_url(&url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "仓库目录加载任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryList(RepositoryListTaskPayload {
                url,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_repository_copy_task(
        &self,
        request: CreateRepositoryCopyTaskRequest,
    ) -> Result<Task, NovaError> {
        let source_url = normalize_repository_url(&request.source_url)?;
        let target_url = normalize_repository_url(&request.target_url)?;
        if source_url == target_url {
            return Err(NovaError::command(
                "REPOSITORY_COPY_TARGET_SAME_AS_SOURCE",
                "目标 URL 不能和源 URL 相同",
                Some("创建分支或标签需要选择不同的目标 URL。".to_string()),
                true,
            ));
        }

        let message = request.message.trim().to_string();
        if message.is_empty() {
            return Err(NovaError::command(
                "REPOSITORY_COPY_MESSAGE_REQUIRED",
                "请输入创建分支或标签的提交信息",
                None,
                true,
            ));
        }

        let revision = normalize_optional_revision_value(
            request.revision.as_deref(),
            "REPOSITORY_COPY_REVISION_INVALID",
            "创建分支或标签的 revision 无效",
        )?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let title = match request.kind {
            RepositoryCopyKind::Branch => "创建分支",
            RepositoryCopyKind::Tag => "创建标签",
        };
        let task = Task {
            task_id: task_id.clone(),
            title: format!("{title} {}", compact_repository_url(&target_url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "创建分支/标签任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryCopy(RepositoryCopyTaskPayload {
                kind: request.kind,
                source_url,
                target_url,
                revision,
                message,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_branch_checkout_task(
        &self,
        request: CreateBranchCheckoutTaskRequest,
    ) -> Result<Task, NovaError> {
        let branch_url = normalize_repository_url(&request.branch_url)?;
        let local_path = normalize_checkout_path(&request.local_path)?;
        let revision = normalize_optional_revision_value(
            request.revision.as_deref(),
            "CHECKOUT_REVISION_INVALID",
            "分支 checkout revision 无效",
        )?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("Checkout 分支 {}", compact_repository_url(&branch_url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "分支 checkout 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::BranchCheckout(BranchCheckoutTaskPayload {
                branch_url,
                local_path,
                revision,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_svn_switch_task(
        &self,
        request: CreateSvnSwitchTaskRequest,
    ) -> Result<Task, NovaError> {
        let working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        let target_url = normalize_repository_url(&request.target_url)?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        if !request.allow_local_changes.unwrap_or(false)
            && workspace_has_local_changes(&svn_executable, &working_copy_root)?
        {
            return Err(NovaError::command(
                "SVN_SWITCH_LOCAL_CHANGES",
                "当前工作副本有本地改动",
                Some("执行 svn switch 前需要确认本地改动风险。".to_string()),
                true,
            ));
        }

        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("Switch 到 {}", compact_repository_url(&target_url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "svn switch 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::SvnSwitch(SvnSwitchTaskPayload {
                working_copy_root: working_copy_root.display().to_string(),
                target_url,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_revision_diff_task(
        &self,
        app: &AppHandle,
        request: CreateRevisionDiffTaskRequest,
    ) -> Result<Task, NovaError> {
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let patch_output_dir = app
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
        let payload = normalize_revision_diff_payload(request, svn_executable, patch_output_dir)?;
        let now = timestamp_millis();
        let title = match payload.mode {
            RevisionDiffMode::Revisions => "比较两个 revision",
            RevisionDiffMode::WorkingCopyToRevision => "比较工作副本和 revision",
            RevisionDiffMode::Urls => "比较两个分支 URL",
        };
        let task = Task {
            task_id: task_id.clone(),
            title: title.to_string(),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "Revision diff 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RevisionDiff(payload),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_merge_task(&self, request: CreateMergeTaskRequest) -> Result<Task, NovaError> {
        let working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        let source_url = normalize_repository_url(&request.source_url)?;
        let (start_revision, end_revision) =
            normalize_merge_revision_range(request.start_revision, request.end_revision)?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        if !request.dry_run
            && merge_workspace_has_local_changes(&svn_executable, &working_copy_root)?
        {
            return Err(NovaError::command(
                "SVN_MERGE_LOCAL_CHANGES",
                "当前工作副本有本地改动",
                Some("执行真实 merge 前请先提交或清理当前工作副本改动；dry-run 仍可用于预览预计变更。".to_string()),
                true,
            ));
        }
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: if request.dry_run {
                format!("Merge dry-run {}", compact_repository_url(&source_url))
            } else {
                format!("Merge {}", compact_repository_url(&source_url))
            },
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "Merge 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::Merge(MergeTaskPayload {
                working_copy_root: working_copy_root.display().to_string(),
                source_url,
                start_revision,
                end_revision,
                dry_run: request.dry_run,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_apply_patch_task(
        &self,
        request: CreateApplyPatchTaskRequest,
    ) -> Result<Task, NovaError> {
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let (working_copy_root, patch_file_path) =
            normalize_apply_patch_paths(&request.working_copy_root, &request.patch_file_path)?;
        let patch_snapshot = read_apply_patch_snapshot(&patch_file_path)?;
        let patch_digest = apply_patch_digest(&patch_snapshot);
        validate_expected_patch_digest(
            request.dry_run,
            request.expected_patch_digest.as_deref(),
            &patch_digest,
        )?;
        validate_apply_patch_working_copy_root(&svn_executable, &working_copy_root)?;
        validate_apply_patch_targets(&working_copy_root, &patch_snapshot)?;

        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: if request.dry_run {
                "预检 Patch".to_string()
            } else {
                "应用 Patch".to_string()
            },
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "Apply Patch 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::ApplyPatch(ApplyPatchTaskPayload {
                working_copy_root: working_copy_root.display().to_string(),
                patch_file_path: patch_file_path.display().to_string(),
                patch_digest,
                patch_snapshot: Arc::from(patch_snapshot),
                dry_run: request.dry_run,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn list_tasks(&self) -> TaskSnapshot {
        let state = self.state.lock().expect("任务队列锁已损坏");
        TaskSnapshot {
            tasks: state.tasks.iter().map(TaskSummary::from).collect(),
            running_task_id: state.running_task_id.clone(),
        }
    }

    pub fn all_tasks(&self) -> Vec<Task> {
        let state = self.state.lock().expect("任务队列锁已损坏");
        state.tasks.clone()
    }

    pub fn get_task(&self, task_id: &str) -> Result<Task, NovaError> {
        let state = self.state.lock().expect("任务队列锁已损坏");
        state
            .tasks
            .iter()
            .find(|task| task.task_id == task_id)
            .cloned()
            .ok_or_else(|| {
                NovaError::command(
                    "TASK_NOT_FOUND",
                    "未找到指定任务",
                    Some(format!("task_id: {task_id}")),
                    true,
                )
            })
    }

    pub fn cancel_task(&self, task_id: &str) -> Result<Task, NovaError> {
        let mut state = self.state.lock().expect("任务队列锁已损坏");
        let pending_index = state.pending.iter().position(|id| id == task_id);
        if let Some(index) = pending_index {
            state.pending.remove(index);
        }

        let task = state
            .tasks
            .iter_mut()
            .find(|task| task.task_id == task_id)
            .ok_or_else(|| {
                NovaError::command(
                    "TASK_NOT_FOUND",
                    "未找到指定任务",
                    Some(format!("task_id: {task_id}")),
                    true,
                )
            })?;

        match task.status {
            TaskStatus::Pending => {
                task.status = TaskStatus::Cancelled;
                release_apply_patch_snapshot(&mut task.payload);
                task.updated_at = timestamp_millis();
                task.logs.push(TaskLog {
                    message: "任务已取消".to_string(),
                    created_at: task.updated_at,
                });
                Ok(task.clone())
            }
            TaskStatus::Running => Err(NovaError::command(
                "TASK_CANCEL_UNSUPPORTED",
                "当前任务正在运行，暂不支持终止进程",
                Some("本阶段取消功能仅支持尚未开始的任务。".to_string()),
                true,
            )),
            TaskStatus::Success | TaskStatus::Failed | TaskStatus::Cancelled => {
                Err(NovaError::command(
                    "TASK_ALREADY_FINISHED",
                    "任务已经结束",
                    Some(format!("当前状态：{:?}", task.status)),
                    true,
                ))
            }
        }
    }

    fn ensure_worker(&self) {
        if self
            .worker_running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }

        let state = Arc::clone(&self.state);
        let worker_running = Arc::clone(&self.worker_running);

        thread::spawn(move || {
            run_worker(state, worker_running);
        });
    }

    fn enqueue(&self, task_id: String, task: Task) {
        {
            let mut state = self.state.lock().expect("任务队列锁已损坏");
            state.pending.push_back(task_id);
            state.tasks.push(task);
        }

        self.ensure_worker();
    }
}

impl From<&Task> for TaskSummary {
    fn from(task: &Task) -> Self {
        Self {
            task_id: task.task_id.clone(),
            title: task.title.clone(),
            status: task.status.clone(),
            error: task.error.clone(),
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

fn run_worker(state: Arc<Mutex<TaskQueueState>>, worker_running: Arc<AtomicBool>) {
    loop {
        let next_task = {
            let mut state = state.lock().expect("任务队列锁已损坏");
            let next = state.pending.pop_front();
            state.running_task_id = next.clone();
            next.and_then(|task_id| {
                state
                    .tasks
                    .iter_mut()
                    .find(|task| task.task_id == task_id)
                    .map(|task| {
                        let payload = task.payload.clone();
                        release_apply_patch_snapshot(&mut task.payload);
                        (task_id, payload)
                    })
            })
        };

        let Some((task_id, payload)) = next_task else {
            worker_running.store(false, Ordering::Release);
            let mut state = state.lock().expect("任务队列锁已损坏");
            state.running_task_id = None;
            if state.pending.is_empty()
                || worker_running
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_err()
            {
                break;
            }
            continue;
        };

        match payload {
            TaskPayload::Mock(outcome) => run_mock_task(&state, &task_id, outcome),
            TaskPayload::SvnCommit(payload) => run_commit_task(&state, &task_id, payload),
            TaskPayload::SvnOperation(payload) => run_svn_operation_task(&state, &task_id, payload),
            TaskPayload::SvnBatchOperation(payload) => {
                run_svn_batch_operation_task(&state, &task_id, payload)
            }
            TaskPayload::ShadowWorkspace(payload) => {
                run_shadow_workspace_task(&state, &task_id, payload)
            }
            TaskPayload::PartialCommit(payload) => {
                run_partial_commit_task(&state, &task_id, payload)
            }
            TaskPayload::RepositoryList(payload) => {
                run_repository_list_task(&state, &task_id, payload)
            }
            TaskPayload::RepositoryCopy(payload) => {
                run_repository_copy_task(&state, &task_id, payload)
            }
            TaskPayload::BranchCheckout(payload) => {
                run_branch_checkout_task(&state, &task_id, payload)
            }
            TaskPayload::SvnSwitch(payload) => run_svn_switch_task(&state, &task_id, payload),
            TaskPayload::RevisionDiff(payload) => run_revision_diff_task(&state, &task_id, payload),
            TaskPayload::Merge(payload) => run_merge_task(&state, &task_id, payload),
            TaskPayload::ApplyPatch(payload) => run_apply_patch_task(&state, &task_id, payload),
        }
    }
}

fn release_apply_patch_snapshot(payload: &mut TaskPayload) {
    if let TaskPayload::ApplyPatch(payload) = payload {
        payload.patch_snapshot = Arc::<[u8]>::from([]);
    }
}

fn run_mock_task(state: &Arc<Mutex<TaskQueueState>>, task_id: &str, outcome: MockTaskOutcome) {
    update_task(state, task_id, TaskStatus::Running, "任务开始执行", None);
    thread::sleep(Duration::from_millis(450));
    append_task_log(state, task_id, "准备模拟命令环境");
    thread::sleep(Duration::from_millis(450));
    append_task_log(state, task_id, "模拟命令运行中");
    thread::sleep(Duration::from_millis(450));

    match outcome {
        MockTaskOutcome::Success => {
            update_task(state, task_id, TaskStatus::Success, "任务执行成功", None)
        }
        MockTaskOutcome::Failed => update_task(
            state,
            task_id,
            TaskStatus::Failed,
            "任务执行失败",
            Some("模拟任务失败，用于验证失败状态和日志展示。".to_string()),
        ),
    }
}

fn run_commit_task(state: &Arc<Mutex<TaskQueueState>>, task_id: &str, payload: CommitTaskPayload) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "提交任务开始执行",
        None,
    );
    append_task_log(
        state,
        task_id,
        &format!("准备提交 {} 个文件", payload.files.len()),
    );

    let root = PathBuf::from(&payload.working_copy_root);
    let targets: Vec<PathBuf> = payload.files.iter().map(|file| root.join(file)).collect();
    let mut command = Command::new(&payload.svn_executable);
    command.arg("commit");
    for target in &targets {
        command.arg(target);
    }
    command.arg("-m").arg(&payload.message).current_dir(&root);

    append_task_log(
        state,
        task_id,
        &format!("执行 svn commit：{}", payload.files.join(", ")),
    );

    match command.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(state, task_id, TaskStatus::Success, "提交执行成功", None);
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "提交执行失败",
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "提交命令启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn run_svn_operation_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: SvnOperationTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "SVN 操作开始执行",
        None,
    );

    let root = PathBuf::from(&payload.working_copy_root);
    let mut command = Command::new(&payload.svn_executable);
    match payload.kind {
        SvnOperationKind::Update => {
            command.arg("update").arg(&root);
            append_task_log(state, task_id, "执行 svn update");
        }
        SvnOperationKind::UpdatePath => {
            let Some(file_path) = payload.file_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "Update 执行失败",
                    Some("缺少要 update 的路径。".to_string()),
                );
                return;
            };
            command.arg("update").arg(root.join(file_path));
            append_task_log(state, task_id, &format!("执行 svn update：{file_path}"));
        }
        SvnOperationKind::Cleanup => {
            command.arg("cleanup").arg(&root);
            append_task_log(state, task_id, "执行 svn cleanup");
        }
        SvnOperationKind::AddFile => {
            let Some(file_path) = payload.file_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "Add 执行失败",
                    Some("缺少要 add 的文件路径。".to_string()),
                );
                return;
            };
            command
                .arg("add")
                .arg("--parents")
                .arg(root.join(file_path));
            append_task_log(state, task_id, &format!("执行 svn add：{file_path}"));
        }
        SvnOperationKind::DeletePath => {
            let Some(file_path) = payload.file_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "删除参数缺失",
                    Some("缺少要删除的文件或目录路径。".to_string()),
                );
                return;
            };

            let canonical_root = match canonicalize_delete_working_copy_root(&root) {
                Ok(canonical_root) if canonical_root == root => canonical_root,
                Ok(canonical_root) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "删除安全校验失败",
                        Some(format!(
                            "工作副本根目录在任务排队后发生变化：{}",
                            canonical_root.display()
                        )),
                    );
                    return;
                }
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "删除安全校验失败",
                        Some(nova_error_text(&error)),
                    );
                    return;
                }
            };
            let Some(expected_identity) = payload.delete_target_identity.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "删除安全校验失败",
                    Some("删除任务缺少目标身份快照。".to_string()),
                );
                return;
            };
            let current_identity =
                match validate_delete_target(&payload.svn_executable, &canonical_root, file_path) {
                    Ok(identity) => identity,
                    Err(error) => {
                        update_task(
                            state,
                            task_id,
                            TaskStatus::Failed,
                            "删除安全校验失败",
                            Some(nova_error_text(&error)),
                        );
                        return;
                    }
                };
            if &current_identity != expected_identity {
                let error = delete_target_changed_error(expected_identity, &current_identity);
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "删除目标已发生变化",
                    Some(nova_error_text(&error)),
                );
                return;
            }
            command
                .arg("delete")
                .arg("--force")
                .arg(canonical_root.join(file_path));
            append_task_log(
                state,
                task_id,
                &format!("执行 svn delete --force：{file_path}"),
            );
        }
        SvnOperationKind::MovePath | SvnOperationKind::CopyPath => {
            let (command_name, code_prefix, label) = match &payload.kind {
                SvnOperationKind::MovePath => ("move", "MOVE", "Move"),
                SvnOperationKind::CopyPath => ("copy", "COPY", "Copy"),
                _ => unreachable!(),
            };
            let (Some(source_path), Some(target_path)) =
                (payload.file_path.as_deref(), payload.target_path.as_deref())
            else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    &format!("{label} 参数缺失"),
                    Some(format!("缺少 {label} 源路径或目标路径。")),
                );
                return;
            };
            let canonical_root = match canonicalize_delete_working_copy_root(&root) {
                Ok(canonical_root) if canonical_root == root => canonical_root,
                Ok(canonical_root) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        &format!("{label} 安全校验失败"),
                        Some(format!(
                            "工作副本根目录在任务排队后发生变化：{}",
                            canonical_root.display()
                        )),
                    );
                    return;
                }
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        &format!("{label} 安全校验失败"),
                        Some(nova_error_text(&error)),
                    );
                    return;
                }
            };
            let (Some(expected_source), Some(expected_destination)) = (
                payload.delete_target_identity.as_deref(),
                payload.destination_identity.as_deref(),
            ) else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    &format!("{label} 安全校验失败"),
                    Some(format!("{label} 任务缺少源或目标身份快照。")),
                );
                return;
            };
            let current_source = match validate_working_copy_transfer_source(
                &payload.svn_executable,
                &canonical_root,
                source_path,
                code_prefix,
                label,
            ) {
                Ok(identity) => identity,
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        &format!("{label} 源路径校验失败"),
                        Some(nova_error_text(&error)),
                    );
                    return;
                }
            };
            if &current_source != expected_source {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    &format!("{label} 源路径已发生变化"),
                    Some(nova_error_text(&delete_target_changed_error(
                        expected_source,
                        &current_source,
                    ))),
                );
                return;
            }
            let current_destination = match validate_working_copy_destination(
                &payload.svn_executable,
                &canonical_root,
                source_path,
                &current_source,
                target_path,
                code_prefix,
                label,
            ) {
                Ok(identity) => identity,
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        &format!("{label} 目标路径校验失败"),
                        Some(nova_error_text(&error)),
                    );
                    return;
                }
            };
            if &current_destination != expected_destination {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    &format!("{label} 目标路径已发生变化"),
                    Some("目标父目录在任务排队后发生变化。".to_string()),
                );
                return;
            }
            command
                .arg(command_name)
                .arg(canonical_root.join(source_path))
                .arg(canonical_root.join(target_path));
            append_task_log(
                state,
                task_id,
                &format!("执行 svn {command_name}：{source_path} -> {target_path}"),
            );
        }
        SvnOperationKind::RevertFile => {
            let Some(file_path) = payload.file_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "Revert 参数缺失",
                    Some("缺少要 revert 的文件路径。".to_string()),
                );
                return;
            };
            command.arg("revert").arg(root.join(file_path));
            append_task_log(state, task_id, &format!("执行 svn revert：{file_path}"));
        }
        SvnOperationKind::LockFile => {
            let Some(file_path) = payload.file_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "Lock 参数缺失",
                    Some("缺少要 lock 的文件路径。".to_string()),
                );
                return;
            };
            command.arg("lock").arg(root.join(file_path));
            append_task_log(state, task_id, &format!("执行 svn lock：{file_path}"));
        }
        SvnOperationKind::UnlockFile | SvnOperationKind::ForceUnlockFile => {
            let Some(file_path) = payload.file_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "Unlock 参数缺失",
                    Some("缺少要 unlock 的文件路径。".to_string()),
                );
                return;
            };
            command.arg("unlock");
            if matches!(payload.kind, SvnOperationKind::ForceUnlockFile) {
                command.arg("--force");
            }
            command.arg(root.join(file_path));
            let force_label = if matches!(payload.kind, SvnOperationKind::ForceUnlockFile) {
                " --force"
            } else {
                ""
            };
            append_task_log(
                state,
                task_id,
                &format!("执行 svn unlock{force_label}：{file_path}"),
            );
        }
        SvnOperationKind::ResolveWorking
        | SvnOperationKind::ResolveMineFull
        | SvnOperationKind::ResolveTheirsFull => {
            let Some(file_path) = payload.file_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "Resolve 参数缺失",
                    Some("缺少要 resolve 的文件路径。".to_string()),
                );
                return;
            };
            let accept = match payload.kind {
                SvnOperationKind::ResolveWorking => "working",
                SvnOperationKind::ResolveMineFull => "mine-full",
                SvnOperationKind::ResolveTheirsFull => "theirs-full",
                _ => unreachable!("resolve 分支已限定"),
            };
            command
                .arg("resolve")
                .arg("--accept")
                .arg(accept)
                .arg(root.join(file_path));
            append_task_log(
                state,
                task_id,
                &format!("执行 svn resolve --accept {accept}：{file_path}"),
            );
        }
    }
    command.current_dir(&root);

    match command.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "SVN 操作执行成功",
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 操作执行失败",
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 命令启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn run_svn_batch_operation_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: SvnBatchOperationTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "批量 SVN 操作开始执行",
        None,
    );

    let root = PathBuf::from(&payload.working_copy_root);
    let mut command = Command::new(&payload.svn_executable);
    match &payload.kind {
        SvnBatchOperationKind::Revert => {
            command.arg("revert");
            for file_path in &payload.file_paths {
                command.arg(root.join(file_path));
            }
            append_task_log(
                state,
                task_id,
                &format!("执行 svn revert：{}", payload.file_paths.join(", ")),
            );
        }
        SvnBatchOperationKind::Delete => {
            let canonical_root = match canonicalize_delete_working_copy_root(&root) {
                Ok(canonical_root) if canonical_root == root => canonical_root,
                Ok(canonical_root) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "批量 Delete 安全校验失败",
                        Some(format!(
                            "工作副本根目录在任务排队后发生变化：{}",
                            canonical_root.display()
                        )),
                    );
                    return;
                }
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "批量 Delete 安全校验失败",
                        Some(nova_error_text(&error)),
                    );
                    return;
                }
            };
            if payload.source_identities.len() != payload.file_paths.len() {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "批量 Delete 安全校验失败",
                    Some("批量 Delete 任务缺少完整的目标身份快照。".to_string()),
                );
                return;
            }
            for (file_path, expected_identity) in payload
                .file_paths
                .iter()
                .zip(payload.source_identities.iter())
            {
                let current_identity = match validate_delete_target(
                    &payload.svn_executable,
                    &canonical_root,
                    file_path,
                ) {
                    Ok(identity) => identity,
                    Err(error) => {
                        update_task(
                            state,
                            task_id,
                            TaskStatus::Failed,
                            "批量 Delete 安全校验失败",
                            Some(nova_error_text(&error)),
                        );
                        return;
                    }
                };
                if &current_identity != expected_identity {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "批量 Delete 目标已发生变化",
                        Some(nova_error_text(&delete_target_changed_error(
                            expected_identity,
                            &current_identity,
                        ))),
                    );
                    return;
                }
            }

            command.arg("delete").arg("--force");
            for file_path in &payload.file_paths {
                command.arg(canonical_root.join(file_path));
            }
            append_task_log(
                state,
                task_id,
                &format!("执行 svn delete --force：{}", payload.file_paths.join(", ")),
            );
        }
        SvnBatchOperationKind::Move => {
            let canonical_root = match canonicalize_delete_working_copy_root(&root) {
                Ok(canonical_root) if canonical_root == root => canonical_root,
                Ok(canonical_root) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "批量 Move 安全校验失败",
                        Some(format!(
                            "工作副本根目录在任务排队后发生变化：{}",
                            canonical_root.display()
                        )),
                    );
                    return;
                }
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "批量 Move 安全校验失败",
                        Some(nova_error_text(&error)),
                    );
                    return;
                }
            };
            let Some(target_directory) = payload.target_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "批量 Move 参数缺失",
                    Some("缺少批量 Move 目标目录。".to_string()),
                );
                return;
            };
            if payload.source_identities.len() != payload.file_paths.len()
                || payload.destination_identities.len() != payload.file_paths.len()
            {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "批量 Move 安全校验失败",
                    Some("批量 Move 任务缺少完整的源或目标身份快照。".to_string()),
                );
                return;
            }

            for ((source_path, expected_source), expected_destination) in payload
                .file_paths
                .iter()
                .zip(payload.source_identities.iter())
                .zip(payload.destination_identities.iter())
            {
                let current_source = match validate_working_copy_transfer_source(
                    &payload.svn_executable,
                    &canonical_root,
                    source_path,
                    "BATCH_MOVE",
                    "批量 Move",
                ) {
                    Ok(identity) => identity,
                    Err(error) => {
                        update_task(
                            state,
                            task_id,
                            TaskStatus::Failed,
                            "批量 Move 源路径校验失败",
                            Some(nova_error_text(&error)),
                        );
                        return;
                    }
                };
                if &current_source != expected_source {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "批量 Move 源路径已发生变化",
                        Some(nova_error_text(&delete_target_changed_error(
                            expected_source,
                            &current_source,
                        ))),
                    );
                    return;
                }

                let destination_path = batch_move_destination_path(target_directory, source_path);
                let current_destination = match validate_working_copy_destination(
                    &payload.svn_executable,
                    &canonical_root,
                    source_path,
                    &current_source,
                    &destination_path,
                    "BATCH_MOVE",
                    "批量 Move",
                ) {
                    Ok(identity) => identity,
                    Err(error) => {
                        update_task(
                            state,
                            task_id,
                            TaskStatus::Failed,
                            "批量 Move 目标路径校验失败",
                            Some(nova_error_text(&error)),
                        );
                        return;
                    }
                };
                if &current_destination != expected_destination {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "批量 Move 目标路径已发生变化",
                        Some("目标目录在任务排队后发生变化。".to_string()),
                    );
                    return;
                }
            }

            command.arg("move");
            for source_path in &payload.file_paths {
                command.arg(canonical_root.join(source_path));
            }
            let target = if target_directory.is_empty() {
                canonical_root.clone()
            } else {
                canonical_root.join(target_directory)
            };
            command.arg(target);
            append_task_log(
                state,
                task_id,
                &format!(
                    "执行 svn move：{} -> {}",
                    payload.file_paths.join(", "),
                    if target_directory.is_empty() {
                        "."
                    } else {
                        target_directory
                    }
                ),
            );
        }
    }
    command.current_dir(&root);

    match command.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "批量 SVN 操作执行成功",
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "批量 SVN 操作执行失败",
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "批量 SVN 命令启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn run_shadow_workspace_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: ShadowWorkspaceTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "影子工作副本任务开始执行",
        None,
    );

    if matches!(payload.kind, ShadowWorkspaceOperationKind::Rebuild) {
        append_task_log(state, task_id, "删除旧影子工作副本");
        if let Err(error) = shadow::remove_shadow_workspace(&payload.app, &payload.request) {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "影子工作副本删除失败",
                Some(error.to_string()),
            );
            return;
        }
    }

    let shadow_path = match shadow::shadow_workspace_path(&payload.app, &payload.request) {
        Ok(path) => path,
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "影子路径计算失败",
                Some(error.to_string()),
            );
            return;
        }
    };
    let executable = match shadow::svn_executable(&payload.request) {
        Ok(executable) => executable,
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 可执行路径无效",
                Some(error.to_string()),
            );
            return;
        }
    };
    let exists = shadow_path.join(".svn").exists();
    let mut command = Command::new(&executable);

    if exists {
        command.arg("update");
        if let Some(revision) = payload
            .request
            .revision
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            command.arg("-r").arg(revision);
        }
        command.arg(&shadow_path).current_dir(&shadow_path);
        append_task_log(state, task_id, "执行 svn update 更新影子工作副本");
    } else {
        if let Some(parent) = shadow_path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "创建影子目录失败",
                    Some(error.to_string()),
                );
                return;
            }
        }
        command.arg("checkout");
        if let Some(revision) = payload
            .request
            .revision
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            command.arg("-r").arg(revision);
        }
        command
            .arg(&payload.request.repository_url)
            .arg(&shadow_path);
        append_task_log(state, task_id, "执行 svn checkout 创建影子工作副本");
    }

    match command.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "影子工作副本准备完成",
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "影子工作副本任务失败",
                Some(command_error_detail(&executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 命令启动失败",
                Some(format!("无法执行 `{executable}`：{error}")),
            );
        }
    }
}

fn run_partial_commit_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: PartialCommitTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "Hunk 级部分提交开始执行",
        None,
    );

    let shadow_path = match shadow::shadow_workspace_path(&payload.app, &payload.shadow_request) {
        Ok(path) => path,
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "影子路径计算失败",
                Some(error.to_string()),
            );
            return;
        }
    };
    let executable = match shadow::svn_executable(&payload.shadow_request) {
        Ok(executable) => executable,
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 可执行路径无效",
                Some(error.to_string()),
            );
            return;
        }
    };

    if !shadow_path.join(".svn").exists() {
        append_task_log(state, task_id, "影子工作副本不存在，先执行 checkout");
        if !run_shadow_checkout_or_update(
            state,
            task_id,
            &payload.shadow_request,
            &shadow_path,
            &executable,
        ) {
            return;
        }
    } else {
        append_task_log(state, task_id, "更新影子工作副本");
        if !run_shadow_checkout_or_update(
            state,
            task_id,
            &payload.shadow_request,
            &shadow_path,
            &executable,
        ) {
            return;
        }
    }

    append_task_log(state, task_id, "清理影子工作副本本地改动");
    let revert_output = Command::new(&executable)
        .arg("revert")
        .arg("-R")
        .arg(&shadow_path)
        .current_dir(&shadow_path)
        .output();
    match revert_output {
        Ok(output) if output.status.success() => append_command_output(state, task_id, &output),
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "影子工作副本清理失败",
                Some(command_error_detail(&executable, &output)),
            );
            return;
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN revert 启动失败",
                Some(format!("无法执行 `{executable}`：{error}")),
            );
            return;
        }
    }

    let patch_path = shadow_path.join(".novasvn-selected.patch");
    if let Err(error) = std::fs::write(&patch_path, &payload.selected_patch) {
        update_task(
            state,
            task_id,
            TaskStatus::Failed,
            "写入 selected patch 失败",
            Some(error.to_string()),
        );
        return;
    }

    append_task_log(state, task_id, "应用 selected patch 到影子工作副本");
    let patch_output = svn_patch_command(&executable, false, &patch_path, &shadow_path).output();
    let _ = std::fs::remove_file(&patch_path);
    match patch_output {
        Ok(output) if output.status.success() => append_command_output(state, task_id, &output),
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "selected patch 应用失败",
                Some(command_error_detail(&executable, &output)),
            );
            return;
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN patch 启动失败",
                Some(format!("无法执行 `{executable}`：{error}")),
            );
            return;
        }
    }

    append_task_log(state, task_id, "在影子工作副本执行 svn commit");
    let mut commit = Command::new(&executable);
    commit.arg("commit");
    for file in &payload.files {
        commit.arg(shadow_path.join(file));
    }
    commit
        .arg("-m")
        .arg(&payload.message)
        .current_dir(&shadow_path);

    match commit.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "Hunk 级部分提交成功，请同步真实工作副本",
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "影子工作副本提交失败",
                Some(command_error_detail(&executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN commit 启动失败",
                Some(format!("无法执行 `{executable}`：{error}")),
            );
        }
    }
}

fn run_repository_list_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryListTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "仓库目录加载开始执行",
        None,
    );
    append_task_log(
        state,
        task_id,
        &format!("执行 svn list --xml：{}", payload.url),
    );

    let output = Command::new(&payload.svn_executable)
        .args(["list", "--xml"])
        .arg(&payload.url)
        .output();

    match output {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            let xml = String::from_utf8_lossy(&output.stdout);
            match parse_repository_list_xml(&xml, &payload.url) {
                Ok(result) => {
                    let count = result.entries.len();
                    set_task_result(
                        state,
                        task_id,
                        TaskResult {
                            repository_list: Some(result),
                            revision_diff: None,
                            merge_result: None,
                            apply_patch_result: None,
                        },
                    );
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Success,
                        &format!("仓库目录加载完成，共 {count} 项"),
                        None,
                    );
                }
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "仓库目录 XML 解析失败",
                        Some(error.to_string()),
                    );
                }
            }
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "仓库目录加载失败",
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 命令启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn run_repository_copy_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryCopyTaskPayload,
) {
    let title = match payload.kind {
        RepositoryCopyKind::Branch => "创建分支",
        RepositoryCopyKind::Tag => "创建标签",
    };
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        &format!("{title}开始执行"),
        None,
    );
    append_task_log(
        state,
        task_id,
        &format!(
            "执行 svn copy：{} -> {}",
            payload.source_url, payload.target_url
        ),
    );

    let mut command = Command::new(&payload.svn_executable);
    command.arg("copy");
    if let Some(revision) = payload.revision.as_deref() {
        command.arg("-r").arg(revision);
    }
    command
        .arg(&payload.source_url)
        .arg(&payload.target_url)
        .arg("-m")
        .arg(&payload.message);

    match command.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                &format!("{title}成功"),
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                &format!("{title}失败"),
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 命令启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn run_revision_diff_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RevisionDiffTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "Revision diff 开始执行",
        None,
    );

    let mut command = Command::new(&payload.svn_executable);
    command.arg("diff");
    let target = match payload.mode {
        RevisionDiffMode::Revisions => {
            let root = payload
                .working_copy_root
                .as_deref()
                .expect("revision diff 工作副本已校验");
            let left = payload
                .left_revision
                .as_deref()
                .expect("左 revision 已校验");
            let right = payload
                .right_revision
                .as_deref()
                .expect("右 revision 已校验");
            let command_target = payload.target_url.as_deref().unwrap_or(root);
            command
                .arg("-r")
                .arg(format!("{left}:{right}"))
                .arg(command_target);
            let display_target = payload
                .target_url
                .as_deref()
                .map(compact_repository_url)
                .unwrap_or_else(|| root.to_string());
            format!("{display_target} r{left}:r{right}")
        }
        RevisionDiffMode::WorkingCopyToRevision => {
            let root = payload
                .working_copy_root
                .as_deref()
                .expect("工作副本 diff 工作副本已校验");
            let revision = payload
                .right_revision
                .as_deref()
                .expect("目标 revision 已校验");
            command.arg("-r").arg(revision).arg(root);
            format!("{root} ↔ r{revision}")
        }
        RevisionDiffMode::Urls => {
            let left_url = payload.left_url.as_deref().expect("左 URL 已校验");
            let right_url = payload.right_url.as_deref().expect("右 URL 已校验");
            command.arg(left_url).arg(right_url);
            format!(
                "{} ↔ {}",
                compact_repository_url(left_url),
                compact_repository_url(right_url)
            )
        }
    };
    append_task_log(state, task_id, &format!("执行 svn diff：{target}"));

    match command.output() {
        Ok(output) if output.status.success() => {
            append_stream_lines(state, task_id, &String::from_utf8_lossy(&output.stderr));
            let diff_text = String::from_utf8_lossy(&output.stdout).to_string();
            let file_count = count_diff_files(&diff_text);
            let line_count = diff_text.lines().count();
            let truncated = diff_text.len() > REVISION_DIFF_PREVIEW_MAX_BYTES;
            let preview_text = truncate_utf8(&diff_text, REVISION_DIFF_PREVIEW_MAX_BYTES);
            let patch_file = write_revision_diff_patch(&payload, task_id, &target, &diff_text);
            if let Err(error) = &patch_file {
                append_task_log(state, task_id, &format!("完整 patch 文件写入失败：{error}"));
            }
            let patch_file = patch_file.ok().flatten();
            let result = RevisionDiffResult {
                mode: revision_diff_mode_label(&payload.mode).to_string(),
                target,
                diff_text: preview_text,
                file_count,
                line_count,
                truncated,
                max_bytes: REVISION_DIFF_PREVIEW_MAX_BYTES,
                patch_file_path: patch_file
                    .as_ref()
                    .map(|file| file.path.display().to_string()),
                patch_file_dir: patch_file
                    .as_ref()
                    .map(|file| file.dir.display().to_string()),
                patch_file_name: patch_file.map(|file| file.name),
            };
            if truncated {
                append_task_log(
                    state,
                    task_id,
                    &format!(
                        "Diff 输出超过 {} 字节，界面仅保留预览片段",
                        REVISION_DIFF_PREVIEW_MAX_BYTES
                    ),
                );
            }
            if !diff_text.is_empty() {
                if let Some(path) = result.patch_file_path.as_deref() {
                    append_task_log(state, task_id, &format!("完整 patch 已保存：{path}"));
                }
            }
            set_task_result(
                state,
                task_id,
                TaskResult {
                    repository_list: None,
                    revision_diff: Some(result),
                    merge_result: None,
                    apply_patch_result: None,
                },
            );
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                &format!(
                    "Revision diff 完成，{file_count} 个文件，{line_count} 行{}",
                    if truncated {
                        "，结果已截断预览"
                    } else {
                        ""
                    }
                ),
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "Revision diff 失败",
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN diff 启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn run_merge_task(state: &Arc<Mutex<TaskQueueState>>, task_id: &str, payload: MergeTaskPayload) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        if payload.dry_run {
            "Merge dry-run 开始执行"
        } else {
            "Merge 开始执行"
        },
        None,
    );

    let root = PathBuf::from(&payload.working_copy_root);
    let mut command = Command::new(&payload.svn_executable);
    command.arg("merge");
    if let Some(range) = merge_revision_arg(&payload.start_revision, &payload.end_revision) {
        command.arg("-r").arg(range);
    }
    if payload.dry_run {
        command.arg("--dry-run");
    }
    command.arg(&payload.source_url).current_dir(&root);
    append_task_log(
        state,
        task_id,
        &format!(
            "执行 svn merge{}：{}",
            if payload.dry_run { " --dry-run" } else { "" },
            payload.source_url
        ),
    );

    match command.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            let output_text = merge_output_text(&output);
            let result = MergeResult {
                dry_run: payload.dry_run,
                source_url: payload.source_url.clone(),
                revision_range: merge_revision_label(
                    &payload.start_revision,
                    &payload.end_revision,
                ),
                file_count: count_merge_output_files(&output_text),
                line_count: output_text.lines().count(),
                output_text,
            };
            set_task_result(
                state,
                task_id,
                TaskResult {
                    repository_list: None,
                    revision_diff: None,
                    merge_result: Some(result),
                    apply_patch_result: None,
                },
            );
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                if payload.dry_run {
                    "Merge dry-run 完成"
                } else {
                    "Merge 执行成功"
                },
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                if payload.dry_run {
                    "Merge dry-run 失败"
                } else {
                    "Merge 执行失败"
                },
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN merge 启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn run_apply_patch_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: ApplyPatchTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        if payload.dry_run {
            "Patch dry-run 开始执行"
        } else {
            "Patch 开始应用"
        },
        None,
    );

    let validated = normalize_workspace_root(&payload.working_copy_root).and_then(|root| {
        let working_copy_root = fs::canonicalize(&root).map_err(|error| {
            NovaError::command(
                "APPLY_PATCH_WORKSPACE_INVALID",
                "无法解析工作副本根目录",
                Some(format!("路径：{}；错误：{error}", root.display())),
                true,
            )
        })?;
        validate_apply_patch_working_copy_root(&payload.svn_executable, &working_copy_root)?;
        validate_apply_patch_targets(&working_copy_root, &payload.patch_snapshot)?;
        Ok(working_copy_root)
    });
    let working_copy_root = match validated {
        Ok(root) => root,
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "Patch 安全校验失败",
                Some(nova_error_text(&error)),
            );
            return;
        }
    };

    let snapshot_file = match ApplyPatchSnapshotFile::create(
        &working_copy_root,
        task_id,
        &payload.patch_snapshot,
    ) {
        Ok(snapshot_file) => snapshot_file,
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "创建 Patch 快照失败",
                Some(nova_error_text(&error)),
            );
            return;
        }
    };

    if !payload.dry_run {
        append_task_log(state, task_id, "使用不可变 Patch 快照执行应用前 dry-run");
        let preflight_output = svn_patch_command(
            &payload.svn_executable,
            true,
            snapshot_file.path(),
            &working_copy_root,
        )
        .output();
        let preflight_output = match preflight_output {
            Ok(output) => output,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "SVN patch 预检启动失败",
                    Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
                );
                return;
            }
        };
        append_command_output(state, task_id, &preflight_output);
        let preflight_text = apply_patch_output_from_command(&preflight_output);
        let preflight_stats = parse_apply_patch_stats(&preflight_text);
        if !preflight_output.status.success() || !preflight_stats.allows_apply() {
            set_apply_patch_result(
                state,
                task_id,
                &payload,
                true,
                preflight_text,
                &preflight_stats,
            );
            let detail = if preflight_output.status.success() {
                format_apply_patch_guard_error(&preflight_stats)
            } else {
                apply_patch_command_error_detail(&payload.svn_executable, &preflight_output)
            };
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "Patch 应用前预检未通过",
                Some(detail),
            );
            return;
        }
        append_task_log(state, task_id, "Patch 应用前预检通过");
    }

    append_task_log(
        state,
        task_id,
        &format!(
            "使用不可变快照执行 svn patch{}：{}",
            if payload.dry_run { " --dry-run" } else { "" },
            payload.patch_file_path
        ),
    );

    match svn_patch_command(
        &payload.svn_executable,
        payload.dry_run,
        snapshot_file.path(),
        &working_copy_root,
    )
    .output()
    {
        Ok(output) => {
            append_command_output(state, task_id, &output);
            let output_text = apply_patch_output_from_command(&output);
            let stats = parse_apply_patch_stats(&output_text);
            set_apply_patch_result(
                state,
                task_id,
                &payload,
                payload.dry_run,
                output_text,
                &stats,
            );

            if output.status.success() && (payload.dry_run || stats.allows_apply()) {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Success,
                    &format!(
                        "Patch {}完成：应用 {}，拒绝 {}，跳过 {}，冲突 {}",
                        if payload.dry_run { "预检" } else { "执行" },
                        stats.applied,
                        stats.rejected,
                        stats.skipped,
                        stats.conflicted
                    ),
                    None,
                );
            } else {
                let detail = if output.status.success() {
                    format_apply_patch_guard_error(&stats)
                } else {
                    apply_patch_command_error_detail(&payload.svn_executable, &output)
                };
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    if payload.dry_run {
                        "Patch dry-run 失败"
                    } else {
                        "Patch 应用失败"
                    },
                    Some(detail),
                );
            }
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN patch 启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn set_apply_patch_result(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: &ApplyPatchTaskPayload,
    result_dry_run: bool,
    output_text: String,
    stats: &ApplyPatchStats,
) {
    set_task_result(
        state,
        task_id,
        TaskResult {
            repository_list: None,
            revision_diff: None,
            merge_result: None,
            apply_patch_result: Some(ApplyPatchResult {
                dry_run: result_dry_run,
                patch_file_path: payload.patch_file_path.clone(),
                patch_digest: payload.patch_digest.clone(),
                output_text,
                applied: stats.applied,
                rejected: stats.rejected,
                skipped: stats.skipped,
                conflicted: stats.conflicted,
            }),
        },
    );
}

fn format_apply_patch_guard_error(stats: &ApplyPatchStats) -> String {
    format!(
        "Patch 快照未满足安全应用条件：应用 {}，拒绝 {}，跳过 {}，冲突 {}。",
        stats.applied, stats.rejected, stats.skipped, stats.conflicted
    )
}

fn run_branch_checkout_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: BranchCheckoutTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "分支 checkout 开始执行",
        None,
    );
    append_task_log(
        state,
        task_id,
        &format!(
            "执行 svn checkout：{} -> {}",
            payload.branch_url, payload.local_path
        ),
    );

    let mut command = Command::new(&payload.svn_executable);
    command.arg("checkout");
    if let Some(revision) = payload.revision.as_deref() {
        command.arg("-r").arg(revision);
    }
    command.arg(&payload.branch_url).arg(&payload.local_path);

    match command.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "分支 checkout 成功",
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "分支 checkout 失败",
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 命令启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn run_svn_switch_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: SvnSwitchTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "svn switch 开始执行",
        None,
    );
    append_task_log(
        state,
        task_id,
        &format!("执行 svn switch：{}", payload.target_url),
    );

    let root = PathBuf::from(&payload.working_copy_root);
    let output = Command::new(&payload.svn_executable)
        .arg("switch")
        .arg(&payload.target_url)
        .arg(&root)
        .current_dir(&root)
        .output();

    match output {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(state, task_id, TaskStatus::Success, "svn switch 成功", None);
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "svn switch 失败",
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 命令启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn run_shadow_checkout_or_update(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    request: &ShadowWorkspaceRequest,
    shadow_path: &Path,
    executable: &str,
) -> bool {
    let exists = shadow_path.join(".svn").exists();
    let mut command = Command::new(executable);
    if exists {
        command.arg("update");
        if let Some(revision) = request
            .revision
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            command.arg("-r").arg(revision);
        }
        command.arg(shadow_path).current_dir(shadow_path);
    } else {
        if let Some(parent) = shadow_path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "创建影子目录失败",
                    Some(error.to_string()),
                );
                return false;
            }
        }
        command.arg("checkout");
        if let Some(revision) = request
            .revision
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            command.arg("-r").arg(revision);
        }
        command.arg(&request.repository_url).arg(shadow_path);
    }

    match command.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            true
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "影子工作副本准备失败",
                Some(command_error_detail(executable, &output)),
            );
            false
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN 命令启动失败",
                Some(format!("无法执行 `{executable}`：{error}")),
            );
            false
        }
    }
}

fn append_command_output(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    output: &std::process::Output,
) {
    append_stream_lines(state, task_id, &String::from_utf8_lossy(&output.stdout));
    append_stream_lines(state, task_id, &String::from_utf8_lossy(&output.stderr));
}

fn append_stream_lines(state: &Arc<Mutex<TaskQueueState>>, task_id: &str, text: &str) {
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        append_task_log(state, task_id, line);
    }
}

fn command_error_detail(executable: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        return stderr;
    }

    if !stdout.is_empty() {
        return stdout;
    }

    format!(
        "`{executable} commit` 返回退出码 {:?}，但没有输出。",
        output.status.code()
    )
}

fn apply_patch_command_error_detail(executable: &str, output: &std::process::Output) -> String {
    command_output_error_detail(executable, "patch", output)
}

fn command_output_error_detail(
    executable: &str,
    subcommand: &str,
    output: &std::process::Output,
) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        return stderr;
    }

    if !stdout.is_empty() {
        return stdout;
    }

    format!(
        "`{executable} {subcommand}` 返回退出码 {:?}，但没有输出。",
        output.status.code()
    )
}

fn nova_error_text(error: &NovaError) -> String {
    match error {
        NovaError::Command {
            message, detail, ..
        } => detail
            .as_deref()
            .map(|detail| format!("{message}：{detail}"))
            .unwrap_or_else(|| message.clone()),
    }
}

fn update_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    status: TaskStatus,
    message: &str,
    error: Option<String>,
) {
    let mut state = state.lock().expect("任务队列锁已损坏");
    if let Some(task) = state.tasks.iter_mut().find(|task| task.task_id == task_id) {
        let now = timestamp_millis();
        task.status = status;
        task.error = error;
        task.updated_at = now;
        task.logs.push(TaskLog {
            message: message.to_string(),
            created_at: now,
        });
    }
}

fn append_task_log(state: &Arc<Mutex<TaskQueueState>>, task_id: &str, message: &str) {
    let mut state = state.lock().expect("任务队列锁已损坏");
    if let Some(task) = state.tasks.iter_mut().find(|task| task.task_id == task_id) {
        let now = timestamp_millis();
        task.updated_at = now;
        task.logs.push(TaskLog {
            message: message.to_string(),
            created_at: now,
        });
    }
}

fn set_task_result(state: &Arc<Mutex<TaskQueueState>>, task_id: &str, result: TaskResult) {
    let mut state = state.lock().expect("任务队列锁已损坏");
    if let Some(task) = state.tasks.iter_mut().find(|task| task.task_id == task_id) {
        task.result = Some(result);
        task.updated_at = timestamp_millis();
    }
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("系统时间早于 UNIX_EPOCH")
        .as_millis() as u64
}

fn normalize_svn_executable(executable: Option<&str>) -> Result<String, NovaError> {
    normalize_executable_setting(
        executable,
        "svn",
        "SVN_EXECUTABLE_INVALID",
        "SVN 可执行文件路径无效",
    )
}

fn workspace_has_local_changes(executable: &str, root: &Path) -> Result<bool, NovaError> {
    workspace_has_local_changes_with_error(
        executable,
        root,
        "SVN_SWITCH_STATUS_FAILED",
        "SVN_SWITCH_STATUS_XML_PARSE_FAILED",
    )
}

fn merge_workspace_has_local_changes(executable: &str, root: &Path) -> Result<bool, NovaError> {
    workspace_has_local_changes_with_error(
        executable,
        root,
        "SVN_MERGE_STATUS_FAILED",
        "SVN_MERGE_STATUS_XML_PARSE_FAILED",
    )
}

fn workspace_has_local_changes_with_error(
    executable: &str,
    root: &Path,
    status_error_code: &'static str,
    parse_error_code: &'static str,
) -> Result<bool, NovaError> {
    let xml = svn_status_xml_for_guard(executable, root, status_error_code)?;
    status_xml_has_entries_with_error(&xml, parse_error_code)
}

fn svn_status_xml_for_guard(
    executable: &str,
    root: &Path,
    status_error_code: &'static str,
) -> Result<String, NovaError> {
    let output = Command::new(executable)
        .args(["status", "--xml"])
        .arg(root)
        .current_dir(root)
        .output()
        .map_err(|error| {
            NovaError::command(
                status_error_code,
                "无法检查工作副本本地改动",
                Some(format!(
                    "执行 `{executable} status --xml {}` 失败：{error}",
                    root.display()
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            status_error_code,
            "无法检查工作副本本地改动",
            Some(command_error_detail(executable, &output)),
            true,
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
fn status_xml_has_entries(xml: &str) -> Result<bool, NovaError> {
    status_xml_has_entries_with_error(xml, "SVN_SWITCH_STATUS_XML_PARSE_FAILED")
}

fn status_xml_has_entries_with_error(
    xml: &str,
    parse_error_code: &'static str,
) -> Result<bool, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            parse_error_code,
            "解析工作副本本地改动状态失败",
            Some(format!("svn status --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;

    Ok(document
        .descendants()
        .any(|node| node.has_tag_name("entry")))
}

fn normalize_workspace_root(path: &str) -> Result<PathBuf, NovaError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "WORKSPACE_REQUIRED",
            "请先打开 SVN 工作副本",
            None,
            true,
        ));
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() || !path.is_dir() {
        return Err(NovaError::command(
            "WORKSPACE_PATH_INVALID",
            "工作副本路径无效",
            Some(format!("路径：{}", path.display())),
            true,
        ));
    }

    Ok(path)
}

fn normalize_apply_patch_paths(
    working_copy_root: &str,
    patch_file_path: &str,
) -> Result<(PathBuf, PathBuf), NovaError> {
    let working_copy_root = normalize_workspace_root(working_copy_root)?;
    let working_copy_root = fs::canonicalize(&working_copy_root).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_WORKSPACE_INVALID",
            "无法解析工作副本根目录",
            Some(format!(
                "路径：{}；错误：{error}",
                working_copy_root.display()
            )),
            true,
        )
    })?;

    let raw_patch_path = patch_file_path.trim();
    if raw_patch_path.is_empty() {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_REQUIRED",
            "请选择 Patch 文件",
            None,
            true,
        ));
    }
    if raw_patch_path.chars().any(char::is_control) {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_PATH_INVALID",
            "Patch 文件路径无效",
            Some("Patch 文件路径不能包含控制字符。".to_string()),
            true,
        ));
    }

    let patch_file_path = PathBuf::from(raw_patch_path);
    if !patch_file_path.is_absolute() {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_PATH_INVALID",
            "Patch 文件路径无效",
            Some("请选择具有绝对路径的 Patch 文件。".to_string()),
            true,
        ));
    }
    let extension = patch_file_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(extension.as_deref(), Some("patch" | "diff")) {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_EXTENSION_INVALID",
            "Patch 文件扩展名无效",
            Some("仅支持 .patch 或 .diff 文件。".to_string()),
            true,
        ));
    }

    let metadata = fs::symlink_metadata(&patch_file_path).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_FILE_NOT_FOUND",
            "Patch 文件不存在或无法读取",
            Some(format!(
                "路径：{}；错误：{error}",
                patch_file_path.display()
            )),
            true,
        )
    })?;
    if !metadata.is_file() {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_TYPE_INVALID",
            "Patch 路径不是普通文件",
            Some(format!("路径：{}", patch_file_path.display())),
            true,
        ));
    }
    if metadata.len() == 0 {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_EMPTY",
            "Patch 文件为空",
            Some(format!("路径：{}", patch_file_path.display())),
            true,
        ));
    }
    if metadata.len() > APPLY_PATCH_MAX_BYTES {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_TOO_LARGE",
            "Patch 文件过大",
            Some(format!(
                "文件大小为 {} 字节，最大允许 {} 字节。",
                metadata.len(),
                APPLY_PATCH_MAX_BYTES
            )),
            true,
        ));
    }

    let patch_file_path = fs::canonicalize(&patch_file_path).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_FILE_PATH_INVALID",
            "无法解析 Patch 文件路径",
            Some(format!(
                "路径：{}；错误：{error}",
                patch_file_path.display()
            )),
            true,
        )
    })?;
    if patch_file_path.starts_with(&working_copy_root) {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_INSIDE_WORKSPACE",
            "Patch 文件不能位于目标工作副本内",
            Some("请将 Patch 文件移到工作副本外，避免应用过程中修改 Patch 自身。".to_string()),
            true,
        ));
    }

    Ok((working_copy_root, patch_file_path))
}

fn read_apply_patch_snapshot(patch_file_path: &Path) -> Result<Vec<u8>, NovaError> {
    let snapshot = fs::read(patch_file_path).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_FILE_READ_FAILED",
            "无法读取 Patch 文件",
            Some(format!(
                "路径：{}；错误：{error}",
                patch_file_path.display()
            )),
            true,
        )
    })?;
    if snapshot.is_empty() {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_EMPTY",
            "Patch 文件为空",
            Some(format!("路径：{}", patch_file_path.display())),
            true,
        ));
    }
    if snapshot.len() as u64 > APPLY_PATCH_MAX_BYTES {
        return Err(NovaError::command(
            "APPLY_PATCH_FILE_TOO_LARGE",
            "Patch 文件过大",
            Some(format!(
                "文件大小为 {} 字节，最大允许 {} 字节。",
                snapshot.len(),
                APPLY_PATCH_MAX_BYTES
            )),
            true,
        ));
    }

    Ok(snapshot)
}

fn apply_patch_digest(snapshot: &[u8]) -> String {
    format!("{:x}", Sha256::digest(snapshot))
}

fn validate_expected_patch_digest(
    dry_run: bool,
    expected_patch_digest: Option<&str>,
    patch_digest: &str,
) -> Result<(), NovaError> {
    if dry_run {
        if expected_patch_digest.is_some() {
            return Err(NovaError::command(
                "APPLY_PATCH_DIGEST_NOT_ALLOWED",
                "Patch dry-run 不应提供预期摘要",
                None,
                true,
            ));
        }
        return Ok(());
    }

    let expected = expected_patch_digest.ok_or_else(|| {
        NovaError::command(
            "APPLY_PATCH_DIGEST_REQUIRED",
            "应用 Patch 前必须提供预期摘要",
            Some("请先执行 dry-run，并使用其返回的 Patch 摘要确认实际应用。".to_string()),
            true,
        )
    })?;
    let expected = expected.trim();
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(NovaError::command(
            "APPLY_PATCH_DIGEST_INVALID",
            "预期 Patch 摘要无效",
            Some("摘要必须是 64 位 SHA-256 十六进制字符串。".to_string()),
            true,
        ));
    }
    if !expected.eq_ignore_ascii_case(patch_digest) {
        return Err(NovaError::command(
            "APPLY_PATCH_DIGEST_MISMATCH",
            "Patch 内容已发生变化",
            Some(format!(
                "预期摘要：{}；当前摘要：{patch_digest}",
                expected.to_ascii_lowercase()
            )),
            true,
        ));
    }

    Ok(())
}

fn validate_apply_patch_working_copy_root(
    svn_executable: &str,
    working_copy_root: &Path,
) -> Result<(), NovaError> {
    let output = Command::new(svn_executable)
        .args(["info", "--xml"])
        .arg(working_copy_root)
        .current_dir(working_copy_root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "APPLY_PATCH_WORKSPACE_INVALID",
                "无法验证 SVN 工作副本根目录",
                Some(format!("无法执行 `{svn_executable} info`：{error}")),
                true,
            )
        })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "APPLY_PATCH_WORKSPACE_INVALID",
            "目标目录不是可用的 SVN 工作副本根目录",
            Some(command_output_error_detail(
                svn_executable,
                "info --xml",
                &output,
            )),
            true,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    let document = Document::parse(&xml).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_WORKSPACE_INFO_PARSE_FAILED",
            "无法解析 SVN 工作副本信息",
            Some(format!("svn info --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;
    let reported_root = document
        .descendants()
        .find(|node| node.has_tag_name("wcroot-abspath"))
        .and_then(|node| node.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            NovaError::command(
                "APPLY_PATCH_WORKSPACE_INVALID",
                "SVN 工作副本信息缺少根目录",
                None,
                true,
            )
        })?;
    let reported_root = fs::canonicalize(reported_root).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_WORKSPACE_INVALID",
            "SVN 返回了无法解析的工作副本根目录",
            Some(format!("路径：{reported_root}；错误：{error}")),
            true,
        )
    })?;
    if reported_root != working_copy_root {
        return Err(NovaError::command(
            "APPLY_PATCH_WORKSPACE_ROOT_REQUIRED",
            "必须选择 SVN 工作副本根目录",
            Some(format!("实际工作副本根目录：{}", reported_root.display())),
            true,
        ));
    }

    Ok(())
}

fn validate_apply_patch_targets(
    working_copy_root: &Path,
    patch_snapshot: &[u8],
) -> Result<(), NovaError> {
    let patch_text = String::from_utf8_lossy(patch_snapshot);
    let mut lines = patch_text.lines().peekable();
    let mut target_count = 0usize;

    while let Some(line) = lines.next() {
        if let Some(target) = line.strip_prefix("Index: ") {
            target_count +=
                validate_apply_patch_target_path(working_copy_root, target, "Index")? as usize;
            continue;
        }
        if let Some(target) = line.strip_prefix("Property changes on: ") {
            target_count +=
                validate_apply_patch_target_path(working_copy_root, target, "属性变更")? as usize;
            continue;
        }
        if let Some(targets) = line.strip_prefix("diff --git ") {
            let mut targets = targets.split_whitespace();
            let old_target = targets.next().unwrap_or_default();
            let new_target = targets.next().unwrap_or_default();
            if old_target.is_empty() || new_target.is_empty() {
                return Err(invalid_apply_patch_target("diff --git 目标不完整"));
            }
            target_count +=
                validate_apply_patch_target_path(working_copy_root, old_target, "diff --git")?
                    as usize;
            target_count +=
                validate_apply_patch_target_path(working_copy_root, new_target, "diff --git")?
                    as usize;
            continue;
        }
        if let Some(old_target) = line.strip_prefix("--- ") {
            let Some(next_line) = lines.peek() else {
                continue;
            };
            let Some(new_target) = next_line.strip_prefix("+++ ") else {
                continue;
            };
            let old_target = old_target.split('\t').next().unwrap_or(old_target);
            let new_target = new_target.split('\t').next().unwrap_or(new_target);
            target_count +=
                validate_apply_patch_target_path(working_copy_root, old_target, "旧文件")? as usize;
            target_count +=
                validate_apply_patch_target_path(working_copy_root, new_target, "新文件")? as usize;
        }
    }

    if target_count == 0 {
        return Err(NovaError::command(
            "APPLY_PATCH_TARGET_MISSING",
            "Patch 中没有可应用的文件目标",
            Some("请选择包含标准 unified diff 文件头的 Patch。".to_string()),
            true,
        ));
    }

    Ok(())
}

fn validate_apply_patch_target_path(
    working_copy_root: &Path,
    target: &str,
    label: &str,
) -> Result<bool, NovaError> {
    let target = target.trim();
    if target == "/dev/null" {
        return Ok(false);
    }
    validate_apply_patch_target_syntax(target, label)?;
    validate_apply_patch_target_ancestor(working_copy_root, target, label)?;

    if let Some(stripped) = target
        .strip_prefix("a/")
        .or_else(|| target.strip_prefix("b/"))
    {
        validate_apply_patch_target_syntax(stripped, label)?;
        validate_apply_patch_target_ancestor(working_copy_root, stripped, label)?;
    }

    Ok(true)
}

fn validate_apply_patch_target_syntax(target: &str, label: &str) -> Result<(), NovaError> {
    if target.is_empty()
        || target.starts_with('"')
        || target.ends_with('"')
        || target.contains('\u{fffd}')
        || target.chars().any(char::is_control)
        || path_utils::is_absolute_or_windows_path(Path::new(target), target)
        || is_windows_drive_relative_path(target)
        || path_utils::has_parent_segment(target)
        || target
            .split(['/', '\\'])
            .any(|segment| segment.eq_ignore_ascii_case(".svn"))
    {
        return Err(invalid_apply_patch_target(&format!("{label}：{target}")));
    }

    Ok(())
}

fn is_windows_drive_relative_path(target: &str) -> bool {
    let bytes = target.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn validate_apply_patch_target_ancestor(
    working_copy_root: &Path,
    target: &str,
    label: &str,
) -> Result<(), NovaError> {
    let working_copy_root = fs::canonicalize(working_copy_root).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_WORKSPACE_INVALID",
            "无法解析 Patch 目标工作副本",
            Some(format!(
                "路径：{}；错误：{error}",
                working_copy_root.display()
            )),
            true,
        )
    })?;
    let mut ancestor = working_copy_root.join(target);
    loop {
        match fs::symlink_metadata(&ancestor) {
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !ancestor.pop() || !ancestor.starts_with(&working_copy_root) {
                    return Err(invalid_apply_patch_target(&format!("{label}：{target}")));
                }
            }
            Err(error) => {
                return Err(NovaError::command(
                    "APPLY_PATCH_TARGET_CHECK_FAILED",
                    "无法验证 Patch 文件目标",
                    Some(format!("{label}：{target}；错误：{error}")),
                    true,
                ));
            }
        }
    }

    let ancestor = fs::canonicalize(&ancestor).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_TARGET_CHECK_FAILED",
            "无法解析 Patch 文件目标",
            Some(format!("{label}：{target}；错误：{error}")),
            true,
        )
    })?;
    if !ancestor.starts_with(&working_copy_root) {
        return Err(invalid_apply_patch_target(&format!("{label}：{target}")));
    }

    Ok(())
}

fn invalid_apply_patch_target(detail: &str) -> NovaError {
    NovaError::command(
        "APPLY_PATCH_TARGET_INVALID",
        "Patch 包含不安全的文件目标",
        Some(format!(
            "{detail}。Patch 目标必须是工作副本内不含 `..` 的相对路径。"
        )),
        true,
    )
}

fn normalize_commit_files(files: &[String]) -> Result<Vec<String>, NovaError> {
    if files.is_empty() {
        return Err(NovaError::command(
            "COMMIT_FILES_REQUIRED",
            "请选择要提交的文件",
            None,
            true,
        ));
    }

    let mut normalized = Vec::with_capacity(files.len());
    for file in files {
        normalized.push(normalize_relative_file_path(
            file,
            "COMMIT_FILE_PATH_INVALID",
            "提交文件路径无效",
        )?);
    }

    Ok(normalized)
}

fn validate_selected_patch_files(selected_patch: &str, files: &[String]) -> Result<(), NovaError> {
    for file in files {
        let old_header = format!("--- {file}");
        let new_header = format!("+++ {file}");
        let index_header = format!("Index: {file}");
        if selected_patch.lines().any(|line| {
            line == index_header || line.starts_with(&old_header) || line.starts_with(&new_header)
        }) {
            continue;
        }

        return Err(NovaError::command(
            "SELECTED_PATCH_FILE_MISMATCH",
            "Selected patch 与提交文件不一致",
            Some(format!("selected patch 未包含提交文件：{file}")),
            true,
        ));
    }

    Ok(())
}

fn normalize_relative_file_path(
    file: &str,
    code: &'static str,
    message: &'static str,
) -> Result<String, NovaError> {
    let path = Path::new(file);
    if file.is_empty()
        || task_file_path_is_absolute(path, file)
        || task_file_path_has_parent_segment(file)
        || task_file_path_has_unsafe_platform_alias(file)
    {
        return Err(NovaError::command(
            code,
            message,
            Some("文件路径必须是工作副本内的相对路径。".to_string()),
            true,
        ));
    }

    if file.chars().any(char::is_control) {
        return Err(NovaError::command(
            code,
            message,
            Some("文件路径不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(normalize_task_file_path_separators(file))
}

#[cfg(windows)]
fn task_file_path_is_absolute(path: &Path, raw: &str) -> bool {
    path_utils::is_absolute_or_windows_path(path, raw)
}

#[cfg(not(windows))]
fn task_file_path_is_absolute(path: &Path, _raw: &str) -> bool {
    path.is_absolute()
}

#[cfg(windows)]
fn task_file_path_has_parent_segment(raw: &str) -> bool {
    raw.split(['/', '\\']).any(|segment| segment == "..")
}

#[cfg(not(windows))]
fn task_file_path_has_parent_segment(raw: &str) -> bool {
    raw.split('/').any(|segment| segment == "..")
}

#[cfg(windows)]
fn task_file_path_has_unsafe_platform_alias(raw: &str) -> bool {
    raw.split(['/', '\\'])
        .any(delete_path_segment_has_windows_alias)
}

#[cfg(not(windows))]
fn task_file_path_has_unsafe_platform_alias(_raw: &str) -> bool {
    false
}

#[cfg(windows)]
fn normalize_task_file_path_separators(raw: &str) -> String {
    raw.replace('\\', "/")
}

#[cfg(not(windows))]
fn normalize_task_file_path_separators(raw: &str) -> String {
    raw.to_string()
}

fn normalize_delete_path(file: &str) -> Result<String, NovaError> {
    normalize_strict_working_copy_path(file, "DELETE_PATH_INVALID", "删除路径无效")
}

fn normalize_batch_operation_paths<F>(
    paths: &[String],
    code: &str,
    message: &str,
    mut normalize: F,
) -> Result<Vec<String>, NovaError>
where
    F: FnMut(&str) -> Result<String, NovaError>,
{
    if paths.is_empty() || paths.len() > MAX_BATCH_OPERATION_PATHS {
        return Err(NovaError::command(
            code,
            message,
            Some(format!(
                "请选择 1 到 {MAX_BATCH_OPERATION_PATHS} 个工作副本路径。"
            )),
            true,
        ));
    }

    let mut normalized = Vec::with_capacity(paths.len());
    let mut seen = HashSet::with_capacity(paths.len());
    let mut total_bytes = 0usize;
    for path in paths {
        let path = normalize(path)?;
        total_bytes = total_bytes.saturating_add(path.len() + 1);
        if total_bytes > MAX_BATCH_OPERATION_PATH_BYTES {
            return Err(NovaError::command(
                code,
                message,
                Some(format!(
                    "所选路径总长度不能超过 {MAX_BATCH_OPERATION_PATH_BYTES} 字节。"
                )),
                true,
            ));
        }
        if seen.insert(path.clone()) {
            normalized.push(path);
        }
    }

    Ok(normalized)
}

fn collapse_descendant_paths(paths: Vec<String>) -> Vec<String> {
    let selected = paths.iter().cloned().collect::<HashSet<_>>();
    paths
        .into_iter()
        .filter(|path| {
            let mut current = path.as_str();
            while let Some((parent, _)) = current.rsplit_once('/') {
                if selected.contains(parent) {
                    return false;
                }
                current = parent;
            }
            true
        })
        .collect()
}

fn normalize_batch_move_target(path: &str) -> Result<String, NovaError> {
    if path == "." {
        return Ok(String::new());
    }
    normalize_move_path(
        path,
        "BATCH_MOVE_TARGET_PATH_INVALID",
        "批量 Move 目标目录无效",
    )
}

fn batch_move_destination_path(target_directory: &str, source_path: &str) -> String {
    let basename = source_path.rsplit('/').next().unwrap_or(source_path);
    if target_directory.is_empty() {
        basename.to_string()
    } else {
        format!("{target_directory}/{basename}")
    }
}

fn ensure_unique_batch_move_destinations(paths: Vec<String>) -> Result<Vec<String>, NovaError> {
    let mut seen = HashSet::with_capacity(paths.len());
    for path in &paths {
        if !seen.insert(path) {
            return Err(NovaError::command(
                "BATCH_MOVE_TARGET_COLLISION",
                "批量 Move 中存在同名目标",
                Some(format!("多个源路径会移动到同一目标：{path}")),
                true,
            ));
        }
    }
    Ok(paths)
}

fn normalize_move_path(file: &str, code: &str, message: &str) -> Result<String, NovaError> {
    normalize_strict_working_copy_path(file, code, message)
}

fn normalize_strict_working_copy_path(
    file: &str,
    code: &str,
    message: &str,
) -> Result<String, NovaError> {
    let path = Path::new(file);
    if file.is_empty()
        || delete_path_has_unsafe_platform_syntax(path, file)
        || file.chars().any(char::is_control)
    {
        return Err(NovaError::command(
            code,
            message,
            Some("路径必须使用 `/` 分隔，并且是工作副本内不含控制字符的严格相对路径。".to_string()),
            true,
        ));
    }

    let segments = file.split('/').collect::<Vec<_>>();
    if segments.iter().any(|segment| {
        segment.is_empty() || matches!(*segment, "." | "..") || segment.eq_ignore_ascii_case(".svn")
    }) || segments
        .iter()
        .any(|segment| delete_path_segment_has_windows_alias(segment))
    {
        return Err(NovaError::command(
            code,
            message,
            Some("路径不能包含空路径段、`.`、`..`、`.svn` 元数据目录或系统路径别名。".to_string()),
            true,
        ));
    }

    Ok(file.to_string())
}

#[cfg(windows)]
fn delete_path_has_unsafe_platform_syntax(path: &Path, file: &str) -> bool {
    let bytes = file.as_bytes();
    let has_windows_prefix = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    path_utils::is_absolute_or_windows_path(path, file)
        || file.starts_with('/')
        || file.contains('\\')
        || has_windows_prefix
}

#[cfg(not(windows))]
fn delete_path_has_unsafe_platform_syntax(path: &Path, _file: &str) -> bool {
    path.is_absolute()
}

#[cfg(windows)]
fn delete_path_segment_has_windows_alias(segment: &str) -> bool {
    segment.ends_with(' ') || segment.ends_with('.') || segment.contains(':')
}

#[cfg(not(windows))]
fn delete_path_segment_has_windows_alias(_segment: &str) -> bool {
    false
}

fn canonicalize_delete_working_copy_root(root: &Path) -> Result<PathBuf, NovaError> {
    let canonical_root = fs::canonicalize(root).map_err(|error| {
        NovaError::command(
            "DELETE_TARGET_UNSAFE",
            "无法安全解析删除目标工作副本",
            Some(format!("路径：{}；错误：{error}", root.display())),
            true,
        )
    })?;
    if !canonical_root.is_absolute() {
        return Err(NovaError::command(
            "DELETE_TARGET_UNSAFE",
            "删除目标工作副本不是绝对路径",
            Some(format!("路径：{}", canonical_root.display())),
            true,
        ));
    }

    Ok(canonical_root)
}

fn validate_delete_target(
    svn_executable: &str,
    working_copy_root: &Path,
    relative_path: &str,
) -> Result<DeleteTargetIdentity, NovaError> {
    validate_delete_target_ancestors(working_copy_root, relative_path)?;

    let target = working_copy_root.join(relative_path);
    let output = Command::new(svn_executable)
        .args(["info", "--xml"])
        .arg(&target)
        .current_dir(working_copy_root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "DELETE_TARGET_NOT_VERSIONED",
                "无法验证删除目标的 SVN 工作副本",
                Some(format!("无法执行 `{svn_executable} info --xml`：{error}")),
                true,
            )
        })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "DELETE_TARGET_NOT_VERSIONED",
            "删除目标不是版本控制项目",
            Some(command_output_error_detail(
                svn_executable,
                "info --xml",
                &output,
            )),
            true,
        ));
    }

    let xml = std::str::from_utf8(&output.stdout).map_err(|error| {
        NovaError::command(
            "DELETE_TARGET_NOT_VERSIONED",
            "删除目标的 SVN 信息不是有效 UTF-8",
            Some(error.to_string()),
            true,
        )
    })?;
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "DELETE_TARGET_NOT_VERSIONED",
            "无法解析删除目标的 SVN 信息",
            Some(format!("svn info --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;
    let mut entries = document
        .descendants()
        .filter(|node| node.has_tag_name("entry"));
    let entry = entries.next().ok_or_else(|| {
        NovaError::command(
            "DELETE_TARGET_NOT_VERSIONED",
            "删除目标缺少 SVN 节点信息",
            None,
            true,
        )
    })?;
    if entries.next().is_some() {
        return Err(NovaError::command(
            "DELETE_TARGET_NOT_VERSIONED",
            "删除目标返回了多个 SVN 节点",
            None,
            true,
        ));
    }

    let entry_kind = required_delete_info_attribute(entry, "kind")?;
    if !matches!(entry_kind.as_str(), "file" | "dir") {
        return Err(NovaError::command(
            "DELETE_TARGET_NOT_VERSIONED",
            "删除目标的 SVN 节点类型无效",
            Some(format!("类型：{entry_kind}")),
            true,
        ));
    }
    let url = required_delete_info_text(entry, "url")?;
    let relative_url = text_child(entry, "relative-url");
    let repository_uuid = entry
        .children()
        .find(|node| node.has_tag_name("repository"))
        .and_then(|repository| text_child(repository, "uuid"));
    let wc_info = entry
        .children()
        .find(|node| node.has_tag_name("wc-info"))
        .ok_or_else(|| {
            NovaError::command(
                "DELETE_TARGET_NOT_VERSIONED",
                "删除目标缺少 SVN 工作副本信息",
                None,
                true,
            )
        })?;
    let reported_root = required_delete_info_text(wc_info, "wcroot-abspath")?;
    let reported_root = fs::canonicalize(&reported_root).map_err(|error| {
        NovaError::command(
            "DELETE_TARGET_NOT_VERSIONED",
            "无法解析删除目标所属的 SVN 工作副本",
            Some(format!("路径：{reported_root}；错误：{error}")),
            true,
        )
    })?;
    if reported_root != working_copy_root {
        return Err(NovaError::command(
            "DELETE_TARGET_NOT_VERSIONED",
            "删除目标不属于当前 SVN 工作副本",
            Some(format!(
                "当前工作副本：{}；目标工作副本：{}",
                working_copy_root.display(),
                reported_root.display()
            )),
            true,
        ));
    }

    validate_delete_target_ancestors(working_copy_root, relative_path)?;

    let (filesystem_kind, final_node_is_symlink, final_node_is_reparse_point) =
        read_delete_target_filesystem_identity(&target)?;
    let filesystem_kind_matches_svn = matches!(
        (entry_kind.as_str(), &filesystem_kind),
        (
            "file",
            DeleteFilesystemNodeKind::File
                | DeleteFilesystemNodeKind::Symlink
                | DeleteFilesystemNodeKind::Missing
        ) | (
            "dir",
            DeleteFilesystemNodeKind::Directory | DeleteFilesystemNodeKind::Missing
        )
    );
    if !filesystem_kind_matches_svn {
        return Err(NovaError::command(
            "DELETE_TARGET_UNSAFE",
            "删除目标的文件系统类型与 SVN 节点类型不一致",
            Some(format!(
                "SVN 类型：{entry_kind}；文件系统类型：{filesystem_kind:?}"
            )),
            true,
        ));
    }

    Ok(DeleteTargetIdentity {
        entry_kind,
        entry_revision: entry.attribute("revision").map(ToString::to_string),
        url,
        relative_url,
        repository_uuid,
        schedule: required_delete_info_text(wc_info, "schedule")?,
        depth: text_child(wc_info, "depth"),
        copy_from_url: text_child(wc_info, "copy-from-url"),
        copy_from_revision: text_child(wc_info, "copy-from-rev"),
        filesystem_kind,
        final_node_is_symlink,
        final_node_is_reparse_point,
    })
}

fn validate_working_copy_destination(
    svn_executable: &str,
    working_copy_root: &Path,
    source_path: &str,
    source_identity: &DeleteTargetIdentity,
    target_path: &str,
    code_prefix: &str,
    label: &str,
) -> Result<WorkingCopyDestinationIdentity, NovaError> {
    if source_path == target_path {
        return Err(NovaError::command(
            format!("{code_prefix}_TARGET_SAME_AS_SOURCE"),
            format!("{label} 目标路径不能与源路径相同"),
            Some(format!("路径：{source_path}")),
            true,
        ));
    }
    if source_identity.entry_kind == "dir"
        && target_path
            .strip_prefix(source_path)
            .is_some_and(|suffix| suffix.starts_with('/'))
    {
        return Err(NovaError::command(
            format!("{code_prefix}_TARGET_INSIDE_SOURCE"),
            format!("目录不能 {label} 到自身内部"),
            Some(format!("源：{source_path}；目标：{target_path}")),
            true,
        ));
    }

    validate_delete_target_ancestors(working_copy_root, target_path).map_err(|error| {
        NovaError::command(
            format!("{code_prefix}_TARGET_UNSAFE"),
            format!("{label} 目标路径不安全"),
            Some(nova_error_text(&error)),
            true,
        )
    })?;
    let target = working_copy_root.join(target_path);
    match fs::symlink_metadata(&target) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Ok(_) => {
            return Err(NovaError::command(
                format!("{code_prefix}_TARGET_EXISTS"),
                format!("{label} 目标路径已存在"),
                Some(format!("路径：{}", target.display())),
                true,
            ));
        }
        Err(error) => {
            return Err(NovaError::command(
                format!("{code_prefix}_TARGET_UNSAFE"),
                format!("无法检查 {label} 目标路径"),
                Some(format!("路径：{}；错误：{error}", target.display())),
                true,
            ));
        }
    }

    let parent_path = target_path
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string());
    let parent_identity = if let Some(parent_path) = parent_path.as_deref() {
        let identity = validate_delete_target(svn_executable, working_copy_root, parent_path)
            .map_err(|error| {
                NovaError::command(
                    format!("{code_prefix}_TARGET_PARENT_INVALID"),
                    format!("{label} 目标父目录不是当前工作副本中的版本控制目录"),
                    Some(nova_error_text(&error)),
                    true,
                )
            })?;
        if identity.entry_kind != "dir" {
            return Err(NovaError::command(
                format!("{code_prefix}_TARGET_PARENT_INVALID"),
                format!("{label} 目标父路径不是版本控制目录"),
                Some(format!("父路径：{parent_path}")),
                true,
            ));
        }
        Some(identity)
    } else {
        None
    };

    Ok(WorkingCopyDestinationIdentity {
        parent_path,
        parent_identity,
    })
}

fn validate_working_copy_transfer_source(
    svn_executable: &str,
    working_copy_root: &Path,
    source_path: &str,
    code_prefix: &str,
    label: &str,
) -> Result<DeleteTargetIdentity, NovaError> {
    validate_delete_target(svn_executable, working_copy_root, source_path).map_err(|error| {
        NovaError::command(
            format!("{code_prefix}_SOURCE_INVALID"),
            format!("{label} 源路径不是当前工作副本中的安全版本控制项目"),
            Some(nova_error_text(&error)),
            true,
        )
    })
}

fn required_delete_info_attribute(
    node: roxmltree::Node<'_, '_>,
    attribute: &str,
) -> Result<String, NovaError> {
    node.attribute(attribute)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| {
            NovaError::command(
                "DELETE_TARGET_NOT_VERSIONED",
                "删除目标的 SVN 信息不完整",
                Some(format!("缺少属性：{attribute}")),
                true,
            )
        })
}

fn required_delete_info_text(
    node: roxmltree::Node<'_, '_>,
    tag_name: &str,
) -> Result<String, NovaError> {
    text_child(node, tag_name).ok_or_else(|| {
        NovaError::command(
            "DELETE_TARGET_NOT_VERSIONED",
            "删除目标的 SVN 信息不完整",
            Some(format!("缺少字段：{tag_name}")),
            true,
        )
    })
}

fn read_delete_target_filesystem_identity(
    target: &Path,
) -> Result<(DeleteFilesystemNodeKind, bool, bool), NovaError> {
    let metadata = match fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((DeleteFilesystemNodeKind::Missing, false, false));
        }
        Err(error) => {
            return Err(NovaError::command(
                "DELETE_TARGET_UNSAFE",
                "无法读取删除目标的文件系统身份",
                Some(format!("路径：{}；错误：{error}", target.display())),
                true,
            ));
        }
    };
    let is_symlink = metadata.file_type().is_symlink();
    let is_reparse_point = metadata_is_reparse_point(&metadata);
    let kind = if is_symlink {
        DeleteFilesystemNodeKind::Symlink
    } else if is_reparse_point {
        DeleteFilesystemNodeKind::ReparsePoint
    } else if metadata.is_file() {
        DeleteFilesystemNodeKind::File
    } else if metadata.is_dir() {
        DeleteFilesystemNodeKind::Directory
    } else {
        DeleteFilesystemNodeKind::Other
    };

    Ok((kind, is_symlink, is_reparse_point))
}

fn delete_target_changed_error(
    expected: &DeleteTargetIdentity,
    current: &DeleteTargetIdentity,
) -> NovaError {
    NovaError::command(
        "DELETE_TARGET_CHANGED",
        "删除目标在任务排队后发生变化",
        Some(format!(
            "排队时：SVN {} / {}，文件系统 {:?}；当前：SVN {} / {}，文件系统 {:?}",
            expected.entry_kind,
            expected.schedule,
            expected.filesystem_kind,
            current.entry_kind,
            current.schedule,
            current.filesystem_kind
        )),
        true,
    )
}

fn validate_delete_target_ancestors(
    working_copy_root: &Path,
    relative_path: &str,
) -> Result<(), NovaError> {
    let mut current = working_copy_root.to_path_buf();
    let mut segments = relative_path.split('/').peekable();
    while let Some(segment) = segments.next() {
        let is_target = segments.peek().is_none();
        current.push(segment);
        let metadata = match fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(NovaError::command(
                    "DELETE_TARGET_UNSAFE",
                    "无法检查删除目标路径",
                    Some(format!("路径：{}；错误：{error}", current.display())),
                    true,
                ));
            }
        };
        let is_symlink = metadata.file_type().is_symlink();
        if (!is_target && is_symlink)
            || (metadata_is_reparse_point(&metadata) && !(is_target && is_symlink))
        {
            return Err(NovaError::command(
                "DELETE_TARGET_UNSAFE",
                "删除目标的中间路径包含符号链接或重解析点",
                Some(format!("路径：{}", current.display())),
                true,
            ));
        }
        if is_target && is_symlink {
            continue;
        }

        let canonical_current = fs::canonicalize(&current).map_err(|error| {
            NovaError::command(
                "DELETE_TARGET_UNSAFE",
                "无法安全解析删除目标路径",
                Some(format!("路径：{}；错误：{error}", current.display())),
                true,
            )
        })?;
        if !canonical_current.starts_with(working_copy_root) {
            return Err(NovaError::command(
                "DELETE_TARGET_UNSAFE",
                "删除目标路径逃逸出当前工作副本",
                Some(format!("路径：{}", canonical_current.display())),
                true,
            ));
        }
    }

    Ok(())
}

#[cfg(windows)]
fn metadata_is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn operation_title(
    kind: &SvnOperationKind,
    file_path: Option<&str>,
    target_path: Option<&str>,
) -> String {
    match kind {
        SvnOperationKind::Update => "更新工作副本".to_string(),
        SvnOperationKind::UpdatePath => {
            format!("更新路径 {}", file_path.unwrap_or_default())
        }
        SvnOperationKind::Cleanup => "清理工作副本".to_string(),
        SvnOperationKind::AddFile => {
            format!("添加文件 {}", file_path.unwrap_or_default())
        }
        SvnOperationKind::DeletePath => {
            format!("删除 {}", file_path.unwrap_or_default())
        }
        SvnOperationKind::MovePath => format!(
            "移动 {} 到 {}",
            file_path.unwrap_or_default(),
            target_path.unwrap_or_default()
        ),
        SvnOperationKind::CopyPath => format!(
            "复制 {} 到 {}",
            file_path.unwrap_or_default(),
            target_path.unwrap_or_default()
        ),
        SvnOperationKind::RevertFile => {
            format!("撤销文件 {}", file_path.unwrap_or(""))
        }
        SvnOperationKind::LockFile => {
            format!("锁定文件 {}", file_path.unwrap_or(""))
        }
        SvnOperationKind::UnlockFile => {
            format!("解锁文件 {}", file_path.unwrap_or(""))
        }
        SvnOperationKind::ForceUnlockFile => {
            format!("强制解锁文件 {}", file_path.unwrap_or(""))
        }
        SvnOperationKind::ResolveWorking => {
            format!("标记已解决 {}", file_path.unwrap_or(""))
        }
        SvnOperationKind::ResolveMineFull => {
            format!("使用 mine 解决 {}", file_path.unwrap_or(""))
        }
        SvnOperationKind::ResolveTheirsFull => {
            format!("使用 theirs 解决 {}", file_path.unwrap_or(""))
        }
    }
}

fn batch_operation_title(
    kind: &SvnBatchOperationKind,
    path_count: usize,
    target_path: Option<&str>,
) -> String {
    match kind {
        SvnBatchOperationKind::Revert => format!("撤销 {path_count} 个路径"),
        SvnBatchOperationKind::Delete => format!("删除 {path_count} 个路径"),
        SvnBatchOperationKind::Move => format!(
            "移动 {path_count} 个路径到 {}",
            target_path
                .filter(|path| !path.is_empty())
                .unwrap_or("工作副本根目录")
        ),
    }
}

fn normalize_repository_url(url: &str) -> Result<String, NovaError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "REPOSITORY_URL_REQUIRED",
            "请输入仓库 URL",
            None,
            true,
        ));
    }

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "REPOSITORY_URL_INVALID",
            "仓库 URL 无效",
            Some("仓库 URL 不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(trimmed.trim_end_matches('/').to_string())
}

fn normalize_checkout_path(path: &str) -> Result<String, NovaError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "CHECKOUT_PATH_REQUIRED",
            "请输入本地工作副本路径",
            None,
            true,
        ));
    }

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "CHECKOUT_PATH_INVALID",
            "本地工作副本路径无效",
            Some("本地路径不能包含控制字符。".to_string()),
            true,
        ));
    }

    let path = Path::new(trimmed);
    if !path_utils::is_absolute_or_home_path(path, trimmed) {
        return Err(NovaError::command(
            "CHECKOUT_PATH_INVALID",
            "本地工作副本路径无效",
            Some("本地路径必须是绝对路径或 ~/ 开头路径。".to_string()),
            true,
        ));
    }

    Ok(trimmed.to_string())
}

fn normalize_revision_diff_payload(
    request: CreateRevisionDiffTaskRequest,
    svn_executable: String,
    patch_output_dir: PathBuf,
) -> Result<RevisionDiffTaskPayload, NovaError> {
    match request.mode {
        RevisionDiffMode::Revisions => {
            let working_copy_root = normalize_optional_workspace_root(
                request.working_copy_root.as_deref(),
                "REVISION_DIFF_WORKSPACE_REQUIRED",
                "比较 revision 需要先打开工作副本",
            )?;
            let left_revision = normalize_revision_value(
                request.left_revision.as_deref(),
                "REVISION_DIFF_LEFT_REQUIRED",
                "请输入左侧 revision",
            )?;
            let right_revision = normalize_revision_value(
                request.right_revision.as_deref(),
                "REVISION_DIFF_RIGHT_REQUIRED",
                "请输入右侧 revision",
            )?;
            if left_revision == right_revision {
                return Err(NovaError::command(
                    "REVISION_DIFF_REVISIONS_SAME",
                    "左右 revision 不能相同",
                    Some("比较两个 revision 时需要选择不同的版本号。".to_string()),
                    true,
                ));
            }
            let target_url = request
                .target_url
                .as_deref()
                .map(normalize_repository_url)
                .transpose()?;

            Ok(RevisionDiffTaskPayload {
                mode: RevisionDiffMode::Revisions,
                working_copy_root: Some(working_copy_root.display().to_string()),
                target_url,
                left_revision: Some(left_revision),
                right_revision: Some(right_revision),
                left_url: None,
                right_url: None,
                svn_executable,
                patch_output_dir,
            })
        }
        RevisionDiffMode::WorkingCopyToRevision => {
            let working_copy_root = normalize_optional_workspace_root(
                request.working_copy_root.as_deref(),
                "REVISION_DIFF_WORKSPACE_REQUIRED",
                "比较工作副本需要先打开工作副本",
            )?;
            let right_revision = normalize_revision_value(
                request.right_revision.as_deref(),
                "REVISION_DIFF_TARGET_REQUIRED",
                "请输入要比较的 revision",
            )?;

            Ok(RevisionDiffTaskPayload {
                mode: RevisionDiffMode::WorkingCopyToRevision,
                working_copy_root: Some(working_copy_root.display().to_string()),
                target_url: None,
                left_revision: None,
                right_revision: Some(right_revision),
                left_url: None,
                right_url: None,
                svn_executable,
                patch_output_dir,
            })
        }
        RevisionDiffMode::Urls => {
            let left_url = normalize_repository_url(request.left_url.as_deref().unwrap_or(""))?;
            let right_url = normalize_repository_url(request.right_url.as_deref().unwrap_or(""))?;
            if left_url == right_url {
                return Err(NovaError::command(
                    "REVISION_DIFF_URLS_SAME",
                    "左右 URL 不能相同",
                    Some("比较两个分支 URL 时需要选择不同的仓库地址。".to_string()),
                    true,
                ));
            }

            Ok(RevisionDiffTaskPayload {
                mode: RevisionDiffMode::Urls,
                working_copy_root: None,
                target_url: None,
                left_revision: None,
                right_revision: None,
                left_url: Some(left_url),
                right_url: Some(right_url),
                svn_executable,
                patch_output_dir,
            })
        }
    }
}

fn normalize_optional_workspace_root(
    path: Option<&str>,
    code: &'static str,
    message: &'static str,
) -> Result<PathBuf, NovaError> {
    let Some(path) = path else {
        return Err(NovaError::command(code, message, None, true));
    };

    normalize_workspace_root(path).map_err(|error| match error {
        NovaError::Command { detail, .. } => NovaError::command(code, message, detail, true),
    })
}

fn normalize_revision_value(
    revision: Option<&str>,
    code: &'static str,
    message: &'static str,
) -> Result<String, NovaError> {
    let value = revision.unwrap_or("").trim();
    if value.is_empty() {
        return Err(NovaError::command(code, message, None, true));
    }

    if value.chars().any(char::is_control) {
        return Err(NovaError::command(
            "REVISION_DIFF_REVISION_INVALID",
            "Revision 无效",
            Some("Revision 不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(value.to_string())
}

fn normalize_optional_revision_value(
    revision: Option<&str>,
    code: &'static str,
    message: &'static str,
) -> Result<Option<String>, NovaError> {
    let Some(value) = revision.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if value.chars().any(char::is_control) {
        return Err(NovaError::command(
            code,
            message,
            Some("Revision 不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(Some(value.to_string()))
}

fn normalize_merge_revision_range(
    start_revision: Option<String>,
    end_revision: Option<String>,
) -> Result<(Option<String>, Option<String>), NovaError> {
    let start_revision = start_revision
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let end_revision = end_revision
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if start_revision.is_some() ^ end_revision.is_some() {
        return Err(NovaError::command(
            "MERGE_REVISION_RANGE_INVALID",
            "Revision 范围需要同时填写起点和终点",
            None,
            true,
        ));
    }

    for value in start_revision.iter().chain(end_revision.iter()) {
        if value.chars().any(char::is_control) {
            return Err(NovaError::command(
                "MERGE_REVISION_INVALID",
                "Merge revision 无效",
                Some("Revision 不能包含控制字符。".to_string()),
                true,
            ));
        }
    }

    Ok((start_revision, end_revision))
}

fn merge_revision_arg(
    start_revision: &Option<String>,
    end_revision: &Option<String>,
) -> Option<String> {
    match (start_revision.as_deref(), end_revision.as_deref()) {
        (Some(start), Some(end)) => Some(format!("{start}:{end}")),
        _ => None,
    }
}

fn merge_revision_label(start_revision: &Option<String>, end_revision: &Option<String>) -> String {
    merge_revision_arg(start_revision, end_revision).unwrap_or_else(|| "默认".to_string())
}

fn merge_output_text(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    match (stdout.is_empty(), stderr.is_empty()) {
        (false, false) => format!("{stdout}\n{stderr}"),
        (false, true) => stdout,
        (true, false) => stderr,
        (true, true) => "svn merge 没有输出。".to_string(),
    }
}

fn count_merge_output_files(output: &str) -> usize {
    output
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            matches!(
                trimmed.chars().next(),
                Some('A' | 'D' | 'U' | 'C' | 'G' | 'M' | 'R' | 'E')
            ) && trimmed.chars().nth(1).is_some_and(char::is_whitespace)
        })
        .count()
}

struct ApplyPatchSnapshotFile {
    path: PathBuf,
}

impl ApplyPatchSnapshotFile {
    fn create(working_copy_root: &Path, task_id: &str, snapshot: &[u8]) -> Result<Self, NovaError> {
        let directory = apply_patch_snapshot_directory(working_copy_root)?;
        for _ in 0..128 {
            let nonce = APPLY_PATCH_SNAPSHOT_NONCE.fetch_add(1, Ordering::Relaxed);
            let name = format!(
                ".novasvn-apply-patch-{}-{}-{nonce}.patch",
                std::process::id(),
                sanitize_patch_file_part(task_id)
            );
            let path = directory.join(name);
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            let file = options.open(&path);
            let mut file = match file {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(NovaError::command(
                        "APPLY_PATCH_SNAPSHOT_CREATE_FAILED",
                        "无法创建 Patch 临时快照",
                        Some(format!("目录：{}；错误：{error}", directory.display())),
                        true,
                    ));
                }
            };
            if let Err(error) = file.write_all(snapshot) {
                drop(file);
                let _ = fs::remove_file(&path);
                return Err(NovaError::command(
                    "APPLY_PATCH_SNAPSHOT_WRITE_FAILED",
                    "无法写入 Patch 临时快照",
                    Some(format!("路径：{}；错误：{error}", path.display())),
                    true,
                ));
            }
            drop(file);
            return Ok(Self { path });
        }

        Err(NovaError::command(
            "APPLY_PATCH_SNAPSHOT_CREATE_FAILED",
            "无法创建唯一的 Patch 临时快照",
            Some(format!("目录：{}", directory.display())),
            true,
        ))
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ApplyPatchSnapshotFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn apply_patch_snapshot_directory(working_copy_root: &Path) -> Result<PathBuf, NovaError> {
    let temp_directory = fs::canonicalize(std::env::temp_dir()).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_TEMP_DIR_INVALID",
            "无法解析系统临时目录",
            Some(error.to_string()),
            true,
        )
    })?;
    if !temp_directory.starts_with(working_copy_root) {
        return Ok(temp_directory);
    }

    let parent = working_copy_root.parent().ok_or_else(|| {
        NovaError::command(
            "APPLY_PATCH_TEMP_DIR_INVALID",
            "无法在工作副本外创建 Patch 快照",
            Some("工作副本根目录不能覆盖整个文件系统。".to_string()),
            true,
        )
    })?;
    let parent = fs::canonicalize(parent).map_err(|error| {
        NovaError::command(
            "APPLY_PATCH_TEMP_DIR_INVALID",
            "无法解析工作副本父目录",
            Some(error.to_string()),
            true,
        )
    })?;
    if parent.starts_with(working_copy_root) {
        return Err(NovaError::command(
            "APPLY_PATCH_TEMP_DIR_INVALID",
            "无法在工作副本外创建 Patch 快照",
            None,
            true,
        ));
    }

    Ok(parent)
}

fn svn_patch_command(
    executable: &str,
    dry_run: bool,
    patch_file: &Path,
    working_copy_root: &Path,
) -> Command {
    let mut command = Command::new(executable);
    configure_svn_patch_command(&mut command, dry_run, patch_file, working_copy_root);
    command
}

fn configure_svn_patch_command(
    command: &mut Command,
    dry_run: bool,
    patch_file: &Path,
    working_copy_root: &Path,
) {
    command
        .env_remove("LC_ALL")
        .env("LC_MESSAGES", "C")
        .env("LANGUAGE", "C")
        .arg("patch");
    if dry_run {
        command.arg("--dry-run");
    }
    command
        .arg(patch_file)
        .arg(working_copy_root)
        .current_dir(working_copy_root);
}

fn apply_patch_output_text(stdout: &str, stderr: &str) -> String {
    let stdout = stdout.trim();
    let stderr = stderr.trim();
    match (stdout.is_empty(), stderr.is_empty()) {
        (false, false) => format!("{stdout}\n{stderr}"),
        (false, true) => stdout.to_string(),
        (true, false) => stderr.to_string(),
        (true, true) => "svn patch 没有输出。".to_string(),
    }
}

fn apply_patch_output_from_command(output: &std::process::Output) -> String {
    apply_patch_output_text(
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    )
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ApplyPatchStats {
    applied: usize,
    rejected: usize,
    skipped: usize,
    conflicted: usize,
}

impl ApplyPatchStats {
    fn allows_apply(&self) -> bool {
        self.applied > 0 && self.rejected == 0 && self.skipped == 0 && self.conflicted == 0
    }
}

fn parse_apply_patch_stats(output: &str) -> ApplyPatchStats {
    let mut stats = ApplyPatchStats::default();
    let mut applied_paths = HashSet::new();
    let mut conflicted_paths = HashSet::new();
    let mut conflict_summary = 0usize;
    let mut skipped_summary = 0usize;

    for line in output.lines() {
        let trimmed = line.trim_start();
        if let Some((actions, path)) = parse_apply_patch_action_line(trimmed) {
            if actions.contains('C') {
                conflicted_paths.insert(path.to_string());
            } else if actions
                .chars()
                .any(|action| matches!(action, 'A' | 'D' | 'U' | 'G'))
            {
                applied_paths.insert(path.to_string());
            }
        }

        let lowercase = trimmed.to_ascii_lowercase();
        if lowercase.contains("rejected hunk") {
            stats.rejected += 1;
        }
        if lowercase.starts_with("skipped ") && !lowercase.starts_with("skipped paths:") {
            stats.skipped += 1;
        }

        for prefix in ["text conflicts:", "property conflicts:", "tree conflicts:"] {
            if let Some(count) = parse_apply_patch_summary_count(&lowercase, prefix) {
                conflict_summary += count;
            }
        }
        if let Some(count) = parse_apply_patch_summary_count(&lowercase, "skipped paths:") {
            skipped_summary += count;
        }
    }

    stats.applied = applied_paths.difference(&conflicted_paths).count();
    stats.conflicted = conflicted_paths.len().max(conflict_summary);
    stats.skipped = stats.skipped.max(skipped_summary);
    stats
}

fn parse_apply_patch_action_line(line: &str) -> Option<(&str, &str)> {
    let bytes = line.as_bytes();
    let is_action = |byte: u8| matches!(byte, b'A' | b'D' | b'U' | b'C' | b'G');

    if bytes.len() >= 3
        && is_action(bytes[0])
        && is_action(bytes[1])
        && bytes[2].is_ascii_whitespace()
    {
        let path = line[2..].trim();
        return (!path.is_empty()).then_some((&line[..2], path));
    }
    if bytes.len() >= 2 && is_action(bytes[0]) && bytes[1].is_ascii_whitespace() {
        let path = line[1..].trim();
        return (!path.is_empty()).then_some((&line[..1], path));
    }

    None
}

fn parse_apply_patch_summary_count(line: &str, prefix: &str) -> Option<usize> {
    line.trim()
        .strip_prefix(prefix)?
        .trim()
        .parse::<usize>()
        .ok()
}

fn revision_diff_mode_label(mode: &RevisionDiffMode) -> &'static str {
    match mode {
        RevisionDiffMode::Revisions => "revisions",
        RevisionDiffMode::WorkingCopyToRevision => "working_copy_to_revision",
        RevisionDiffMode::Urls => "urls",
    }
}

#[derive(Debug)]
struct RevisionDiffPatchFile {
    path: PathBuf,
    dir: PathBuf,
    name: String,
}

fn write_revision_diff_patch(
    payload: &RevisionDiffTaskPayload,
    task_id: &str,
    target: &str,
    diff_text: &str,
) -> Result<Option<RevisionDiffPatchFile>, NovaError> {
    if diff_text.is_empty() {
        return Ok(None);
    }

    fs::create_dir_all(&payload.patch_output_dir).map_err(|error| {
        NovaError::command(
            "REVISION_DIFF_PATCH_DIR_FAILED",
            "创建 Revision Diff patch 目录失败",
            Some(format!(
                "路径：{}。错误：{error}",
                payload.patch_output_dir.display()
            )),
            true,
        )
    })?;

    let name =
        revision_diff_patch_file_name(revision_diff_mode_label(&payload.mode), target, task_id);
    let path = payload.patch_output_dir.join(&name);
    fs::write(&path, diff_text).map_err(|error| {
        NovaError::command(
            "REVISION_DIFF_PATCH_WRITE_FAILED",
            "写入 Revision Diff patch 失败",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    Ok(Some(RevisionDiffPatchFile {
        path,
        dir: payload.patch_output_dir.clone(),
        name,
    }))
}

fn revision_diff_patch_file_name(mode: &str, target: &str, task_id: &str) -> String {
    let mode = sanitize_patch_file_part(mode);
    let target = sanitize_patch_file_part(target);
    let task_id = sanitize_patch_file_part(task_id);
    format!("novasvn-{mode}-{target}-{task_id}.patch")
}

fn sanitize_patch_file_part(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut previous_dash = false;

    for character in value.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
            output.push(character);
            previous_dash = false;
        } else if !previous_dash {
            output.push('-');
            previous_dash = true;
        }

        if output.len() >= 80 {
            break;
        }
    }

    let trimmed = output.trim_matches('-');
    if trimmed.is_empty() {
        "diff".to_string()
    } else {
        trimmed.to_string()
    }
}

fn count_diff_files(diff_text: &str) -> usize {
    diff_text
        .lines()
        .filter(|line| line.starts_with("Index: ") || line.starts_with("diff --git "))
        .count()
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }

    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }

    value[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(not(windows))]
    use std::os::unix::fs::PermissionsExt;
    use std::{fs, io::Write};

    fn test_temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("novasvn-task-test-{name}-{}", timestamp_millis()));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    fn svn_tools_available() -> bool {
        Command::new("svn")
            .args(["--version", "--quiet"])
            .output()
            .is_ok_and(|output| output.status.success())
            && Command::new("svnadmin")
                .args(["--version", "--quiet"])
                .output()
                .is_ok_and(|output| output.status.success())
    }

    fn run_test_command(command: &mut Command) -> std::process::Output {
        let output = command.output().expect("测试命令应能启动");
        assert!(
            output.status.success(),
            "测试命令执行失败：{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }

    fn wait_for_test_task(queue: &TaskQueue, task_id: &str) -> Task {
        for _ in 0..100 {
            let task = queue.get_task(task_id).expect("task exists");
            if matches!(
                task.status,
                TaskStatus::Success | TaskStatus::Failed | TaskStatus::Cancelled
            ) {
                return task;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("任务未在测试超时前结束");
    }

    #[cfg(windows)]
    fn write_svn_status_stub(dir: &Path, status_xml: &str) -> PathBuf {
        let path = dir.join("svn-status-stub.cmd");
        let escaped_xml = status_xml
            .replace('^', "^^")
            .replace('&', "^&")
            .replace('<', "^<")
            .replace('>', "^>")
            .replace('|', "^|");
        let mut file = fs::File::create(&path).expect("create svn status stub");
        writeln!(file, "@echo off").expect("write stub");
        writeln!(file, "echo {escaped_xml}").expect("write stub");
        path
    }

    #[cfg(not(windows))]
    fn write_svn_status_stub(dir: &Path, status_xml: &str) -> PathBuf {
        let path = dir.join("svn-status-stub.sh");
        let mut file = fs::File::create(&path).expect("create svn status stub");
        writeln!(file, "#!/bin/sh").expect("write stub");
        writeln!(file, "printf '%s\\n' '{}'", status_xml).expect("write stub");
        drop(file);
        let mut permissions = fs::metadata(&path).expect("stub metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("make stub executable");
        path
    }

    #[test]
    fn normalizes_relative_commit_files() {
        let files = normalize_commit_files(&["src/main.rs".to_string()]).expect("valid path");

        assert_eq!(files, vec!["src/main.rs"]);
    }

    #[test]
    fn accepts_paths_that_look_like_status_names() {
        let files = normalize_commit_files(&[
            "missing".to_string(),
            "src/conflicted".to_string(),
            "assets/obstructed.txt".to_string(),
        ])
        .expect("status-like paths are valid paths");

        assert_eq!(
            files,
            vec!["missing", "src/conflicted", "assets/obstructed.txt"]
        );
    }

    #[test]
    fn validates_selected_patch_contains_commit_files() {
        let patch =
            "Index: src/main.rs\n--- src/main.rs\t(revision 1)\n+++ src/main.rs\t(working copy)\n";

        assert!(validate_selected_patch_files(patch, &["src/main.rs".to_string()]).is_ok());
        assert!(validate_selected_patch_files(patch, &["src/lib.rs".to_string()]).is_err());
    }

    #[test]
    fn rejects_absolute_or_parent_paths() {
        assert!(normalize_relative_file_path("../secret.txt", "INVALID", "invalid",).is_err());
        #[cfg(windows)]
        assert!(normalize_relative_file_path("C:\\secret.txt", "INVALID", "invalid",).is_err());
        #[cfg(not(windows))]
        assert_eq!(
            normalize_relative_file_path("C:\\secret.txt", "INVALID", "invalid")
                .expect("Unix Windows 风格文本是普通文件名"),
            "C:\\secret.txt"
        );
    }

    #[test]
    fn preserves_platform_specific_relative_file_paths() {
        assert_eq!(
            normalize_relative_file_path(" leading.txt", "INVALID", "invalid")
                .expect("文件路径前导空格应保持原样"),
            " leading.txt"
        );
        #[cfg(not(windows))]
        {
            assert_eq!(
                normalize_relative_file_path("trailing.txt ", "INVALID", "invalid")
                    .expect("Unix 文件路径末尾空格应保持原样"),
                "trailing.txt "
            );
            assert_eq!(
                normalize_relative_file_path("literal\\name.txt", "INVALID", "invalid")
                    .expect("Unix 反斜杠文件名应保持原样"),
                "literal\\name.txt"
            );
            assert_eq!(
                normalize_relative_file_path("literal\\..\\name.txt", "INVALID", "invalid")
                    .expect("Unix 反斜杠不是父级分隔符"),
                "literal\\..\\name.txt"
            );
        }
        #[cfg(windows)]
        {
            assert!(normalize_relative_file_path("trailing.txt ", "INVALID", "invalid").is_err());
            assert_eq!(
                normalize_relative_file_path("src\\main.rs", "INVALID", "invalid")
                    .expect("Windows 反斜杠应规范化"),
                "src/main.rs"
            );
            assert!(
                normalize_relative_file_path("src\\..\\secret.txt", "INVALID", "invalid").is_err()
            );
        }
    }

    #[test]
    fn rejects_control_characters_in_task_file_paths() {
        let error = normalize_relative_file_path("src/main.rs\nnext", "INVALID", "invalid")
            .expect_err("task file path with control characters must be rejected");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "INVALID");
            }
        }
    }

    #[test]
    fn validates_strict_delete_paths() {
        assert_eq!(
            normalize_delete_path(" src/nested/file.txt").expect("相对路径应通过校验"),
            " src/nested/file.txt"
        );
        #[cfg(not(windows))]
        assert_eq!(
            normalize_delete_path("leading.txt ").expect("末尾空格必须原样保留"),
            "leading.txt "
        );

        for invalid_path in [
            "",
            ".svn/wc.db",
            "src/.svn/entries",
            "../outside.txt",
            "src/../outside.txt",
            "src/./file.txt",
            "src//file.txt",
            "/tmp/outside.txt",
            "src/file.txt\nnext",
        ] {
            let error =
                normalize_delete_path(invalid_path).expect_err("不安全的删除路径必须被拒绝");
            assert!(matches!(
                error,
                NovaError::Command { ref code, .. } if code == "DELETE_PATH_INVALID"
            ));
        }

        #[cfg(not(windows))]
        for valid_path in [
            "src\\.SVN\\wc.db",
            "src\\nested\\file.txt",
            "\\tmp\\outside.txt",
            "C:\\outside.txt",
            "C:outside.txt",
        ] {
            assert_eq!(
                normalize_delete_path(valid_path).expect("Unix 反斜杠文件名应通过校验"),
                valid_path
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_delete_path_aliases() {
        for invalid_path in [
            "src\\nested\\file.txt",
            "\\tmp\\outside.txt",
            "C:\\outside.txt",
            "C:outside.txt",
            "file.txt ",
            "directory./file.txt",
            ".svn./wc.db",
            ".svn /wc.db",
            "file.txt:alternate-stream",
        ] {
            let error =
                normalize_delete_path(invalid_path).expect_err("Windows 路径别名必须被拒绝");
            assert!(matches!(
                error,
                NovaError::Command { ref code, .. } if code == "DELETE_PATH_INVALID"
            ));
        }
    }

    #[test]
    fn validates_checkout_paths() {
        assert!(normalize_checkout_path("C:\\wc\\feature").is_ok());
        assert!(normalize_checkout_path("~/NovaSVN/feature").is_ok());
        assert!(normalize_checkout_path("relative\\feature").is_err());
        assert!(normalize_checkout_path("C:\\wc\nfeature").is_err());
    }

    #[test]
    fn validates_optional_revision_values() {
        assert_eq!(
            normalize_optional_revision_value(Some(" 42 "), "INVALID", "invalid").unwrap(),
            Some("42".to_string())
        );
        assert_eq!(
            normalize_optional_revision_value(Some(" "), "INVALID", "invalid").unwrap(),
            None
        );
        assert!(normalize_optional_revision_value(Some("42\n43"), "INVALID", "invalid").is_err());
    }

    #[test]
    fn validates_svn_executable_values() {
        assert_eq!(normalize_svn_executable(None).unwrap(), "svn");
        assert_eq!(
            normalize_svn_executable(Some(" svn.exe ")).unwrap(),
            "svn.exe"
        );
        assert!(normalize_svn_executable(Some("C:\\Tools\\svn.exe")).is_ok());
        assert!(normalize_svn_executable(Some("tools\\svn.exe")).is_err());
        assert!(normalize_svn_executable(Some("svn\n")).is_err());
    }

    #[test]
    fn detects_status_xml_entries_for_switch_guard() {
        let changed = r#"<status><target path="C:\wc"><entry path="a.txt"><wc-status item="modified" /></entry></target></status>"#;
        let clean = r#"<status><target path="C:\wc"></target></status>"#;

        assert!(status_xml_has_entries(changed).unwrap());
        assert!(!status_xml_has_entries(clean).unwrap());
        assert!(status_xml_has_entries("<not xml").is_err());
    }

    #[test]
    fn creates_lock_and_resolve_operation_tasks_with_normalized_paths() {
        let queue = TaskQueue::new();
        let dir = test_temp_dir("svn-operation-paths");

        let update_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: dir.display().to_string(),
                kind: SvnOperationKind::UpdatePath,
                file_path: Some("src/main.rs".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("path update task should be created");
        assert_eq!(update_task.title, "更新路径 src/main.rs");
        match update_task.payload {
            TaskPayload::SvnOperation(payload) => {
                assert!(matches!(payload.kind, SvnOperationKind::UpdatePath));
                assert_eq!(payload.file_path.as_deref(), Some("src/main.rs"));
            }
            _ => panic!("expected svn operation payload"),
        }

        let lock_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: dir.display().to_string(),
                kind: SvnOperationKind::LockFile,
                file_path: Some("src/main.rs".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("lock task should be created");
        assert_eq!(lock_task.title, "锁定文件 src/main.rs");
        match lock_task.payload {
            TaskPayload::SvnOperation(payload) => {
                assert!(matches!(payload.kind, SvnOperationKind::LockFile));
                assert_eq!(payload.file_path.as_deref(), Some("src/main.rs"));
            }
            _ => panic!("expected svn operation payload"),
        }

        let resolve_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: dir.display().to_string(),
                kind: SvnOperationKind::ResolveTheirsFull,
                file_path: Some("src/conflict.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("resolve task should be created");
        assert_eq!(resolve_task.title, "使用 theirs 解决 src/conflict.txt");
        match resolve_task.payload {
            TaskPayload::SvnOperation(payload) => {
                assert!(matches!(payload.kind, SvnOperationKind::ResolveTheirsFull));
                assert_eq!(payload.file_path.as_deref(), Some("src/conflict.txt"));
            }
            _ => panic!("expected svn operation payload"),
        }

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn creates_batch_revert_tasks_with_deduplicated_safe_paths() {
        let queue = TaskQueue::new();
        let dir = test_temp_dir("svn-batch-operation-paths");
        let task = queue
            .create_svn_batch_operation_task(CreateSvnBatchOperationTaskRequest {
                working_copy_root: dir.display().to_string(),
                kind: SvnBatchOperationKind::Revert,
                file_paths: vec![
                    "src/main.rs".to_string(),
                    "src/main.rs".to_string(),
                    "src/lib.rs".to_string(),
                ],
                target_path: None,
                svn_executable: None,
            })
            .expect("batch revert task should be created");

        assert_eq!(task.title, "撤销 2 个路径");
        match task.payload {
            TaskPayload::SvnBatchOperation(payload) => {
                assert!(matches!(payload.kind, SvnBatchOperationKind::Revert));
                assert_eq!(payload.file_paths, vec!["src/main.rs", "src/lib.rs"]);
            }
            _ => panic!("expected batch svn operation payload"),
        }

        for paths in [vec![], vec!["../outside.txt".to_string()]] {
            assert!(queue
                .create_svn_batch_operation_task(CreateSvnBatchOperationTaskRequest {
                    working_copy_root: dir.display().to_string(),
                    kind: SvnBatchOperationKind::Revert,
                    file_paths: paths,
                    target_path: None,
                    svn_executable: None,
                })
                .is_err());
        }
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn collapses_descendants_for_destructive_batch_operations() {
        assert_eq!(
            collapse_descendant_paths(vec![
                "src/main.rs".to_string(),
                "src".to_string(),
                "tests/case.rs".to_string(),
            ]),
            vec!["src", "tests/case.rs"]
        );
        assert_eq!(
            batch_move_destination_path("archive", "src/main.rs"),
            "archive/main.rs"
        );
        assert_eq!(batch_move_destination_path("", "src/main.rs"), "main.rs");
        assert!(ensure_unique_batch_move_destinations(vec![
            "archive/main.rs".to_string(),
            "archive/main.rs".to_string(),
        ])
        .is_err());
    }

    #[test]
    fn rejects_lock_unlock_and_resolve_operations_without_file_paths() {
        let queue = TaskQueue::new();
        let dir = test_temp_dir("svn-operation-missing-path");

        for (kind, expected_code) in [
            (SvnOperationKind::UpdatePath, "UPDATE_PATH_INVALID"),
            (SvnOperationKind::AddFile, "ADD_FILE_PATH_INVALID"),
            (SvnOperationKind::DeletePath, "DELETE_PATH_INVALID"),
            (SvnOperationKind::MovePath, "MOVE_SOURCE_PATH_INVALID"),
            (SvnOperationKind::CopyPath, "COPY_SOURCE_PATH_INVALID"),
            (SvnOperationKind::LockFile, "LOCK_FILE_PATH_INVALID"),
            (SvnOperationKind::UnlockFile, "UNLOCK_FILE_PATH_INVALID"),
            (
                SvnOperationKind::ForceUnlockFile,
                "UNLOCK_FILE_PATH_INVALID",
            ),
            (
                SvnOperationKind::ResolveWorking,
                "RESOLVE_FILE_PATH_INVALID",
            ),
            (
                SvnOperationKind::ResolveMineFull,
                "RESOLVE_FILE_PATH_INVALID",
            ),
            (
                SvnOperationKind::ResolveTheirsFull,
                "RESOLVE_FILE_PATH_INVALID",
            ),
        ] {
            let error = queue
                .create_svn_operation_task(CreateSvnOperationTaskRequest {
                    working_copy_root: dir.display().to_string(),
                    kind,
                    file_path: None,
                    target_path: None,
                    svn_executable: None,
                })
                .expect_err("file operation without path must be rejected");

            match error {
                NovaError::Command { code, .. } => assert_eq!(code, expected_code),
            }
        }

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn adds_nested_unversioned_file_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-add-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::create_dir_all(working_copy.join("nested")).expect("create nested directory");
        fs::write(working_copy.join("nested/new.txt"), "new file\n").expect("write new file");

        let queue = TaskQueue::new();
        let task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::AddFile,
                file_path: Some("nested/new.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("add task should be created");
        let task = wait_for_test_task(&queue, &task.task_id);

        assert!(
            matches!(task.status, TaskStatus::Success),
            "Add 任务失败：{:?}",
            task.error
        );
        let output = run_test_command(
            Command::new("svn")
                .args(["status", "--xml"])
                .arg(&working_copy),
        );
        let xml = String::from_utf8_lossy(&output.stdout);
        let document = Document::parse(&xml).expect("status xml parses");
        let added_paths = document
            .descendants()
            .filter(|node| node.has_tag_name("entry"))
            .filter(|node| {
                node.children()
                    .find(|child| child.has_tag_name("wc-status"))
                    .and_then(|status| status.attribute("item"))
                    == Some("added")
            })
            .filter_map(|node| node.attribute("path"))
            .collect::<Vec<_>>();
        assert!(added_paths.iter().any(|path| path.ends_with("nested")));
        assert!(added_paths
            .iter()
            .any(|path| path.ends_with("nested/new.txt")));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn updates_only_requested_path_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-update-path-integration");
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let local_working_copy = root.join("local-working-copy");
        let remote_working_copy = root.join("remote-working-copy");
        fs::create_dir_all(&import_dir).expect("create update path import tree");
        fs::write(import_dir.join("target.txt"), "base").expect("write update target fixture");
        fs::write(import_dir.join("untouched.txt"), "base")
            .expect("write untouched update fixture");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&local_working_copy),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&remote_working_copy),
        );
        fs::write(remote_working_copy.join("target.txt"), "remote target")
            .expect("write remote update target");
        fs::write(
            remote_working_copy.join("untouched.txt"),
            "remote untouched",
        )
        .expect("write remote untouched target");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&remote_working_copy)
                .args(["-m", "remote changes"]),
        );

        let queue = TaskQueue::new();
        let task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: local_working_copy.display().to_string(),
                kind: SvnOperationKind::UpdatePath,
                file_path: Some("target.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("path update task should be created");
        let task = wait_for_test_task(&queue, &task.task_id);

        assert!(
            matches!(task.status, TaskStatus::Success),
            "Update 路径任务失败：{:?}",
            task.error
        );
        assert_eq!(
            fs::read_to_string(local_working_copy.join("target.txt")).unwrap(),
            "remote target"
        );
        assert_eq!(
            fs::read_to_string(local_working_copy.join("untouched.txt")).unwrap(),
            "base"
        );

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn runs_batch_revert_move_and_delete_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-batch-operations-integration");
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(import_dir.join("archive")).expect("create batch import tree");
        fs::write(import_dir.join("alpha.txt"), "alpha base").expect("write alpha fixture");
        fs::write(import_dir.join("beta.txt"), "beta base").expect("write beta fixture");
        fs::write(import_dir.join("archive/keep.txt"), "keep").expect("write archive fixture");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        fs::write(working_copy.join("alpha.txt"), "alpha local").expect("modify alpha fixture");
        fs::write(working_copy.join("beta.txt"), "beta local").expect("modify beta fixture");
        let queue = TaskQueue::new();
        let revert_task = queue
            .create_svn_batch_operation_task(CreateSvnBatchOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnBatchOperationKind::Revert,
                file_paths: vec!["alpha.txt".to_string(), "beta.txt".to_string()],
                target_path: None,
                svn_executable: None,
            })
            .expect("batch revert task should be created");
        let revert_task = wait_for_test_task(&queue, &revert_task.task_id);
        assert!(
            matches!(revert_task.status, TaskStatus::Success),
            "batch Revert task failed: {:?}",
            revert_task.error
        );
        assert_eq!(
            fs::read_to_string(working_copy.join("alpha.txt")).unwrap(),
            "alpha base"
        );
        assert_eq!(
            fs::read_to_string(working_copy.join("beta.txt")).unwrap(),
            "beta base"
        );

        let move_task = queue
            .create_svn_batch_operation_task(CreateSvnBatchOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnBatchOperationKind::Move,
                file_paths: vec!["alpha.txt".to_string(), "beta.txt".to_string()],
                target_path: Some("archive".to_string()),
                svn_executable: None,
            })
            .expect("batch move task should be created");
        let move_task = wait_for_test_task(&queue, &move_task.task_id);
        assert!(
            matches!(move_task.status, TaskStatus::Success),
            "batch Move task failed: {:?}",
            move_task.error
        );
        assert!(working_copy.join("archive/alpha.txt").is_file());
        assert!(working_copy.join("archive/beta.txt").is_file());
        assert!(!working_copy.join("alpha.txt").exists());
        assert!(!working_copy.join("beta.txt").exists());

        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "batch move"]),
        );
        let delete_task = queue
            .create_svn_batch_operation_task(CreateSvnBatchOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnBatchOperationKind::Delete,
                file_paths: vec![
                    "archive/alpha.txt".to_string(),
                    "archive/beta.txt".to_string(),
                ],
                target_path: None,
                svn_executable: None,
            })
            .expect("batch delete task should be created");
        let delete_task = wait_for_test_task(&queue, &delete_task.task_id);
        assert!(
            matches!(delete_task.status, TaskStatus::Success),
            "batch Delete task failed: {:?}",
            delete_task.error
        );
        assert!(!working_copy.join("archive/alpha.txt").exists());
        assert!(!working_copy.join("archive/beta.txt").exists());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn moves_versioned_file_and_directory_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-move-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("source.txt"), "source\n").expect("write source file");
        fs::create_dir_all(working_copy.join("source-dir/nested")).expect("create source dir");
        fs::write(working_copy.join("source-dir/nested/child.txt"), "child\n")
            .expect("write child file");
        fs::create_dir_all(working_copy.join("target-parent")).expect("create target parent");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg("--force")
                .arg(&working_copy),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "初始化 Move 测试"]),
        );

        let queue = TaskQueue::new();
        let file_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::MovePath,
                file_path: Some("source.txt".to_string()),
                target_path: Some("renamed.txt".to_string()),
                svn_executable: None,
            })
            .expect("file Move task should be created");
        assert_eq!(file_task.title, "移动 source.txt 到 renamed.txt");
        let file_task = wait_for_test_task(&queue, &file_task.task_id);
        assert!(
            matches!(file_task.status, TaskStatus::Success),
            "文件 Move 任务失败：{:?}",
            file_task.error
        );
        assert!(!working_copy.join("source.txt").exists());
        assert!(working_copy.join("renamed.txt").is_file());

        for (target_path, expected_code) in [
            ("source-dir", "MOVE_TARGET_SAME_AS_SOURCE"),
            ("source-dir/nested/moved", "MOVE_TARGET_INSIDE_SOURCE"),
            ("target-parent", "MOVE_TARGET_EXISTS"),
        ] {
            let error = queue
                .create_svn_operation_task(CreateSvnOperationTaskRequest {
                    working_copy_root: working_copy.display().to_string(),
                    kind: SvnOperationKind::MovePath,
                    file_path: Some("source-dir".to_string()),
                    target_path: Some(target_path.to_string()),
                    svn_executable: None,
                })
                .expect_err("unsafe Move target must be rejected");
            assert!(matches!(
                error,
                NovaError::Command { ref code, .. } if code == expected_code
            ));
        }

        let directory_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::MovePath,
                file_path: Some("source-dir".to_string()),
                target_path: Some("target-parent/moved-dir".to_string()),
                svn_executable: None,
            })
            .expect("directory Move task should be created");
        let directory_task = wait_for_test_task(&queue, &directory_task.task_id);
        assert!(
            matches!(directory_task.status, TaskStatus::Success),
            "目录 Move 任务失败：{:?}",
            directory_task.error
        );
        assert!(!working_copy.join("source-dir").exists());
        assert!(working_copy
            .join("target-parent/moved-dir/nested/child.txt")
            .is_file());

        let output = run_test_command(
            Command::new("svn")
                .args(["status", "--xml"])
                .arg(&working_copy),
        );
        let xml = String::from_utf8_lossy(&output.stdout);
        assert!(xml.contains("renamed.txt"));
        assert!(xml.contains("target-parent"));
        assert!(xml.contains("moved-dir"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn copies_versioned_file_and_directory_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-copy-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("source.txt"), "source\n").expect("write source file");
        fs::create_dir_all(working_copy.join("source-dir/nested")).expect("create source dir");
        fs::write(working_copy.join("source-dir/nested/child.txt"), "child\n")
            .expect("write child file");
        fs::create_dir_all(working_copy.join("target-parent")).expect("create target parent");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg("--force")
                .arg(&working_copy),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "初始化 Copy 测试"]),
        );

        let queue = TaskQueue::new();
        let file_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::CopyPath,
                file_path: Some("source.txt".to_string()),
                target_path: Some("copied.txt".to_string()),
                svn_executable: None,
            })
            .expect("file Copy task should be created");
        assert_eq!(file_task.title, "复制 source.txt 到 copied.txt");
        let file_task = wait_for_test_task(&queue, &file_task.task_id);
        assert!(
            matches!(file_task.status, TaskStatus::Success),
            "文件 Copy 任务失败：{:?}",
            file_task.error
        );
        assert!(working_copy.join("source.txt").is_file());
        assert!(working_copy.join("copied.txt").is_file());

        for (target_path, expected_code) in [
            ("source-dir", "COPY_TARGET_SAME_AS_SOURCE"),
            ("source-dir/nested/copied", "COPY_TARGET_INSIDE_SOURCE"),
            ("target-parent", "COPY_TARGET_EXISTS"),
        ] {
            let error = queue
                .create_svn_operation_task(CreateSvnOperationTaskRequest {
                    working_copy_root: working_copy.display().to_string(),
                    kind: SvnOperationKind::CopyPath,
                    file_path: Some("source-dir".to_string()),
                    target_path: Some(target_path.to_string()),
                    svn_executable: None,
                })
                .expect_err("unsafe Copy target must be rejected");
            assert!(matches!(
                error,
                NovaError::Command { ref code, .. } if code == expected_code
            ));
        }

        let directory_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::CopyPath,
                file_path: Some("source-dir".to_string()),
                target_path: Some("target-parent/copied-dir".to_string()),
                svn_executable: None,
            })
            .expect("directory Copy task should be created");
        let directory_task = wait_for_test_task(&queue, &directory_task.task_id);
        assert!(
            matches!(directory_task.status, TaskStatus::Success),
            "目录 Copy 任务失败：{:?}",
            directory_task.error
        );
        assert!(working_copy.join("source-dir/nested/child.txt").is_file());
        assert!(working_copy
            .join("target-parent/copied-dir/nested/child.txt")
            .is_file());

        let output = run_test_command(
            Command::new("svn")
                .args(["status", "--xml"])
                .arg(&working_copy),
        );
        let xml = String::from_utf8_lossy(&output.stdout);
        assert!(xml.contains("copied.txt"));
        assert!(xml.contains("copied-dir"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn deletes_versioned_file_and_directory_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-delete-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        fs::write(working_copy.join("tracked.txt"), "tracked file\n").expect("write tracked file");
        fs::write(working_copy.join(" tracked.txt"), "spaced tracked file\n")
            .expect("write spaced tracked file");
        fs::create_dir_all(working_copy.join("versioned-dir/nested"))
            .expect("create versioned directory");
        fs::write(
            working_copy.join("versioned-dir/nested/child.txt"),
            "versioned child\n",
        )
        .expect("write versioned child");
        #[cfg(unix)]
        {
            fs::write(
                working_copy.join("literal\\name.txt"),
                "literal backslash file\n",
            )
            .expect("write literal backslash file");
            fs::create_dir_all(working_copy.join("literal")).expect("create literal directory");
            fs::write(working_copy.join("literal/name.txt"), "nested slash file\n")
                .expect("write nested slash file");
        }
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("tracked.txt"))
                .arg(working_copy.join(" tracked.txt"))
                .arg(working_copy.join("versioned-dir")),
        );
        #[cfg(unix)]
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("literal\\name.txt"))
                .arg(working_copy.join("literal")),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "初始化删除测试"])
                .arg(&working_copy),
        );
        fs::write(working_copy.join("unversioned.txt"), "unversioned\n")
            .expect("write unversioned file");
        run_test_command(
            Command::new("svn")
                .args(["propset", "svn:ignore", "ignored.tmp"])
                .arg(&working_copy),
        );
        fs::write(working_copy.join("ignored.tmp"), "ignored\n").expect("write ignored file");

        let queue = TaskQueue::new();
        for target in ["unversioned.txt", "ignored.tmp"] {
            let error = queue
                .create_svn_operation_task(CreateSvnOperationTaskRequest {
                    working_copy_root: working_copy.display().to_string(),
                    kind: SvnOperationKind::DeletePath,
                    file_path: Some(target.to_string()),
                    target_path: None,
                    svn_executable: None,
                })
                .expect_err("未版本控制或忽略文件不得创建 Delete 任务");
            assert!(matches!(
                error,
                NovaError::Command { ref code, .. } if code == "DELETE_TARGET_NOT_VERSIONED"
            ));
            assert!(
                working_copy.join(target).is_file(),
                "被拒绝的 Delete 目标必须保持存在：{target}"
            );
        }

        #[cfg(unix)]
        {
            let literal_backslash_task = queue
                .create_svn_operation_task(CreateSvnOperationTaskRequest {
                    working_copy_root: working_copy.display().to_string(),
                    kind: SvnOperationKind::DeletePath,
                    file_path: Some("literal\\name.txt".to_string()),
                    target_path: None,
                    svn_executable: None,
                })
                .expect("Unix 反斜杠文件应允许创建 Delete 任务");
            let literal_backslash_task =
                wait_for_test_task(&queue, &literal_backslash_task.task_id);
            assert!(
                matches!(literal_backslash_task.status, TaskStatus::Success),
                "Unix 反斜杠文件删除任务失败：{:?}",
                literal_backslash_task.error
            );
            assert!(!working_copy.join("literal\\name.txt").exists());
            assert_eq!(
                fs::read_to_string(working_copy.join("literal/name.txt"))
                    .expect("nested slash target remains readable"),
                "nested slash file\n"
            );
        }

        let spaced_file_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some(" tracked.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("delete exact spaced file task should be created");
        let spaced_file_task = wait_for_test_task(&queue, &spaced_file_task.task_id);
        assert!(
            matches!(spaced_file_task.status, TaskStatus::Success),
            "带空格文件删除任务失败：{:?}",
            spaced_file_task.error
        );
        assert!(!working_copy.join(" tracked.txt").exists());
        assert!(
            working_copy.join("tracked.txt").exists(),
            "删除带空格目标不得误删近似文件"
        );

        let file_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("tracked.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("delete file task should be created");
        assert_eq!(file_task.title, "删除 tracked.txt");
        let file_task = wait_for_test_task(&queue, &file_task.task_id);
        assert!(
            matches!(file_task.status, TaskStatus::Success),
            "文件删除任务失败：{:?}",
            file_task.error
        );
        assert!(file_task
            .logs
            .iter()
            .any(|log| log.message == "执行 svn delete --force：tracked.txt"));

        let directory_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("versioned-dir".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("delete directory task should be created");
        let directory_task = wait_for_test_task(&queue, &directory_task.task_id);
        assert!(
            matches!(directory_task.status, TaskStatus::Success),
            "目录删除任务失败：{:?}",
            directory_task.error
        );

        assert!(!working_copy.join("tracked.txt").exists());
        assert!(!working_copy.join("versioned-dir").exists());

        let output = run_test_command(
            Command::new("svn")
                .args(["status", "--xml"])
                .arg(&working_copy),
        );
        let xml = String::from_utf8_lossy(&output.stdout);
        let document = Document::parse(&xml).expect("status xml parses");
        let deleted_paths = document
            .descendants()
            .filter(|node| node.has_tag_name("entry"))
            .filter(|node| {
                node.children()
                    .find(|child| child.has_tag_name("wc-status"))
                    .and_then(|status| status.attribute("item"))
                    == Some("deleted")
            })
            .filter_map(|node| node.attribute("path"))
            .collect::<Vec<_>>();
        assert!(deleted_paths
            .iter()
            .any(|path| path.ends_with("tracked.txt")));
        assert!(deleted_paths
            .iter()
            .any(|path| path.ends_with(" tracked.txt")));
        assert!(deleted_paths
            .iter()
            .any(|path| path.ends_with("versioned-dir")));

        for invalid_path in [
            ".svn/wc.db".to_string(),
            "versioned-dir/.svn/entries".to_string(),
            root.join("outside.txt").display().to_string(),
            "../outside.txt".to_string(),
        ] {
            let error = queue
                .create_svn_operation_task(CreateSvnOperationTaskRequest {
                    working_copy_root: working_copy.display().to_string(),
                    kind: SvnOperationKind::DeletePath,
                    file_path: Some(invalid_path),
                    target_path: None,
                    svn_executable: None,
                })
                .expect_err("不安全的 Delete 目标必须被拒绝");
            assert!(matches!(
                error,
                NovaError::Command { ref code, .. } if code == "DELETE_PATH_INVALID"
            ));
        }

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_queued_delete_after_target_identity_replacement() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-delete-identity-replacement");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("victim.txt"), "original victim\n")
            .expect("write copied replacement victim");
        fs::write(
            working_copy.join("obstructed.txt"),
            "original obstruction victim\n",
        )
        .expect("write obstruction victim");
        fs::write(
            working_copy.join("mutable.txt"),
            "original mutable content\n",
        )
        .expect("write mutable victim");
        fs::create_dir_all(working_copy.join("source-dir")).expect("create copy source");
        fs::write(
            working_copy.join("source-dir/tracked.txt"),
            "tracked copied child\n",
        )
        .expect("write tracked copied child");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("victim.txt"))
                .arg(working_copy.join("obstructed.txt"))
                .arg(working_copy.join("mutable.txt"))
                .arg(working_copy.join("source-dir")),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "初始化删除身份替换测试"])
                .arg(&working_copy),
        );

        let queue = TaskQueue::new();
        queue.create_mock_task(CreateMockTaskRequest {
            title: Some("阻塞 Delete 身份替换测试队列".to_string()),
            outcome: MockTaskOutcome::Success,
        });
        let copied_replacement_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("victim.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("初始文件 Delete 任务应创建成功");
        let obstructed_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("obstructed.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("初始 obstruction 文件 Delete 任务应创建成功");
        let mutable_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("mutable.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("初始可修改文件 Delete 任务应创建成功");

        run_test_command(
            Command::new("svn")
                .arg("delete")
                .arg("--force")
                .arg(working_copy.join("victim.txt")),
        );
        run_test_command(
            Command::new("svn")
                .arg("copy")
                .arg(working_copy.join("source-dir"))
                .arg(working_copy.join("victim.txt")),
        );
        fs::write(
            working_copy.join("victim.txt/unversioned.txt"),
            "unversioned copied child\n",
        )
        .expect("write unversioned copied child");

        fs::remove_file(working_copy.join("obstructed.txt"))
            .expect("remove original obstruction victim");
        fs::create_dir(working_copy.join("obstructed.txt"))
            .expect("replace file with obstructing directory");
        fs::write(
            working_copy.join("obstructed.txt/unversioned.txt"),
            "unversioned obstructing child\n",
        )
        .expect("write obstructing child");
        fs::write(working_copy.join("mutable.txt"), "modified after enqueue\n")
            .expect("modify file content after enqueue");

        let copied_replacement_task = wait_for_test_task(&queue, &copied_replacement_task.task_id);
        let obstructed_task = wait_for_test_task(&queue, &obstructed_task.task_id);
        let mutable_task = wait_for_test_task(&queue, &mutable_task.task_id);
        assert!(
            matches!(copied_replacement_task.status, TaskStatus::Failed),
            "文件替换为 copied directory 后 Delete 必须失败"
        );
        assert!(copied_replacement_task
            .error
            .as_deref()
            .is_some_and(|error| error.contains("排队后发生变化")));
        assert!(
            matches!(obstructed_task.status, TaskStatus::Failed),
            "文件替换为 obstructing directory 后 Delete 必须失败"
        );
        assert!(obstructed_task
            .error
            .as_deref()
            .is_some_and(|error| error.contains("文件系统类型与 SVN 节点类型不一致")));
        assert!(
            matches!(mutable_task.status, TaskStatus::Success),
            "仅修改普通文件内容不得改变 Delete 目标身份：{:?}",
            mutable_task.error
        );
        assert_eq!(
            fs::read_to_string(working_copy.join("victim.txt/tracked.txt"))
                .expect("tracked copied child remains"),
            "tracked copied child\n"
        );
        assert_eq!(
            fs::read_to_string(working_copy.join("victim.txt/unversioned.txt"))
                .expect("unversioned copied child remains"),
            "unversioned copied child\n"
        );
        assert_eq!(
            fs::read_to_string(working_copy.join("obstructed.txt/unversioned.txt"))
                .expect("obstructing child remains"),
            "unversioned obstructing child\n"
        );
        assert!(!working_copy.join("mutable.txt").exists());

        fs::remove_dir_all(root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn deletes_versioned_symlink_without_touching_external_target() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-delete-versioned-symlink");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        let external_target = root.join("external-target");
        fs::create_dir_all(&external_target).expect("create external target");
        fs::write(external_target.join("protected.txt"), "must remain\n")
            .expect("write external protected file");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        std::os::unix::fs::symlink(&external_target, working_copy.join("versioned-link"))
            .expect("create versioned symlink");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("versioned-link")),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "初始化版本控制符号链接测试"])
                .arg(&working_copy),
        );

        let queue = TaskQueue::new();
        let task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("versioned-link".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("已版本控制符号链接应允许创建 Delete 任务");
        let task = wait_for_test_task(&queue, &task.task_id);
        assert!(
            matches!(task.status, TaskStatus::Success),
            "符号链接删除任务失败：{:?}",
            task.error
        );
        assert!(fs::symlink_metadata(working_copy.join("versioned-link")).is_err());
        assert_eq!(
            fs::read_to_string(external_target.join("protected.txt"))
                .expect("external protected file remains readable"),
            "must remain\n"
        );

        let output = run_test_command(
            Command::new("svn")
                .args(["status", "--xml"])
                .arg(&working_copy),
        );
        let xml = String::from_utf8_lossy(&output.stdout);
        let document = Document::parse(&xml).expect("status xml parses");
        assert!(document
            .descendants()
            .filter(|node| node.has_tag_name("entry"))
            .any(|node| {
                node.attribute("path")
                    .is_some_and(|path| path.ends_with("versioned-link"))
                    && node
                        .children()
                        .find(|child| child.has_tag_name("wc-status"))
                        .and_then(|status| status.attribute("item"))
                        == Some("deleted")
            }));

        fs::remove_dir_all(root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_delete_through_symlink_to_another_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-delete-symlink");
        let repository = root.join("repository");
        let working_copy_a = root.join("working-copy-a");
        let working_copy_b = working_copy_a.join("nested-working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy_a),
        );
        fs::write(working_copy_a.join("protected.txt"), "must remain\n")
            .expect("write protected file");
        fs::create_dir_all(working_copy_a.join("replaceable"))
            .expect("create replaceable directory");
        fs::write(
            working_copy_a.join("replaceable/protected.txt"),
            "must remain in directory\n",
        )
        .expect("write protected directory file");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy_a.join("protected.txt"))
                .arg(working_copy_a.join("replaceable")),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "初始化符号链接删除测试"])
                .arg(&working_copy_a),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy_b),
        );

        let queue = TaskQueue::new();
        queue.create_mock_task(CreateMockTaskRequest {
            title: Some("阻塞 Delete 测试队列".to_string()),
            outcome: MockTaskOutcome::Success,
        });
        let queued_delete = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy_a.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("replaceable/protected.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("入队时安全的 Delete 任务应创建成功");
        fs::rename(
            working_copy_a.join("replaceable"),
            working_copy_a.join("replaceable-original"),
        )
        .expect("move original directory before queued delete runs");
        std::os::unix::fs::symlink(
            working_copy_b.join("replaceable"),
            working_copy_a.join("replaceable"),
        )
        .expect("replace queued delete ancestor with symlink");
        let queued_delete = wait_for_test_task(&queue, &queued_delete.task_id);
        assert!(
            matches!(queued_delete.status, TaskStatus::Failed),
            "执行前被替换为符号链接的 Delete 必须失败"
        );
        assert_eq!(
            fs::read_to_string(working_copy_b.join("replaceable/protected.txt"))
                .expect("protected nested file remains readable"),
            "must remain in directory\n"
        );
        fs::remove_file(working_copy_a.join("replaceable")).expect("remove replacement symlink");
        fs::rename(
            working_copy_a.join("replaceable-original"),
            working_copy_a.join("replaceable"),
        )
        .expect("restore original directory");

        let error = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy_a.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("nested-working-copy/protected.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect_err("属于嵌套工作副本的 Delete 目标必须被拒绝");
        assert!(matches!(
            error,
            NovaError::Command { ref code, .. } if code == "DELETE_TARGET_NOT_VERSIONED"
        ));

        std::os::unix::fs::symlink(&working_copy_b, working_copy_a.join("linked-working-copy"))
            .expect("create working copy symlink");

        let error = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy_a.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("linked-working-copy".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect_err("指向另一工作副本的未版本控制符号链接必须被拒绝");
        assert!(matches!(
            error,
            NovaError::Command { ref code, .. } if code == "DELETE_TARGET_NOT_VERSIONED"
        ));

        let error = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy_a.display().to_string(),
                kind: SvnOperationKind::DeletePath,
                file_path: Some("linked-working-copy/protected.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect_err("穿过符号链接的 Delete 必须在入队前被拒绝");
        assert!(matches!(
            error,
            NovaError::Command { ref code, .. } if code == "DELETE_TARGET_UNSAFE"
        ));
        assert_eq!(
            fs::read_to_string(working_copy_b.join("protected.txt"))
                .expect("protected file remains readable"),
            "must remain\n"
        );
        let output = run_test_command(
            Command::new("svn")
                .args(["status", "--xml"])
                .arg(&working_copy_b),
        );
        assert!(
            !status_xml_has_entries(&String::from_utf8_lossy(&output.stdout))
                .expect("status xml parses"),
            "第二个工作副本不得出现删除状态"
        );

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn validates_apply_patch_file_paths_and_extension() {
        let root = test_temp_dir("apply-patch-paths");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(&working_copy).expect("create working copy directory");

        let external_patch = root.join("change.PATCH");
        fs::write(
            &external_patch,
            "Index: file.txt\n--- file.txt\n+++ file.txt\n",
        )
        .expect("write external patch");
        let (_, normalized_patch) = normalize_apply_patch_paths(
            &working_copy.display().to_string(),
            &external_patch.display().to_string(),
        )
        .expect("external patch path should be valid");
        assert_eq!(normalized_patch, fs::canonicalize(&external_patch).unwrap());

        let invalid_extension = root.join("change.txt");
        fs::write(&invalid_extension, "not a patch\n").expect("write invalid extension file");
        let error = normalize_apply_patch_paths(
            &working_copy.display().to_string(),
            &invalid_extension.display().to_string(),
        )
        .expect_err("invalid extension must be rejected");
        assert!(matches!(
            error,
            NovaError::Command { ref code, .. }
                if code == "APPLY_PATCH_FILE_EXTENSION_INVALID"
        ));

        let directory_patch = root.join("directory.patch");
        fs::create_dir(&directory_patch).expect("create patch directory");
        let error = normalize_apply_patch_paths(
            &working_copy.display().to_string(),
            &directory_patch.display().to_string(),
        )
        .expect_err("directory must not be accepted as a patch file");
        assert!(matches!(
            error,
            NovaError::Command { ref code, .. } if code == "APPLY_PATCH_FILE_TYPE_INVALID"
        ));

        let internal_patch = working_copy.join("self.patch");
        fs::write(&internal_patch, "Index: self.patch\n").expect("write internal patch");
        let error = normalize_apply_patch_paths(
            &working_copy.display().to_string(),
            &internal_patch.display().to_string(),
        )
        .expect_err("patch inside working copy must be rejected");
        assert!(matches!(
            error,
            NovaError::Command { ref code, .. }
                if code == "APPLY_PATCH_FILE_INSIDE_WORKSPACE"
        ));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn validates_apply_patch_sha256_confirmation() {
        let digest = apply_patch_digest(b"abc");
        assert_eq!(
            digest,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(validate_expected_patch_digest(true, None, &digest).is_ok());
        assert!(validate_expected_patch_digest(true, Some(&digest), &digest).is_err());
        assert!(validate_expected_patch_digest(false, None, &digest).is_err());
        assert!(
            validate_expected_patch_digest(false, Some(&digest.to_ascii_uppercase()), &digest)
                .is_ok()
        );
        assert!(validate_expected_patch_digest(false, Some(&"0".repeat(64)), &digest).is_err());
    }

    #[test]
    fn forces_parseable_locale_for_svn_patch_commands() {
        let root = test_temp_dir("apply-patch-locale");
        let patch = root.join("change.patch");
        let mut command = Command::new("svn");
        command
            .env("LC_ALL", "zh_CN.UTF-8")
            .env("LANG", "fr_FR.UTF-8")
            .env("LC_MESSAGES", "fr_FR.UTF-8")
            .env("LANGUAGE", "de_DE");
        configure_svn_patch_command(&mut command, true, &patch, &root);

        for name in ["LC_MESSAGES", "LANGUAGE"] {
            let value = command
                .get_envs()
                .find(|(key, _)| key.to_string_lossy() == name)
                .and_then(|(_, value)| value)
                .map(|value| value.to_string_lossy().into_owned());
            assert_eq!(value.as_deref(), Some("C"));
        }
        let lang = command
            .get_envs()
            .find(|(key, _)| key.to_string_lossy() == "LANG")
            .and_then(|(_, value)| value)
            .map(|value| value.to_string_lossy().into_owned());
        assert_eq!(lang.as_deref(), Some("fr_FR.UTF-8"));
        let lc_all = command
            .get_envs()
            .find(|(key, _)| key.to_string_lossy() == "LC_ALL")
            .map(|(_, value)| value);
        assert_eq!(lc_all, Some(None));

        fs::remove_dir_all(root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn creates_private_and_self_cleaning_apply_patch_snapshot() {
        let root = test_temp_dir("apply-patch-snapshot");
        let working_copy = root.join("working-copy");
        fs::create_dir(&working_copy).expect("create working copy directory");
        let snapshot = ApplyPatchSnapshotFile::create(&working_copy, "task-42", b"patch\n")
            .expect("create snapshot");
        let path = snapshot.path().to_path_buf();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert!(!path.starts_with(fs::canonicalize(&working_copy).unwrap()));
        drop(snapshot);
        assert!(!path.exists());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_oversized_apply_patch_file() {
        let root = test_temp_dir("apply-patch-size");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(&working_copy).expect("create working copy directory");
        let patch = root.join("large.diff");
        let file = fs::File::create(&patch).expect("create sparse patch");
        file.set_len(APPLY_PATCH_MAX_BYTES + 1)
            .expect("resize sparse patch");

        let error = normalize_apply_patch_paths(
            &working_copy.display().to_string(),
            &patch.display().to_string(),
        )
        .expect_err("oversized patch must be rejected");
        assert!(matches!(
            error,
            NovaError::Command { ref code, .. } if code == "APPLY_PATCH_FILE_TOO_LARGE"
        ));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_unsafe_apply_patch_targets() {
        let root = test_temp_dir("apply-patch-targets");
        let working_copy = root.join("working-copy");
        fs::create_dir(&working_copy).expect("create working copy directory");
        let safe_patch = root.join("safe.patch");
        fs::write(
            &safe_patch,
            "Index: src/main.rs\n--- src/main.rs\t(revision 1)\n+++ src/main.rs\t(working copy)\n",
        )
        .expect("write safe patch");
        validate_apply_patch_targets(&working_copy, &fs::read(&safe_patch).unwrap())
            .expect("safe targets should pass");

        let mut non_utf8_hunk =
            b"Index: src/main.rs\n--- src/main.rs\n+++ src/main.rs\n@@ -1 +1 @@\n-old\n+".to_vec();
        non_utf8_hunk.push(0xff);
        non_utf8_hunk.push(b'\n');
        validate_apply_patch_targets(&working_copy, &non_utf8_hunk)
            .expect("non-UTF-8 hunk content should not affect ASCII target validation");

        let drive_relative_patch = b"Index: C:outside.txt\n--- C:outside.txt\n+++ C:outside.txt\n";
        assert!(validate_apply_patch_targets(&working_copy, drive_relative_patch).is_err());

        let traversal_patch = root.join("traversal.patch");
        fs::write(
            &traversal_patch,
            "Index: ../outside.txt\n--- ../outside.txt\n+++ ../outside.txt\n",
        )
        .expect("write traversal patch");
        let error =
            validate_apply_patch_targets(&working_copy, &fs::read(&traversal_patch).unwrap())
                .expect_err("parent path target must be rejected");
        assert!(matches!(
            error,
            NovaError::Command { ref code, .. } if code == "APPLY_PATCH_TARGET_INVALID"
        ));

        let metadata_patch = root.join("metadata.patch");
        fs::write(
            &metadata_patch,
            "Index: src/.SVN/entries\n--- src/.SVN/entries\n+++ src/.SVN/entries\n",
        )
        .expect("write metadata target patch");
        assert!(
            validate_apply_patch_targets(&working_copy, &fs::read(&metadata_patch).unwrap())
                .is_err()
        );

        let absolute_patch = root.join("absolute.diff");
        fs::write(
            &absolute_patch,
            "--- /tmp/outside.txt\n+++ /tmp/outside.txt\n@@ -1 +1 @@\n-old\n+new\n",
        )
        .expect("write absolute target patch");
        assert!(
            validate_apply_patch_targets(&working_copy, &fs::read(&absolute_patch).unwrap())
                .is_err()
        );

        #[cfg(not(windows))]
        {
            let outside = root.join("outside");
            fs::create_dir(&outside).expect("create outside directory");
            std::os::unix::fs::symlink(&outside, working_copy.join("link"))
                .expect("create target symlink");
            let symlink_patch = root.join("symlink.diff");
            fs::write(
                &symlink_patch,
                "Index: link/outside.txt\n--- link/outside.txt\n+++ link/outside.txt\n",
            )
            .expect("write symlink target patch");
            assert!(validate_apply_patch_targets(
                &working_copy,
                &fs::read(&symlink_patch).unwrap()
            )
            .is_err());

            let git_patch = b"diff --git a/link/outside.txt b/link/outside.txt\n--- a/link/outside.txt\n+++ b/link/outside.txt\n";
            assert!(validate_apply_patch_targets(&working_copy, git_patch).is_err());
        }

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn parses_apply_patch_output_statistics() {
        let output = "UU        /tmp/wc/applied.txt\n U        /tmp/wc/applied.txt\nC         /tmp/wc/conflict.txt\nCC        /tmp/wc/conflict.txt\n>         rejected hunk @@ -1,1 +1,1 @@\nSkipped missing target: '/tmp/wc/missing.txt'\nSummary of conflicts:\n  Text conflicts: 1\n  Skipped paths: 1\n";

        let stats = parse_apply_patch_stats(output);
        assert_eq!(
            stats,
            ApplyPatchStats {
                applied: 1,
                rejected: 1,
                skipped: 1,
                conflicted: 1,
            }
        );
        assert!(!stats.allows_apply());
    }

    #[test]
    fn dry_runs_and_applies_patch_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("apply-patch-integration");
        let repository = root.join("repository");
        let import_source = root.join("import-source");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(&import_source).expect("create import source");
        fs::write(import_source.join("中文.txt"), "before\n").expect("write initial file");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_source)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        let patch_file = root.join("change.patch");
        fs::write(
            &patch_file,
            "Index: 中文.txt\n===================================================================\n--- 中文.txt\t(revision 1)\n+++ 中文.txt\t(working copy)\n@@ -1 +1 @@\n-before\n+after\n",
        )
        .expect("write patch");
        let queue = TaskQueue::new();
        let dry_run = queue
            .create_apply_patch_task(CreateApplyPatchTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                patch_file_path: patch_file.display().to_string(),
                dry_run: true,
                expected_patch_digest: None,
                svn_executable: None,
            })
            .expect("create dry-run task");
        let dry_run = wait_for_test_task(&queue, &dry_run.task_id);
        assert!(
            matches!(dry_run.status, TaskStatus::Success),
            "Patch dry-run 失败：{:?}",
            dry_run.error
        );
        assert_eq!(
            fs::read_to_string(working_copy.join("中文.txt")).unwrap(),
            "before\n"
        );
        let dry_run_result = dry_run
            .result
            .and_then(|result| result.apply_patch_result)
            .expect("dry-run result exists");
        assert!(dry_run_result.dry_run);
        assert_eq!(dry_run_result.applied, 1);
        assert_eq!(dry_run_result.rejected, 0);
        assert_eq!(dry_run_result.conflicted, 0);

        let rejected_patch_file = root.join("rejected.patch");
        fs::write(
            &rejected_patch_file,
            "Index: 中文.txt\n===================================================================\n--- 中文.txt\t(revision 1)\n+++ 中文.txt\t(working copy)\n@@ -1 +1 @@\n-not-present\n+after\n",
        )
        .expect("write rejected patch");
        let rejected_dry_run = queue
            .create_apply_patch_task(CreateApplyPatchTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                patch_file_path: rejected_patch_file.display().to_string(),
                dry_run: true,
                expected_patch_digest: None,
                svn_executable: None,
            })
            .expect("create rejected dry-run task");
        let rejected_dry_run = wait_for_test_task(&queue, &rejected_dry_run.task_id);
        assert!(
            matches!(rejected_dry_run.status, TaskStatus::Success),
            "Rejected Patch dry-run 应保持成功退出：{:?}",
            rejected_dry_run.error
        );
        let rejected_result = rejected_dry_run
            .result
            .and_then(|result| result.apply_patch_result)
            .expect("rejected dry-run result exists");
        assert!(rejected_result.rejected > 0);
        assert!(rejected_result.conflicted > 0);
        assert_eq!(
            fs::read_to_string(working_copy.join("中文.txt")).unwrap(),
            "before\n"
        );
        assert!(!working_copy.join("中文.txt.svnpatch.rej").exists());

        let rejected_apply = queue
            .create_apply_patch_task(CreateApplyPatchTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                patch_file_path: rejected_patch_file.display().to_string(),
                dry_run: false,
                expected_patch_digest: Some(rejected_result.patch_digest.clone()),
                svn_executable: None,
            })
            .expect("create rejected apply task");
        let rejected_apply = wait_for_test_task(&queue, &rejected_apply.task_id);
        assert!(matches!(rejected_apply.status, TaskStatus::Failed));
        let rejected_apply_result = rejected_apply
            .result
            .and_then(|result| result.apply_patch_result)
            .expect("rejected apply preflight result exists");
        assert!(rejected_apply_result.dry_run);
        assert!(rejected_apply_result.rejected > 0);
        assert!(rejected_apply_result.conflicted > 0);
        assert_eq!(
            fs::read_to_string(working_copy.join("中文.txt")).unwrap(),
            "before\n"
        );
        assert!(!working_copy.join("中文.txt.svnpatch.rej").exists());

        queue.create_mock_task(CreateMockTaskRequest {
            title: Some("阻塞 Apply Patch 测试队列".to_string()),
            outcome: MockTaskOutcome::Success,
        });
        let apply = queue
            .create_apply_patch_task(CreateApplyPatchTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                patch_file_path: patch_file.display().to_string(),
                dry_run: false,
                expected_patch_digest: Some(dry_run_result.patch_digest.clone()),
                svn_executable: None,
            })
            .expect("create apply task");
        fs::write(
            &patch_file,
            "Index: 中文.txt\n--- 中文.txt\n+++ 中文.txt\n@@ -1 +1 @@\n-before\n+changed-after-enqueue\n",
        )
        .expect("replace original patch after enqueue");
        let apply = wait_for_test_task(&queue, &apply.task_id);
        assert!(
            matches!(apply.status, TaskStatus::Success),
            "Patch 应用失败：{:?}",
            apply.error
        );
        assert_eq!(
            fs::read_to_string(working_copy.join("中文.txt")).unwrap(),
            "after\n"
        );
        assert!(matches!(
            &apply.payload,
            TaskPayload::ApplyPatch(payload) if payload.patch_snapshot.is_empty()
        ));
        let apply_result = apply
            .result
            .and_then(|result| result.apply_patch_result)
            .expect("apply result exists");
        assert!(!apply_result.dry_run);
        assert_eq!(apply_result.applied, 1);
        assert_eq!(apply_result.rejected, 0);
        assert_eq!(apply_result.skipped, 0);
        assert_eq!(apply_result.conflicted, 0);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_repository_copy_to_same_url() {
        let queue = TaskQueue::new();
        let error = queue
            .create_repository_copy_task(CreateRepositoryCopyTaskRequest {
                kind: RepositoryCopyKind::Branch,
                source_url: "https://example.com/svn/trunk/".to_string(),
                target_url: " https://example.com/svn/trunk ".to_string(),
                revision: None,
                message: "create branch".to_string(),
                svn_executable: None,
            })
            .expect_err("same source and target must be rejected");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "REPOSITORY_COPY_TARGET_SAME_AS_SOURCE");
            }
        }
    }

    #[test]
    fn rejects_revision_diff_with_same_urls() {
        let error = normalize_revision_diff_payload(
            CreateRevisionDiffTaskRequest {
                mode: RevisionDiffMode::Urls,
                working_copy_root: None,
                target_url: None,
                left_revision: None,
                right_revision: None,
                left_url: Some("https://example.com/svn/branches/feature/".to_string()),
                right_url: Some(" https://example.com/svn/branches/feature ".to_string()),
                svn_executable: None,
            },
            "svn".to_string(),
            test_temp_dir("revision-diff-url-output"),
        )
        .expect_err("same revision diff URLs must be rejected");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "REVISION_DIFF_URLS_SAME");
            }
        }
    }

    #[test]
    fn rejects_revision_diff_with_same_revisions() {
        let dir = test_temp_dir("revision-diff-same-revision");
        let error = normalize_revision_diff_payload(
            CreateRevisionDiffTaskRequest {
                mode: RevisionDiffMode::Revisions,
                working_copy_root: Some(dir.display().to_string()),
                target_url: None,
                left_revision: Some(" 42 ".to_string()),
                right_revision: Some("42".to_string()),
                left_url: None,
                right_url: None,
                svn_executable: None,
            },
            "svn".to_string(),
            test_temp_dir("revision-diff-revision-output"),
        )
        .expect_err("same revisions must be rejected");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "REVISION_DIFF_REVISIONS_SAME");
            }
        }

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn accepts_repository_url_target_for_revision_diff() {
        let dir = test_temp_dir("revision-diff-url-target");
        let payload = normalize_revision_diff_payload(
            CreateRevisionDiffTaskRequest {
                mode: RevisionDiffMode::Revisions,
                working_copy_root: Some(dir.display().to_string()),
                target_url: Some(" https://example.com/svn/trunk/src/main.ts/ ".to_string()),
                left_revision: Some("41".to_string()),
                right_revision: Some("42".to_string()),
                left_url: None,
                right_url: None,
                svn_executable: None,
            },
            "svn".to_string(),
            test_temp_dir("revision-diff-url-target-output"),
        )
        .expect("repository URL target should be accepted");

        assert_eq!(
            payload.target_url.as_deref(),
            Some("https://example.com/svn/trunk/src/main.ts")
        );
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn builds_safe_revision_diff_patch_file_names() {
        let name = revision_diff_patch_file_name(
            "urls",
            "https://example.com/svn/branches/feature?bad:name",
            "task-42",
        );

        assert!(name.starts_with("novasvn-urls-"));
        assert!(name.ends_with("-task-42.patch"));
        assert!(!name.contains(['\\', '/', ':', '?', '"', '<', '>', '|']));
    }

    #[test]
    fn validates_merge_revision_range() {
        let range = normalize_merge_revision_range(Some("10".to_string()), Some("12".to_string()))
            .expect("range valid");

        assert_eq!(range, (Some("10".to_string()), Some("12".to_string())));
        assert!(normalize_merge_revision_range(Some("10".to_string()), None).is_err());
    }

    #[test]
    fn counts_merge_output_file_lines() {
        let output = "U    src/a.txt\nA    src/b.txt\n--- Merging r1 through r2 into '.':\n";

        assert_eq!(count_merge_output_files(output), 2);
    }

    #[test]
    fn blocks_non_dry_run_merge_when_workspace_has_changes() {
        let queue = TaskQueue::new();
        let dir = test_temp_dir("merge-guard");
        let svn = write_svn_status_stub(
            &dir,
            r#"<status><target path="wc"><entry path="a.txt"><wc-status item="modified" /></entry></target></status>"#,
        );

        let error = queue
            .create_merge_task(CreateMergeTaskRequest {
                working_copy_root: dir.display().to_string(),
                source_url: "https://example.com/svn/branches/feature".to_string(),
                start_revision: Some("10".to_string()),
                end_revision: Some("12".to_string()),
                dry_run: false,
                svn_executable: Some(svn.display().to_string()),
            })
            .expect_err("non dry-run merge must be blocked for dirty workspace");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "SVN_MERGE_LOCAL_CHANGES");
            }
        }

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn allows_dry_run_merge_when_workspace_has_changes() {
        let queue = TaskQueue::new();
        let dir = test_temp_dir("merge-dry-run");
        let svn = write_svn_status_stub(
            &dir,
            r#"<status><target path="wc"><entry path="a.txt"><wc-status item="modified" /></entry></target></status>"#,
        );

        let task = queue
            .create_merge_task(CreateMergeTaskRequest {
                working_copy_root: dir.display().to_string(),
                source_url: "https://example.com/svn/branches/feature".to_string(),
                start_revision: Some("10".to_string()),
                end_revision: Some("12".to_string()),
                dry_run: true,
                svn_executable: Some(svn.display().to_string()),
            })
            .expect("dry-run merge should not require a clean workspace");

        assert!(matches!(task.payload, TaskPayload::Merge(payload) if payload.dry_run));

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn counts_svn_diff_files() {
        let diff = "Index: a.txt\n--- a.txt\n+++ a.txt\ndiff --git b/c b/c\n";

        assert_eq!(count_diff_files(diff), 2);
    }

    #[test]
    fn truncates_revision_diff_preview_on_utf8_boundary() {
        let text = "abc中文def";
        let truncated = truncate_utf8(text, 5);

        assert_eq!(truncated, "abc");
        assert!(truncated.is_char_boundary(truncated.len()));
    }

    #[test]
    fn parses_repository_list_xml_with_directory_first_sort() {
        let xml = r#"
<lists>
  <list path="https://example.com/svn">
    <entry kind="file">
      <name>zeta.txt</name>
      <commit revision="8"><author>zoe</author><date>2026-01-02T00:00:00Z</date></commit>
    </entry>
    <entry kind="dir">
      <name>branches</name>
      <commit revision="7"><author>dev</author><date>2026-01-01T00:00:00Z</date></commit>
    </entry>
    <entry kind="dir">
      <name>trunk</name>
      <commit revision="9"><author>dev</author><date>2026-01-03T00:00:00Z</date></commit>
    </entry>
  </list>
</lists>
"#;

        let result =
            parse_repository_list_xml(xml, "https://example.com/svn").expect("list parses");

        assert_eq!(result.url, "https://example.com/svn");
        assert_eq!(result.entries.len(), 3);
        assert_eq!(result.entries[0].name, "branches");
        assert_eq!(result.entries[1].name, "trunk");
        assert_eq!(result.entries[2].name, "zeta.txt");
        assert_eq!(result.entries[0].kind, "dir");
        assert_eq!(result.entries[0].revision, "7");
        assert_eq!(result.entries[0].author, "dev");
        assert_eq!(result.entries[0].date, "2026-01-01T00:00:00Z");
    }
}

fn compact_repository_url(url: &str) -> String {
    const MAX_CHARS: usize = 48;
    if url.chars().count() <= MAX_CHARS {
        return url.to_string();
    }

    let tail: String = url
        .chars()
        .rev()
        .take(MAX_CHARS - 3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("...{tail}")
}

fn parse_repository_list_xml(xml: &str, url: &str) -> Result<RepositoryListResult, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "SVN_LIST_XML_PARSE_FAILED",
            "解析仓库目录失败",
            Some(format!("svn list --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;

    let mut entries = Vec::new();
    for entry in document
        .descendants()
        .filter(|node| node.has_tag_name("entry"))
    {
        let kind = entry.attribute("kind").unwrap_or("file").to_string();
        let name = text_child(entry, "name").unwrap_or_default();
        let commit = entry.children().find(|node| node.has_tag_name("commit"));
        let revision = commit
            .and_then(|node| node.attribute("revision"))
            .unwrap_or("")
            .to_string();
        let author = commit
            .and_then(|node| text_child(node, "author"))
            .unwrap_or_default();
        let date = commit
            .and_then(|node| text_child(node, "date"))
            .unwrap_or_default();

        entries.push(RepositoryListEntry {
            name,
            kind,
            revision,
            author,
            date,
        });
    }

    entries.sort_by(|left, right| {
        let left_dir = left.kind == "dir";
        let right_dir = right.kind == "dir";
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(RepositoryListResult {
        url: url.to_string(),
        entries,
    })
}

fn text_child(node: roxmltree::Node<'_, '_>, tag_name: &str) -> Option<String> {
    node.children()
        .find(|child| child.has_tag_name(tag_name))
        .and_then(|child| child.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}
