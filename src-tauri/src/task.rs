#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Output, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use quick_xml::{
    escape::{resolve_xml_entity, unescape},
    events::Event,
    Reader as XmlReader,
};
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::{
    error::NovaError,
    executable::normalize_executable_setting,
    merge_preview::{self, MergePreviewSession},
    path_utils,
    redaction::redact_credentials,
    shadow::{self, ShadowWorkspaceRequest},
    svn,
};

const REVISION_DIFF_PREVIEW_MAX_BYTES: usize = 2 * 1024 * 1024;
const APPLY_PATCH_MAX_BYTES: u64 = 32 * 1024 * 1024;
const APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES: usize = 256 * 1024;
const APPLY_PATCH_TASK_LOG_MAX_BYTES: usize = 64 * 1024;
const APPLY_PATCH_TASK_LOG_MAX_LINES: usize = 500;
const MAX_APPLY_PATCH_COMMAND_OUTPUT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_APPLY_PATCH_OUTPUT_LINE_BYTES: usize = 64 * 1024;
const MAX_APPLY_PATCH_STATS_PATHS: usize = 100_000;
const MAX_BATCH_OPERATION_PATHS: usize = 500;
const MAX_BATCH_OPERATION_PATH_BYTES: usize = 24 * 1024;
/// Budget for path args on one `svn status` invocation. `status` does not support
/// `--targets`, so large selections must be chunked under Windows CreateProcess limits.
const SVN_STATUS_PATH_ARGV_MAX_BYTES: usize = 24 * 1024;
const TASK_HISTORY_FILE_VERSION: u32 = 1;
const MAX_PERSISTED_TASKS: usize = 200;
const MAX_PERSISTED_TASK_LOGS: usize = 500;
const MAX_PERSISTED_TASK_LOG_BYTES: usize = 256 * 1024;
const MAX_PERSISTED_TASK_ERROR_BYTES: usize = 64 * 1024;
const MAX_TASK_COMMAND_LOG_BYTES: usize = 16 * 1024;
const MAX_TASK_COMMAND_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MERGE_OUTPUT_PREVIEW_MAX_BYTES: usize = 256 * 1024;
const MAX_MERGE_COMMAND_OUTPUT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_MERGE_OUTPUT_LINE_BYTES: usize = 64 * 1024;
const MAX_MERGE_PREVIEW_FILE_ENTRIES: usize = 100_000;
const MAX_REVISION_DIFF_PATCH_BYTES: u64 = 256 * 1024 * 1024;
const MAX_REPOSITORY_LIST_XML_BYTES: u64 = 64 * 1024 * 1024;
const MAX_REPOSITORY_LIST_ENTRIES: usize = 100_000;
const MAX_REPOSITORY_LIST_FIELD_BYTES: usize = 32 * 1024;
const MAX_REPOSITORY_LIST_TEXT_BYTES: usize = 32 * 1024 * 1024;
const MAX_RUNTIME_TASK_LOGS: usize = 2000;
const MAX_RUNTIME_TASK_LOG_BYTES: usize = 256 * 1024;
const TASK_LOG_TRUNCATION_MARKER: &str = "任务日志已截断：仅保留最近输出";
const TASK_COMMAND_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// 通用命令空闲超时：长时间无 stdout/stderr 则终止（避免假死）。
const TASK_COMMAND_IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Update 可能长时间传输大文件且几乎无行输出，不使用空闲超时（仍受总时限约束）。
const TASK_UPDATE_IDLE_TIMEOUT: Option<Duration> = None;
static APPLY_PATCH_SNAPSHOT_NONCE: AtomicU64 = AtomicU64::new(1);
static TASK_COMMAND_OUTPUT_NONCE: AtomicU64 = AtomicU64::new(1);
static SVN_TARGETS_FILE_NONCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    Success,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    UnaddFile,
    DeletePath,
    DeleteUnversionedFile,
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
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepositoryFileTaskRequest {
    pub url: String,
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryCopyKind {
    Branch,
    Tag,
    Entry,
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
pub struct CreateRepositoryMkdirTaskRequest {
    pub url: String,
    pub message: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepositoryImportTaskRequest {
    pub source_path: String,
    pub target_url: String,
    pub message: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepositoryMoveTaskRequest {
    pub kind: Option<RepositoryMoveKind>,
    pub source_url: String,
    pub target_url: String,
    pub message: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepositoryDeleteTaskRequest {
    pub url: String,
    pub message: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryMoveKind {
    Move,
    Rename,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateBranchCheckoutTaskRequest {
    pub branch_url: String,
    pub local_path: String,
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepositoryCheckoutTaskRequest {
    pub url: String,
    pub local_path: String,
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepositoryExportTaskRequest {
    pub url: String,
    pub local_path: String,
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRepositoryDragExportTaskRequest {
    pub url: String,
    pub name: String,
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
    pub file_path: Option<String>,
    pub target_url: Option<String>,
    pub left_revision: Option<String>,
    pub right_revision: Option<String>,
    pub left_url: Option<String>,
    pub right_url: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRevertRevisionTaskRequest {
    pub working_copy_root: String,
    pub target_path: Option<String>,
    pub source_url: Option<String>,
    pub target_revision: Option<String>,
    pub target_revisions: Option<Vec<String>>,
    pub svn_executable: Option<String>,
    #[serde(default)]
    pub whole_workspace: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMergeTaskRequest {
    pub working_copy_root: String,
    pub source_url: String,
    pub start_revision: Option<String>,
    pub end_revision: Option<String>,
    pub revisions: Option<Vec<String>>,
    pub dry_run: bool,
    #[serde(default)]
    pub allow_local_changes: bool,
    pub record_only: bool,
    pub ignore_ancestry: bool,
    pub force: bool,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateApplyMergePreviewTaskRequest {
    pub preview_id: String,
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
    pub repository_file: Option<RepositoryFileResult>,
    pub repository_export: Option<RepositoryExportResult>,
    pub revision_diff: Option<RevisionDiffResult>,
    pub merge_result: Option<MergeResult>,
    pub apply_patch_result: Option<ApplyPatchResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepositoryExportResult {
    pub url: String,
    pub revision: Option<String>,
    pub local_path: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepositoryFileResult {
    pub url: String,
    pub revision: Option<String>,
    pub file_path: String,
    pub file_name: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepositoryListResult {
    pub url: String,
    pub revision: Option<String>,
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
    pub record_only: bool,
    pub ignore_ancestry: bool,
    pub force: bool,
    pub output_text: String,
    pub output_truncated: bool,
    pub max_output_bytes: usize,
    pub file_count: usize,
    pub line_count: usize,
    pub added: usize,
    pub deleted: usize,
    pub updated: usize,
    pub conflicted: usize,
    pub preview_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyPatchResult {
    pub dry_run: bool,
    pub patch_file_path: String,
    pub patch_digest: String,
    pub output_text: String,
    pub output_truncated: bool,
    pub max_output_bytes: usize,
    pub applied: usize,
    pub offset_hunks: usize,
    pub rejected: usize,
    pub skipped: usize,
    pub conflicted: usize,
}

#[derive(Debug, Clone)]
enum TaskPayload {
    Recovered,
    Mock(MockTaskOutcome),
    SvnCommit(CommitTaskPayload),
    SvnOperation(SvnOperationTaskPayload),
    SvnBatchOperation(SvnBatchOperationTaskPayload),
    ShadowWorkspace(ShadowWorkspaceTaskPayload),
    PartialCommit(PartialCommitTaskPayload),
    RepositoryList(RepositoryListTaskPayload),
    RepositoryFile(RepositoryFileTaskPayload),
    RepositoryCopy(RepositoryCopyTaskPayload),
    RepositoryMkdir(RepositoryMkdirTaskPayload),
    RepositoryImport(RepositoryImportTaskPayload),
    RepositoryMove(RepositoryMoveTaskPayload),
    RepositoryDelete(RepositoryDeleteTaskPayload),
    BranchCheckout(BranchCheckoutTaskPayload),
    RepositoryCheckout(RepositoryCheckoutTaskPayload),
    RepositoryExport(RepositoryExportTaskPayload),
    SvnSwitch(SvnSwitchTaskPayload),
    RevisionDiff(RevisionDiffTaskPayload),
    RevertRevision(RevertRevisionTaskPayload),
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
    unversioned_file_identity: Option<Box<UnversionedFileIdentity>>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct UnversionedFileIdentity {
    canonical_path: PathBuf,
    bytes: u64,
    sha256: String,
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
    revision: Option<String>,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct RepositoryFileTaskPayload {
    url: String,
    revision: Option<String>,
    svn_executable: String,
    output_dir: PathBuf,
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
struct RepositoryMkdirTaskPayload {
    url: String,
    message: String,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct RepositoryImportTaskPayload {
    source_path: String,
    target_url: String,
    message: String,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct RepositoryMoveTaskPayload {
    kind: RepositoryMoveKind,
    source_url: String,
    target_url: String,
    message: String,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct RepositoryDeleteTaskPayload {
    url: String,
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
struct RepositoryCheckoutTaskPayload {
    url: String,
    local_path: String,
    revision: Option<String>,
    svn_executable: String,
}

#[derive(Debug, Clone)]
struct RepositoryExportTaskPayload {
    url: String,
    local_path: String,
    revision: Option<String>,
    svn_executable: String,
    cleanup_on_failure: bool,
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
    file_path: Option<String>,
    target_url: Option<String>,
    left_revision: Option<String>,
    right_revision: Option<String>,
    left_url: Option<String>,
    right_url: Option<String>,
    svn_executable: String,
    patch_output_dir: PathBuf,
}

#[derive(Debug, Clone)]
struct RevertRevisionTaskPayload {
    working_copy_root: String,
    target_path: String,
    source_url: Option<String>,
    target_revisions: Vec<String>,
    svn_executable: String,
    whole_workspace: bool,
}

#[derive(Debug, Clone)]
struct MergeTaskPayload {
    app: Option<AppHandle>,
    working_copy_root: String,
    source_url: String,
    start_revision: Option<String>,
    end_revision: Option<String>,
    revisions: Vec<String>,
    dry_run: bool,
    allow_local_changes: bool,
    record_only: bool,
    ignore_ancestry: bool,
    force: bool,
    svn_executable: String,
    preview_id: Option<String>,
    expected_snapshot_digest: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct MergeRevisionSelection {
    start_revision: Option<String>,
    end_revision: Option<String>,
    revisions: Vec<String>,
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

#[derive(Debug, Serialize, Deserialize)]
struct PersistedTaskHistory {
    version: u32,
    tasks: Vec<PersistedTask>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedTask {
    task_id: String,
    title: String,
    status: TaskStatus,
    logs: Vec<TaskLog>,
    error: Option<String>,
    created_at: u64,
    updated_at: u64,
}

impl From<&Task> for PersistedTask {
    fn from(task: &Task) -> Self {
        Self {
            task_id: task.task_id.clone(),
            title: redact_credentials(&task.title),
            status: task.status.clone(),
            logs: persisted_task_logs(&task.logs),
            error: task
                .error
                .as_deref()
                .map(redact_credentials)
                .map(|error| persisted_task_text(&error, MAX_PERSISTED_TASK_ERROR_BYTES)),
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

impl From<PersistedTask> for Task {
    fn from(task: PersistedTask) -> Self {
        let mut logs = task
            .logs
            .into_iter()
            .map(|log| TaskLog {
                message: redact_credentials(&log.message),
                created_at: log.created_at,
            })
            .collect::<Vec<_>>();
        trim_task_logs(&mut logs);
        Self {
            task_id: task.task_id,
            title: redact_credentials(&task.title),
            status: task.status,
            logs,
            error: task.error.map(|error| redact_credentials(&error)),
            result: None,
            created_at: task.created_at,
            updated_at: task.updated_at,
            payload: TaskPayload::Recovered,
        }
    }
}

#[derive(Debug, Default)]
struct TaskQueueState {
    tasks: Vec<Task>,
    pending: VecDeque<String>,
    running_task_id: Option<String>,
    running_processes: HashMap<String, Arc<Mutex<Child>>>,
    cancellation_requested: HashSet<String>,
    persistence_path: Option<PathBuf>,
}

impl TaskQueue {
    #[cfg(test)]
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(TaskQueueState::default())),
            next_id: AtomicU64::new(1),
            worker_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn persistent(path: PathBuf) -> Self {
        let (mut tasks, recovery_changed) = load_task_history(&path);
        let next_id = next_task_id(&tasks);
        let now = timestamp_millis();
        let mut interrupted = false;

        for task in &mut tasks {
            if matches!(task.status, TaskStatus::Pending | TaskStatus::Running) {
                task.status = TaskStatus::Interrupted;
                task.error = Some(
                    "应用在任务完成前退出，任务已中断且不会自动重试。请检查工作副本状态后重新执行。"
                        .to_string(),
                );
                task.result = None;
                task.updated_at = now;
                push_task_log(
                    task,
                    "应用重启时检测到未完成任务，已标记为中断".to_string(),
                    now,
                );
                interrupted = true;
            }
        }

        let state = TaskQueueState {
            tasks,
            pending: VecDeque::new(),
            running_task_id: None,
            running_processes: HashMap::new(),
            cancellation_requested: HashSet::new(),
            persistence_path: Some(path),
        };
        if recovery_changed || interrupted {
            if let Err(error) = persist_task_history(&state) {
                eprintln!("[NovaSVN] 保存恢复后的任务历史失败：{error}");
            }
        }

        Self {
            state: Arc::new(Mutex::new(state)),
            next_id: AtomicU64::new(next_id),
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
            SvnOperationKind::AddFile => Some(normalize_add_path(
                request.file_path.as_deref().unwrap_or_default(),
            )?),
            SvnOperationKind::UnaddFile => Some(normalize_relative_file_path(
                request.file_path.as_deref().unwrap_or_default(),
                "UNADD_FILE_PATH_INVALID",
                "Unadd 文件路径无效",
            )?),
            SvnOperationKind::DeletePath => Some(normalize_delete_path(
                request.file_path.as_deref().unwrap_or_default(),
            )?),
            SvnOperationKind::DeleteUnversionedFile => Some(normalize_strict_working_copy_path(
                request.file_path.as_deref().unwrap_or_default(),
                "DELETE_UNVERSIONED_FILE_PATH_INVALID",
                "未版本控制文件删除路径无效",
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
        if matches!(&request.kind, SvnOperationKind::AddFile) {
            working_copy_root = canonicalize_add_working_copy_root(&working_copy_root)?;
            validate_add_target(
                &svn_executable,
                &working_copy_root,
                file_path.as_deref().unwrap_or_default(),
            )?;
        } else if matches!(&request.kind, SvnOperationKind::UnaddFile) {
            working_copy_root = canonicalize_unadd_working_copy_root(&working_copy_root)?;
            validate_unadd_target(
                &svn_executable,
                &working_copy_root,
                file_path.as_deref().unwrap_or_default(),
            )?;
        }
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
        let unversioned_file_identity =
            if matches!(&request.kind, SvnOperationKind::DeleteUnversionedFile) {
                working_copy_root = canonicalize_delete_working_copy_root(&working_copy_root)?;
                Some(Box::new(validate_unversioned_file_delete_target(
                    &svn_executable,
                    &working_copy_root,
                    file_path.as_deref().unwrap_or_default(),
                )?))
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
                unversioned_file_identity,
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
        let revision = normalize_repository_list_revision(request.revision.as_deref())?;
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
                revision,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_repository_file_task(
        &self,
        app: &AppHandle,
        request: CreateRepositoryFileTaskRequest,
    ) -> Result<Task, NovaError> {
        let url = normalize_repository_url(&request.url)?;
        let revision = normalize_repository_list_revision(request.revision.as_deref())?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let output_dir = app
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
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let revision_label = revision.as_deref().unwrap_or("HEAD");
        let task = Task {
            task_id: task_id.clone(),
            title: format!(
                "打开仓库文件 {} @ {revision_label}",
                compact_repository_url(&url)
            ),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "仓库文件下载任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryFile(RepositoryFileTaskPayload {
                url,
                revision,
                svn_executable,
                output_dir,
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
                Some("Repository Copy 需要选择不同的目标 URL。".to_string()),
                true,
            ));
        }

        let message = request.message.trim().to_string();
        if message.is_empty() {
            return Err(NovaError::command(
                "REPOSITORY_COPY_MESSAGE_REQUIRED",
                "请输入 Repository Copy 的提交信息",
                None,
                true,
            ));
        }

        let revision = normalize_optional_revision_value(
            request.revision.as_deref(),
            "REPOSITORY_COPY_REVISION_INVALID",
            "Repository Copy 的 revision 无效",
        )?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let title = match request.kind {
            RepositoryCopyKind::Branch => "创建分支",
            RepositoryCopyKind::Tag => "创建标签",
            RepositoryCopyKind::Entry => "复制仓库条目",
        };
        let task = Task {
            task_id: task_id.clone(),
            title: format!("{title} {}", compact_repository_url(&target_url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "Repository Copy 任务已加入队列".to_string(),
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

    pub fn create_repository_mkdir_task(
        &self,
        request: CreateRepositoryMkdirTaskRequest,
    ) -> Result<Task, NovaError> {
        let url = normalize_repository_url(&request.url)?;
        let message = request.message.trim().to_string();
        if message.is_empty() {
            return Err(NovaError::command(
                "REPOSITORY_MKDIR_MESSAGE_REQUIRED",
                "请输入创建仓库目录的提交信息",
                None,
                true,
            ));
        }
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("创建仓库目录 {}", compact_repository_url(&url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "创建仓库目录任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryMkdir(RepositoryMkdirTaskPayload {
                url,
                message,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_repository_import_task(
        &self,
        request: CreateRepositoryImportTaskRequest,
    ) -> Result<Task, NovaError> {
        let source_path = normalize_repository_local_path(
            &request.source_path,
            "REPOSITORY_IMPORT_SOURCE",
            "Import 本地源路径",
        )?;
        validate_repository_import_source(Path::new(&source_path))?;
        let target_url = normalize_repository_url(&request.target_url)?;
        let message = request.message.trim().to_string();
        if message.is_empty() {
            return Err(NovaError::command(
                "REPOSITORY_IMPORT_MESSAGE_REQUIRED",
                "请输入 Repository Import 的提交信息",
                None,
                true,
            ));
        }
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("Import 到 {}", compact_repository_url(&target_url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "Repository Import 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryImport(RepositoryImportTaskPayload {
                source_path,
                target_url,
                message,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_repository_move_task(
        &self,
        request: CreateRepositoryMoveTaskRequest,
    ) -> Result<Task, NovaError> {
        let kind = request.kind.unwrap_or(RepositoryMoveKind::Move);
        let source_url = normalize_repository_url(&request.source_url)?;
        let target_url = normalize_repository_url(&request.target_url)?;
        if source_url == target_url {
            return Err(NovaError::command(
                "REPOSITORY_MOVE_TARGET_SAME_AS_SOURCE",
                "Move 目标 URL 不能和源 URL 相同",
                None,
                true,
            ));
        }
        if matches!(kind, RepositoryMoveKind::Rename)
            && repository_url_parent(&source_url) != repository_url_parent(&target_url)
        {
            return Err(NovaError::command(
                "REPOSITORY_RENAME_PARENT_MISMATCH",
                "Rename 目标必须和源条目位于同一仓库目录",
                None,
                true,
            ));
        }
        let message = request.message.trim().to_string();
        if message.is_empty() {
            return Err(NovaError::command(
                "REPOSITORY_MOVE_MESSAGE_REQUIRED",
                "请输入 Repository Move 的提交信息",
                None,
                true,
            ));
        }
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let operation = match kind {
            RepositoryMoveKind::Move => "移动仓库条目",
            RepositoryMoveKind::Rename => "重命名仓库条目",
        };
        let task = Task {
            task_id: task_id.clone(),
            title: format!("{operation} {}", compact_repository_url(&source_url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "Repository Move 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryMove(RepositoryMoveTaskPayload {
                kind,
                source_url,
                target_url,
                message,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_repository_delete_task(
        &self,
        request: CreateRepositoryDeleteTaskRequest,
    ) -> Result<Task, NovaError> {
        let url = normalize_repository_url(&request.url)?;
        let message = request.message.trim().to_string();
        if message.is_empty() {
            return Err(NovaError::command(
                "REPOSITORY_DELETE_MESSAGE_REQUIRED",
                "请输入 Repository Delete 的提交信息",
                None,
                true,
            ));
        }
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("删除仓库条目 {}", compact_repository_url(&url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "Repository Delete 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryDelete(RepositoryDeleteTaskPayload {
                url,
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

    pub fn create_repository_checkout_task(
        &self,
        request: CreateRepositoryCheckoutTaskRequest,
    ) -> Result<Task, NovaError> {
        let url = normalize_repository_url(&request.url)?;
        let local_path = normalize_checkout_path(&request.local_path)?;
        validate_checkout_destination(Path::new(&local_path))?;
        let revision = normalize_optional_revision_value(
            request.revision.as_deref(),
            "REPOSITORY_CHECKOUT_REVISION_INVALID",
            "仓库 Checkout Revision 无效",
        )?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("Checkout {}", compact_repository_url(&url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "仓库 Checkout 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryCheckout(RepositoryCheckoutTaskPayload {
                url,
                local_path,
                revision,
                svn_executable,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_repository_export_task(
        &self,
        request: CreateRepositoryExportTaskRequest,
    ) -> Result<Task, NovaError> {
        let url = normalize_repository_url(&request.url)?;
        let local_path = normalize_export_path(&request.local_path)?;
        validate_export_destination(Path::new(&local_path))?;
        let revision = normalize_optional_revision_value(
            request.revision.as_deref(),
            "REPOSITORY_EXPORT_REVISION_INVALID",
            "仓库 Export Revision 无效",
        )?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("Export {}", compact_repository_url(&url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "仓库 Export 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryExport(RepositoryExportTaskPayload {
                url,
                local_path,
                revision,
                svn_executable,
                cleanup_on_failure: false,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_repository_drag_export_task(
        &self,
        app: &AppHandle,
        request: CreateRepositoryDragExportTaskRequest,
    ) -> Result<Task, NovaError> {
        let url = normalize_repository_url(&request.url)?;
        let revision = normalize_optional_revision_value(
            request.revision.as_deref(),
            "REPOSITORY_DRAG_EXPORT_REVISION_INVALID",
            "仓库拖出 Export Revision 无效",
        )?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let file_name = normalize_repository_drag_export_name(&request.name)?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let output_dir = app
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
            .join("repository-drag-exports")
            .join(format!("{}-{task_id}", timestamp_millis()));
        fs::create_dir_all(&output_dir).map_err(|error| {
            NovaError::command(
                "REPOSITORY_DRAG_EXPORT_DIRECTORY_FAILED",
                "无法创建仓库拖出临时目录",
                Some(format!("路径：{}；错误：{error}", output_dir.display())),
                true,
            )
        })?;
        let local_path = output_dir.join(file_name).display().to_string();
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!("拖出 Export {}", compact_repository_url(&url)),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "仓库拖出 Export 任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RepositoryExport(RepositoryExportTaskPayload {
                url,
                local_path,
                revision,
                svn_executable,
                cleanup_on_failure: true,
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

    pub fn create_revert_revision_task(
        &self,
        request: CreateRevertRevisionTaskRequest,
    ) -> Result<Task, NovaError> {
        let working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        let target_path =
            normalize_revert_target_path(&working_copy_root, request.target_path.as_deref())?;
        let target_is_root = target_path == working_copy_root;
        let source_url = request
            .source_url
            .as_deref()
            .map(normalize_repository_url)
            .transpose()?;
        let target_revisions = normalize_revert_target_revisions(
            request.target_revision.as_deref(),
            request.target_revisions.as_deref(),
            request.whole_workspace,
        )?;
        let revision_label = revert_revision_selection_label(&target_revisions);
        let is_batch = target_revisions.len() > 1;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: if request.whole_workspace {
                if target_is_root {
                    format!("回退工作区到 {revision_label}")
                } else {
                    format!("回退目标到 {revision_label}")
                }
            } else if is_batch {
                format!("批量撤销 {} 个 Revision", target_revisions.len())
            } else {
                format!("撤销提交 {revision_label}")
            },
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: if request.whole_workspace {
                    "回退工作区任务已加入队列".to_string()
                } else if is_batch {
                    format!(
                        "批量撤销 {} 个 Revision 的任务已加入队列",
                        target_revisions.len()
                    )
                } else {
                    "撤销单次提交任务已加入队列".to_string()
                },
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::RevertRevision(RevertRevisionTaskPayload {
                working_copy_root: working_copy_root.display().to_string(),
                target_path: target_path.display().to_string(),
                source_url,
                target_revisions,
                svn_executable,
                whole_workspace: request.whole_workspace,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    #[cfg(test)]
    pub fn create_merge_task(&self, request: CreateMergeTaskRequest) -> Result<Task, NovaError> {
        self.create_merge_task_internal(None, request)
    }

    pub fn create_merge_task_with_app(
        &self,
        app: &AppHandle,
        request: CreateMergeTaskRequest,
    ) -> Result<Task, NovaError> {
        self.create_merge_task_internal(Some(app), request)
    }

    fn create_merge_task_internal(
        &self,
        app: Option<&AppHandle>,
        request: CreateMergeTaskRequest,
    ) -> Result<Task, NovaError> {
        let working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        let source_url = normalize_repository_url(&request.source_url)?;
        let MergeRevisionSelection {
            start_revision,
            end_revision,
            revisions,
        } = normalize_merge_selection(
            request.start_revision,
            request.end_revision,
            request.revisions,
        )?;
        validate_merge_tracking_options(request.record_only, request.ignore_ancestry)?;
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        if !request.dry_run
            && !request.allow_local_changes
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
        let preview_id = request.dry_run.then(new_merge_preview_id);
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
                app: app.cloned(),
                working_copy_root: working_copy_root.display().to_string(),
                source_url,
                start_revision,
                end_revision,
                revisions,
                dry_run: request.dry_run,
                allow_local_changes: request.allow_local_changes,
                record_only: request.record_only,
                ignore_ancestry: request.ignore_ancestry,
                force: request.force,
                svn_executable,
                preview_id,
                expected_snapshot_digest: None,
            }),
        };

        self.enqueue(task_id, task.clone());
        Ok(task)
    }

    pub fn create_apply_merge_preview_task(
        &self,
        app: &AppHandle,
        request: CreateApplyMergePreviewTaskRequest,
    ) -> Result<Task, NovaError> {
        let session = merge_preview::read_session(app, &request.preview_id)?;
        let root = normalize_workspace_root(&session.working_copy_root)?;
        let current_digest =
            merge_preview::workspace_snapshot_digest(&session.svn_executable, &root)?;
        if current_digest != session.snapshot_digest {
            return Err(merge_preview_stale_error());
        }
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let now = timestamp_millis();
        let task = Task {
            task_id: task_id.clone(),
            title: format!(
                "应用 Merge 预览 {}",
                compact_repository_url(&session.source_url)
            ),
            status: TaskStatus::Pending,
            logs: vec![TaskLog {
                message: "Merge 预览应用任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::Merge(MergeTaskPayload {
                app: Some(app.clone()),
                working_copy_root: root.display().to_string(),
                source_url: session.source_url,
                start_revision: session.start_revision,
                end_revision: session.end_revision,
                revisions: session.revisions,
                dry_run: false,
                allow_local_changes: false,
                record_only: session.record_only,
                ignore_ancestry: session.ignore_ancestry,
                force: session.force,
                svn_executable: session.svn_executable,
                preview_id: Some(request.preview_id),
                expected_snapshot_digest: Some(session.snapshot_digest),
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
        let running_process = {
            let mut state = self.state.lock().expect("任务队列锁已损坏");
            let task_index = state
                .tasks
                .iter()
                .position(|task| task.task_id == task_id)
                .ok_or_else(|| {
                    NovaError::command(
                        "TASK_NOT_FOUND",
                        "未找到指定任务",
                        Some(format!("task_id: {task_id}")),
                        true,
                    )
                })?;

            match state.tasks[task_index].status.clone() {
                TaskStatus::Pending => {
                    if let Some(index) = state.pending.iter().position(|id| id == task_id) {
                        state.pending.remove(index);
                    }
                    let task = &mut state.tasks[task_index];
                    task.status = TaskStatus::Cancelled;
                    release_apply_patch_snapshot(&mut task.payload);
                    task.updated_at = timestamp_millis();
                    let now = task.updated_at;
                    push_task_log(task, "取消原因：用户在任务开始前取消".to_string(), now);
                    if let Err(error) = persist_task_history(&state) {
                        eprintln!("[NovaSVN] 保存取消后的任务历史失败：{error}");
                    }
                    return Ok(state.tasks[task_index].clone());
                }
                TaskStatus::Running => {
                    if !state.cancellation_requested.insert(task_id.to_string()) {
                        return Ok(state.tasks[task_index].clone());
                    }
                    let now = timestamp_millis();
                    state.tasks[task_index].updated_at = now;
                    push_task_log(
                        &mut state.tasks[task_index],
                        "取消原因：用户请求取消运行中任务；正在终止 SVN 进程树".to_string(),
                        now,
                    );
                    let process = state.running_processes.get(task_id).cloned();
                    if let Err(error) = persist_task_history(&state) {
                        eprintln!("[NovaSVN] 保存取消请求失败：{error}");
                    }
                    process
                }
                TaskStatus::Success
                | TaskStatus::Failed
                | TaskStatus::Cancelled
                | TaskStatus::Interrupted => {
                    return Err(NovaError::command(
                        "TASK_ALREADY_FINISHED",
                        "任务已经结束",
                        Some(format!("当前状态：{:?}", state.tasks[task_index].status)),
                        true,
                    ));
                }
            }
        };

        if let Some(process) = running_process {
            if let Err(error) = terminate_process_tree(&process) {
                let mut state = self.state.lock().expect("任务队列锁已损坏");
                let already_cancelled = state
                    .tasks
                    .iter()
                    .find(|task| task.task_id == task_id)
                    .is_some_and(|task| matches!(task.status, TaskStatus::Cancelled));
                if already_cancelled {
                    return Ok(state
                        .tasks
                        .iter()
                        .find(|task| task.task_id == task_id)
                        .expect("已取消任务应存在")
                        .clone());
                }

                state.cancellation_requested.remove(task_id);
                if let Some(task) = state.tasks.iter_mut().find(|task| task.task_id == task_id) {
                    let now = timestamp_millis();
                    task.updated_at = now;
                    push_task_log(task, format!("终止 SVN 进程树失败：{error}"), now);
                }
                if let Err(persist_error) = persist_task_history(&state) {
                    eprintln!("[NovaSVN] 保存取消失败状态失败：{persist_error}");
                }
                return Err(NovaError::command(
                    "TASK_CANCEL_FAILED",
                    "终止运行中任务失败",
                    Some(error.to_string()),
                    true,
                ));
            }
        }

        self.get_task(task_id)
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
            if let Err(error) = persist_task_history(&state) {
                eprintln!("[NovaSVN] 保存新任务历史失败：{error}");
            }
        }

        self.ensure_worker();
    }
}

fn load_task_history(path: &Path) -> (Vec<Task>, bool) {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (Vec::new(), false),
        Err(error) => {
            return (
                vec![task_history_recovery_error(format!(
                    "读取 `{}` 失败：{error}",
                    path.display()
                ))],
                true,
            );
        }
    };

    let history = match serde_json::from_str::<PersistedTaskHistory>(&content) {
        Ok(history) if history.version == TASK_HISTORY_FILE_VERSION => history,
        Ok(history) => {
            return (
                vec![task_history_recovery_error(format!(
                    "任务历史版本 {} 不受支持，当前版本为 {}。",
                    history.version, TASK_HISTORY_FILE_VERSION
                ))],
                true,
            );
        }
        Err(error) => {
            return (
                vec![task_history_recovery_error(format!(
                    "解析 `{}` 失败：{error}",
                    path.display()
                ))],
                true,
            );
        }
    };

    let mut tasks = history
        .tasks
        .into_iter()
        .map(Task::from)
        .collect::<Vec<_>>();
    if tasks.len() <= MAX_PERSISTED_TASKS {
        return (tasks, false);
    }

    let first_task = tasks.len() - MAX_PERSISTED_TASKS;
    tasks.drain(..first_task);
    (tasks, true)
}

fn task_history_recovery_error(detail: String) -> Task {
    let now = timestamp_millis();
    Task {
        task_id: format!("task-recovery-{now}"),
        title: "任务历史恢复失败".to_string(),
        status: TaskStatus::Interrupted,
        logs: vec![TaskLog {
            message: "应用启动时无法恢复任务历史".to_string(),
            created_at: now,
        }],
        error: Some(detail),
        result: None,
        created_at: now,
        updated_at: now,
        payload: TaskPayload::Recovered,
    }
}

fn next_task_id(tasks: &[Task]) -> u64 {
    tasks
        .iter()
        .filter_map(|task| task.task_id.strip_prefix("task-"))
        .filter_map(|value| value.parse::<u64>().ok())
        .max()
        .unwrap_or(0)
        .saturating_add(1)
        .max(1)
}

fn persisted_task_logs(logs: &[TaskLog]) -> Vec<TaskLog> {
    let mut persisted = Vec::new();
    let mut persisted_bytes = 0usize;
    for log in logs.iter().rev().take(MAX_PERSISTED_TASK_LOGS) {
        if persisted_bytes >= MAX_PERSISTED_TASK_LOG_BYTES {
            break;
        }
        let remaining = MAX_PERSISTED_TASK_LOG_BYTES - persisted_bytes;
        let message = persisted_task_text(&redact_credentials(&log.message), remaining);
        persisted_bytes += message.len();
        persisted.push(TaskLog {
            message,
            created_at: log.created_at,
        });
    }
    persisted.reverse();
    persisted
}

fn persisted_task_text(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }

    let marker = "\n...[任务历史内容已截断]";
    if max_bytes <= marker.len() {
        return truncate_utf8(value, max_bytes);
    }
    let content_bytes = max_bytes.saturating_sub(marker.len());
    format!("{}{}", truncate_utf8(value, content_bytes), marker)
}

fn persist_task_history(state: &TaskQueueState) -> Result<(), String> {
    let Some(path) = state.persistence_path.as_deref() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建目录 `{}` 失败：{error}", parent.display()))?;
    }

    let first_task = state.tasks.len().saturating_sub(MAX_PERSISTED_TASKS);
    let history = PersistedTaskHistory {
        version: TASK_HISTORY_FILE_VERSION,
        tasks: state.tasks[first_task..]
            .iter()
            .map(PersistedTask::from)
            .collect(),
    };
    let content = serde_json::to_vec_pretty(&history)
        .map_err(|error| format!("序列化任务历史失败：{error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content)
        .map_err(|error| format!("写入 `{}` 失败：{error}", temp_path.display()))?;

    if cfg!(windows) && path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("替换 `{}` 失败：{error}", path.display()))?;
    }
    fs::rename(&temp_path, path).map_err(|error| {
        format!(
            "将 `{}` 替换为 `{}` 失败：{error}",
            temp_path.display(),
            path.display()
        )
    })
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
            TaskPayload::Recovered => update_task(
                &state,
                &task_id,
                TaskStatus::Interrupted,
                "恢复任务不能重新执行",
                Some("任务执行参数不会持久化，请检查工作副本状态后重新创建任务。".to_string()),
            ),
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
            TaskPayload::RepositoryFile(payload) => {
                run_repository_file_task(&state, &task_id, payload)
            }
            TaskPayload::RepositoryCopy(payload) => {
                run_repository_copy_task(&state, &task_id, payload)
            }
            TaskPayload::RepositoryMkdir(payload) => {
                run_repository_mkdir_task(&state, &task_id, payload)
            }
            TaskPayload::RepositoryImport(payload) => {
                run_repository_import_task(&state, &task_id, payload)
            }
            TaskPayload::RepositoryMove(payload) => {
                run_repository_move_task(&state, &task_id, payload)
            }
            TaskPayload::RepositoryDelete(payload) => {
                run_repository_delete_task(&state, &task_id, payload)
            }
            TaskPayload::BranchCheckout(payload) => {
                run_branch_checkout_task(&state, &task_id, payload)
            }
            TaskPayload::RepositoryCheckout(payload) => {
                run_repository_checkout_task(&state, &task_id, payload)
            }
            TaskPayload::RepositoryExport(payload) => {
                run_repository_export_task(&state, &task_id, payload)
            }
            TaskPayload::SvnSwitch(payload) => run_svn_switch_task(&state, &task_id, payload),
            TaskPayload::RevisionDiff(payload) => run_revision_diff_task(&state, &task_id, payload),
            TaskPayload::RevertRevision(payload) => {
                run_revert_revision_task(&state, &task_id, payload)
            }
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

    let target_statuses =
        match collect_commit_target_statuses(&payload.svn_executable, &root, &payload.files) {
            Ok(statuses) => statuses,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "无法检查提交目标版本状态",
                    Some(error),
                );
                return;
            }
        };

    // A missing versioned path must be scheduled for deletion before svn commit can include it.
    if !target_statuses.missing.is_empty() {
        append_task_log(
            state,
            task_id,
            &format!(
                "自动 Delete {} 个丢失文件：{}",
                target_statuses.missing.len(),
                format_paths_for_task_log(&target_statuses.missing)
            ),
        );
        let delete_root = match canonicalize_delete_working_copy_root(&root) {
            Ok(canonical) => canonical,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "提交前自动 Delete 安全校验失败",
                    Some(nova_error_text(&error)),
                );
                return;
            }
        };
        for relative_path in &target_statuses.missing {
            match validate_delete_target(&payload.svn_executable, &delete_root, relative_path) {
                Ok(identity)
                    if matches!(identity.filesystem_kind, DeleteFilesystemNodeKind::Missing) => {}
                Ok(identity) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "提交前自动 Delete 安全校验失败",
                        Some(format!(
                            "路径 `{relative_path}` 已不再处于丢失状态；文件系统类型：{:?}",
                            identity.filesystem_kind
                        )),
                    );
                    return;
                }
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "提交前自动 Delete 安全校验失败",
                        Some(nova_error_text(&error)),
                    );
                    return;
                }
            }
        }
        let delete_targets =
            match SvnTargetsFile::create(task_id, "delete-missing", &target_statuses.missing) {
                Ok(targets) => targets,
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "提交前自动 Delete 启动失败",
                        Some(error),
                    );
                    return;
                }
            };
        let mut delete_command = svn::command(&payload.svn_executable);
        delete_command
            .arg("delete")
            .arg("--force")
            .arg("--keep-local")
            .arg("--targets")
            .arg(delete_targets.path())
            .current_dir(&delete_root);
        match run_task_command(state, task_id, &mut delete_command) {
            Ok(output) if output.status.success() => {
                append_command_output(state, task_id, &output);
                append_task_log(state, task_id, "自动 Delete 完成");
            }
            Ok(output) => {
                append_command_output(state, task_id, &output);
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "提交前自动 Delete 失败",
                    Some(command_error_detail(&payload.svn_executable, &output)),
                );
                return;
            }
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "提交前自动 Delete 启动失败",
                    Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
                );
                return;
            }
        }
    }

    // Auto-add unversioned selections so commit can include new files (Tortoise-style).
    let unversioned = target_statuses.unversioned;
    let unversioned_parents = if unversioned.is_empty() {
        Vec::new()
    } else {
        let parent_candidates = commit_parent_paths(&unversioned);
        match collect_commit_target_statuses_with_options(
            &payload.svn_executable,
            &root,
            &parent_candidates,
            false,
        ) {
            Ok(statuses) => statuses.unversioned,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "无法检查提交目标父目录版本状态",
                    Some(error),
                );
                return;
            }
        }
    };
    if !unversioned.is_empty() {
        append_task_log(
            state,
            task_id,
            &format!(
                "自动 Add {} 个未版本控制文件：{}",
                unversioned.len(),
                format_paths_for_task_log(&unversioned)
            ),
        );
        // Match standalone Add: validate_add_target expects a canonical WC root
        // (Windows canonicalize uses \\?\ prefixes; non-canonical roots fail the safety check).
        let add_root = match canonicalize_add_working_copy_root(&root) {
            Ok(canonical) => canonical,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "提交前自动 Add 安全校验失败",
                    Some(nova_error_text(&error)),
                );
                return;
            }
        };
        for relative_path in &unversioned {
            if let Err(error) =
                validate_add_target(&payload.svn_executable, &add_root, relative_path)
            {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "提交前自动 Add 安全校验失败",
                    Some(nova_error_text(&error)),
                );
                return;
            }
        }
        // Use --targets so large selections stay under Windows CreateProcess limits
        // (os error 206: "文件名或扩展名太长").
        let add_targets = match SvnTargetsFile::create(task_id, "add", &unversioned) {
            Ok(targets) => targets,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "提交前自动 Add 启动失败",
                    Some(error),
                );
                return;
            }
        };
        let mut add_command = svn::command(&payload.svn_executable);
        // Relative paths + current_dir(add_root): same as standalone Add, and keeps parents correct.
        add_command
            .arg("add")
            .arg("--parents")
            .arg("--targets")
            .arg(add_targets.path())
            .current_dir(&add_root);
        match run_task_command(state, task_id, &mut add_command) {
            Ok(output) if output.status.success() => {
                append_command_output(state, task_id, &output);
                append_task_log(state, task_id, "自动 Add 完成");
            }
            Ok(output) => {
                append_command_output(state, task_id, &output);
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "提交前自动 Add 失败",
                    Some(command_error_detail(&payload.svn_executable, &output)),
                );
                return;
            }
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "提交前自动 Add 启动失败",
                    Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
                );
                return;
            }
        }
    }

    let mut commit_paths = payload.files.clone();
    for parent in unversioned_parents {
        if !commit_paths.iter().any(|path| path == &parent) {
            commit_paths.push(parent);
        }
    }

    let commit_targets = match SvnTargetsFile::create(task_id, "commit", &commit_paths) {
        Ok(targets) => targets,
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "提交命令启动失败",
                Some(error),
            );
            return;
        }
    };
    let mut command = svn::command(&payload.svn_executable);
    // Relative targets avoid Windows command-line limits; keep changelists as persistent local grouping.
    // `--depth empty` is required: `svn commit dir` otherwise recursively includes every
    // pending change under that directory, not just the files the user selected.
    command
        .arg("commit")
        .arg("--depth")
        .arg("empty")
        .arg("--keep-changelists")
        .arg("--targets")
        .arg(commit_targets.path())
        .arg("-m")
        .arg(&payload.message)
        .current_dir(&root);

    append_task_log(
        state,
        task_id,
        &format!(
            "执行 svn commit：{}",
            format_paths_for_task_log(&commit_paths)
        ),
    );

    match run_task_command(state, task_id, &mut command) {
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

#[derive(Debug, Default, PartialEq, Eq)]
struct CommitTargetStatuses {
    unversioned: Vec<String>,
    missing: Vec<String>,
}

/// Returns working-copy relative paths among `files` that need preparation before commit.
///
/// Always stores the original relative path from `files` (never an absolute status path),
/// so subsequent SVN commands and validation stay inside the working copy.
fn collect_commit_target_statuses(
    executable: &str,
    root: &Path,
    files: &[String],
) -> Result<CommitTargetStatuses, String> {
    collect_commit_target_statuses_with_options(executable, root, files, true)
}

fn collect_commit_target_statuses_with_options(
    executable: &str,
    root: &Path,
    files: &[String],
    infer_unobserved_existing: bool,
) -> Result<CommitTargetStatuses, String> {
    if files.is_empty() {
        return Ok(CommitTargetStatuses::default());
    }

    // Prefer relative targets so status XML paths stay matchable to commit file list entries.
    // Note: `svn status` does **not** accept `--targets` (unlike commit/add/delete). Passing
    // `--targets` fails with: Subcommand 'status' doesn't accept option '--targets ARG'.
    // Chunk path argv instead to stay under Windows CreateProcess limits.
    let root_normalized = normalize_status_path(&root.display().to_string());
    let mut statuses = CommitTargetStatuses::default();
    let mut observed = HashSet::new();
    for batch in chunk_paths_for_svn_status_argv(files) {
        let mut command = svn::command(executable);
        command
            .args(["status", "--xml", "--depth", "empty"])
            .args(batch)
            .current_dir(root);

        let output = command.output().map_err(|error| {
            format!("执行 `{executable} status --xml` 检查提交目标失败：{error}")
        })?;
        if !output.status.success() {
            return Err(command_error_detail(executable, &output));
        }

        let xml = String::from_utf8_lossy(&output.stdout);
        let document = Document::parse(xml.as_ref())
            .map_err(|error| format!("解析提交目标 status XML 失败：{error}"))?;

        for entry in document
            .descendants()
            .filter(|node| node.has_tag_name("entry"))
        {
            let path = entry.attribute("path").unwrap_or("").trim();
            if path.is_empty() {
                continue;
            }
            let item = entry
                .descendants()
                .find(|node| node.has_tag_name("wc-status"))
                .and_then(|node| node.attribute("item"))
                .unwrap_or("");
            let Some(original) = match_commit_file_path(files, path, &root_normalized) else {
                continue;
            };
            observed.insert(original.clone());
            let matching_statuses = match item {
                "unversioned" | "untracked" => &mut statuses.unversioned,
                "missing" => &mut statuses.missing,
                _ => continue,
            };
            if !matching_statuses
                .iter()
                .any(|existing: &String| existing == &original)
            {
                matching_statuses.push(original);
            }
        }
    }
    // SVN omits an explicit file from status XML when one of its ancestors is unversioned.
    // Existing requested paths without any status entry still need `svn add --parents`.
    // Do not apply this to parent-directory probes: a versioned, unchanged directory also
    // has no status entry, and treating it as unversioned would `svn commit` the directory
    // (default depth infinity) and drag in unrelated local modifications.
    if infer_unobserved_existing {
        for file in files {
            if !observed.contains(file)
                && fs::symlink_metadata(root.join(file)).is_ok()
                && !statuses.unversioned.iter().any(|path| path == file)
            {
                statuses.unversioned.push(file.clone());
            }
        }
    }
    Ok(statuses)
}

/// Return unique non-root parent paths needed when `svn add --parents` schedules new directories.
fn commit_parent_paths(paths: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut parents = Vec::new();
    for path in paths {
        let mut current = Path::new(path).parent().map(Path::to_path_buf);
        while let Some(parent) = current {
            if parent.as_os_str().is_empty() || parent == Path::new(".") {
                break;
            }
            let parent_path = parent.to_string_lossy().into_owned();
            if seen.insert(parent_path.clone()) {
                parents.push(parent_path);
            }
            current = parent.parent().map(Path::to_path_buf);
        }
    }
    parents
}

/// Split paths into argv-safe batches for commands that cannot use `--targets`.
fn chunk_paths_for_svn_status_argv(paths: &[String]) -> Vec<&[String]> {
    if paths.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    let mut used_bytes = 0_usize;
    for (index, path) in paths.iter().enumerate() {
        // +1 approximates the separator/quoting overhead per argument.
        let path_bytes = path.len().saturating_add(1);
        if index > start && used_bytes.saturating_add(path_bytes) > SVN_STATUS_PATH_ARGV_MAX_BYTES {
            chunks.push(&paths[start..index]);
            start = index;
            used_bytes = 0;
        }
        used_bytes = used_bytes.saturating_add(path_bytes);
    }
    if start < paths.len() {
        chunks.push(&paths[start..]);
    }
    chunks
}

/// Temporary file listing one SVN target path per line for `svn --targets`.
///
/// Keeps large multi-path operations under Windows CreateProcess limits
/// (command line / path length errors such as os error 206).
#[derive(Debug)]
struct SvnTargetsFile {
    path: PathBuf,
}

impl SvnTargetsFile {
    fn create(task_id: &str, purpose: &str, paths: &[String]) -> Result<Self, String> {
        if paths.is_empty() {
            return Err("SVN targets 列表不能为空。".to_string());
        }

        let directory = std::env::temp_dir();
        let safe_task = sanitize_patch_file_part(task_id);
        let safe_purpose = sanitize_patch_file_part(purpose);
        for _ in 0..128 {
            let nonce = SVN_TARGETS_FILE_NONCE.fetch_add(1, Ordering::Relaxed);
            let name = format!(
                "novasvn-svn-targets-{}-{}-{}-{nonce}.txt",
                std::process::id(),
                safe_task,
                safe_purpose
            );
            let path = directory.join(name);
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = match options.open(&path) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!(
                        "无法创建 SVN targets 临时文件 `{}`：{error}",
                        path.display()
                    ));
                }
            };

            // One path per line, UTF-8. Keep WC-relative paths as provided by the caller.
            let mut content = String::with_capacity(paths.iter().map(|path| path.len() + 1).sum());
            for path in paths {
                content.push_str(path);
                content.push('\n');
            }
            if let Err(error) = file.write_all(content.as_bytes()) {
                drop(file);
                let _ = fs::remove_file(&path);
                return Err(format!(
                    "无法写入 SVN targets 临时文件 `{}`：{error}",
                    path.display()
                ));
            }
            drop(file);
            return Ok(Self { path });
        }

        Err(format!(
            "无法创建唯一的 SVN targets 临时文件（目录：{}）",
            directory.display()
        ))
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for SvnTargetsFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Compact path list for task logs so huge selections do not bloat history.
fn format_paths_for_task_log(paths: &[String]) -> String {
    const MAX_LISTED: usize = 20;
    if paths.len() <= MAX_LISTED {
        return paths.join(", ");
    }
    let listed = paths[..MAX_LISTED].join(", ");
    format!("{listed} …（共 {} 个）", paths.len())
}

/// Map a status XML path (relative or absolute) back to a path from the commit request.
fn match_commit_file_path(
    files: &[String],
    status_path: &str,
    root_normalized: &str,
) -> Option<String> {
    let mut normalized = normalize_status_path(status_path);
    // Strip working-copy root prefix when svn reports absolute paths.
    if !root_normalized.is_empty() {
        if let Some(stripped) = normalized
            .strip_prefix(root_normalized)
            .map(|value| value.trim_start_matches('/'))
        {
            if !stripped.is_empty() {
                normalized = stripped.to_string();
            }
        }
    }

    for file in files {
        let candidate = normalize_status_path(file);
        if candidate == normalized
            || candidate.ends_with(&format!("/{normalized}"))
            || normalized.ends_with(&format!("/{candidate}"))
        {
            return Some(file.clone());
        }
    }
    None
}

fn normalize_status_path(path: &str) -> String {
    path.trim()
        .trim_start_matches("./")
        .replace('\\', "/")
        .trim_matches('/')
        .to_string()
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
    let mut command = svn::command(&payload.svn_executable);
    let stream_update_output = matches!(
        &payload.kind,
        SvnOperationKind::Update | SvnOperationKind::UpdatePath
    );
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
            if let Err(error) = validate_add_target(&payload.svn_executable, &root, file_path) {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "Add 安全校验失败",
                    Some(nova_error_text(&error)),
                );
                return;
            }
            command.arg("add").arg("--parents").arg(file_path);
            append_task_log(state, task_id, &format!("执行 svn add：{file_path}"));
        }
        SvnOperationKind::UnaddFile => {
            let Some(file_path) = payload.file_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "Unadd 执行失败",
                    Some("缺少要 unadd 的文件路径。".to_string()),
                );
                return;
            };
            if let Err(error) = validate_unadd_target(&payload.svn_executable, &root, file_path) {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "Unadd 安全校验失败",
                    Some(nova_error_text(&error)),
                );
                return;
            }
            command.arg("revert").arg(root.join(file_path));
            append_task_log(
                state,
                task_id,
                &format!("执行 svn revert（Unadd）：{file_path}"),
            );
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
            // SVN CLI 只能接收路径，无法绑定已校验句柄；最终复检必须紧邻命令启动。
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
        SvnOperationKind::DeleteUnversionedFile => {
            let Some(file_path) = payload.file_path.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "删除未版本控制文件失败",
                    Some("缺少要删除的文件路径。".to_string()),
                );
                return;
            };
            let Some(expected_identity) = payload.unversioned_file_identity.as_deref() else {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "删除未版本控制文件失败",
                    Some("删除任务缺少文件身份快照。".to_string()),
                );
                return;
            };
            let current_identity = match validate_unversioned_file_delete_target(
                &payload.svn_executable,
                &root,
                file_path,
            ) {
                Ok(identity) => identity,
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "删除未版本控制文件安全校验失败",
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
                    "未版本控制文件已发生变化",
                    Some(format!(
                        "排队时：{} 字节 / {}；当前：{} 字节 / {}",
                        expected_identity.bytes,
                        expected_identity.sha256,
                        current_identity.bytes,
                        current_identity.sha256
                    )),
                );
                return;
            }
            if let Err(error) = fs::remove_file(&current_identity.canonical_path) {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "删除未版本控制文件失败",
                    Some(format!(
                        "删除 `{}` 失败：{error}",
                        current_identity.canonical_path.display()
                    )),
                );
                return;
            }
            append_task_log(
                state,
                task_id,
                &format!("从磁盘删除未版本控制文件：{file_path}"),
            );
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "未版本控制文件已删除",
                None,
            );
            return;
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

    let command_result = if stream_update_output {
        run_task_command_streaming_output(state, task_id, &mut command)
    } else {
        run_task_command(state, task_id, &mut command)
    };
    match command_result {
        Ok(output) if output.status.success() => {
            if !stream_update_output {
                append_command_output(state, task_id, &output);
            }
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "SVN 操作执行成功",
                None,
            );
        }
        Ok(output) => {
            if !stream_update_output {
                append_command_output(state, task_id, &output);
            }
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
    let mut command = svn::command(&payload.svn_executable);
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

            // 批量目标同样无法原子绑定句柄，完成整组复检后不得插入其他外部操作。
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

    match run_task_command(state, task_id, &mut command) {
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
    let mut command = svn::command(&executable);

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

    match run_task_command(state, task_id, &mut command) {
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
    let mut revert_command = svn::command(&executable);
    revert_command
        .arg("revert")
        .arg("-R")
        .arg(&shadow_path)
        .current_dir(&shadow_path);
    let revert_output = run_task_command(state, task_id, &mut revert_command);
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
    let mut patch_command = svn_patch_command(&executable, false, &patch_path, &shadow_path);
    let patch_output = run_task_command(state, task_id, &mut patch_command);
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
    let mut commit = svn::command(&executable);
    commit.arg("commit");
    for file in &payload.files {
        commit.arg(shadow_path.join(file));
    }
    commit
        .arg("-m")
        .arg(&payload.message)
        .current_dir(&shadow_path);

    match run_task_command(state, task_id, &mut commit) {
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
    let revision_label = payload.revision.as_deref().unwrap_or("HEAD");
    append_task_log(
        state,
        task_id,
        &format!("执行 svn list --xml -r {revision_label}：{}", payload.url),
    );

    let mut command = svn::command(&payload.svn_executable);
    command.args(["list", "--xml"]);
    if let Some(revision) = payload.revision.as_deref() {
        command.args(["-r", revision]);
    }
    let command_target =
        repository_url_with_peg_revision(&payload.url, payload.revision.as_deref());
    let (output_file, writer) =
        match TaskCommandOutputFile::create(task_id, "repository-list", "xml") {
            Ok(output_file) => output_file,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "创建仓库目录输出文件失败",
                    Some(error.to_string()),
                );
                return;
            }
        };
    command
        .arg(command_target)
        .stdout(std::process::Stdio::from(writer));
    let output = run_task_command_with_configured_stdout(state, task_id, &mut command);

    match output {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            let reader = match output_file.open_reader(MAX_REPOSITORY_LIST_XML_BYTES) {
                Ok(reader) => reader,
                Err(error) => {
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "读取仓库目录输出失败",
                        Some(error.to_string()),
                    );
                    return;
                }
            };
            match parse_repository_list_xml_reader(
                reader,
                &payload.url,
                payload.revision.as_deref(),
            ) {
                Ok(result) => {
                    let count = result.entries.len();
                    set_task_result(
                        state,
                        task_id,
                        TaskResult {
                            repository_list: Some(result),
                            repository_file: None,
                            repository_export: None,
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
                        Some(nova_error_text(&error)),
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

struct TaskCommandOutputFile {
    path: PathBuf,
}

impl TaskCommandOutputFile {
    fn create(task_id: &str, purpose: &str, extension: &str) -> std::io::Result<(Self, fs::File)> {
        let directory = std::env::temp_dir();
        fs::create_dir_all(&directory)?;
        for _ in 0..128 {
            let nonce = TASK_COMMAND_OUTPUT_NONCE.fetch_add(1, Ordering::Relaxed);
            let file_name = format!(
                "novasvn-{purpose}-{}-{}-{nonce}.{extension}",
                std::process::id(),
                sanitize_patch_file_part(task_id)
            );
            let path = directory.join(file_name);
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            match options.open(&path) {
                Ok(file) => return Ok((Self { path }, file)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }

        Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "无法创建唯一的命令输出临时文件",
        ))
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn open_reader(&self, max_bytes: u64) -> std::io::Result<BufReader<fs::File>> {
        let file = fs::File::open(&self.path)?;
        let bytes = file.metadata()?.len();
        if bytes > max_bytes {
            return Err(std::io::Error::new(
                std::io::ErrorKind::FileTooLarge,
                format!("命令输出文件超过安全上限 {max_bytes} 字节，实际 {bytes} 字节"),
            ));
        }
        Ok(BufReader::new(file))
    }
}

impl Drop for TaskCommandOutputFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Debug)]
struct ApplyPatchCommandResult {
    status: ExitStatus,
    analysis: ApplyPatchOutputAnalysis,
}

fn run_apply_patch_command(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    command: &mut Command,
) -> Result<ApplyPatchCommandResult, NovaError> {
    let (stdout_file, stdout_writer) =
        TaskCommandOutputFile::create(task_id, "patch-stdout", "log").map_err(|error| {
            NovaError::command(
                "APPLY_PATCH_OUTPUT_CREATE_FAILED",
                "无法创建 Patch stdout 临时文件",
                Some(error.to_string()),
                true,
            )
        })?;
    let (stderr_file, stderr_writer) =
        TaskCommandOutputFile::create(task_id, "patch-stderr", "log").map_err(|error| {
            NovaError::command(
                "APPLY_PATCH_OUTPUT_CREATE_FAILED",
                "无法创建 Patch stderr 临时文件",
                Some(error.to_string()),
                true,
            )
        })?;
    command
        .stdout(Stdio::from(stdout_writer))
        .stderr(Stdio::from(stderr_writer));
    let output =
        run_task_command_with_configured_streams(state, task_id, command).map_err(|error| {
            NovaError::command(
                "APPLY_PATCH_COMMAND_FAILED",
                "无法执行 SVN Patch 命令",
                Some(error.to_string()),
                true,
            )
        })?;
    let analysis = analyze_apply_patch_output_files(&stdout_file, &stderr_file)?;
    Ok(ApplyPatchCommandResult {
        status: output.status,
        analysis,
    })
}

#[derive(Debug)]
struct MergeCommandResult {
    status: ExitStatus,
    analysis: MergeOutputAnalysis,
}

fn run_merge_command(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    command: &mut Command,
) -> Result<MergeCommandResult, NovaError> {
    let (stdout_file, stdout_writer) =
        TaskCommandOutputFile::create(task_id, "merge-stdout", "log").map_err(|error| {
            NovaError::command(
                "MERGE_OUTPUT_CREATE_FAILED",
                "无法创建 Merge stdout 临时文件",
                Some(error.to_string()),
                true,
            )
        })?;
    let (stderr_file, stderr_writer) =
        TaskCommandOutputFile::create(task_id, "merge-stderr", "log").map_err(|error| {
            NovaError::command(
                "MERGE_OUTPUT_CREATE_FAILED",
                "无法创建 Merge stderr 临时文件",
                Some(error.to_string()),
                true,
            )
        })?;
    command
        .stdout(Stdio::from(stdout_writer))
        .stderr(Stdio::from(stderr_writer));
    let output =
        run_task_command_with_configured_streams(state, task_id, command).map_err(|error| {
            NovaError::command(
                "MERGE_COMMAND_FAILED",
                "无法执行 SVN Merge 命令",
                Some(error.to_string()),
                true,
            )
        })?;
    let analysis = analyze_merge_output_files(&stdout_file, &stderr_file)?;
    Ok(MergeCommandResult {
        status: output.status,
        analysis,
    })
}

fn append_merge_analysis_logs(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    analysis: &MergeOutputAnalysis,
) {
    for line in &analysis.status_lines {
        append_task_log(state, task_id, line);
    }
    if analysis.log_truncated {
        append_task_log(
            state,
            task_id,
            &format!(
                "Merge 命令输出日志已截断（最多 {} 字节、{} 行）",
                MAX_RUNTIME_TASK_LOG_BYTES, MAX_RUNTIME_TASK_LOGS
            ),
        );
    }
}

fn merge_analysis_error_detail(analysis: &MergeOutputAnalysis) -> String {
    if analysis.output_text.trim().is_empty() {
        return "svn merge 返回失败，但没有输出。".to_string();
    }
    bounded_text_preview(
        analysis.output_text.clone(),
        MAX_RUNTIME_TASK_LOG_BYTES,
        "Merge 错误输出已截断",
    )
}

fn run_repository_file_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryFileTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "仓库文件开始下载",
        None,
    );
    let revision_label = payload.revision.as_deref().unwrap_or("HEAD");
    append_task_log(
        state,
        task_id,
        &format!("执行 svn cat -r {revision_label}：{}", payload.url),
    );

    if let Err(error) = fs::create_dir_all(&payload.output_dir) {
        update_task(
            state,
            task_id,
            TaskStatus::Failed,
            "仓库文件临时目录创建失败",
            Some(format!(
                "路径：{}；错误：{error}",
                payload.output_dir.display()
            )),
        );
        return;
    }
    let output_dir = match normalize_repository_output_dir(&payload.output_dir) {
        Ok(output_dir) => output_dir,
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "仓库文件临时目录校验失败",
                Some(error.to_string()),
            );
            return;
        }
    };
    let (file, file_path, file_name) =
        match create_repository_temp_file(&output_dir, &payload.url, task_id) {
            Ok(result) => result,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "仓库临时文件创建失败",
                    Some(error.to_string()),
                );
                return;
            }
        };

    let mut command = svn::command(&payload.svn_executable);
    command.arg("cat");
    if let Some(revision) = payload.revision.as_deref() {
        command.args(["-r", revision]);
    }
    let command_target =
        repository_url_with_peg_revision(&payload.url, payload.revision.as_deref());
    command
        .arg(command_target)
        .stdout(std::process::Stdio::from(file));
    let output = run_task_command_with_configured_stdout(state, task_id, &mut command);
    match output {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            let bytes = match file_path.metadata() {
                Ok(metadata) => metadata.len(),
                Err(error) => {
                    fs::remove_file(&file_path).ok();
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "仓库临时文件校验失败",
                        Some(format!("路径：{}；错误：{error}", file_path.display())),
                    );
                    return;
                }
            };
            set_task_result(
                state,
                task_id,
                TaskResult {
                    repository_list: None,
                    repository_file: Some(RepositoryFileResult {
                        url: payload.url,
                        revision: payload.revision,
                        file_path: file_path.display().to_string(),
                        file_name,
                        bytes,
                    }),
                    repository_export: None,
                    revision_diff: None,
                    merge_result: None,
                    apply_patch_result: None,
                },
            );
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                &format!("仓库文件已下载，{bytes} 字节"),
                None,
            );
        }
        Ok(output) => {
            fs::remove_file(&file_path).ok();
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "仓库文件下载失败",
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            fs::remove_file(&file_path).ok();
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN cat 启动失败",
                Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            );
        }
    }
}

fn repository_temp_file_name(url: &str, task_id: &str) -> String {
    let raw_name = url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("repository-file");
    let (raw_stem, raw_extension) = raw_name
        .rsplit_once('.')
        .filter(|(stem, extension)| !stem.is_empty() && !extension.is_empty())
        .map_or((raw_name, None), |(stem, extension)| {
            (stem, Some(extension))
        });
    let stem = sanitize_patch_file_part(raw_stem);
    let stem = if stem == "diff" {
        "repository-file".to_string()
    } else {
        stem
    };
    let extension = raw_extension
        .map(|value| {
            value
                .chars()
                .filter(char::is_ascii_alphanumeric)
                .take(32)
                .collect::<String>()
        })
        .filter(|value| !value.is_empty())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let name = format!("{stem}{extension}");
    format!("{}-{name}", sanitize_patch_file_part(task_id))
}

pub(crate) fn repository_url_with_peg_revision(url: &str, revision: Option<&str>) -> String {
    match revision {
        Some(revision) => format!("{url}@{revision}"),
        None if url.contains('@') => format!("{url}@"),
        None => url.to_string(),
    }
}

fn normalize_repository_output_dir(output_dir: &Path) -> Result<PathBuf, NovaError> {
    let parent = output_dir.parent().ok_or_else(|| {
        NovaError::command(
            "REPOSITORY_FILE_DIR_INVALID",
            "仓库文件临时目录无效",
            Some(format!("路径：{}", output_dir.display())),
            true,
        )
    })?;
    let canonical_parent = parent.canonicalize().map_err(|error| {
        NovaError::command(
            "REPOSITORY_FILE_DIR_INVALID",
            "仓库文件临时目录不可用",
            Some(format!("路径：{}；错误：{error}", parent.display())),
            true,
        )
    })?;
    let canonical_output_dir = output_dir.canonicalize().map_err(|error| {
        NovaError::command(
            "REPOSITORY_FILE_DIR_INVALID",
            "仓库文件临时目录不可用",
            Some(format!("路径：{}；错误：{error}", output_dir.display())),
            true,
        )
    })?;
    if !canonical_output_dir.starts_with(&canonical_parent) {
        return Err(NovaError::command(
            "REPOSITORY_FILE_DIR_OUTSIDE_APP_DATA",
            "仓库文件临时目录越界",
            Some(format!("解析后的路径：{}", canonical_output_dir.display())),
            true,
        ));
    }
    Ok(canonical_output_dir)
}

fn create_repository_temp_file(
    output_dir: &Path,
    url: &str,
    task_id: &str,
) -> Result<(fs::File, PathBuf, String), NovaError> {
    let base_name = repository_temp_file_name(url, task_id);
    for attempt in 0..100u8 {
        let file_name = if attempt == 0 {
            base_name.clone()
        } else if let Some((stem, extension)) = base_name.rsplit_once('.') {
            format!("{stem}-{attempt}.{extension}")
        } else {
            format!("{base_name}-{attempt}")
        };
        let file_path = output_dir.join(&file_name);
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        match options.open(&file_path) {
            Ok(file) => return Ok((file, file_path, file_name)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(NovaError::command(
                    "REPOSITORY_TEMP_FILE_CREATE_FAILED",
                    "无法创建仓库文件临时副本",
                    Some(format!("路径：{}；错误：{error}", file_path.display())),
                    true,
                ));
            }
        }
    }

    Err(NovaError::command(
        "REPOSITORY_TEMP_FILE_CREATE_FAILED",
        "无法创建唯一的仓库文件临时副本",
        Some(format!("目录：{}", output_dir.display())),
        true,
    ))
}

fn run_repository_copy_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryCopyTaskPayload,
) {
    let title = match payload.kind {
        RepositoryCopyKind::Branch => "创建分支",
        RepositoryCopyKind::Tag => "创建标签",
        RepositoryCopyKind::Entry => "复制仓库条目",
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

    let source = repository_url_with_peg_revision(&payload.source_url, payload.revision.as_deref());
    let target = repository_url_with_peg_revision(&payload.target_url, None);
    let mut command = svn::command(&payload.svn_executable);
    command.arg("copy");
    if let Some(revision) = payload.revision.as_deref() {
        command.arg("-r").arg(revision);
    }
    command
        .arg("-m")
        .arg(&payload.message)
        .arg("--")
        .arg(source)
        .arg(target);

    match run_task_command(state, task_id, &mut command) {
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
                Some(repository_write_command_error_detail(
                    &payload.svn_executable,
                    &output,
                )),
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

fn run_repository_mkdir_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryMkdirTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "创建仓库目录开始执行",
        None,
    );
    append_task_log(state, task_id, &format!("执行 svn mkdir：{}", payload.url));

    let target = repository_url_with_peg_revision(&payload.url, None);
    let mut command = svn::command(&payload.svn_executable);
    command
        .arg("mkdir")
        .arg("-m")
        .arg(&payload.message)
        .arg("--")
        .arg(target);
    let output = run_task_command(state, task_id, &mut command);

    match output {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "创建仓库目录成功",
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "创建仓库目录失败",
                Some(repository_write_command_error_detail(
                    &payload.svn_executable,
                    &output,
                )),
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

fn run_repository_import_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryImportTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "Repository Import 开始执行",
        None,
    );
    if let Err(error) = validate_repository_import_source(Path::new(&payload.source_path)) {
        update_task(
            state,
            task_id,
            TaskStatus::Failed,
            "Repository Import 本地源不可用",
            Some(error.to_string()),
        );
        return;
    }
    append_task_log(
        state,
        task_id,
        &format!(
            "执行 svn import：{} -> {}",
            payload.source_path, payload.target_url
        ),
    );

    let target = repository_url_with_peg_revision(&payload.target_url, None);
    let mut command = svn::command(&payload.svn_executable);
    command
        .arg("import")
        .arg("-m")
        .arg(&payload.message)
        .arg("--")
        .arg(&payload.source_path)
        .arg(target);
    let output = run_task_command(state, task_id, &mut command);

    match output {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "Repository Import 成功",
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "Repository Import 失败",
                Some(repository_write_command_error_detail(
                    &payload.svn_executable,
                    &output,
                )),
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

fn run_repository_move_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryMoveTaskPayload,
) {
    let operation = match payload.kind {
        RepositoryMoveKind::Move => "Repository Move",
        RepositoryMoveKind::Rename => "Repository Rename",
    };
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        &format!("{operation} 开始执行"),
        None,
    );
    append_task_log(
        state,
        task_id,
        &format!(
            "执行 svn move：{} -> {}",
            payload.source_url, payload.target_url
        ),
    );

    let source = repository_url_with_peg_revision(&payload.source_url, None);
    let target = repository_url_with_peg_revision(&payload.target_url, None);
    let mut command = svn::command(&payload.svn_executable);
    command
        .arg("move")
        .arg("-m")
        .arg(&payload.message)
        .arg("--")
        .arg(source)
        .arg(target);
    let output = run_task_command(state, task_id, &mut command);

    match output {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                &format!("{operation} 成功"),
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                &format!("{operation} 失败"),
                Some(repository_write_command_error_detail(
                    &payload.svn_executable,
                    &output,
                )),
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

fn run_repository_delete_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryDeleteTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "Repository Delete 开始执行",
        None,
    );
    append_task_log(state, task_id, &format!("执行 svn delete：{}", payload.url));

    let target = repository_url_with_peg_revision(&payload.url, None);
    let mut command = svn::command(&payload.svn_executable);
    command
        .arg("delete")
        .arg("-m")
        .arg(&payload.message)
        .arg("--")
        .arg(target);
    let output = run_task_command(state, task_id, &mut command);

    match output {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "Repository Delete 成功",
                None,
            );
        }
        Ok(output) => {
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "Repository Delete 失败",
                Some(repository_write_command_error_detail(
                    &payload.svn_executable,
                    &output,
                )),
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

    let mut command = svn::command(&payload.svn_executable);
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
            let command_target = payload
                .file_path
                .as_deref()
                .map(|file_path| Path::new(root).join(file_path))
                .unwrap_or_else(|| PathBuf::from(root));
            command.arg("-r").arg(revision).arg(&command_target);
            payload
                .file_path
                .as_deref()
                .map(|file_path| format!("{file_path} ↔ r{revision}"))
                .unwrap_or_else(|| format!("{root} ↔ r{revision}"))
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

    let (output_file, writer) =
        match TaskCommandOutputFile::create(task_id, "revision-diff", "patch") {
            Ok(output_file) => output_file,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "创建 Revision diff 输出文件失败",
                    Some(error.to_string()),
                );
                return;
            }
        };
    command.stdout(std::process::Stdio::from(writer));
    match run_task_command_with_configured_stdout(state, task_id, &mut command) {
        Ok(output) if output.status.success() => {
            append_stream_lines(state, task_id, &String::from_utf8_lossy(&output.stderr));
            let analysis = match analyze_revision_diff_file(output_file.path()) {
                Ok(analysis) => analysis,
                Err(error) => {
                    let error = nova_error_message(&error);
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "Revision diff 输出分析失败",
                        Some(error),
                    );
                    return;
                }
            };
            let patch_file = match copy_revision_diff_patch(
                &payload,
                task_id,
                &target,
                output_file.path(),
                analysis.total_bytes,
            ) {
                Ok(patch_file) => patch_file,
                Err(error) if analysis.truncated => {
                    let error = nova_error_message(&error);
                    append_task_log(state, task_id, &format!("完整 patch 文件写入失败：{error}"));
                    update_task(
                        state,
                        task_id,
                        TaskStatus::Failed,
                        "Revision diff 完整 Patch 写入失败",
                        Some(error),
                    );
                    return;
                }
                Err(error) => {
                    append_task_log(
                        state,
                        task_id,
                        &format!("完整 patch 文件写入失败：{}", nova_error_message(&error)),
                    );
                    None
                }
            };
            let result = RevisionDiffResult {
                mode: revision_diff_mode_label(&payload.mode).to_string(),
                target,
                diff_text: analysis.preview_text,
                file_count: analysis.file_count,
                line_count: analysis.line_count,
                truncated: analysis.truncated,
                max_bytes: REVISION_DIFF_PREVIEW_MAX_BYTES,
                patch_file_path: patch_file
                    .as_ref()
                    .map(|file| file.path.display().to_string()),
                patch_file_dir: patch_file
                    .as_ref()
                    .map(|file| file.dir.display().to_string()),
                patch_file_name: patch_file.map(|file| file.name),
            };
            if analysis.truncated {
                append_task_log(
                    state,
                    task_id,
                    &format!(
                        "Diff 输出超过 {} 字节，界面仅保留预览片段",
                        REVISION_DIFF_PREVIEW_MAX_BYTES
                    ),
                );
            }
            if analysis.total_bytes > 0 {
                if let Some(path) = result.patch_file_path.as_deref() {
                    append_task_log(state, task_id, &format!("完整 patch 已保存：{path}"));
                }
            }
            set_task_result(
                state,
                task_id,
                TaskResult {
                    repository_list: None,
                    repository_file: None,
                    repository_export: None,
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
                    "Revision diff 完成，{file_count} 个文件，{line_count} 行{suffix}",
                    file_count = analysis.file_count,
                    line_count = analysis.line_count,
                    suffix = if analysis.truncated {
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

fn run_revert_revision_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RevertRevisionTaskPayload,
) {
    let target_is_root = Path::new(&payload.target_path) == Path::new(&payload.working_copy_root);
    let is_batch = payload.target_revisions.len() > 1;
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        if payload.whole_workspace {
            if target_is_root {
                "回退工作区开始执行"
            } else {
                "回退目标开始执行"
            }
        } else if is_batch {
            "批量撤销 Revision 开始执行"
        } else {
            "撤销单次提交开始执行"
        },
        None,
    );

    match execute_revert_revision(state, task_id, &payload) {
        Ok((output, source_url)) => {
            append_task_log(
                state,
                task_id,
                &format!(
                    "执行 {}：{}",
                    if payload.whole_workspace {
                        format!(
                            "svn merge --ignore-ancestry --allow-mixed-revisions -r HEAD:{}",
                            payload.target_revisions[0]
                        )
                    } else {
                        format!(
                            "svn merge --ignore-ancestry --allow-mixed-revisions -c -{}",
                            payload.target_revisions.join(",-")
                        )
                    },
                    source_url,
                ),
            );
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                if payload.whole_workspace {
                    if target_is_root {
                        "工作区已回退并生成本地改动"
                    } else {
                        "目标已回退并生成本地改动"
                    }
                } else if is_batch {
                    "选中的 Revision 已批量撤销并生成本地改动"
                } else {
                    "单次提交已撤销并生成本地改动"
                },
                None,
            );
        }
        Err(error) => {
            let error = nova_error_message(&error);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                if payload.whole_workspace {
                    if target_is_root {
                        "回退工作区失败"
                    } else {
                        "回退目标失败"
                    }
                } else if is_batch {
                    "批量撤销 Revision 失败"
                } else {
                    "撤销单次提交失败"
                },
                Some(error),
            );
        }
    }
}

fn nova_error_message(error: &NovaError) -> String {
    match error {
        NovaError::Command {
            message, detail, ..
        } => detail
            .as_ref()
            .map(|detail| format!("{message}：{detail}"))
            .unwrap_or_else(|| message.clone()),
    }
}

fn execute_revert_revision(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: &RevertRevisionTaskPayload,
) -> Result<(std::process::Output, String), NovaError> {
    let root = PathBuf::from(&payload.working_copy_root);
    let target = normalize_revert_target_path(&root, Some(&payload.target_path))?;

    let target_revision = payload.target_revisions.first().ok_or_else(|| {
        NovaError::command(
            "REVERT_REVISION_TARGET_REQUIRED",
            "请选择要撤销的 Revision",
            None,
            true,
        )
    })?;

    let source_url = match payload.source_url.as_deref() {
        Some(source_url) => source_url.to_string(),
        None => {
            let source_url =
                read_revert_revision_info_item(&payload.svn_executable, &target, "url")?;
            normalize_repository_url(&source_url)?
        }
    };
    let source_url = format!("{source_url}@HEAD");
    let mut command = svn::command(&payload.svn_executable);
    command
        .arg("merge")
        .args(["--ignore-ancestry", "--allow-mixed-revisions"]);
    if payload.whole_workspace {
        command.arg("-r").arg(format!("HEAD:{target_revision}"));
    } else {
        command
            .arg("-c")
            .arg(format!("-{}", payload.target_revisions.join(",-")));
    }
    command.arg(&source_url).arg(&target).current_dir(&root);
    let output = run_task_command(state, task_id, &mut command).map_err(|error| {
        NovaError::command(
            "REVERT_REVISION_COMMAND_FAILED",
            if payload.whole_workspace {
                "无法启动回退到指定版本命令"
            } else {
                "无法启动撤销单次提交命令"
            },
            Some(format!("无法执行 `{}`：{error}", payload.svn_executable)),
            true,
        )
    })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "REVERT_REVISION_FAILED",
            if payload.whole_workspace {
                "回退到指定版本命令执行失败"
            } else {
                "撤销单次提交命令执行失败"
            },
            Some(command_error_detail(&payload.svn_executable, &output)),
            true,
        ));
    }

    Ok((output, source_url))
}

fn read_revert_revision_info_item(
    executable: &str,
    root: &Path,
    item: &str,
) -> Result<String, NovaError> {
    let mut command = svn::command(executable);
    command.args(["info", "--show-item", item]);
    let output = command.arg(root).output().map_err(|error| {
        NovaError::command(
            "REVERT_REVISION_INFO_FAILED",
            "无法读取版本回退所需的 SVN 信息",
            Some(format!(
                "无法执行 `{executable} info --show-item {item}`：{error}"
            )),
            true,
        )
    })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "REVERT_REVISION_INFO_FAILED",
            "无法读取版本回退所需的 SVN 信息",
            Some(command_error_detail(executable, &output)),
            true,
        ));
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        return Err(NovaError::command(
            "REVERT_REVISION_INFO_EMPTY",
            "版本回退所需的 SVN 信息为空",
            Some(format!("字段：{item}")),
            true,
        ));
    }
    Ok(value)
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

    if payload.dry_run && payload.app.is_some() {
        run_merge_preview_task(state, task_id, payload);
        return;
    }

    let root = PathBuf::from(&payload.working_copy_root);
    let target_check = if payload.dry_run || payload.allow_local_changes {
        merge_workspace_has_local_changes(&payload.svn_executable, &root).map(|dirty| {
            if dirty {
                append_task_log(
                    state,
                    task_id,
                    if payload.dry_run {
                        "当前工作副本存在本地改动，dry-run 将继续生成预览"
                    } else {
                        "当前工作副本存在本地改动，Merge 将与现有改动叠加"
                    },
                );
            }
            true
        })
    } else if let Some(expected) = payload.expected_snapshot_digest.as_deref() {
        merge_preview::workspace_snapshot_digest(&payload.svn_executable, &root)
            .map(|current| current == expected)
    } else {
        merge_workspace_has_local_changes(&payload.svn_executable, &root).map(|dirty| !dirty)
    };
    match target_check {
        Ok(false) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "Merge 执行前检查未通过",
                Some(if payload.expected_snapshot_digest.is_some() {
                    "目标工作副本在生成预览后发生变化；请重新生成 Merge 预览。".to_string()
                } else {
                    "当前工作副本在任务等待期间出现了本地改动；请提交或清理后重新执行 Merge。"
                        .to_string()
                }),
            );
            return;
        }
        Ok(true) => {
            append_task_log(state, task_id, "执行前工作副本状态复检通过");
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "Merge 执行前检查失败",
                Some(nova_error_text(&error)),
            );
            return;
        }
    }

    let mut command = svn::command(&payload.svn_executable);
    command.arg("merge");
    for argument in merge_revision_arguments(
        &payload.start_revision,
        &payload.end_revision,
        &payload.revisions,
    ) {
        command.arg(argument);
    }
    if payload.dry_run {
        command.arg("--dry-run");
    }
    if payload.record_only {
        command.arg("--record-only");
    }
    if payload.ignore_ancestry {
        command.arg("--ignore-ancestry");
    }
    if payload.force {
        command.arg("--force");
    }
    command
        .arg(&payload.source_url)
        .arg(&root)
        .current_dir(&root);
    append_task_log(
        state,
        task_id,
        &format!(
            "执行 svn merge{}{}{}{}：{}",
            if payload.dry_run { " --dry-run" } else { "" },
            if payload.record_only {
                " --record-only"
            } else {
                ""
            },
            if payload.ignore_ancestry {
                " --ignore-ancestry"
            } else {
                ""
            },
            if payload.force { " --force" } else { "" },
            payload.source_url
        ),
    );

    match run_merge_command(state, task_id, &mut command) {
        Ok(output) if output.status.success() => {
            append_merge_analysis_logs(state, task_id, &output.analysis);
            if output.analysis.output_truncated {
                append_task_log(
                    state,
                    task_id,
                    &format!(
                        "Merge 输出预览已截断（最多 {} 字节）",
                        MERGE_OUTPUT_PREVIEW_MAX_BYTES
                    ),
                );
            }
            let result = MergeResult {
                dry_run: payload.dry_run,
                source_url: payload.source_url.clone(),
                revision_range: merge_revision_label(
                    &payload.start_revision,
                    &payload.end_revision,
                    &payload.revisions,
                ),
                record_only: payload.record_only,
                ignore_ancestry: payload.ignore_ancestry,
                force: payload.force,
                output_truncated: output.analysis.output_truncated,
                max_output_bytes: MERGE_OUTPUT_PREVIEW_MAX_BYTES,
                file_count: output.analysis.summary.file_count,
                line_count: output.analysis.line_count,
                added: output.analysis.summary.added,
                deleted: output.analysis.summary.deleted,
                updated: output.analysis.summary.updated,
                conflicted: output.analysis.summary.conflicted,
                output_text: output.analysis.output_text.clone(),
                preview_id: None,
            };
            set_task_result(
                state,
                task_id,
                TaskResult {
                    repository_list: None,
                    repository_file: None,
                    repository_export: None,
                    revision_diff: None,
                    merge_result: Some(result),
                    apply_patch_result: None,
                },
            );
            update_task(state, task_id, TaskStatus::Success, "Merge 执行成功", None);
        }
        Ok(output) => {
            append_merge_analysis_logs(state, task_id, &output.analysis);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "Merge 执行失败",
                Some(merge_analysis_error_detail(&output.analysis)),
            );
        }
        Err(error) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "SVN merge 启动失败",
                Some(nova_error_text(&error)),
            );
        }
    }
}

fn run_merge_preview_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: MergeTaskPayload,
) {
    let Some(preview_id) = payload.preview_id.clone() else {
        update_task(
            state,
            task_id,
            TaskStatus::Failed,
            "Merge 预览初始化失败",
            Some("预览任务缺少会话标识。".to_string()),
        );
        return;
    };
    let root = PathBuf::from(&payload.working_copy_root);
    let result = build_merge_preview(state, task_id, &payload, &preview_id, &root);
    match result {
        Ok((session, analysis)) => {
            let result = MergeResult {
                dry_run: true,
                source_url: payload.source_url.clone(),
                revision_range: session.revision_range.clone(),
                record_only: payload.record_only,
                ignore_ancestry: payload.ignore_ancestry,
                force: payload.force,
                output_text: analysis.output_text.clone(),
                output_truncated: analysis.output_truncated,
                max_output_bytes: MERGE_OUTPUT_PREVIEW_MAX_BYTES,
                file_count: session.files.len(),
                line_count: analysis.line_count,
                added: session
                    .files
                    .iter()
                    .filter(|file| file.action == "A")
                    .count(),
                deleted: session
                    .files
                    .iter()
                    .filter(|file| file.action == "D")
                    .count(),
                updated: session
                    .files
                    .iter()
                    .filter(|file| !matches!(file.action.as_str(), "A" | "D" | "C"))
                    .count(),
                conflicted: session.files.iter().filter(|file| file.conflicted).count(),
                preview_id: Some(preview_id),
            };
            set_task_result(
                state,
                task_id,
                TaskResult {
                    repository_list: None,
                    repository_file: None,
                    repository_export: None,
                    revision_diff: None,
                    merge_result: Some(result),
                    apply_patch_result: None,
                },
            );
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "Merge 逐文件预览已生成",
                None,
            );
        }
        Err(error) => {
            if let Some(app) = payload.app.as_ref() {
                let _ = merge_preview::release_session(app, &preview_id);
            }
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "Merge 预览生成失败",
                Some(nova_error_text(&error)),
            );
        }
    }
}

fn build_merge_preview(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: &MergeTaskPayload,
    preview_id: &str,
    root: &Path,
) -> Result<(MergePreviewSession, MergeOutputAnalysis), NovaError> {
    append_task_log(state, task_id, "正在计算目标工作副本快照");
    let snapshot_digest =
        merge_preview_snapshot_digest(state, task_id, &payload.svn_executable, root)?;
    let (copy_root, target_relative_path) =
        merge_preview_copy_context_for_task(state, task_id, &payload.svn_executable, root)?;
    let app = payload.app.as_ref().ok_or_else(|| {
        NovaError::command(
            "MERGE_PREVIEW_APP_MISSING",
            "Merge 预览初始化失败",
            Some("缺少应用运行时。".to_string()),
            false,
        )
    })?;
    let session_directory = merge_preview::prepare_session_dir(app, preview_id, &copy_root)?;
    let work_directory = session_directory.join("work");
    append_task_log(state, task_id, "正在复制目标工作副本到隔离预览目录");
    merge_preview::copy_working_copy_with_cancel(&copy_root, &work_directory, || {
        task_cancellation_requested(state, task_id)
    })?;
    let preview_target = if target_relative_path.as_os_str().is_empty() {
        work_directory.clone()
    } else {
        work_directory.join(&target_relative_path)
    };
    let verified_digest =
        merge_preview_snapshot_digest(state, task_id, &payload.svn_executable, root)?;
    if verified_digest != snapshot_digest {
        return Err(merge_preview_stale_error());
    }

    append_task_log(state, task_id, "正在分析 Merge 影响文件");
    let mut dry_command = build_merge_command(payload, &preview_target, true);
    let dry_output = run_merge_command(state, task_id, &mut dry_command)?;
    if !dry_output.status.success() {
        return Err(NovaError::command(
            "MERGE_PREVIEW_DRY_RUN_FAILED",
            "Merge 预检失败",
            Some(merge_analysis_error_detail(&dry_output.analysis)),
            true,
        ));
    }
    let dry_paths = merge_output_path_entries(&dry_output.analysis, &preview_target);
    for path in dry_paths.keys() {
        let _ = merge_preview::save_original_file_with_cancel(
            &session_directory,
            &preview_target,
            path,
            || task_cancellation_requested(state, task_id),
        )?;
    }

    append_task_log(state, task_id, "正在隔离工作副本中执行 Merge");
    let mut merge_command = build_merge_command(payload, &preview_target, false);
    let output = run_merge_command(state, task_id, &mut merge_command)?;
    append_merge_analysis_logs(state, task_id, &output.analysis);
    if !output.status.success() {
        return Err(NovaError::command(
            "MERGE_PREVIEW_MERGE_FAILED",
            "隔离工作副本 Merge 失败",
            Some(merge_analysis_error_detail(&output.analysis)),
            true,
        ));
    }

    let mut paths = dry_paths;
    for (path, value) in merge_output_path_entries(&output.analysis, &preview_target) {
        if !paths.contains_key(&path) {
            let _ = merge_preview::save_original_file_with_cancel(
                &session_directory,
                root,
                &path,
                || task_cancellation_requested(state, task_id),
            )?;
        }
        paths
            .entry(path)
            .and_modify(|current| current.merge(&value))
            .or_insert(value);
    }
    let mut files = paths
        .into_iter()
        .map(|(path, status)| {
            if task_cancellation_requested(state, task_id) {
                return Err(NovaError::command(
                    "MERGE_PREVIEW_CANCELLED",
                    "Merge 预览已取消",
                    None,
                    true,
                ));
            }
            merge_preview::inspect_preview_file(
                &session_directory,
                &preview_target,
                &path,
                status.action,
                status.conflicted,
                status.property_only,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    files.sort_by(|left, right| left.path.cmp(&right.path));
    let final_digest =
        merge_preview_snapshot_digest(state, task_id, &payload.svn_executable, root)?;
    if final_digest != snapshot_digest {
        return Err(merge_preview_stale_error());
    }
    let created_at = timestamp_millis();
    let session = MergePreviewSession {
        preview_id: preview_id.to_string(),
        working_copy_root: payload.working_copy_root.clone(),
        target_relative_path: target_relative_path.to_string_lossy().replace('\\', "/"),
        source_url: payload.source_url.clone(),
        revision_range: merge_revision_label(
            &payload.start_revision,
            &payload.end_revision,
            &payload.revisions,
        ),
        start_revision: payload.start_revision.clone(),
        end_revision: payload.end_revision.clone(),
        revisions: payload.revisions.clone(),
        record_only: payload.record_only,
        ignore_ancestry: payload.ignore_ancestry,
        force: payload.force,
        svn_executable: payload.svn_executable.clone(),
        snapshot_digest,
        created_at,
        expires_at: merge_preview::new_session_expiry(created_at),
        output_text: output.analysis.output_text.clone(),
        files,
    };
    merge_preview::write_session(app, &session)?;
    Ok((session, output.analysis))
}

fn merge_preview_snapshot_digest(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    executable: &str,
    root: &Path,
) -> Result<String, NovaError> {
    merge_preview::workspace_snapshot_digest_with(
        executable,
        root,
        |command| run_task_command(state, task_id, command),
        || task_cancellation_requested(state, task_id),
    )
}

fn task_cancellation_requested(state: &Arc<Mutex<TaskQueueState>>, task_id: &str) -> bool {
    state
        .lock()
        .expect("任务队列锁已损坏")
        .cancellation_requested
        .contains(task_id)
}

fn merge_preview_copy_context_for_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    executable: &str,
    target: &Path,
) -> Result<(PathBuf, PathBuf), NovaError> {
    let mut command = svn::command(executable);
    command
        .args(["info", "--show-item", "wc-root"])
        .arg(target)
        .current_dir(target);
    let output = run_task_command(state, task_id, &mut command).map_err(|error| {
        NovaError::command(
            "MERGE_PREVIEW_WORKSPACE_INFO_FAILED",
            "无法定位 Merge 目标所属的工作副本",
            Some(format!(
                "无法执行 `{executable} info --show-item wc-root`：{error}"
            )),
            true,
        )
    })?;
    resolve_merge_preview_copy_context(executable, target, output)
}

#[cfg(test)]
fn merge_preview_copy_context(
    executable: &str,
    target: &Path,
) -> Result<(PathBuf, PathBuf), NovaError> {
    let mut command = svn::command(executable);
    command
        .args(["info", "--show-item", "wc-root"])
        .arg(target)
        .current_dir(target);
    let output = command.output().map_err(|error| {
        NovaError::command(
            "MERGE_PREVIEW_WORKSPACE_INFO_FAILED",
            "无法定位 Merge 目标所属的工作副本",
            Some(format!(
                "无法执行 `{executable} info --show-item wc-root`：{error}"
            )),
            true,
        )
    })?;
    resolve_merge_preview_copy_context(executable, target, output)
}

fn resolve_merge_preview_copy_context(
    executable: &str,
    target: &Path,
    output: Output,
) -> Result<(PathBuf, PathBuf), NovaError> {
    if !output.status.success() {
        return Err(NovaError::command(
            "MERGE_PREVIEW_WORKSPACE_INFO_FAILED",
            "无法定位 Merge 目标所属的工作副本",
            Some(command_error_detail(executable, &output)),
            true,
        ));
    }
    let reported_root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if reported_root.is_empty() {
        return Err(NovaError::command(
            "MERGE_PREVIEW_WORKSPACE_INFO_EMPTY",
            "Merge 目标缺少工作副本根目录",
            None,
            true,
        ));
    }
    let copy_root = fs::canonicalize(&reported_root).map_err(|error| {
        NovaError::command(
            "MERGE_PREVIEW_WORKSPACE_RESOLVE_FAILED",
            "无法解析 Merge 目标所属的工作副本",
            Some(format!("路径：{reported_root}；错误：{error}")),
            true,
        )
    })?;
    let canonical_target = fs::canonicalize(target).map_err(|error| {
        NovaError::command(
            "MERGE_PREVIEW_TARGET_RESOLVE_FAILED",
            "无法解析 Merge 目标目录",
            Some(format!("路径：{}；错误：{error}", target.display())),
            true,
        )
    })?;
    let relative = canonical_target
        .strip_prefix(&copy_root)
        .map(Path::to_path_buf)
        .map_err(|_| {
            NovaError::command(
                "MERGE_PREVIEW_TARGET_OUTSIDE_WORKSPACE",
                "Merge 目标不在所属工作副本内",
                Some(format!(
                    "目标：{}；工作副本：{}",
                    canonical_target.display(),
                    copy_root.display()
                )),
                false,
            )
        })?;
    Ok((copy_root, relative))
}

fn build_merge_command(payload: &MergeTaskPayload, root: &Path, dry_run: bool) -> Command {
    let mut command = svn::command(&payload.svn_executable);
    command.arg("merge");
    for argument in merge_revision_arguments(
        &payload.start_revision,
        &payload.end_revision,
        &payload.revisions,
    ) {
        command.arg(argument);
    }
    if dry_run {
        command.arg("--dry-run");
    }
    if payload.record_only {
        command.arg("--record-only");
    }
    if payload.ignore_ancestry {
        command.arg("--ignore-ancestry");
    }
    if payload.force {
        command.arg("--force");
    }
    command.arg(&payload.source_url).arg(root).current_dir(root);
    command
}

#[derive(Debug, Clone)]
struct MergePreviewPathStatus {
    action: String,
    conflicted: bool,
    property_only: bool,
}

impl MergePreviewPathStatus {
    fn merge(&mut self, other: &Self) {
        self.conflicted |= other.conflicted;
        self.property_only &= other.property_only;
        if other.conflicted || self.action == "M" {
            self.action = other.action.clone();
        }
    }
}

fn merge_output_path_entries(
    analysis: &MergeOutputAnalysis,
    root: &Path,
) -> HashMap<String, MergePreviewPathStatus> {
    let mut paths = HashMap::new();
    for line in &analysis.log_lines {
        let columns = line.chars().take(4).collect::<Vec<_>>();
        if columns.len() < 4
            || !columns
                .iter()
                .any(|value| matches!(value, 'A' | 'D' | 'U' | 'C' | 'G' | 'M' | 'R' | 'E'))
            || !columns.iter().any(|value| value.is_whitespace())
        {
            continue;
        }
        let raw_path = line
            .char_indices()
            .nth(4)
            .map(|(index, _)| &line[index..])
            .unwrap_or_default()
            .trim();
        if raw_path.is_empty() {
            continue;
        }
        let path = PathBuf::from(raw_path);
        let relative = if path.is_absolute() {
            path.strip_prefix(root).ok().map(Path::to_path_buf)
        } else {
            Some(path)
        };
        let Some(relative) = relative else {
            continue;
        };
        if relative
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
        {
            continue;
        }
        let relative = relative.to_string_lossy().replace('\\', "/");
        let conflicted = columns.contains(&'C');
        let action = if conflicted {
            "C"
        } else {
            match columns.first().copied().unwrap_or('M') {
                'A' => "A",
                'D' => "D",
                _ => "M",
            }
        };
        let status = MergePreviewPathStatus {
            action: action.to_string(),
            conflicted,
            property_only: columns.first().is_some_and(|value| value.is_whitespace()),
        };
        paths
            .entry(relative)
            .and_modify(|current: &mut MergePreviewPathStatus| current.merge(&status))
            .or_insert(status);
    }
    paths
}

fn new_merge_preview_id() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn merge_preview_stale_error() -> NovaError {
    NovaError::command(
        "MERGE_PREVIEW_TARGET_CHANGED",
        "目标工作副本在预览后发生变化",
        Some("请返回 Log 窗口重新生成 Merge 预览。".to_string()),
        true,
    )
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
        let mut preflight_command = svn_patch_command(
            &payload.svn_executable,
            true,
            snapshot_file.path(),
            &working_copy_root,
        );
        let preflight_output = match run_apply_patch_command(state, task_id, &mut preflight_command)
        {
            Ok(output) => output,
            Err(error) => {
                update_task(
                    state,
                    task_id,
                    TaskStatus::Failed,
                    "SVN patch 预检启动失败",
                    Some(nova_error_text(&error)),
                );
                return;
            }
        };
        append_apply_patch_analysis_logs(state, task_id, &preflight_output.analysis);
        let preflight_text = preflight_output.analysis.preview_text.clone();
        let preflight_stats = &preflight_output.analysis.stats;
        if !preflight_output.status.success() || !preflight_stats.allows_apply() {
            set_apply_patch_result(
                state,
                task_id,
                &payload,
                true,
                preflight_text,
                preflight_output.analysis.output_truncated,
                preflight_stats,
            );
            let detail = if preflight_output.status.success() {
                format_apply_patch_guard_error(preflight_stats)
            } else {
                apply_patch_analysis_error_detail(&preflight_output.analysis)
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

    let mut patch_command = svn_patch_command(
        &payload.svn_executable,
        payload.dry_run,
        snapshot_file.path(),
        &working_copy_root,
    );
    match run_apply_patch_command(state, task_id, &mut patch_command) {
        Ok(output) => {
            append_apply_patch_analysis_logs(state, task_id, &output.analysis);
            let output_text = output.analysis.preview_text.clone();
            let stats = &output.analysis.stats;
            set_apply_patch_result(
                state,
                task_id,
                &payload,
                payload.dry_run,
                output_text,
                output.analysis.output_truncated,
                stats,
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
                    format_apply_patch_guard_error(stats)
                } else {
                    apply_patch_analysis_error_detail(&output.analysis)
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
    output_truncated: bool,
    stats: &ApplyPatchStats,
) {
    let output_text = bounded_apply_patch_output(output_text).0;
    set_task_result(
        state,
        task_id,
        TaskResult {
            repository_list: None,
            repository_file: None,
            repository_export: None,
            revision_diff: None,
            merge_result: None,
            apply_patch_result: Some(ApplyPatchResult {
                dry_run: result_dry_run,
                patch_file_path: payload.patch_file_path.clone(),
                patch_digest: payload.patch_digest.clone(),
                output_text,
                output_truncated,
                max_output_bytes: APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES,
                applied: stats.applied,
                offset_hunks: stats.offset_hunks,
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

    let mut command = svn::command(&payload.svn_executable);
    command.arg("checkout");
    if let Some(revision) = payload.revision.as_deref() {
        command.arg("-r").arg(revision);
    }
    command.arg(&payload.branch_url).arg(&payload.local_path);

    match run_task_command_streaming_output(state, task_id, &mut command) {
        Ok(output) if output.status.success() => {
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "分支 checkout 成功",
                None,
            );
        }
        Ok(output) => {
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

fn run_repository_checkout_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryCheckoutTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "仓库 Checkout 开始执行",
        None,
    );
    if let Err(error) = validate_checkout_destination(Path::new(&payload.local_path)) {
        update_task(
            state,
            task_id,
            TaskStatus::Failed,
            "仓库 Checkout 目标不可用",
            Some(error.to_string()),
        );
        return;
    }

    let command_target =
        repository_url_with_peg_revision(&payload.url, payload.revision.as_deref());
    append_task_log(
        state,
        task_id,
        &format!(
            "执行 svn checkout：{} -> {}",
            payload.url, payload.local_path
        ),
    );
    let mut command = svn::command(&payload.svn_executable);
    command.arg("checkout");
    if let Some(revision) = payload.revision.as_deref() {
        command.arg("-r").arg(revision);
    }
    command
        .arg("--")
        .arg(command_target)
        .arg(&payload.local_path);

    match run_task_command_streaming_output(state, task_id, &mut command) {
        Ok(output) if output.status.success() => {
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "仓库 Checkout 成功",
                None,
            );
        }
        Ok(output) => {
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "仓库 Checkout 失败",
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

fn run_repository_export_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: RepositoryExportTaskPayload,
) {
    update_task(
        state,
        task_id,
        TaskStatus::Running,
        "仓库 Export 开始执行",
        None,
    );
    if let Err(error) = validate_export_destination(Path::new(&payload.local_path)) {
        cleanup_repository_drag_export(&payload);
        update_task(
            state,
            task_id,
            TaskStatus::Failed,
            "仓库 Export 目标不可用",
            Some(error.to_string()),
        );
        return;
    }

    let command_target =
        repository_url_with_peg_revision(&payload.url, payload.revision.as_deref());
    append_task_log(
        state,
        task_id,
        &format!("执行 svn export：{} -> {}", payload.url, payload.local_path),
    );
    let mut command = svn::command(&payload.svn_executable);
    command.arg("export");
    if let Some(revision) = payload.revision.as_deref() {
        command.arg("-r").arg(revision);
    }
    command
        .arg("--")
        .arg(command_target)
        .arg(&payload.local_path);

    match run_task_command(state, task_id, &mut command) {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            let local_path = Path::new(&payload.local_path);
            let file_name = local_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("repository-export")
                .to_string();
            set_task_result(
                state,
                task_id,
                TaskResult {
                    repository_list: None,
                    repository_file: None,
                    repository_export: Some(RepositoryExportResult {
                        url: payload.url.clone(),
                        revision: payload.revision.clone(),
                        local_path: payload.local_path.clone(),
                        file_name,
                    }),
                    revision_diff: None,
                    merge_result: None,
                    apply_patch_result: None,
                },
            );
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                "仓库 Export 成功",
                None,
            );
        }
        Ok(output) => {
            cleanup_repository_drag_export(&payload);
            append_command_output(state, task_id, &output);
            update_task(
                state,
                task_id,
                TaskStatus::Failed,
                "仓库 Export 失败",
                Some(command_error_detail(&payload.svn_executable, &output)),
            );
        }
        Err(error) => {
            cleanup_repository_drag_export(&payload);
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

fn cleanup_repository_drag_export(payload: &RepositoryExportTaskPayload) {
    if !payload.cleanup_on_failure {
        return;
    }
    if let Some(parent) = Path::new(&payload.local_path).parent() {
        fs::remove_dir_all(parent).ok();
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
    let mut command = svn::command(&payload.svn_executable);
    command
        .arg("switch")
        .arg(&payload.target_url)
        .arg(&root)
        .current_dir(&root);
    let output = run_task_command(state, task_id, &mut command);

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
    let mut command = svn::command(executable);
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

    match run_task_command(state, task_id, &mut command) {
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

fn run_task_command(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    command: &mut Command,
) -> std::io::Result<Output> {
    run_task_command_inner(
        state,
        task_id,
        command,
        true,
        TaskCommandLimits {
            timeout: TASK_COMMAND_TIMEOUT,
            idle_timeout: Some(TASK_COMMAND_IDLE_TIMEOUT),
        },
        true,
        Some(MAX_TASK_COMMAND_OUTPUT_BYTES),
        false,
    )
}

fn run_task_command_streaming_output(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    command: &mut Command,
) -> std::io::Result<Output> {
    // Update 流式输出：关闭空闲超时，避免大文件传输静默期被误杀。
    run_task_command_inner(
        state,
        task_id,
        command,
        true,
        TaskCommandLimits {
            timeout: TASK_COMMAND_TIMEOUT,
            idle_timeout: TASK_UPDATE_IDLE_TIMEOUT,
        },
        true,
        Some(MAX_TASK_COMMAND_OUTPUT_BYTES),
        true,
    )
}

fn run_task_command_with_configured_stdout(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    command: &mut Command,
) -> std::io::Result<Output> {
    run_task_command_inner(
        state,
        task_id,
        command,
        false,
        TaskCommandLimits {
            timeout: TASK_COMMAND_TIMEOUT,
            idle_timeout: None,
        },
        true,
        Some(MAX_TASK_COMMAND_OUTPUT_BYTES),
        false,
    )
}

fn run_task_command_with_configured_streams(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    command: &mut Command,
) -> std::io::Result<Output> {
    run_task_command_inner(
        state,
        task_id,
        command,
        false,
        TaskCommandLimits {
            timeout: TASK_COMMAND_TIMEOUT,
            idle_timeout: None,
        },
        false,
        None,
        false,
    )
}

#[derive(Debug, Clone, Copy)]
struct TaskCommandLimits {
    timeout: Duration,
    idle_timeout: Option<Duration>,
}

#[cfg(test)]
fn run_task_command_with_limits(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    command: &mut Command,
    limits: TaskCommandLimits,
) -> std::io::Result<Output> {
    run_task_command_inner(
        state,
        task_id,
        command,
        true,
        limits,
        true,
        Some(MAX_TASK_COMMAND_OUTPUT_BYTES),
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn run_task_command_inner(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    command: &mut Command,
    capture_stdout: bool,
    limits: TaskCommandLimits,
    capture_stderr: bool,
    output_limit: Option<usize>,
    stream_output_lines: bool,
) -> std::io::Result<Output> {
    if state
        .lock()
        .expect("任务队列锁已损坏")
        .cancellation_requested
        .contains(task_id)
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "任务已请求取消",
        ));
    }

    // 避免子进程因等待 stdin 而挂起（macOS GUI 下尤为常见）。
    command.stdin(Stdio::null());
    if capture_stdout {
        command.stdout(Stdio::piped());
    }
    if capture_stderr {
        command.stderr(Stdio::piped());
    }
    configure_task_process_group(command);
    append_task_log(
        state,
        task_id,
        &format!("启动命令：{}", format_task_command(command)),
    );

    let mut child = command.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let started_at = Instant::now();
    let last_output_at = Arc::new(Mutex::new(started_at));
    let stdout_activity = Arc::clone(&last_output_at);
    let stderr_activity = Arc::clone(&last_output_at);
    let stdout_streamer = stream_output_lines.then(|| TaskOutputStreamer {
        state: Arc::clone(state),
        task_id: task_id.to_string(),
    });
    let stderr_streamer = stream_output_lines.then(|| TaskOutputStreamer {
        state: Arc::clone(state),
        task_id: task_id.to_string(),
    });
    let stdout_reader = thread::spawn(move || {
        read_child_pipe_with_streamer(stdout, stdout_activity, output_limit, stdout_streamer)
    });
    let stderr_reader = thread::spawn(move || {
        read_child_pipe_with_streamer(stderr, stderr_activity, output_limit, stderr_streamer)
    });
    let child = Arc::new(Mutex::new(child));

    let cancellation_requested = {
        let mut queue = state.lock().expect("任务队列锁已损坏");
        if queue.cancellation_requested.contains(task_id) {
            true
        } else {
            queue
                .running_processes
                .insert(task_id.to_string(), Arc::clone(&child));
            false
        }
    };
    if cancellation_requested {
        terminate_process_tree(&child)?;
    }

    let mut status = None;
    let mut execution_error = None;
    let mut last_heartbeat_at = started_at;
    loop {
        let result = child.lock().expect("SVN 子进程锁已损坏").try_wait();
        match result {
            Ok(Some(exit_status)) => {
                status = Some(exit_status);
                break;
            }
            Ok(None) => {}
            Err(error) => {
                terminate_process_tree(&child).ok();
                execution_error = Some(error);
                break;
            }
        }

        let now = Instant::now();
        // 流式 Update 长时间无行输出时写心跳，避免界面像卡死。
        if stream_output_lines && now.duration_since(last_heartbeat_at) >= Duration::from_secs(15) {
            let last_output = *last_output_at.lock().expect("命令输出活动锁已损坏");
            let silent_for = now.duration_since(last_output);
            if silent_for >= Duration::from_secs(15) {
                append_task_log(
                    state,
                    task_id,
                    &format!(
                        "仍在执行中…已运行{}，最近{}无新输出（大文件传输时属正常）",
                        format_task_command_duration(now.duration_since(started_at)),
                        format_task_command_duration(silent_for)
                    ),
                );
            }
            last_heartbeat_at = now;
        }
        let timeout_message = if now.duration_since(started_at) >= limits.timeout {
            Some(format!(
                "SVN 命令运行超过{}，已终止进程树",
                format_task_command_duration(limits.timeout)
            ))
        } else if let Some(idle_timeout) = limits.idle_timeout {
            let last_output_at = *last_output_at.lock().expect("命令输出活动锁已损坏");
            (now.duration_since(last_output_at) >= idle_timeout).then(|| {
                format!(
                    "SVN 命令连续{}无输出，已终止进程树",
                    format_task_command_duration(idle_timeout)
                )
            })
        } else {
            None
        };
        if let Some(mut message) = timeout_message {
            if let Err(error) = terminate_process_tree(&child) {
                message.push_str(&format!("；终止时发生错误：{error}"));
            }
            status = child
                .lock()
                .expect("SVN 子进程锁已损坏")
                .try_wait()
                .ok()
                .flatten();
            execution_error = Some(std::io::Error::new(std::io::ErrorKind::TimedOut, message));
            break;
        }

        thread::sleep(Duration::from_millis(25));
    }

    {
        let mut queue = state.lock().expect("任务队列锁已损坏");
        let registered = queue
            .running_processes
            .get(task_id)
            .is_some_and(|registered| Arc::ptr_eq(registered, &child));
        if registered {
            queue.running_processes.remove(task_id);
        }
    }

    let stdout = join_child_reader(stdout_reader, "stdout");
    let stderr = join_child_reader(stderr_reader, "stderr");
    if let Ok(result) = &stdout {
        append_child_output_limit_log(state, task_id, "stdout", result);
    }
    if let Ok(result) = &stderr {
        append_child_output_limit_log(state, task_id, "stderr", result);
    }
    if let Some(status) = status.as_ref() {
        append_task_log(state, task_id, &format_task_exit_status(status));
    }
    if let Some(error) = execution_error {
        append_task_log(state, task_id, &format!("命令执行异常：{error}"));
        return Err(error);
    }
    Ok(Output {
        status: status.ok_or_else(|| std::io::Error::other("SVN 子进程未返回退出状态"))?,
        stdout: stdout?.bytes,
        stderr: stderr?.bytes,
    })
}

fn format_task_command(command: &Command) -> String {
    const SENSITIVE_VALUE_FLAGS: [&str; 5] = [
        "-m",
        "--message",
        "--username",
        "--password",
        "--config-option",
    ];

    let mut parts = vec![format!(
        "{:?}",
        command.get_program().to_string_lossy().as_ref()
    )];
    let mut redact_next = false;
    for argument in command.get_args() {
        let argument = argument.to_string_lossy();
        if redact_next {
            parts.push(format!("{:?}", "<已隐藏>"));
            redact_next = false;
            continue;
        }

        if SENSITIVE_VALUE_FLAGS.contains(&argument.as_ref()) {
            parts.push(format!("{:?}", argument.as_ref()));
            redact_next = true;
            continue;
        }
        if let Some((flag, _)) = argument.split_once('=') {
            if SENSITIVE_VALUE_FLAGS.contains(&flag) {
                parts.push(format!("{:?}", format!("{flag}=<已隐藏>")));
                continue;
            }
        }

        parts.push(format!("{:?}", redact_credentials(&argument)));
    }

    bounded_text_preview(
        parts.join(" "),
        MAX_TASK_COMMAND_LOG_BYTES,
        "命令日志已截断",
    )
}

fn format_task_exit_status(status: &ExitStatus) -> String {
    if let Some(code) = status.code() {
        return format!("命令退出：退出码 {code}");
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;

        if let Some(signal) = status.signal() {
            return format!("命令退出：Unix 信号 {signal}");
        }
    }

    "命令退出：系统未提供退出码".to_string()
}

#[derive(Debug, PartialEq, Eq)]
struct ChildPipeReadResult {
    bytes: Vec<u8>,
    total_bytes: usize,
    truncated: bool,
}

#[cfg(test)]
fn read_child_pipe(
    pipe: Option<impl Read>,
    last_output_at: Arc<Mutex<Instant>>,
    max_bytes: Option<usize>,
) -> std::io::Result<ChildPipeReadResult> {
    read_child_pipe_with_streamer(pipe, last_output_at, max_bytes, None)
}

#[derive(Clone)]
struct TaskOutputStreamer {
    state: Arc<Mutex<TaskQueueState>>,
    task_id: String,
}

impl TaskOutputStreamer {
    fn append_line(&self, bytes: &[u8]) {
        let message = String::from_utf8_lossy(bytes).trim().to_string();
        if !message.is_empty() {
            append_task_logs(&self.state, &self.task_id, std::iter::once(message));
        }
    }

    /// 批量写入，降低大项目 Update 时的锁竞争与日志裁剪开销。
    fn append_lines(&self, lines: &[Vec<u8>]) {
        if lines.is_empty() {
            return;
        }
        let messages = lines.iter().filter_map(|bytes| {
            let message = String::from_utf8_lossy(bytes).trim().to_string();
            (!message.is_empty()).then_some(message)
        });
        append_task_logs(&self.state, &self.task_id, messages);
    }
}

fn read_child_pipe_with_streamer(
    mut pipe: Option<impl Read>,
    last_output_at: Arc<Mutex<Instant>>,
    max_bytes: Option<usize>,
    streamer: Option<TaskOutputStreamer>,
) -> std::io::Result<ChildPipeReadResult> {
    const MAX_STREAMED_LINE_BYTES: usize = 64 * 1024;
    let mut output = Vec::new();
    let mut total_bytes = 0usize;
    let mut truncated = false;
    let mut streamed_line = Vec::new();
    // 每个 read 块内先攒行，再一次加锁写入，避免数万次 remove(0)/扫全表。
    let mut pending_lines: Vec<Vec<u8>> = Vec::new();
    if let Some(pipe) = pipe.as_mut() {
        let mut buffer = [0_u8; 8 * 1024];
        loop {
            let read = pipe.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            total_bytes = total_bytes.saturating_add(read);
            if let Some(streamer) = streamer.as_ref() {
                for byte in &buffer[..read] {
                    if *byte == b'\n' {
                        pending_lines.push(std::mem::take(&mut streamed_line));
                    } else if streamed_line.len() < MAX_STREAMED_LINE_BYTES {
                        streamed_line.push(*byte);
                    }
                }
                if !pending_lines.is_empty() {
                    streamer.append_lines(&pending_lines);
                    pending_lines.clear();
                }
            }
            if let Some(max_bytes) = max_bytes {
                let remaining = max_bytes.saturating_sub(output.len());
                if remaining > 0 {
                    output.extend_from_slice(&buffer[..read.min(remaining)]);
                }
                if read > remaining {
                    truncated = true;
                }
            } else {
                output.extend_from_slice(&buffer[..read]);
            }
            *last_output_at.lock().expect("命令输出活动锁已损坏") = Instant::now();
        }
    }
    if let Some(streamer) = streamer.as_ref() {
        if !streamed_line.is_empty() {
            streamer.append_line(&streamed_line);
        }
    }
    if max_bytes.is_some() && truncated {
        while !output.is_empty() && std::str::from_utf8(&output).is_err() {
            output.pop();
        }
    }
    Ok(ChildPipeReadResult {
        bytes: output,
        total_bytes,
        truncated,
    })
}

fn format_task_command_duration(duration: Duration) -> String {
    if duration < Duration::from_secs(1) {
        format!(" {} 毫秒", duration.as_millis())
    } else {
        format!(" {} 秒", duration.as_secs())
    }
}

fn join_child_reader(
    reader: thread::JoinHandle<std::io::Result<ChildPipeReadResult>>,
    stream_name: &str,
) -> std::io::Result<ChildPipeReadResult> {
    reader
        .join()
        .map_err(|_| std::io::Error::other(format!("读取子进程 {stream_name} 的线程异常退出")))?
}

fn append_child_output_limit_log(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    stream_name: &str,
    result: &ChildPipeReadResult,
) {
    if result.truncated {
        append_task_log(
            state,
            task_id,
            &format!(
                "命令 {stream_name} 输出已截断：保留最多 {} 字节，实际读取 {} 字节",
                MAX_TASK_COMMAND_OUTPUT_BYTES, result.total_bytes
            ),
        );
    }
}

#[cfg(unix)]
fn configure_task_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_task_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_tree(process: &Arc<Mutex<Child>>) -> std::io::Result<()> {
    let pid = {
        let mut child = process.lock().expect("SVN 子进程锁已损坏");
        if child.try_wait()?.is_some() {
            return Ok(());
        }
        i32::try_from(child.id())
            .map_err(|_| std::io::Error::other("SVN 子进程 ID 超出 Unix pid 范围"))?
    };

    signal_unix_process_group(pid, libc::SIGTERM)?;
    let root_exited = wait_for_process_exit(process, Duration::from_millis(500))?;
    signal_unix_process_group(pid, libc::SIGKILL)?;
    if root_exited {
        return Ok(());
    }

    if wait_for_process_exit(process, Duration::from_secs(1))? {
        return Ok(());
    }

    process.lock().expect("SVN 子进程锁已损坏").kill()?;
    if wait_for_process_exit(process, Duration::from_secs(1))? {
        Ok(())
    } else {
        Err(std::io::Error::other("强制终止 Unix 子进程后仍未退出"))
    }
}

#[cfg(unix)]
fn signal_unix_process_group(pid: i32, signal: i32) -> std::io::Result<()> {
    // 子进程启动时已成为独立进程组组长，负 pid 只会向该任务的进程组发送信号。
    let result = unsafe { libc::kill(-pid, signal) };
    if result == 0 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(error)
    }
}

#[cfg(windows)]
fn terminate_process_tree(process: &Arc<Mutex<Child>>) -> std::io::Result<()> {
    let pid = {
        let mut child = process.lock().expect("SVN 子进程锁已损坏");
        if child.try_wait()?.is_some() {
            return Ok(());
        }
        child.id()
    };
    let mut command = Command::new("taskkill");
    svn::configure_hidden_console(&mut command);
    let output = command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output();
    if output.is_ok_and(|output| output.status.success())
        || wait_for_process_exit(process, Duration::from_secs(1))?
    {
        return Ok(());
    }

    process.lock().expect("SVN 子进程锁已损坏").kill()?;
    if wait_for_process_exit(process, Duration::from_secs(1))? {
        Ok(())
    } else {
        Err(std::io::Error::other("强制终止 Windows 子进程后仍未退出"))
    }
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_tree(process: &Arc<Mutex<Child>>) -> std::io::Result<()> {
    process.lock().expect("SVN 子进程锁已损坏").kill()?;
    if wait_for_process_exit(process, Duration::from_secs(1))? {
        Ok(())
    } else {
        Err(std::io::Error::other("强制终止子进程后仍未退出"))
    }
}

fn wait_for_process_exit(process: &Arc<Mutex<Child>>, timeout: Duration) -> std::io::Result<bool> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if process
            .lock()
            .expect("SVN 子进程锁已损坏")
            .try_wait()?
            .is_some()
        {
            return Ok(true);
        }
        if std::time::Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(25));
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

fn append_apply_patch_analysis_logs(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    analysis: &ApplyPatchOutputAnalysis,
) {
    for line in &analysis.log_lines {
        append_task_log(state, task_id, line);
    }
    if analysis.log_truncated {
        append_task_log(
            state,
            task_id,
            &format!(
                "Patch 命令输出日志已截断（最多 {} 字节、{} 行）",
                APPLY_PATCH_TASK_LOG_MAX_BYTES, APPLY_PATCH_TASK_LOG_MAX_LINES
            ),
        );
    }
}

#[cfg(test)]
fn apply_patch_log_preview(stdout: &[u8], stderr: &[u8]) -> (Vec<String>, bool) {
    let mut lines = Vec::new();
    let mut bytes = 0usize;
    let mut truncated = false;
    let streams = [
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr),
    ];

    'streams: for stream in streams {
        for line in stream
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
        {
            if lines.len() >= APPLY_PATCH_TASK_LOG_MAX_LINES
                || bytes >= APPLY_PATCH_TASK_LOG_MAX_BYTES
            {
                truncated = true;
                break 'streams;
            }
            let remaining = APPLY_PATCH_TASK_LOG_MAX_BYTES - bytes;
            let preview = truncate_utf8(line, remaining);
            if preview.len() < line.len() {
                truncated = true;
            }
            bytes += preview.len();
            lines.push(preview);
            if truncated {
                break 'streams;
            }
        }
    }

    (lines, truncated)
}

#[derive(Debug)]
struct ApplyPatchOutputAnalysis {
    preview_text: String,
    output_truncated: bool,
    stats: ApplyPatchStats,
    log_lines: Vec<String>,
    log_truncated: bool,
}

#[derive(Debug, Default)]
struct ApplyPatchOutputCollector {
    preview: Vec<u8>,
    line: Vec<u8>,
    total_bytes: u64,
    log_lines: Vec<String>,
    log_bytes: usize,
    log_truncated: bool,
    stats: ApplyPatchStatsAccumulator,
}

impl ApplyPatchOutputCollector {
    fn read_file(&mut self, path: &Path) -> Result<(), NovaError> {
        let mut file = fs::File::open(path).map_err(|error| {
            NovaError::command(
                "APPLY_PATCH_OUTPUT_READ_FAILED",
                "无法读取 Patch 命令输出",
                Some(format!("路径：{}；错误：{error}", path.display())),
                true,
            )
        })?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer).map_err(|error| {
                NovaError::command(
                    "APPLY_PATCH_OUTPUT_READ_FAILED",
                    "无法读取 Patch 命令输出",
                    Some(error.to_string()),
                    true,
                )
            })?;
            if read == 0 {
                break;
            }
            self.consume_bytes(&buffer[..read])?;
        }
        self.finish_line()
    }

    fn consume_bytes(&mut self, bytes: &[u8]) -> Result<(), NovaError> {
        self.total_bytes = self.total_bytes.saturating_add(bytes.len() as u64);
        if self.total_bytes > MAX_APPLY_PATCH_COMMAND_OUTPUT_BYTES {
            return Err(NovaError::command(
                "APPLY_PATCH_OUTPUT_LIMIT_EXCEEDED",
                "Patch 命令输出过大",
                Some(format!(
                    "完整 Patch 输出超过安全上限 {MAX_APPLY_PATCH_COMMAND_OUTPUT_BYTES} 字节"
                )),
                true,
            ));
        }
        let remaining = APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES.saturating_sub(self.preview.len());
        if remaining > 0 {
            self.preview
                .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        }

        for byte in bytes {
            self.line.push(*byte);
            if self.line.len() > MAX_APPLY_PATCH_OUTPUT_LINE_BYTES {
                return Err(NovaError::command(
                    "APPLY_PATCH_OUTPUT_LINE_LIMIT_EXCEEDED",
                    "Patch 命令输出单行过长",
                    Some(format!(
                        "单行输出超过 {MAX_APPLY_PATCH_OUTPUT_LINE_BYTES} 字节"
                    )),
                    true,
                ));
            }
            if *byte == b'\n' {
                self.finish_line()?;
            }
        }
        Ok(())
    }

    fn finish_line(&mut self) -> Result<(), NovaError> {
        if self.line.is_empty() {
            return Ok(());
        }
        let line = String::from_utf8_lossy(&self.line);
        self.stats.consume_line(&line)?;
        let line = line.trim();
        if !line.is_empty() {
            if self.log_lines.len() >= APPLY_PATCH_TASK_LOG_MAX_LINES
                || self.log_bytes >= APPLY_PATCH_TASK_LOG_MAX_BYTES
            {
                self.log_truncated = true;
            } else {
                let remaining = APPLY_PATCH_TASK_LOG_MAX_BYTES - self.log_bytes;
                let preview = truncate_utf8(line, remaining);
                if preview.len() < line.len() {
                    self.log_truncated = true;
                }
                self.log_bytes += preview.len();
                self.log_lines.push(preview);
            }
        }
        self.line.clear();
        Ok(())
    }

    fn finish(self) -> Result<ApplyPatchOutputAnalysis, NovaError> {
        let output_truncated = self.total_bytes > APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES as u64;
        let preview_text = bounded_text_preview(
            String::from_utf8_lossy(&self.preview).into_owned(),
            APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES,
            "Patch 输出预览已截断",
        );
        Ok(ApplyPatchOutputAnalysis {
            preview_text,
            output_truncated,
            stats: self.stats.finish(),
            log_lines: self.log_lines,
            log_truncated: self.log_truncated,
        })
    }
}

fn analyze_apply_patch_output_files(
    stdout: &TaskCommandOutputFile,
    stderr: &TaskCommandOutputFile,
) -> Result<ApplyPatchOutputAnalysis, NovaError> {
    let mut collector = ApplyPatchOutputCollector::default();
    collector.read_file(stdout.path())?;
    collector.read_file(stderr.path())?;
    collector.finish()
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
        "`{executable}` 返回退出码 {:?}，但没有输出。",
        output.status.code()
    )
}

fn repository_write_command_error_detail(
    executable: &str,
    output: &std::process::Output,
) -> String {
    format_repository_write_error_detail(&command_error_detail(executable, output))
}

fn format_repository_write_error_detail(detail: &str) -> String {
    let normalized = detail.to_lowercase();
    let permission_markers = [
        "e170001",
        "e175013",
        "e215004",
        "e220004",
        "authorization failed",
        "not authorized",
        "access denied",
        "forbidden",
        "authentication failed",
        "could not authenticate",
        "认证失败",
        "拒绝访问",
        "没有权限",
        "无权限",
    ];
    if !permission_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return detail.to_string();
    }

    format!(
        "仓库写入被拒绝：当前凭据没有目标路径的写权限，或认证信息已失效。请检查仓库账号、权限和本机 SVN 凭据后重试。\n\nSVN 原始错误：{detail}"
    )
}

fn apply_patch_analysis_error_detail(analysis: &ApplyPatchOutputAnalysis) -> String {
    if analysis.preview_text.trim().is_empty() {
        return "svn patch 返回失败，但没有输出。".to_string();
    }
    bounded_text_preview(
        analysis.preview_text.clone(),
        APPLY_PATCH_TASK_LOG_MAX_BYTES,
        "Patch 错误输出已截断",
    )
}

fn bounded_text_preview(value: String, max_bytes: usize, marker: &str) -> String {
    if value.len() <= max_bytes {
        return value;
    }

    let omitted = value.len() - max_bytes;
    let suffix = format!("\n...[{marker}，省略至少 {omitted} 字节]");
    let content_limit = max_bytes.saturating_sub(suffix.len());
    let mut boundary = content_limit.min(value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}{}", &value[..boundary], suffix)
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
    let message = redact_credentials(message);
    let error = error.map(|error| redact_credentials(&error));
    let mut state = state.lock().expect("任务队列锁已损坏");
    let cancelled = state.cancellation_requested.contains(task_id)
        && !matches!(status, TaskStatus::Pending | TaskStatus::Running);
    if cancelled {
        state.cancellation_requested.remove(task_id);
    }
    let updated = if let Some(task) = state.tasks.iter_mut().find(|task| task.task_id == task_id) {
        let now = timestamp_millis();
        task.status = if cancelled {
            TaskStatus::Cancelled
        } else {
            status
        };
        task.error = if cancelled { None } else { error };
        if cancelled {
            task.result = None;
        }
        task.updated_at = now;
        push_task_log(
            task,
            if cancelled {
                "任务已取消，SVN 进程树已终止".to_string()
            } else {
                message
            },
            now,
        );
        true
    } else {
        false
    };
    if updated {
        if let Err(error) = persist_task_history(&state) {
            eprintln!("[NovaSVN] 保存任务状态失败：{error}");
        }
    }
}

fn append_task_log(state: &Arc<Mutex<TaskQueueState>>, task_id: &str, message: &str) {
    append_task_logs(state, task_id, std::iter::once(message.to_string()));
}

fn append_task_logs<I>(state: &Arc<Mutex<TaskQueueState>>, task_id: &str, messages: I)
where
    I: IntoIterator<Item = String>,
{
    let mut state = state.lock().expect("任务队列锁已损坏");
    let Some(task) = state.tasks.iter_mut().find(|task| task.task_id == task_id) else {
        return;
    };
    let now = timestamp_millis();
    let mut appended = false;
    for message in messages {
        let message = redact_credentials(&message);
        if message.is_empty() {
            continue;
        }
        push_task_log_without_trim(task, message, now);
        appended = true;
    }
    if appended {
        task.updated_at = now;
        trim_task_logs(&mut task.logs);
    }
}

fn push_task_log(task: &mut Task, message: String, created_at: u64) {
    push_task_log_without_trim(task, message, created_at);
    trim_task_logs(&mut task.logs);
}

fn push_task_log_without_trim(task: &mut Task, message: String, created_at: u64) {
    task.logs.push(TaskLog {
        message: bounded_text_preview(message, MAX_RUNTIME_TASK_LOG_BYTES, "任务日志内容已截断"),
        created_at,
    });
}

/// 高效裁剪任务日志：先算总字节，再一次性 drain 前缀，避免每行 O(n²) 的 remove(0)。
fn trim_task_logs(logs: &mut Vec<TaskLog>) {
    if logs.is_empty() {
        return;
    }

    let mut total_bytes: usize = logs.iter().map(|log| log.message.len()).sum();
    if logs.len() <= MAX_RUNTIME_TASK_LOGS && total_bytes <= MAX_RUNTIME_TASK_LOG_BYTES {
        return;
    }

    let mut drop_count = 0usize;
    while drop_count < logs.len()
        && (logs.len() - drop_count > MAX_RUNTIME_TASK_LOGS
            || total_bytes > MAX_RUNTIME_TASK_LOG_BYTES)
    {
        total_bytes = total_bytes.saturating_sub(logs[drop_count].message.len());
        drop_count += 1;
    }
    if drop_count > 0 {
        logs.drain(0..drop_count);
    }

    let has_marker = logs
        .first()
        .is_some_and(|log| log.message == TASK_LOG_TRUNCATION_MARKER);
    if has_marker {
        return;
    }

    let marker_len = TASK_LOG_TRUNCATION_MARKER.len();
    // 为截断标记腾出一行与字节空间
    while !logs.is_empty()
        && (logs.len() >= MAX_RUNTIME_TASK_LOGS
            || total_bytes.saturating_add(marker_len) > MAX_RUNTIME_TASK_LOG_BYTES)
    {
        total_bytes = total_bytes.saturating_sub(logs[0].message.len());
        logs.remove(0);
    }
    logs.insert(
        0,
        TaskLog {
            message: TASK_LOG_TRUNCATION_MARKER.to_string(),
            created_at: timestamp_millis(),
        },
    );
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
    let output = svn::command(executable)
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

fn normalize_revert_target_path(
    working_copy_root: &Path,
    target_path: Option<&str>,
) -> Result<PathBuf, NovaError> {
    let Some(raw_target) = target_path else {
        return Ok(working_copy_root.to_path_buf());
    };
    let raw_target = raw_target.trim();
    if raw_target.is_empty() || raw_target.chars().any(char::is_control) {
        return Err(NovaError::command(
            "REVERT_REVISION_TARGET_PATH_INVALID",
            "版本回退目标路径无效",
            Some("目标路径不能为空或包含控制字符。".to_string()),
            true,
        ));
    }

    let raw_path = Path::new(raw_target);
    let target = if path_utils::is_absolute_or_windows_path(raw_path, raw_target) {
        raw_path.to_path_buf()
    } else {
        let relative = normalize_relative_file_path(
            raw_target,
            "REVERT_REVISION_TARGET_PATH_INVALID",
            "版本回退目标路径无效",
        )?;
        working_copy_root.join(relative)
    };
    let canonical_root = fs::canonicalize(working_copy_root).map_err(|error| {
        NovaError::command(
            "REVERT_REVISION_WORKSPACE_RESOLVE_FAILED",
            "无法解析版本回退工作副本",
            Some(format!(
                "路径：{}；错误：{error}",
                working_copy_root.display()
            )),
            true,
        )
    })?;
    let mut existing_ancestor = target.as_path();
    while !existing_ancestor.exists() {
        existing_ancestor = existing_ancestor.parent().ok_or_else(|| {
            NovaError::command(
                "REVERT_REVISION_TARGET_PATH_INVALID",
                "无法解析版本回退目标路径",
                Some(format!("路径：{}", target.display())),
                true,
            )
        })?;
    }
    let canonical_ancestor = fs::canonicalize(existing_ancestor).map_err(|error| {
        NovaError::command(
            "REVERT_REVISION_TARGET_PATH_INVALID",
            "无法解析版本回退目标路径",
            Some(format!("路径：{}；错误：{error}", target.display())),
            true,
        )
    })?;
    let relative = canonical_ancestor
        .strip_prefix(&canonical_root)
        .map_err(|_| {
            NovaError::command(
                "REVERT_REVISION_TARGET_OUTSIDE_WORKSPACE",
                "版本回退目标不在工作副本内",
                Some(format!(
                    "目标：{}；工作副本：{}",
                    target.display(),
                    working_copy_root.display()
                )),
                true,
            )
        })?;
    if relative.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".svn")
    }) {
        return Err(NovaError::command(
            "REVERT_REVISION_TARGET_PATH_INVALID",
            "版本回退目标路径无效",
            Some("不能对工作副本的 .svn 元数据目录执行版本回退。".to_string()),
            true,
        ));
    }

    Ok(target)
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
    let output = svn::command(svn_executable)
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

fn normalize_add_path(file: &str) -> Result<String, NovaError> {
    let path = Path::new(file);
    if !file.is_empty()
        && (task_file_path_is_absolute(path, file) || task_file_path_has_parent_segment(file))
    {
        return Err(NovaError::command(
            "ADD_TARGET_OUTSIDE_WORKING_COPY",
            "Add 目标必须位于当前工作副本内",
            Some("请使用不含 `..` 的工作副本相对路径。".to_string()),
            true,
        ));
    }

    normalize_relative_file_path(file, "ADD_FILE_PATH_INVALID", "Add 文件路径无效")
}

fn canonicalize_add_working_copy_root(root: &Path) -> Result<PathBuf, NovaError> {
    let canonical_root = fs::canonicalize(root).map_err(|error| {
        NovaError::command(
            "ADD_WORKING_COPY_INVALID",
            "无法解析 Add 目标工作副本",
            Some(format!("路径：{}；错误：{error}", root.display())),
            true,
        )
    })?;
    if !canonical_root.is_absolute() {
        return Err(NovaError::command(
            "ADD_WORKING_COPY_INVALID",
            "Add 目标工作副本不是绝对路径",
            Some(format!("路径：{}", canonical_root.display())),
            true,
        ));
    }

    Ok(canonical_root)
}

fn canonicalize_unadd_working_copy_root(root: &Path) -> Result<PathBuf, NovaError> {
    let canonical_root = fs::canonicalize(root).map_err(|error| {
        NovaError::command(
            "UNADD_WORKING_COPY_INVALID",
            "无法解析 Unadd 目标工作副本",
            Some(format!("路径：{}；错误：{error}", root.display())),
            true,
        )
    })?;
    if !canonical_root.is_absolute() {
        return Err(NovaError::command(
            "UNADD_WORKING_COPY_INVALID",
            "Unadd 目标工作副本不是绝对路径",
            Some(format!("路径：{}", canonical_root.display())),
            true,
        ));
    }

    Ok(canonical_root)
}

fn validate_add_target(
    svn_executable: &str,
    working_copy_root: &Path,
    relative_path: &str,
) -> Result<(), NovaError> {
    let canonical_root = canonicalize_unadd_working_copy_root(working_copy_root)?;
    if canonical_root != working_copy_root {
        return Err(NovaError::command(
            "ADD_WORKING_COPY_CHANGED",
            "Add 工作副本路径已发生变化",
            Some(format!(
                "任务路径：{}；当前路径：{}",
                working_copy_root.display(),
                canonical_root.display()
            )),
            true,
        ));
    }

    let target = working_copy_root.join(relative_path);
    match fs::symlink_metadata(&target) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(NovaError::command(
                "ADD_TARGET_NOT_FOUND",
                "Add 目标不存在",
                Some(format!("路径：{}", target.display())),
                true,
            ));
        }
        Err(error) => {
            return Err(NovaError::command(
                "ADD_TARGET_CHECK_FAILED",
                "无法检查 Add 目标",
                Some(format!("路径：{}；错误：{error}", target.display())),
                true,
            ));
        }
    }

    let canonical_target = fs::canonicalize(&target).map_err(|error| {
        let (code, message) = if error.kind() == std::io::ErrorKind::NotFound {
            ("ADD_TARGET_NOT_FOUND", "Add 目标不存在")
        } else {
            ("ADD_TARGET_CHECK_FAILED", "无法解析 Add 目标")
        };
        NovaError::command(
            code,
            message,
            Some(format!("路径：{}；错误：{error}", target.display())),
            true,
        )
    })?;
    if !canonical_target.starts_with(working_copy_root) {
        return Err(NovaError::command(
            "ADD_TARGET_OUTSIDE_WORKING_COPY",
            "Add 目标位于当前工作副本外",
            Some(format!(
                "工作副本：{}；目标：{}",
                working_copy_root.display(),
                canonical_target.display()
            )),
            true,
        ));
    }

    let output = svn::command(svn_executable)
        .args(["status", "--xml", "--no-ignore"])
        .arg(&target)
        .current_dir(working_copy_root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "ADD_TARGET_STATUS_FAILED",
                "无法检查 Add 目标的 SVN 状态",
                Some(format!(
                    "无法执行 `{svn_executable} status --xml --no-ignore`：{error}"
                )),
                true,
            )
        })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "ADD_TARGET_STATUS_FAILED",
            "无法检查 Add 目标的 SVN 状态",
            Some(command_output_error_detail(
                svn_executable,
                "status --xml --no-ignore",
                &output,
            )),
            true,
        ));
    }

    let xml = std::str::from_utf8(&output.stdout).map_err(|error| {
        NovaError::command(
            "ADD_TARGET_STATUS_INVALID",
            "Add 目标的 SVN 状态不是有效 UTF-8",
            Some(error.to_string()),
            true,
        )
    })?;
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "ADD_TARGET_STATUS_INVALID",
            "无法解析 Add 目标的 SVN 状态",
            Some(format!("svn status --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;
    let statuses = document
        .descendants()
        .filter(|node| node.has_tag_name("wc-status"))
        .filter_map(|node| node.attribute("item"))
        .collect::<Vec<_>>();
    if statuses.contains(&"ignored") {
        return Err(NovaError::command(
            "ADD_TARGET_IGNORED",
            "Add 目标已被 SVN 忽略",
            Some(format!("路径：{relative_path}。请先调整 svn:ignore 规则。")),
            true,
        ));
    }
    Ok(())
}

fn validate_unadd_target(
    svn_executable: &str,
    working_copy_root: &Path,
    relative_path: &str,
) -> Result<(), NovaError> {
    let canonical_root = canonicalize_add_working_copy_root(working_copy_root)?;
    if canonical_root != working_copy_root {
        return Err(NovaError::command(
            "UNADD_WORKING_COPY_CHANGED",
            "Unadd 工作副本路径已发生变化",
            Some(format!(
                "任务路径：{}；当前路径：{}",
                working_copy_root.display(),
                canonical_root.display()
            )),
            true,
        ));
    }

    let target = working_copy_root.join(relative_path);
    if let Ok(canonical_target) = fs::canonicalize(&target) {
        if !canonical_target.starts_with(working_copy_root) {
            return Err(NovaError::command(
                "UNADD_TARGET_OUTSIDE_WORKING_COPY",
                "Unadd 目标位于当前工作副本外",
                Some(format!(
                    "工作副本：{}；目标：{}",
                    working_copy_root.display(),
                    canonical_target.display()
                )),
                true,
            ));
        }
    }

    let output = svn::command(svn_executable)
        .arg("status")
        .arg("--xml")
        .arg("--depth")
        .arg("empty")
        .arg(&target)
        .current_dir(working_copy_root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "UNADD_TARGET_STATUS_FAILED",
                "无法检查 Unadd 目标的 SVN 状态",
                Some(format!(
                    "无法执行 `{svn_executable} status --xml --depth empty`：{error}"
                )),
                true,
            )
        })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "UNADD_TARGET_STATUS_FAILED",
            "无法检查 Unadd 目标的 SVN 状态",
            Some(command_output_error_detail(
                svn_executable,
                "status --xml --depth empty",
                &output,
            )),
            true,
        ));
    }

    let xml = std::str::from_utf8(&output.stdout).map_err(|error| {
        NovaError::command(
            "UNADD_TARGET_STATUS_INVALID",
            "Unadd 目标的 SVN 状态不是有效 UTF-8",
            Some(error.to_string()),
            true,
        )
    })?;
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "UNADD_TARGET_STATUS_INVALID",
            "无法解析 Unadd 目标的 SVN 状态",
            Some(format!("svn status --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;
    let is_added = document
        .descendants()
        .filter(|node| node.has_tag_name("wc-status"))
        .any(|node| node.attribute("item") == Some("added"));
    if !is_added {
        return Err(NovaError::command(
            "UNADD_TARGET_NOT_ADDED",
            "只能对已 Add 的路径执行 Unadd",
            Some(format!("路径：{relative_path}")),
            true,
        ));
    }

    Ok(())
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

fn validate_unversioned_file_delete_target(
    svn_executable: &str,
    working_copy_root: &Path,
    relative_path: &str,
) -> Result<UnversionedFileIdentity, NovaError> {
    validate_delete_target_ancestors(working_copy_root, relative_path)?;

    let target = working_copy_root.join(relative_path);
    let metadata = fs::symlink_metadata(&target).map_err(|error| {
        let (code, message) = if error.kind() == std::io::ErrorKind::NotFound {
            ("DELETE_UNVERSIONED_FILE_NOT_FOUND", "未版本控制文件不存在")
        } else {
            (
                "DELETE_UNVERSIONED_FILE_CHECK_FAILED",
                "无法检查未版本控制文件",
            )
        };
        NovaError::command(
            code,
            message,
            Some(format!("路径：{}；错误：{error}", target.display())),
            true,
        )
    })?;
    if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
        return Err(NovaError::command(
            "DELETE_UNVERSIONED_FILE_UNSAFE",
            "未版本控制文件不能安全删除",
            Some("目标不能是符号链接或 reparse point。".to_string()),
            true,
        ));
    }
    if !metadata.is_file() {
        return Err(NovaError::command(
            "DELETE_UNVERSIONED_FILE_NOT_FILE",
            "删除目标不是普通文件",
            Some(format!("路径：{}", target.display())),
            true,
        ));
    }

    let canonical_path = fs::canonicalize(&target).map_err(|error| {
        NovaError::command(
            "DELETE_UNVERSIONED_FILE_CHECK_FAILED",
            "无法解析未版本控制文件",
            Some(format!("路径：{}；错误：{error}", target.display())),
            true,
        )
    })?;
    if !canonical_path.starts_with(working_copy_root) {
        return Err(NovaError::command(
            "DELETE_UNVERSIONED_FILE_OUTSIDE_WORKING_COPY",
            "未版本控制文件位于当前工作副本外",
            Some(format!(
                "工作副本：{}；目标：{}",
                working_copy_root.display(),
                canonical_path.display()
            )),
            true,
        ));
    }

    // Use the working-copy relative path for SVN. On Windows, fs::canonicalize
    // returns \\?\ extended paths; Subversion mishandles those absolute targets
    // (status succeeds with an empty entry list, which we would misread as
    // "no longer unversioned" / DELETE_UNVERSIONED_FILE_STATUS_CHANGED).
    let output = svn::command(svn_executable)
        .args(["status", "--xml", "--no-ignore", "--depth", "empty"])
        .arg(relative_path)
        .current_dir(working_copy_root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "DELETE_UNVERSIONED_FILE_STATUS_FAILED",
                "无法检查文件的 SVN 状态",
                Some(format!(
                    "无法执行 `{svn_executable} status --xml --no-ignore --depth empty`：{error}"
                )),
                true,
            )
        })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "DELETE_UNVERSIONED_FILE_STATUS_FAILED",
            "无法检查文件的 SVN 状态",
            Some(command_output_error_detail(
                svn_executable,
                "status --xml --no-ignore --depth empty",
                &output,
            )),
            true,
        ));
    }
    let xml = std::str::from_utf8(&output.stdout).map_err(|error| {
        NovaError::command(
            "DELETE_UNVERSIONED_FILE_STATUS_INVALID",
            "文件的 SVN 状态不是有效 UTF-8",
            Some(error.to_string()),
            true,
        )
    })?;
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "DELETE_UNVERSIONED_FILE_STATUS_INVALID",
            "无法解析文件的 SVN 状态",
            Some(format!("svn status --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;
    let statuses = document
        .descendants()
        .filter(|node| node.has_tag_name("wc-status"))
        .filter_map(|node| node.attribute("item"))
        .collect::<Vec<_>>();
    // Accept both common SVN spellings for untracked local files.
    let is_unversioned = matches!(statuses.as_slice(), ["unversioned"] | ["untracked"]);
    if !is_unversioned {
        return Err(NovaError::command(
            "DELETE_UNVERSIONED_FILE_STATUS_CHANGED",
            "删除目标不再是未版本控制文件",
            Some(format!(
                "路径：{relative_path}；当前状态：{}",
                if statuses.is_empty() {
                    "normal".to_string()
                } else {
                    statuses.join(", ")
                }
            )),
            true,
        ));
    }

    let mut file = fs::File::open(&canonical_path).map_err(|error| {
        NovaError::command(
            "DELETE_UNVERSIONED_FILE_READ_FAILED",
            "无法读取未版本控制文件",
            Some(format!("路径：{}；错误：{error}", canonical_path.display())),
            true,
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            NovaError::command(
                "DELETE_UNVERSIONED_FILE_READ_FAILED",
                "无法读取未版本控制文件",
                Some(format!("路径：{}；错误：{error}", canonical_path.display())),
                true,
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(UnversionedFileIdentity {
        canonical_path,
        bytes: metadata.len(),
        sha256: format!("{:x}", hasher.finalize()),
    })
}

fn validate_delete_target(
    svn_executable: &str,
    working_copy_root: &Path,
    relative_path: &str,
) -> Result<DeleteTargetIdentity, NovaError> {
    validate_delete_target_ancestors(working_copy_root, relative_path)?;

    let target = working_copy_root.join(relative_path);
    let output = svn::command(svn_executable)
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
        let unsafe_symlink = is_symlink && !is_target;
        let unsafe_reparse_point =
            metadata_is_reparse_point(&metadata) && !(is_target && is_symlink);
        if unsafe_symlink || unsafe_reparse_point {
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
        SvnOperationKind::UnaddFile => {
            format!("取消 Add {}", file_path.unwrap_or_default())
        }
        SvnOperationKind::DeletePath => {
            format!("删除 {}", file_path.unwrap_or_default())
        }
        SvnOperationKind::DeleteUnversionedFile => {
            format!("删除未版本控制文件 {}", file_path.unwrap_or_default())
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

pub(crate) fn normalize_repository_url(url: &str) -> Result<String, NovaError> {
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

fn repository_url_parent(url: &str) -> Option<&str> {
    url.rsplit_once('/')
        .and_then(|(parent, _)| (!parent.is_empty() && !parent.ends_with(':')).then_some(parent))
}

fn normalize_checkout_path(path: &str) -> Result<String, NovaError> {
    normalize_repository_local_path(path, "CHECKOUT_PATH", "本地工作副本路径")
}

fn normalize_export_path(path: &str) -> Result<String, NovaError> {
    normalize_repository_local_path(path, "EXPORT_PATH", "本地导出路径")
}

fn normalize_repository_drag_export_name(name: &str) -> Result<String, NovaError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "REPOSITORY_DRAG_EXPORT_NAME_REQUIRED",
            "仓库拖出条目名称不能为空",
            None,
            true,
        ));
    }

    let mut normalized = trimmed
        .chars()
        .take(180)
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    normalized = normalized.trim_end_matches([' ', '.']).to_string();
    if normalized.is_empty() || normalized == "." || normalized == ".." {
        normalized = "repository-export".to_string();
    }

    let stem = normalized
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        normalized.insert(0, '_');
    }

    Ok(normalized)
}

fn normalize_repository_local_path(
    path: &str,
    code_prefix: &str,
    label: &str,
) -> Result<String, NovaError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            format!("{code_prefix}_REQUIRED"),
            format!("请输入{label}"),
            None,
            true,
        ));
    }

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            format!("{code_prefix}_INVALID"),
            format!("{label}无效"),
            Some(format!("{label}不能包含控制字符。")),
            true,
        ));
    }

    let path = Path::new(trimmed);
    if !path_utils::is_absolute_or_home_path(path, trimmed) {
        return Err(NovaError::command(
            format!("{code_prefix}_INVALID"),
            format!("{label}无效"),
            Some(format!("{label}必须是绝对路径或 ~/ 开头路径。")),
            true,
        ));
    }

    Ok(trimmed.to_string())
}

fn validate_checkout_destination(path: &Path) -> Result<(), NovaError> {
    validate_repository_local_destination(path, "REPOSITORY_CHECKOUT", "Checkout")
}

fn validate_export_destination(path: &Path) -> Result<(), NovaError> {
    validate_repository_local_destination(path, "REPOSITORY_EXPORT", "Export")
}

fn validate_repository_import_source(path: &Path) -> Result<(), NovaError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        let code = if error.kind() == std::io::ErrorKind::NotFound {
            "REPOSITORY_IMPORT_SOURCE_MISSING"
        } else {
            "REPOSITORY_IMPORT_SOURCE_UNAVAILABLE"
        };
        NovaError::command(
            code,
            "Repository Import 本地源不可用",
            Some(format!("读取路径 `{}` 失败：{error}", path.display())),
            true,
        )
    })?;
    if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
        return Err(NovaError::command(
            "REPOSITORY_IMPORT_SOURCE_UNSAFE",
            "Repository Import 本地源不可用",
            Some("本地源不能是符号链接或 reparse point。".to_string()),
            true,
        ));
    }
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(NovaError::command(
            "REPOSITORY_IMPORT_SOURCE_UNSUPPORTED",
            "Repository Import 本地源类型不受支持",
            Some(format!("路径 `{}` 不是普通文件或目录。", path.display())),
            true,
        ));
    }
    Ok(())
}

fn validate_repository_local_destination(
    path: &Path,
    code_prefix: &str,
    operation: &str,
) -> Result<(), NovaError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
                return Err(NovaError::command(
                    format!("{code_prefix}_DESTINATION_UNSAFE"),
                    format!("{operation} 本地目标不可用"),
                    Some("目标目录不能是符号链接或 reparse point。".to_string()),
                    true,
                ));
            }
            if !metadata.is_dir() {
                return Err(NovaError::command(
                    format!("{code_prefix}_DESTINATION_NOT_DIRECTORY"),
                    format!("{operation} 本地目标不可用"),
                    Some("目标路径已存在且不是目录。".to_string()),
                    true,
                ));
            }
            let mut entries = fs::read_dir(path).map_err(|error| {
                NovaError::command(
                    format!("{code_prefix}_DESTINATION_UNREADABLE"),
                    format!("无法检查 {operation} 本地目标"),
                    Some(format!("读取目录 `{}` 失败：{error}", path.display())),
                    true,
                )
            })?;
            if entries
                .next()
                .transpose()
                .map_err(|error| {
                    NovaError::command(
                        format!("{code_prefix}_DESTINATION_UNREADABLE"),
                        format!("无法检查 {operation} 本地目标"),
                        Some(format!("读取目录 `{}` 失败：{error}", path.display())),
                        true,
                    )
                })?
                .is_some()
            {
                return Err(NovaError::command(
                    format!("{code_prefix}_DESTINATION_NOT_EMPTY"),
                    format!("{operation} 本地目标必须为空"),
                    Some(format!("目录 `{}` 已包含文件。", path.display())),
                    true,
                ));
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .ok_or_else(|| {
                    NovaError::command(
                        format!("{code_prefix}_PARENT_REQUIRED"),
                        format!("{operation} 本地目标不可用"),
                        Some("目标路径必须包含已存在的父目录。".to_string()),
                        true,
                    )
                })?;
            let parent_metadata = fs::metadata(parent).map_err(|error| {
                NovaError::command(
                    format!("{code_prefix}_PARENT_UNAVAILABLE"),
                    format!("{operation} 父目录不可用"),
                    Some(format!("读取父目录 `{}` 失败：{error}", parent.display())),
                    true,
                )
            })?;
            if !parent_metadata.is_dir() {
                return Err(NovaError::command(
                    format!("{code_prefix}_PARENT_NOT_DIRECTORY"),
                    format!("{operation} 父目录不可用"),
                    Some(format!("`{}` 不是目录。", parent.display())),
                    true,
                ));
            }
            Ok(())
        }
        Err(error) => Err(NovaError::command(
            format!("{code_prefix}_DESTINATION_UNAVAILABLE"),
            format!("无法检查 {operation} 本地目标"),
            Some(format!("读取路径 `{}` 失败：{error}", path.display())),
            true,
        )),
    }
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
                file_path: None,
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
            let file_path = request
                .file_path
                .as_deref()
                .filter(|path| !path.is_empty())
                .map(|path| {
                    normalize_strict_working_copy_path(
                        path,
                        "REVISION_DIFF_FILE_PATH_INVALID",
                        "工作副本比较文件路径无效",
                    )
                })
                .transpose()?;

            Ok(RevisionDiffTaskPayload {
                mode: RevisionDiffMode::WorkingCopyToRevision,
                working_copy_root: Some(working_copy_root.display().to_string()),
                file_path,
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
                file_path: None,
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

fn normalize_revert_target_revision(revision: &str) -> Result<String, NovaError> {
    let value = revision.trim();
    let number = value.parse::<u64>().map_err(|_| {
        NovaError::command(
            "REVERT_REVISION_TARGET_INVALID",
            "目标 Revision 无效",
            Some("目标 Revision 必须是有效的数字版本号。".to_string()),
            true,
        )
    })?;
    if value.is_empty() || !value.chars().all(|character| character.is_ascii_digit()) {
        return Err(NovaError::command(
            "REVERT_REVISION_TARGET_INVALID",
            "目标 Revision 无效",
            Some("目标 Revision 必须是数字版本号。".to_string()),
            true,
        ));
    }
    Ok(number.to_string())
}

fn normalize_revert_target_revisions(
    target_revision: Option<&str>,
    target_revisions: Option<&[String]>,
    whole_workspace: bool,
) -> Result<Vec<String>, NovaError> {
    let single = target_revision
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let multiple = target_revisions.filter(|revisions| !revisions.is_empty());
    if single.is_some() && multiple.is_some() {
        return Err(NovaError::command(
            "REVERT_REVISION_SELECTION_CONFLICT",
            "不能同时指定单个和多个 Revision",
            None,
            true,
        ));
    }

    let mut revisions = match (single, multiple) {
        (Some(revision), None) => vec![normalize_revert_target_revision(revision)?],
        (None, Some(revisions)) => revisions
            .iter()
            .map(|revision| normalize_revert_target_revision(revision))
            .collect::<Result<Vec<_>, _>>()?,
        _ => {
            return Err(NovaError::command(
                "REVERT_REVISION_TARGET_REQUIRED",
                "请选择要撤销的 Revision",
                None,
                true,
            ));
        }
    };
    if revisions.len() > 500 {
        return Err(NovaError::command(
            "REVERT_REVISIONS_TOO_MANY",
            "一次最多撤销 500 个 Revision",
            None,
            true,
        ));
    }
    revisions.sort_by_key(|revision| std::cmp::Reverse(revision.parse::<u64>().unwrap_or(0)));
    revisions.dedup();
    if whole_workspace && revisions.len() != 1 {
        return Err(NovaError::command(
            "REVERT_TO_REVISION_REQUIRES_SINGLE_TARGET",
            "回退到指定版本只能选择一个 Revision",
            None,
            true,
        ));
    }
    if !whole_workspace && revisions.iter().any(|revision| revision == "0") {
        return Err(NovaError::command(
            "REVERT_COMMIT_TARGET_OUT_OF_RANGE",
            "目标提交 Revision 无效",
            Some("r0 不包含可撤销的提交改动。".to_string()),
            true,
        ));
    }
    Ok(revisions)
}

fn revert_revision_selection_label(revisions: &[String]) -> String {
    match revisions {
        [revision] => format!("r{revision}"),
        _ => revisions
            .iter()
            .rev()
            .map(|revision| format!("r{revision}"))
            .collect::<Vec<_>>()
            .join("、"),
    }
}

pub(crate) fn normalize_repository_list_revision(
    revision: Option<&str>,
) -> Result<Option<String>, NovaError> {
    let Some(value) = revision.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.eq_ignore_ascii_case("HEAD") {
        return Ok(None);
    }
    if !value.chars().all(|character| character.is_ascii_digit()) {
        return Err(NovaError::command(
            "REPOSITORY_LIST_REVISION_INVALID",
            "仓库浏览 Revision 无效",
            Some("Revision 必须是单个数字版本号，留空表示 HEAD。".to_string()),
            true,
        ));
    }
    let value = value.parse::<u64>().map_err(|error| {
        NovaError::command(
            "REPOSITORY_LIST_REVISION_INVALID",
            "仓库浏览 Revision 无效",
            Some(error.to_string()),
            true,
        )
    })?;
    Ok(Some(value.to_string()))
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

fn normalize_merge_selection(
    start_revision: Option<String>,
    end_revision: Option<String>,
    revisions: Option<Vec<String>>,
) -> Result<MergeRevisionSelection, NovaError> {
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

    let mut revisions = revisions.unwrap_or_default();
    if !revisions.is_empty() && (start_revision.is_some() || end_revision.is_some()) {
        return Err(NovaError::command(
            "MERGE_SELECTION_CONFLICT",
            "不能同时指定 Revision 范围和离散 Revision",
            None,
            true,
        ));
    }
    if revisions.len() > 500 {
        return Err(NovaError::command(
            "MERGE_REVISIONS_TOO_MANY",
            "一次最多 Merge 500 个 Revision",
            None,
            true,
        ));
    }
    for revision in &mut revisions {
        *revision = revision.trim().to_string();
        if revision.is_empty()
            || !revision.bytes().all(|byte| byte.is_ascii_digit())
            || revision
                .parse::<u64>()
                .ok()
                .filter(|value| *value > 0)
                .is_none()
        {
            return Err(NovaError::command(
                "MERGE_REVISION_INVALID",
                "Merge revision 无效",
                Some("离散 Revision 必须是大于 0 的数字。".to_string()),
                true,
            ));
        }
    }
    revisions.sort_by_key(|revision| revision.parse::<u64>().unwrap_or(u64::MAX));
    revisions.dedup();

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

    Ok(MergeRevisionSelection {
        start_revision,
        end_revision,
        revisions,
    })
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

fn merge_revision_arguments(
    start_revision: &Option<String>,
    end_revision: &Option<String>,
    revisions: &[String],
) -> Vec<String> {
    if !revisions.is_empty() {
        return revisions
            .iter()
            .flat_map(|revision| ["-c".to_string(), revision.clone()])
            .collect();
    }
    merge_revision_arg(start_revision, end_revision)
        .map(|range| vec!["-r".to_string(), range])
        .unwrap_or_default()
}

fn merge_revision_label(
    start_revision: &Option<String>,
    end_revision: &Option<String>,
    revisions: &[String],
) -> String {
    if !revisions.is_empty() {
        return revisions.join(",");
    }
    merge_revision_arg(start_revision, end_revision).unwrap_or_else(|| "默认".to_string())
}

fn validate_merge_tracking_options(
    record_only: bool,
    ignore_ancestry: bool,
) -> Result<(), NovaError> {
    if record_only && ignore_ancestry {
        return Err(NovaError::command(
            "MERGE_TRACKING_OPTIONS_CONFLICT",
            "Record only 不能与 Ignore ancestry 同时使用",
            Some(
                "--record-only 只记录 mergeinfo，而 --ignore-ancestry 会禁用 merge tracking。"
                    .to_string(),
            ),
            true,
        ));
    }

    Ok(())
}

#[derive(Debug, Default, PartialEq, Eq)]
struct MergeOutputSummary {
    file_count: usize,
    added: usize,
    deleted: usize,
    updated: usize,
    conflicted: usize,
}

#[cfg(test)]
fn summarize_merge_output(output: &str) -> MergeOutputSummary {
    let mut summary = MergeOutputSummary::default();

    for line in output.lines() {
        summarize_merge_output_line(line, &mut summary);
    }

    summary
}

fn summarize_merge_output_line(line: &str, summary: &mut MergeOutputSummary) {
    let status_columns: Vec<char> = line.chars().take(4).collect();
    if !is_merge_status_columns(&status_columns) {
        return;
    }

    summary.file_count += 1;
    if status_columns.contains(&'C') {
        summary.conflicted += 1;
    } else if status_columns.first() == Some(&'A') {
        summary.added += 1;
    } else if status_columns.first() == Some(&'D') {
        summary.deleted += 1;
    } else {
        summary.updated += 1;
    }
}

fn is_merge_status_columns(status_columns: &[char]) -> bool {
    status_columns.len() >= 2
        && status_columns
            .iter()
            .any(|status| matches!(status, 'A' | 'D' | 'U' | 'C' | 'G' | 'M' | 'R' | 'E'))
        && status_columns.iter().any(|status| status.is_whitespace())
}

#[derive(Debug)]
struct MergeOutputAnalysis {
    output_text: String,
    output_truncated: bool,
    line_count: usize,
    summary: MergeOutputSummary,
    log_lines: Vec<String>,
    status_lines: Vec<String>,
    log_truncated: bool,
}

#[derive(Debug, Default)]
struct MergeOutputCollector {
    preview: Vec<u8>,
    line: Vec<u8>,
    total_bytes: u64,
    line_count: usize,
    summary: MergeOutputSummary,
    log_lines: Vec<String>,
    status_lines: Vec<String>,
    log_bytes: usize,
    log_truncated: bool,
}

impl MergeOutputCollector {
    fn read_file(&mut self, path: &Path) -> Result<(), NovaError> {
        let mut file = fs::File::open(path).map_err(|error| {
            NovaError::command(
                "MERGE_OUTPUT_READ_FAILED",
                "无法读取 Merge 命令输出",
                Some(format!("路径：{}；错误：{error}", path.display())),
                true,
            )
        })?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer).map_err(|error| {
                NovaError::command(
                    "MERGE_OUTPUT_READ_FAILED",
                    "无法读取 Merge 命令输出",
                    Some(error.to_string()),
                    true,
                )
            })?;
            if read == 0 {
                break;
            }
            self.consume_bytes(&buffer[..read])?;
        }
        self.finish_line()
    }

    fn consume_bytes(&mut self, bytes: &[u8]) -> Result<(), NovaError> {
        self.total_bytes = self.total_bytes.saturating_add(bytes.len() as u64);
        if self.total_bytes > MAX_MERGE_COMMAND_OUTPUT_BYTES {
            return Err(NovaError::command(
                "MERGE_OUTPUT_LIMIT_EXCEEDED",
                "Merge 命令输出过大",
                Some(format!(
                    "完整 Merge 输出超过安全上限 {MAX_MERGE_COMMAND_OUTPUT_BYTES} 字节"
                )),
                true,
            ));
        }
        let remaining = MERGE_OUTPUT_PREVIEW_MAX_BYTES.saturating_sub(self.preview.len());
        if remaining > 0 {
            self.preview
                .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        }
        for byte in bytes {
            self.line.push(*byte);
            if self.line.len() > MAX_MERGE_OUTPUT_LINE_BYTES {
                return Err(NovaError::command(
                    "MERGE_OUTPUT_LINE_LIMIT_EXCEEDED",
                    "Merge 命令输出单行过长",
                    Some(format!("单行输出超过 {MAX_MERGE_OUTPUT_LINE_BYTES} 字节")),
                    true,
                ));
            }
            if *byte == b'\n' {
                self.finish_line()?;
            }
        }
        Ok(())
    }

    fn finish_line(&mut self) -> Result<(), NovaError> {
        if self.line.is_empty() {
            return Ok(());
        }
        let line = String::from_utf8_lossy(&self.line);
        let line = line.trim_end_matches(['\r', '\n']);
        if !line.trim().is_empty() {
            self.line_count = self.line_count.saturating_add(1);
            summarize_merge_output_line(line, &mut self.summary);
            if is_merge_status_columns(&line.chars().take(4).collect::<Vec<_>>()) {
                if self.status_lines.len() >= MAX_MERGE_PREVIEW_FILE_ENTRIES {
                    return Err(NovaError::command(
                        "MERGE_PREVIEW_FILE_LIMIT_EXCEEDED",
                        "Merge 影响文件数量过多",
                        Some(format!(
                            "影响文件状态行超过 {MAX_MERGE_PREVIEW_FILE_ENTRIES} 项"
                        )),
                        true,
                    ));
                }
                self.status_lines.push(line.to_string());
            }
            let log_line = line.trim();
            if self.log_lines.len() >= MAX_RUNTIME_TASK_LOGS
                || self.log_bytes >= MAX_RUNTIME_TASK_LOG_BYTES
            {
                self.log_truncated = true;
            } else {
                let remaining = MAX_RUNTIME_TASK_LOG_BYTES - self.log_bytes;
                let preview = truncate_utf8(log_line, remaining);
                if preview.len() < log_line.len() {
                    self.log_truncated = true;
                }
                self.log_bytes += preview.len();
                self.log_lines.push(preview);
            }
        }
        self.line.clear();
        Ok(())
    }

    fn finish(self) -> MergeOutputAnalysis {
        let output_truncated = self.total_bytes > MERGE_OUTPUT_PREVIEW_MAX_BYTES as u64;
        let output_text = if self.total_bytes == 0 {
            "svn merge 没有输出。".to_string()
        } else {
            bounded_text_preview(
                String::from_utf8_lossy(&self.preview).into_owned(),
                MERGE_OUTPUT_PREVIEW_MAX_BYTES,
                "Merge 输出预览已截断",
            )
        };
        MergeOutputAnalysis {
            output_text,
            output_truncated,
            line_count: self.line_count,
            summary: self.summary,
            log_lines: self.log_lines,
            status_lines: self.status_lines,
            log_truncated: self.log_truncated,
        }
    }
}

fn analyze_merge_output_files(
    stdout: &TaskCommandOutputFile,
    stderr: &TaskCommandOutputFile,
) -> Result<MergeOutputAnalysis, NovaError> {
    let mut collector = MergeOutputCollector::default();
    collector.read_file(stdout.path())?;
    collector.read_file(stderr.path())?;
    Ok(collector.finish())
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
    let mut command = svn::command(executable);
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

fn bounded_apply_patch_output(output_text: String) -> (String, bool) {
    let truncated = output_text.len() > APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES;
    let preview = bounded_text_preview(
        output_text,
        APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES,
        "Patch 输出预览已截断",
    );
    (preview, truncated)
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ApplyPatchStats {
    applied: usize,
    offset_hunks: usize,
    rejected: usize,
    skipped: usize,
    conflicted: usize,
}

impl ApplyPatchStats {
    fn allows_apply(&self) -> bool {
        self.applied > 0 && self.rejected == 0 && self.skipped == 0 && self.conflicted == 0
    }
}

#[cfg(test)]
fn parse_apply_patch_stats(output: &str) -> ApplyPatchStats {
    let mut accumulator = ApplyPatchStatsAccumulator::default();
    for line in output.lines() {
        accumulator
            .consume_line(line)
            .expect("字符串 Patch 统计不应触发路径限制");
    }
    accumulator.finish()
}

#[derive(Debug, Default)]
struct ApplyPatchStatsAccumulator {
    stats: ApplyPatchStats,
    applied_paths: HashSet<String>,
    conflicted_paths: HashSet<String>,
    conflict_summary: usize,
    skipped_summary: usize,
}

impl ApplyPatchStatsAccumulator {
    fn consume_line(&mut self, line: &str) -> Result<(), NovaError> {
        let trimmed = line.trim_start();
        if let Some((actions, path)) = parse_apply_patch_action_line(trimmed) {
            if path.len() > MAX_APPLY_PATCH_OUTPUT_LINE_BYTES {
                return Err(NovaError::command(
                    "APPLY_PATCH_STATS_PATH_LIMIT_EXCEEDED",
                    "Patch 统计路径过长",
                    Some(format!(
                        "单条路径超过 {MAX_APPLY_PATCH_OUTPUT_LINE_BYTES} 字节"
                    )),
                    true,
                ));
            }
            if actions.contains('C') {
                self.conflicted_paths.insert(path.to_string());
            } else if actions
                .chars()
                .any(|action| matches!(action, 'A' | 'D' | 'U' | 'G'))
            {
                self.applied_paths.insert(path.to_string());
            }
            if self.applied_paths.len().max(self.conflicted_paths.len())
                > MAX_APPLY_PATCH_STATS_PATHS
            {
                return Err(NovaError::command(
                    "APPLY_PATCH_STATS_PATH_LIMIT_EXCEEDED",
                    "Patch 统计条目过多",
                    Some(format!(
                        "Patch 统计路径超过安全上限 {MAX_APPLY_PATCH_STATS_PATHS}"
                    )),
                    true,
                ));
            }
        }

        let lowercase = trimmed.to_ascii_lowercase();
        if lowercase.contains("rejected hunk") {
            self.stats.rejected += 1;
        }
        if lowercase.contains("hunk") && lowercase.contains("offset") {
            self.stats.offset_hunks += 1;
        }
        if lowercase.starts_with("skipped ") && !lowercase.starts_with("skipped paths:") {
            self.stats.skipped += 1;
        }

        for prefix in ["text conflicts:", "property conflicts:", "tree conflicts:"] {
            if let Some(count) = parse_apply_patch_summary_count(&lowercase, prefix) {
                self.conflict_summary = self.conflict_summary.saturating_add(count);
            }
        }
        if let Some(count) = parse_apply_patch_summary_count(&lowercase, "skipped paths:") {
            self.skipped_summary = self.skipped_summary.saturating_add(count);
        }
        Ok(())
    }

    fn finish(mut self) -> ApplyPatchStats {
        self.stats.applied = self
            .applied_paths
            .difference(&self.conflicted_paths)
            .count();
        self.stats.conflicted = self.conflicted_paths.len().max(self.conflict_summary);
        self.stats.skipped = self.stats.skipped.max(self.skipped_summary);
        self.stats
    }
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

#[derive(Debug, PartialEq, Eq)]
struct RevisionDiffAnalysis {
    preview_text: String,
    file_count: usize,
    line_count: usize,
    total_bytes: u64,
    truncated: bool,
}

fn analyze_revision_diff_file(path: &Path) -> Result<RevisionDiffAnalysis, NovaError> {
    let file = fs::File::open(path).map_err(|error| {
        NovaError::command(
            "REVISION_DIFF_OUTPUT_READ_FAILED",
            "无法读取 Revision Diff 输出",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;
    analyze_revision_diff_reader(file)
}

fn analyze_revision_diff_reader<R: Read>(mut reader: R) -> Result<RevisionDiffAnalysis, NovaError> {
    analyze_revision_diff_reader_with_limit(&mut reader, MAX_REVISION_DIFF_PATCH_BYTES)
}

fn analyze_revision_diff_reader_with_limit<R: Read>(
    reader: &mut R,
    max_patch_bytes: u64,
) -> Result<RevisionDiffAnalysis, NovaError> {
    const MAX_DIFF_PREFIX_BYTES: usize = 11;

    let mut buffer = [0_u8; 64 * 1024];
    let mut preview = Vec::with_capacity(REVISION_DIFF_PREVIEW_MAX_BYTES);
    let mut line_prefix = Vec::with_capacity(MAX_DIFF_PREFIX_BYTES);
    let mut total_bytes = 0u64;
    let mut line_count = 0usize;
    let mut file_count = 0usize;
    let mut ended_with_newline = false;

    loop {
        let read = reader.read(&mut buffer).map_err(|error| {
            NovaError::command(
                "REVISION_DIFF_OUTPUT_READ_FAILED",
                "无法读取 Revision Diff 输出",
                Some(error.to_string()),
                true,
            )
        })?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read as u64);
        if total_bytes > max_patch_bytes {
            return Err(NovaError::command(
                "REVISION_DIFF_OUTPUT_LIMIT_EXCEEDED",
                "Revision Diff 输出过大",
                Some(format!("完整 Patch 超过安全上限 {max_patch_bytes} 字节")),
                true,
            ));
        }

        let preview_remaining = REVISION_DIFF_PREVIEW_MAX_BYTES.saturating_sub(preview.len());
        if preview_remaining > 0 {
            preview.extend_from_slice(&buffer[..read.min(preview_remaining)]);
        }

        for byte in &buffer[..read] {
            if line_prefix.len() < MAX_DIFF_PREFIX_BYTES {
                line_prefix.push(*byte);
            }
            if *byte == b'\n' {
                line_count = line_count.saturating_add(1);
                if revision_diff_line_is_file_header(&line_prefix) {
                    file_count = file_count.saturating_add(1);
                }
                line_prefix.clear();
                ended_with_newline = true;
            } else {
                ended_with_newline = false;
            }
        }
    }

    if total_bytes > 0 && !ended_with_newline {
        line_count = line_count.saturating_add(1);
        if revision_diff_line_is_file_header(&line_prefix) {
            file_count = file_count.saturating_add(1);
        }
    }

    let preview_text = truncate_utf8(
        &String::from_utf8_lossy(&preview),
        REVISION_DIFF_PREVIEW_MAX_BYTES,
    );
    Ok(RevisionDiffAnalysis {
        preview_text,
        file_count,
        line_count,
        total_bytes,
        truncated: total_bytes > REVISION_DIFF_PREVIEW_MAX_BYTES as u64,
    })
}

fn revision_diff_line_is_file_header(prefix: &[u8]) -> bool {
    prefix.starts_with(b"Index: ") || prefix.starts_with(b"diff --git ")
}

fn copy_revision_diff_patch(
    payload: &RevisionDiffTaskPayload,
    task_id: &str,
    target: &str,
    source_path: &Path,
    total_bytes: u64,
) -> Result<Option<RevisionDiffPatchFile>, NovaError> {
    if total_bytes == 0 {
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
    let copied = fs::copy(source_path, &path).map_err(|error| {
        NovaError::command(
            "REVISION_DIFF_PATCH_WRITE_FAILED",
            "写入 Revision Diff patch 失败",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;
    if copied != total_bytes {
        fs::remove_file(&path).ok();
        return Err(NovaError::command(
            "REVISION_DIFF_PATCH_WRITE_FAILED",
            "Revision Diff patch 写入不完整",
            Some(format!("预期 {total_bytes} 字节，实际写入 {copied} 字节")),
            true,
        ));
    }

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

fn compact_repository_url(url: &str) -> String {
    const MAX_CHARS: usize = 48;
    let url = redact_credentials(url);
    if url.chars().count() <= MAX_CHARS {
        return url;
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

fn parse_repository_list_xml_reader<R: BufRead>(
    reader: R,
    url: &str,
    revision: Option<&str>,
) -> Result<RepositoryListResult, NovaError> {
    parse_repository_list_xml_reader_with_limits(
        reader,
        url,
        revision,
        MAX_REPOSITORY_LIST_ENTRIES,
        MAX_REPOSITORY_LIST_TEXT_BYTES,
    )
}

#[derive(Debug, Default)]
struct StreamingRepositoryListEntry {
    name: String,
    kind: String,
    revision: String,
    author: String,
    date: String,
}

#[derive(Debug, Clone, Copy)]
enum RepositoryListTextField {
    Name,
    Author,
    Date,
}

fn parse_repository_list_xml_reader_with_limits<R: BufRead>(
    reader: R,
    url: &str,
    revision: Option<&str>,
    max_entries: usize,
    max_text_bytes: usize,
) -> Result<RepositoryListResult, NovaError> {
    let mut reader = XmlReader::from_reader(reader);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut entries = Vec::new();
    let mut current_entry: Option<StreamingRepositoryListEntry> = None;
    let mut reading_field: Option<RepositoryListTextField> = None;
    let mut entry_count = 0usize;
    let mut total_text_bytes = 0usize;

    loop {
        let event = reader.read_event_into(&mut buffer).map_err(|error| {
            repository_list_xml_error(format!("svn list --xml 返回了无法解析的 XML：{error}"))
        })?;
        match event {
            Event::Start(start) if start.name().as_ref() == b"entry" => {
                entry_count = entry_count.saturating_add(1);
                if entry_count > max_entries {
                    return Err(NovaError::command(
                        "SVN_LIST_ENTRY_LIMIT_EXCEEDED",
                        "仓库目录包含过多条目",
                        Some(format!("仓库目录条目数超过安全上限 {max_entries}")),
                        true,
                    ));
                }
                let mut entry = StreamingRepositoryListEntry {
                    kind: "file".to_string(),
                    ..StreamingRepositoryListEntry::default()
                };
                for attribute in start.attributes() {
                    let attribute = attribute.map_err(|error| {
                        repository_list_xml_error(format!("仓库条目属性无法解析：{error}"))
                    })?;
                    if attribute.key.as_ref() == b"kind" {
                        entry.kind = attribute
                            .decode_and_unescape_value(reader.decoder())
                            .map_err(|error| {
                                repository_list_xml_error(format!("仓库条目类型无法解码：{error}"))
                            })?
                            .into_owned();
                        validate_repository_list_field(&entry.kind)?;
                        account_repository_list_text(
                            &entry.kind,
                            &mut total_text_bytes,
                            max_text_bytes,
                        )?;
                    }
                }
                current_entry = Some(entry);
            }
            Event::Start(start) if start.name().as_ref() == b"commit" => {
                if let Some(entry) = current_entry.as_mut() {
                    for attribute in start.attributes() {
                        let attribute = attribute.map_err(|error| {
                            repository_list_xml_error(format!("仓库提交属性无法解析：{error}"))
                        })?;
                        if attribute.key.as_ref() == b"revision" {
                            entry.revision = attribute
                                .decode_and_unescape_value(reader.decoder())
                                .map_err(|error| {
                                    repository_list_xml_error(format!(
                                        "仓库提交 Revision 无法解码：{error}"
                                    ))
                                })?
                                .into_owned();
                            validate_repository_list_field(&entry.revision)?;
                            account_repository_list_text(
                                &entry.revision,
                                &mut total_text_bytes,
                                max_text_bytes,
                            )?;
                        }
                    }
                }
            }
            Event::Start(start) if start.name().as_ref() == b"name" => {
                reading_field = current_entry
                    .as_ref()
                    .map(|_| RepositoryListTextField::Name);
            }
            Event::Start(start) if start.name().as_ref() == b"author" => {
                reading_field = current_entry
                    .as_ref()
                    .map(|_| RepositoryListTextField::Author);
            }
            Event::Start(start) if start.name().as_ref() == b"date" => {
                reading_field = current_entry
                    .as_ref()
                    .map(|_| RepositoryListTextField::Date);
            }
            Event::Text(text) if reading_field.is_some() => {
                let decoded = text.decode().map_err(|error| {
                    repository_list_xml_error(format!("仓库条目文本无法解码：{error}"))
                })?;
                let decoded = unescape(&decoded).map_err(|error| {
                    repository_list_xml_error(format!("仓库条目转义字符无法解析：{error}"))
                })?;
                if let (Some(entry), Some(field)) = (current_entry.as_mut(), reading_field) {
                    append_repository_list_text(
                        entry,
                        field,
                        &decoded,
                        &mut total_text_bytes,
                        max_text_bytes,
                    )?;
                }
            }
            Event::CData(text) if reading_field.is_some() => {
                let decoded = text.decode().map_err(|error| {
                    repository_list_xml_error(format!("仓库条目 CDATA 无法解码：{error}"))
                })?;
                if let (Some(entry), Some(field)) = (current_entry.as_mut(), reading_field) {
                    append_repository_list_text(
                        entry,
                        field,
                        &decoded,
                        &mut total_text_bytes,
                        max_text_bytes,
                    )?;
                }
            }
            Event::GeneralRef(reference) if reading_field.is_some() => {
                let decoded = reference.decode().map_err(|error| {
                    repository_list_xml_error(format!("仓库条目实体无法解码：{error}"))
                })?;
                let resolved = if let Some(character) =
                    reference.resolve_char_ref().map_err(|error| {
                        repository_list_xml_error(format!("仓库条目字符引用无法解析：{error}"))
                    })? {
                    character.to_string()
                } else {
                    resolve_xml_entity(&decoded)
                        .ok_or_else(|| {
                            repository_list_xml_error(format!("仓库条目包含未知实体：&{decoded};"))
                        })?
                        .to_string()
                };
                if let (Some(entry), Some(field)) = (current_entry.as_mut(), reading_field) {
                    append_repository_list_text(
                        entry,
                        field,
                        &resolved,
                        &mut total_text_bytes,
                        max_text_bytes,
                    )?;
                }
            }
            Event::End(end) if matches!(end.name().as_ref(), b"name" | b"author" | b"date") => {
                reading_field = None;
            }
            Event::End(end) if end.name().as_ref() == b"entry" => {
                reading_field = None;
                if let Some(mut entry) = current_entry.take() {
                    entry.name = entry.name.trim().to_string();
                    entry.kind = entry.kind.trim().to_string();
                    entry.revision = entry.revision.trim().to_string();
                    entry.author = entry.author.trim().to_string();
                    entry.date = entry.date.trim().to_string();
                    entries.push(RepositoryListEntry {
                        name: entry.name,
                        kind: entry.kind,
                        revision: entry.revision,
                        author: entry.author,
                        date: entry.date,
                    });
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
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
        revision: revision.map(ToString::to_string),
        entries,
    })
}

fn append_repository_list_text(
    entry: &mut StreamingRepositoryListEntry,
    field: RepositoryListTextField,
    value: &str,
    total_text_bytes: &mut usize,
    max_text_bytes: usize,
) -> Result<(), NovaError> {
    let target = match field {
        RepositoryListTextField::Name => &mut entry.name,
        RepositoryListTextField::Author => &mut entry.author,
        RepositoryListTextField::Date => &mut entry.date,
    };
    target.push_str(value);
    validate_repository_list_field(target)?;
    account_repository_list_text(value, total_text_bytes, max_text_bytes)
}

fn validate_repository_list_field(value: &str) -> Result<(), NovaError> {
    if value.len() <= MAX_REPOSITORY_LIST_FIELD_BYTES {
        return Ok(());
    }
    Err(NovaError::command(
        "SVN_LIST_FIELD_LIMIT_EXCEEDED",
        "仓库目录包含过长字段",
        Some(format!(
            "单个名称、类型、Revision、作者或日期字段超过 {MAX_REPOSITORY_LIST_FIELD_BYTES} 字节"
        )),
        true,
    ))
}

fn account_repository_list_text(
    value: &str,
    total_text_bytes: &mut usize,
    max_text_bytes: usize,
) -> Result<(), NovaError> {
    *total_text_bytes = (*total_text_bytes).saturating_add(value.len());
    if *total_text_bytes > max_text_bytes {
        return Err(NovaError::command(
            "SVN_LIST_TEXT_LIMIT_EXCEEDED",
            "仓库目录文本数据过大",
            Some(format!("累计文本超过安全上限 {max_text_bytes} 字节")),
            true,
        ));
    }
    Ok(())
}

fn repository_list_xml_error(detail: String) -> NovaError {
    NovaError::command(
        "SVN_LIST_XML_PARSE_FAILED",
        "解析仓库目录失败",
        Some(detail),
        true,
    )
}

fn text_child(node: roxmltree::Node<'_, '_>, tag_name: &str) -> Option<String> {
    node.children()
        .find(|child| child.has_tag_name(tag_name))
        .and_then(|child| child.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(not(windows))]
    use std::os::unix::fs::PermissionsExt;
    use std::{
        fs,
        io::{Cursor, Write},
    };

    fn test_temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("novasvn-task-test-{name}-{}", timestamp_millis()));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    fn test_file_repository_url(repository: &Path) -> String {
        let path = repository.to_string_lossy().replace('\\', "/");
        #[cfg(windows)]
        {
            format!("file:///{}", path.trim_start_matches('/'))
        }
        #[cfg(not(windows))]
        {
            format!("file://{path}")
        }
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
        // CI 并行跑真实 SVN 时，单任务偶发超过旧的 2 秒轮询窗口。
        const TIMEOUT: Duration = Duration::from_secs(30);
        let deadline = Instant::now() + TIMEOUT;
        loop {
            let task = queue.get_task(task_id).expect("task exists");
            if matches!(
                task.status,
                TaskStatus::Success
                    | TaskStatus::Failed
                    | TaskStatus::Cancelled
                    | TaskStatus::Interrupted
            ) {
                return task;
            }
            if Instant::now() >= deadline {
                panic!(
                    "任务未在测试超时前结束：task_id={task_id}, status={:?}, timeout={TIMEOUT:?}",
                    task.status
                );
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    fn repository_file_test_state(task_id: &str) -> Arc<Mutex<TaskQueueState>> {
        let now = timestamp_millis();
        Arc::new(Mutex::new(TaskQueueState {
            tasks: vec![Task {
                task_id: task_id.to_string(),
                title: "仓库文件测试".to_string(),
                status: TaskStatus::Pending,
                logs: Vec::new(),
                error: None,
                result: None,
                created_at: now,
                updated_at: now,
                payload: TaskPayload::Mock(MockTaskOutcome::Success),
            }],
            pending: VecDeque::new(),
            running_task_id: Some(task_id.to_string()),
            running_processes: HashMap::new(),
            cancellation_requested: HashSet::new(),
            persistence_path: None,
        }))
    }

    fn persisted_test_task(task_id: &str, status: TaskStatus, now: u64) -> Task {
        Task {
            task_id: task_id.to_string(),
            title: format!("测试任务 {task_id}"),
            status,
            logs: vec![TaskLog {
                message: "任务已加入队列".to_string(),
                created_at: now,
            }],
            error: None,
            result: None,
            created_at: now,
            updated_at: now,
            payload: TaskPayload::Recovered,
        }
    }

    #[cfg(not(windows))]
    fn slow_test_command(root: &Path) -> Command {
        let path = root.join("slow-task-command.sh");
        fs::write(&path, "#!/bin/sh\nsleep 0.3\nprintf tracked\n").expect("慢速测试脚本应能写入");
        // 通过 sh 解释执行，避免 Linux 上对刚写入脚本直接 exec 时偶发 ETXTBSY
        let mut command = Command::new("sh");
        command.arg(path);
        command
    }

    #[cfg(windows)]
    fn slow_test_command(_root: &Path) -> Command {
        let mut command = Command::new("cmd");
        command.args(["/C", "ping -n 2 127.0.0.1 >NUL && <NUL set /P =tracked"]);
        command
    }

    #[cfg(unix)]
    fn process_tree_test_command(root: &Path, marker: &Path) -> Command {
        let path = root.join("process-tree-task.sh");
        fs::write(
            &path,
            format!(
                "#!/bin/sh\n(sleep 1; printf child > '{}') &\nsleep 5\n",
                marker.display()
            ),
        )
        .expect("进程树测试脚本应能写入");
        let mut command = Command::new("sh");
        command.arg(path);
        command
    }

    #[cfg(unix)]
    fn active_output_test_command(root: &Path) -> Command {
        let path = root.join("active-output-task.sh");
        fs::write(
            &path,
            "#!/bin/sh\nfor value in 1 2 3 4 5 6 7 8; do printf tick; sleep 0.05; done\n",
        )
        .expect("活动输出测试脚本应能写入");
        // 经 sh 启动，规避「写入脚本后立刻 exec」在 CI 上触发 ExecutableFileBusy
        let mut command = Command::new("sh");
        command.arg(path);
        command
    }

    fn running_process_test_queue(task_id: &str) -> (TaskQueue, Arc<Mutex<TaskQueueState>>) {
        let state = Arc::new(Mutex::new(TaskQueueState {
            tasks: vec![persisted_test_task(
                task_id,
                TaskStatus::Running,
                timestamp_millis(),
            )],
            running_task_id: Some(task_id.to_string()),
            ..TaskQueueState::default()
        }));
        let queue = TaskQueue {
            state: Arc::clone(&state),
            next_id: AtomicU64::new(2),
            worker_running: Arc::new(AtomicBool::new(true)),
        };
        (queue, state)
    }

    fn wait_for_registered_process(state: &Arc<Mutex<TaskQueueState>>, task_id: &str) {
        for _ in 0..100 {
            if state
                .lock()
                .expect("任务队列锁应可用")
                .running_processes
                .contains_key(task_id)
            {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("任务运行期间应保存子进程句柄");
    }

    #[test]
    fn tracks_task_process_handle_lifecycle() {
        let root = test_temp_dir("task-process-handle");
        let (_queue, state) = running_process_test_queue("task-process");
        let worker_state = Arc::clone(&state);
        let mut command = slow_test_command(&root);
        let worker = thread::spawn(move || {
            run_task_command(&worker_state, "task-process", &mut command)
                .expect("慢速测试命令应成功")
        });

        let mut registered_child = None;
        for _ in 0..100 {
            registered_child = state
                .lock()
                .expect("任务队列锁应可用")
                .running_processes
                .get("task-process")
                .cloned();
            if registered_child.is_some() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }

        let registered_child = registered_child.expect("任务运行期间应保存子进程句柄");
        assert!(registered_child.lock().expect("子进程锁应可用").id() > 0);
        let output = worker.join().expect("命令线程应正常结束");
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout), "tracked");
        assert!(!state
            .lock()
            .expect("任务队列锁应可用")
            .running_processes
            .contains_key("task-process"));
        let task = state.lock().expect("任务队列锁应可用").tasks[0].clone();
        assert!(task
            .logs
            .iter()
            .any(|log| log.message.starts_with("启动命令：")));
        assert!(task
            .logs
            .iter()
            .any(|log| log.message == "命令退出：退出码 0"));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn redacts_sensitive_task_command_arguments() {
        let mut command = Command::new("svn");
        command.args([
            "commit",
            "--username",
            "private-user",
            "--password=private-password",
            "-m",
            "private-log-message",
            "--config-option",
            "servers:global:http-auth-types=private-config",
            "https://url-user:url-password@example.com/repository?token=query-token",
        ]);

        let formatted = format_task_command(&command);
        assert!(formatted.contains("<已隐藏>"));
        assert!(formatted.contains("https://<凭据>@example.com/repository?token=<已隐藏>"));
        for secret in [
            "private-user",
            "private-password",
            "private-log-message",
            "private-config",
            "url-user",
            "url-password",
            "query-token",
        ] {
            assert!(!formatted.contains(secret));
        }
    }

    #[test]
    fn redacts_task_logs_errors_and_recovered_history() {
        let state = Arc::new(Mutex::new(TaskQueueState {
            tasks: vec![persisted_test_task(
                "task-redaction",
                TaskStatus::Running,
                timestamp_millis(),
            )],
            ..TaskQueueState::default()
        }));
        append_task_log(
            &state,
            "task-redaction",
            "svn: https://log-user:log-password@example.test/repo --password log-secret",
        );
        update_task(
            &state,
            "task-redaction",
            TaskStatus::Failed,
            "Authorization: Bearer terminal-secret",
            Some("token=error-secret".to_string()),
        );

        let task = state.lock().expect("任务队列锁应可用").tasks[0].clone();
        let serialized = serde_json::to_string(&PersistedTask::from(&task)).unwrap();
        assert!(serialized.contains("<凭据>"));
        assert!(serialized.contains("<已隐藏>"));
        for secret in [
            "log-user",
            "log-password",
            "log-secret",
            "terminal-secret",
            "error-secret",
        ] {
            assert!(!serialized.contains(secret));
        }

        let recovered = Task::from(PersistedTask {
            task_id: "task-recovered-redaction".to_string(),
            title: "https://title-user:title-password@example.test/repo".to_string(),
            status: TaskStatus::Failed,
            logs: vec![TaskLog {
                message: "password=legacy-log-secret".to_string(),
                created_at: 1,
            }],
            error: Some("Authorization: Basic legacy-error-secret".to_string()),
            created_at: 1,
            updated_at: 1,
        });
        let recovered_text = serde_json::to_string(&recovered).unwrap();
        for secret in [
            "title-user",
            "title-password",
            "legacy-log-secret",
            "legacy-error-secret",
        ] {
            assert!(!recovered_text.contains(secret));
        }
    }

    #[test]
    fn records_pending_task_cancellation_reason() {
        let state = Arc::new(Mutex::new(TaskQueueState {
            tasks: vec![persisted_test_task(
                "task-pending-cancel",
                TaskStatus::Pending,
                timestamp_millis(),
            )],
            pending: VecDeque::from(["task-pending-cancel".to_string()]),
            ..TaskQueueState::default()
        }));
        let queue = TaskQueue {
            state,
            next_id: AtomicU64::new(2),
            worker_running: Arc::new(AtomicBool::new(false)),
        };

        let task = queue
            .cancel_task("task-pending-cancel")
            .expect("排队任务应可取消");
        assert!(matches!(task.status, TaskStatus::Cancelled));
        assert!(task
            .logs
            .iter()
            .any(|log| log.message == "取消原因：用户在任务开始前取消"));
    }

    #[test]
    fn cancels_running_task_process_and_keeps_cancelled_status() {
        let root = test_temp_dir("cancel-running-task");
        let (queue, state) = running_process_test_queue("task-cancel");
        let worker_state = Arc::clone(&state);
        let mut command = slow_test_command(&root);
        let worker = thread::spawn(move || {
            let result = run_task_command(&worker_state, "task-cancel", &mut command);
            update_task(
                &worker_state,
                "task-cancel",
                TaskStatus::Failed,
                "测试子进程已结束",
                result.as_ref().err().map(ToString::to_string),
            );
        });

        wait_for_registered_process(&state, "task-cancel");
        queue
            .cancel_task("task-cancel")
            .expect("运行中任务应接受取消请求");
        worker.join().expect("取消测试线程应正常结束");

        let task = queue.get_task("task-cancel").expect("取消后的任务应可读取");
        assert!(matches!(task.status, TaskStatus::Cancelled));
        assert!(task.error.is_none());
        assert!(task
            .logs
            .iter()
            .any(|log| log.message.contains("取消原因：用户请求取消运行中任务")));
        assert!(task
            .logs
            .iter()
            .any(|log| log.message == "任务已取消，SVN 进程树已终止"));
        assert!(state
            .lock()
            .expect("任务队列锁应可用")
            .cancellation_requested
            .is_empty());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn terminates_task_command_after_idle_timeout() {
        let root = test_temp_dir("task-idle-timeout");
        let (_queue, state) = running_process_test_queue("task-idle-timeout");
        let mut command = slow_test_command(&root);
        let error = run_task_command_with_limits(
            &state,
            "task-idle-timeout",
            &mut command,
            TaskCommandLimits {
                timeout: Duration::from_secs(2),
                idle_timeout: Some(Duration::from_millis(100)),
            },
        )
        .expect_err("静默命令应触发无输出超时");

        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        assert!(error.to_string().contains("无输出"));
        assert!(state
            .lock()
            .expect("任务队列锁应可用")
            .running_processes
            .is_empty());
        assert!(state.lock().expect("任务队列锁应可用").tasks[0]
            .logs
            .iter()
            .any(|log| log.message.contains("命令执行异常") && log.message.contains("无输出")));
        fs::remove_dir_all(root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn output_activity_renews_idle_timeout() {
        let root = test_temp_dir("task-output-activity");
        let state = Arc::new(Mutex::new(TaskQueueState::default()));
        let mut command = active_output_test_command(&root);
        let output = run_task_command_with_limits(
            &state,
            "task-output-activity",
            &mut command,
            TaskCommandLimits {
                timeout: Duration::from_secs(2),
                idle_timeout: Some(Duration::from_millis(150)),
            },
        )
        .expect("持续输出命令不应触发空闲超时");

        assert!(output.status.success());
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            "tick".repeat(8),
            "活动输出脚本应完整输出全部 tick"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn bounds_child_pipe_preview_while_draining_all_bytes() {
        let last_output_at = Arc::new(Mutex::new(Instant::now()));
        let input = "中文输出".repeat(4).into_bytes();
        let result = read_child_pipe(
            Some(Cursor::new(input.clone())),
            Arc::clone(&last_output_at),
            Some(4),
        )
        .expect("读取有界输出应成功");

        assert_eq!(result.total_bytes, input.len());
        assert!(result.truncated);
        assert_eq!(result.bytes, "中".as_bytes());
        assert!(
            *last_output_at.lock().expect("输出时间锁应可用")
                > Instant::now() - Duration::from_secs(1)
        );
    }

    #[test]
    fn keeps_unbounded_child_pipe_output_for_structured_commands() {
        let last_output_at = Arc::new(Mutex::new(Instant::now()));
        let input = "structured output\n".repeat(1024).into_bytes();
        let result = read_child_pipe(Some(Cursor::new(input.clone())), last_output_at, None)
            .expect("读取完整输出应成功");

        assert_eq!(result.bytes, input);
        assert_eq!(result.total_bytes, result.bytes.len());
        assert!(!result.truncated);
    }

    #[test]
    fn streams_complete_child_output_lines_into_the_running_task() {
        let task_id = "task-stream-output";
        let mut task = persisted_test_task(task_id, TaskStatus::Running, timestamp_millis());
        task.logs.clear();
        let state = Arc::new(Mutex::new(TaskQueueState {
            tasks: vec![task],
            ..TaskQueueState::default()
        }));
        let streamer = TaskOutputStreamer {
            state: Arc::clone(&state),
            task_id: task_id.to_string(),
        };
        let input = b"U    src/first.ts\nUG   src/properties.ts\nA    src/final.ts".to_vec();

        let result = read_child_pipe_with_streamer(
            Some(Cursor::new(input.clone())),
            Arc::new(Mutex::new(Instant::now())),
            Some(MAX_TASK_COMMAND_OUTPUT_BYTES),
            Some(streamer),
        )
        .expect("stream child output");

        assert_eq!(result.bytes, input);
        let queue = state.lock().expect("task queue lock");
        assert_eq!(
            queue.tasks[0]
                .logs
                .iter()
                .map(|log| log.message.as_str())
                .collect::<Vec<_>>(),
            vec![
                "U    src/first.ts",
                "UG   src/properties.ts",
                "A    src/final.ts"
            ]
        );
    }

    #[test]
    fn bounds_runtime_task_logs_by_lines_and_bytes() {
        let state = Arc::new(Mutex::new(TaskQueueState {
            tasks: vec![persisted_test_task(
                "task-runtime-log-limit",
                TaskStatus::Running,
                timestamp_millis(),
            )],
            ..TaskQueueState::default()
        }));

        for index in 0..(MAX_RUNTIME_TASK_LOGS + 20) {
            append_task_log(
                &state,
                "task-runtime-log-limit",
                &format!("日志行 {index}：{}", "x".repeat(256)),
            );
        }
        append_task_log(
            &state,
            "task-runtime-log-limit",
            &"超长日志".repeat(MAX_RUNTIME_TASK_LOG_BYTES),
        );

        let task = state.lock().expect("任务队列锁应可用").tasks[0].clone();
        assert!(task.logs.len() <= MAX_RUNTIME_TASK_LOGS);
        assert!(
            task.logs.iter().map(|log| log.message.len()).sum::<usize>()
                <= MAX_RUNTIME_TASK_LOG_BYTES
        );
        assert!(task
            .logs
            .iter()
            .any(|log| log.message == TASK_LOG_TRUNCATION_MARKER));
        assert!(task
            .logs
            .iter()
            .all(|log| log.message.is_char_boundary(log.message.len())));
    }

    #[cfg(unix)]
    #[test]
    fn terminates_active_task_command_after_total_timeout() {
        let root = test_temp_dir("task-total-timeout");
        let state = Arc::new(Mutex::new(TaskQueueState::default()));
        let mut command = active_output_test_command(&root);
        // 总时限略宽于 idle，且脚本持续输出，确保命中「总运行超时」而非「无输出超时」
        let error = run_task_command_with_limits(
            &state,
            "task-total-timeout",
            &mut command,
            TaskCommandLimits {
                timeout: Duration::from_millis(280),
                idle_timeout: Some(Duration::from_millis(220)),
            },
        )
        .expect_err("持续输出命令仍应受总时限约束");

        assert_eq!(
            error.kind(),
            std::io::ErrorKind::TimedOut,
            "期望总时限 TimedOut，实际：{error:?}"
        );
        assert!(
            error.to_string().contains("运行超过"),
            "超时信息应说明总运行时限：{error}"
        );
        fs::remove_dir_all(root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn cancels_entire_unix_process_group() {
        let root = test_temp_dir("cancel-process-tree");
        let marker = root.join("child-finished.txt");
        let (queue, state) = running_process_test_queue("task-tree");
        let worker_state = Arc::clone(&state);
        let mut command = process_tree_test_command(&root, &marker);
        let worker = thread::spawn(move || {
            let result = run_task_command(&worker_state, "task-tree", &mut command);
            update_task(
                &worker_state,
                "task-tree",
                TaskStatus::Failed,
                "进程树测试已结束",
                result.as_ref().err().map(ToString::to_string),
            );
        });

        wait_for_registered_process(&state, "task-tree");
        queue.cancel_task("task-tree").expect("Unix 进程树应可终止");
        worker.join().expect("进程树测试线程应正常结束");
        thread::sleep(Duration::from_millis(1_200));

        assert!(!marker.exists(), "取消后孙进程不应继续写入标记文件");
        assert!(matches!(
            queue.get_task("task-tree").expect("任务应存在").status,
            TaskStatus::Cancelled
        ));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn restores_unfinished_task_history_as_interrupted_once() {
        let root = test_temp_dir("task-history-restart");
        let path = root.join("task-history.json");
        let now = timestamp_millis();
        let state = TaskQueueState {
            tasks: vec![
                persisted_test_task("task-7", TaskStatus::Pending, now),
                persisted_test_task("task-8", TaskStatus::Running, now),
                persisted_test_task("task-9", TaskStatus::Success, now),
            ],
            pending: VecDeque::new(),
            running_task_id: Some("task-8".to_string()),
            running_processes: HashMap::new(),
            cancellation_requested: HashSet::new(),
            persistence_path: Some(path.clone()),
        };
        persist_task_history(&state).expect("任务历史应能写入");

        let queue = TaskQueue::persistent(path.clone());
        let snapshot = queue.list_tasks();
        assert!(snapshot.running_task_id.is_none());
        assert!(matches!(snapshot.tasks[0].status, TaskStatus::Interrupted));
        assert!(matches!(snapshot.tasks[1].status, TaskStatus::Interrupted));
        assert!(matches!(snapshot.tasks[2].status, TaskStatus::Success));
        assert_eq!(queue.next_id.load(Ordering::Relaxed), 10);

        let interrupted = queue.get_task("task-7").expect("中断任务应可读取");
        assert!(interrupted
            .error
            .as_deref()
            .is_some_and(|error| error.contains("不会自动重试")));
        assert_eq!(
            interrupted
                .logs
                .iter()
                .filter(|log| log.message.contains("应用重启时检测到未完成任务"))
                .count(),
            1
        );
        drop(queue);

        let reopened = TaskQueue::persistent(path.clone());
        let interrupted = reopened.get_task("task-7").expect("中断任务应继续保留");
        assert_eq!(
            interrupted
                .logs
                .iter()
                .filter(|log| log.message.contains("应用重启时检测到未完成任务"))
                .count(),
            1
        );

        let content = fs::read_to_string(path).expect("任务历史应可读取");
        assert!(content.contains("\"status\": \"interrupted\""));
        assert!(!content.contains("payload"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn surfaces_corrupted_task_history_without_blocking_startup() {
        let root = test_temp_dir("task-history-corrupted");
        let path = root.join("task-history.json");
        fs::write(&path, "{invalid json").expect("损坏历史应能写入");

        let queue = TaskQueue::persistent(path);
        let snapshot = queue.list_tasks();
        assert_eq!(snapshot.tasks.len(), 1);
        assert!(matches!(snapshot.tasks[0].status, TaskStatus::Interrupted));
        assert_eq!(snapshot.tasks[0].title, "任务历史恢复失败");
        let task = queue
            .get_task(&snapshot.tasks[0].task_id)
            .expect("恢复错误任务应可读取");
        assert!(task
            .error
            .as_deref()
            .is_some_and(|error| error.contains("解析")));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn persists_completed_task_history_across_queue_recreation() {
        let root = test_temp_dir("task-history-completed");
        let path = root.join("task-history.json");
        let queue = TaskQueue::persistent(path.clone());
        let task = queue.create_mock_task(CreateMockTaskRequest {
            title: Some("持久化完成任务".to_string()),
            outcome: MockTaskOutcome::Success,
        });
        let completed = wait_for_test_task(&queue, &task.task_id);
        assert!(matches!(completed.status, TaskStatus::Success));
        drop(queue);

        let reopened = TaskQueue::persistent(path);
        let restored = reopened
            .get_task(&task.task_id)
            .expect("完成任务应在队列重建后保留");
        assert!(matches!(restored.status, TaskStatus::Success));
        assert!(restored
            .logs
            .iter()
            .any(|log| log.message == "任务执行成功"));
        assert!(restored.result.is_none());

        fs::remove_dir_all(root).ok();
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
    fn matches_status_paths_back_to_commit_relative_paths() {
        let files = vec![
            "src/main.ts".to_string(),
            "src/nested/new.txt".to_string(),
            "other.ts".to_string(),
        ];
        let root = "C:/repo";

        assert_eq!(
            match_commit_file_path(&files, "src/nested/new.txt", root).as_deref(),
            Some("src/nested/new.txt")
        );
        assert_eq!(
            match_commit_file_path(&files, r"C:\repo\src\nested\new.txt", root).as_deref(),
            Some("src/nested/new.txt")
        );
        assert_eq!(
            match_commit_file_path(&files, "C:/repo/src/main.ts", root).as_deref(),
            Some("src/main.ts")
        );
        assert_eq!(match_commit_file_path(&files, "missing.txt", root), None);
    }

    #[test]
    fn collects_unversioned_commit_targets_from_status_xml_paths() {
        // Simulate the matching half of auto-add: absolute status path must map to relative request.
        let files = vec!["docs/readme.md".to_string(), "new-file.txt".to_string()];
        assert_eq!(
            match_commit_file_path(&files, "C:/work/wc/new-file.txt", "C:/work/wc").as_deref(),
            Some("new-file.txt")
        );
        assert_eq!(
            match_commit_file_path(&files, "docs/readme.md", "C:/work/wc").as_deref(),
            Some("docs/readme.md")
        );
    }

    #[test]
    fn chunks_status_path_argv_under_windows_budget() {
        let short = vec!["a.txt".to_string(), "b.txt".to_string()];
        let short_chunks = chunk_paths_for_svn_status_argv(&short);
        assert_eq!(short_chunks.len(), 1);
        assert_eq!(short_chunks[0].len(), 2);

        // Build paths that must span multiple batches under the fixed argv budget.
        let path = "x".repeat(1_000);
        let many: Vec<String> = (0..40).map(|_| path.clone()).collect();
        let chunks = chunk_paths_for_svn_status_argv(&many);
        assert!(
            chunks.len() > 1,
            "expected multiple chunks for long paths, got {}",
            chunks.len()
        );
        assert_eq!(chunks.iter().map(|chunk| chunk.len()).sum::<usize>(), 40);
        for chunk in &chunks {
            let bytes: usize = chunk.iter().map(|p| p.len() + 1).sum();
            assert!(
                bytes <= SVN_STATUS_PATH_ARGV_MAX_BYTES,
                "chunk byte size {bytes} exceeds budget"
            );
        }
    }

    #[test]
    fn writes_svn_targets_file_with_one_path_per_line() {
        let paths = vec![
            "src/a.txt".to_string(),
            "nested/b.txt".to_string(),
            "unicode-文件.txt".to_string(),
        ];
        let targets = SvnTargetsFile::create("task-1", "add", &paths)
            .expect("targets file should be created");
        let content = fs::read_to_string(targets.path()).expect("read targets file");
        assert_eq!(content, "src/a.txt\nnested/b.txt\nunicode-文件.txt\n");
        let path = targets.path().to_path_buf();
        drop(targets);
        assert!(!path.exists(), "targets file should be removed on drop");
    }

    #[test]
    fn rejects_empty_svn_targets_file() {
        let error = SvnTargetsFile::create("task-1", "add", &[])
            .expect_err("empty targets must be rejected");
        assert!(error.contains("不能为空"));
    }

    #[test]
    fn truncates_large_path_lists_in_task_logs() {
        let short = vec!["a.txt".to_string(), "b.txt".to_string()];
        assert_eq!(format_paths_for_task_log(&short), "a.txt, b.txt");

        let many: Vec<String> = (0..25).map(|index| format!("f{index}.txt")).collect();
        let rendered = format_paths_for_task_log(&many);
        assert!(rendered.contains("f0.txt"));
        assert!(rendered.contains("f19.txt"));
        assert!(!rendered.contains("f20.txt"));
        assert!(rendered.contains("共 25 个"));
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
    fn creates_repository_directory_with_commit_message() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("repository-mkdir-integration");
        let repository = root.join("repository");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        let queue = TaskQueue::new();
        let task = queue
            .create_repository_mkdir_task(CreateRepositoryMkdirTaskRequest {
                url: format!("{repository_url}/新目录"),
                message: "创建新目录".to_string(),
                svn_executable: None,
            })
            .expect("create repository mkdir task");
        let task = wait_for_test_task(&queue, &task.task_id);

        assert!(
            matches!(task.status, TaskStatus::Success),
            "创建仓库目录失败：{:?}",
            task.error
        );
        let info = Command::new("svn")
            .arg("info")
            .arg(format!("{repository_url}/新目录"))
            .output()
            .expect("repository directory info runs");
        assert!(info.status.success());

        let missing_message = queue
            .create_repository_mkdir_task(CreateRepositoryMkdirTaskRequest {
                url: format!("{repository_url}/missing-message"),
                message: "  ".to_string(),
                svn_executable: None,
            })
            .expect_err("仓库目录必须提供提交信息");
        assert!(matches!(
            missing_message,
            NovaError::Command { ref code, .. } if code == "REPOSITORY_MKDIR_MESSAGE_REQUIRED"
        ));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn imports_local_file_and_directory_into_repository() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("repository-import-integration");
        let repository = root.join("repository");
        let source_dir = root.join("导入目录");
        let source_file = root.join("单文件.txt");
        fs::create_dir_all(source_dir.join("nested")).expect("create import source directory");
        fs::write(source_dir.join("nested/note.txt"), "directory content")
            .expect("write directory import source");
        fs::write(&source_file, "single file content").expect("write file import source");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        let queue = TaskQueue::new();

        let directory_task = queue
            .create_repository_import_task(CreateRepositoryImportTaskRequest {
                source_path: source_dir.display().to_string(),
                target_url: format!("{repository_url}/assets"),
                message: "导入目录".to_string(),
                svn_executable: None,
            })
            .expect("create directory import task");
        let directory_task = wait_for_test_task(&queue, &directory_task.task_id);
        assert!(
            matches!(directory_task.status, TaskStatus::Success),
            "导入目录失败：{:?}",
            directory_task.error
        );

        let file_task = queue
            .create_repository_import_task(CreateRepositoryImportTaskRequest {
                source_path: source_file.display().to_string(),
                target_url: format!("{repository_url}/单文件.txt"),
                message: "导入单文件".to_string(),
                svn_executable: None,
            })
            .expect("create file import task");
        let file_task = wait_for_test_task(&queue, &file_task.task_id);
        assert!(
            matches!(file_task.status, TaskStatus::Success),
            "导入文件失败：{:?}",
            file_task.error
        );

        let directory_content = Command::new("svn")
            .arg("cat")
            .arg(format!("{repository_url}/assets/nested/note.txt"))
            .output()
            .expect("read imported directory file");
        assert!(directory_content.status.success());
        assert_eq!(directory_content.stdout, b"directory content");
        let file_content = Command::new("svn")
            .arg("cat")
            .arg(format!("{repository_url}/单文件.txt"))
            .output()
            .expect("read imported single file");
        assert!(file_content.status.success());
        assert_eq!(file_content.stdout, b"single file content");

        let missing = validate_repository_import_source(&root.join("missing"))
            .expect_err("missing import source must fail");
        assert!(matches!(
            missing,
            NovaError::Command { ref code, .. } if code == "REPOSITORY_IMPORT_SOURCE_MISSING"
        ));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn copies_repository_entry_from_historical_revision() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("repository-entry-copy-integration");
        let repository = root.join("repository");
        let source = root.join("source");
        fs::create_dir_all(&source).expect("create copy source");
        fs::write(source.join("note.txt"), "historical content").expect("write copy source");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&source)
                .arg(format!("{repository_url}/source"))
                .args(["-m", "create source"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("delete")
                .arg(format!("{repository_url}/source"))
                .args(["-m", "delete source"]),
        );

        let queue = TaskQueue::new();
        let task = queue
            .create_repository_copy_task(CreateRepositoryCopyTaskRequest {
                kind: RepositoryCopyKind::Entry,
                source_url: format!("{repository_url}/source"),
                target_url: format!("{repository_url}/restored"),
                revision: Some("1".to_string()),
                message: "恢复历史目录".to_string(),
                svn_executable: None,
            })
            .expect("create repository entry copy task");
        let task = wait_for_test_task(&queue, &task.task_id);
        assert!(
            matches!(task.status, TaskStatus::Success),
            "复制历史仓库条目失败：{:?}",
            task.error
        );

        let content = Command::new("svn")
            .arg("cat")
            .arg(format!("{repository_url}/restored/note.txt"))
            .output()
            .expect("read copied repository entry");
        assert!(content.status.success());
        assert_eq!(content.stdout, b"historical content");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn moves_repository_entry_to_new_url() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("repository-entry-move-integration");
        let repository = root.join("repository");
        let source = root.join("source");
        fs::create_dir_all(&source).expect("create move source");
        fs::write(source.join("note.txt"), "move content").expect("write move source");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&source)
                .arg(format!("{repository_url}/source"))
                .args(["-m", "create source"]),
        );

        let queue = TaskQueue::new();
        let task = queue
            .create_repository_move_task(CreateRepositoryMoveTaskRequest {
                kind: None,
                source_url: format!("{repository_url}/source"),
                target_url: format!("{repository_url}/archive/moved"),
                message: "移动仓库目录".to_string(),
                svn_executable: None,
            })
            .expect("create repository move task");
        let task = wait_for_test_task(&queue, &task.task_id);
        assert!(
            matches!(task.status, TaskStatus::Failed),
            "目标父目录不存在时 Move 应失败"
        );

        run_test_command(
            Command::new("svn")
                .arg("mkdir")
                .arg(format!("{repository_url}/archive"))
                .args(["-m", "create archive"]),
        );
        let task = queue
            .create_repository_move_task(CreateRepositoryMoveTaskRequest {
                kind: None,
                source_url: format!("{repository_url}/source"),
                target_url: format!("{repository_url}/archive/moved"),
                message: "移动仓库目录".to_string(),
                svn_executable: None,
            })
            .expect("create repository move task with parent");
        let task = wait_for_test_task(&queue, &task.task_id);
        assert!(
            matches!(task.status, TaskStatus::Success),
            "移动仓库条目失败：{:?}",
            task.error
        );

        let old_info = Command::new("svn")
            .arg("info")
            .arg(format!("{repository_url}/source"))
            .output()
            .expect("old repository entry info runs");
        assert!(!old_info.status.success());
        let content = Command::new("svn")
            .arg("cat")
            .arg(format!("{repository_url}/archive/moved/note.txt"))
            .output()
            .expect("read moved repository entry");
        assert!(content.status.success());
        assert_eq!(content.stdout, b"move content");

        let invalid_rename = queue
            .create_repository_move_task(CreateRepositoryMoveTaskRequest {
                kind: Some(RepositoryMoveKind::Rename),
                source_url: format!("{repository_url}/archive/moved"),
                target_url: format!("{repository_url}/other/renamed"),
                message: "无效重命名".to_string(),
                svn_executable: None,
            })
            .expect_err("Rename must stay in the same parent");
        assert!(matches!(
            invalid_rename,
            NovaError::Command { ref code, .. } if code == "REPOSITORY_RENAME_PARENT_MISMATCH"
        ));

        let rename = queue
            .create_repository_move_task(CreateRepositoryMoveTaskRequest {
                kind: Some(RepositoryMoveKind::Rename),
                source_url: format!("{repository_url}/archive/moved"),
                target_url: format!("{repository_url}/archive/renamed"),
                message: "重命名仓库目录".to_string(),
                svn_executable: None,
            })
            .expect("create repository rename task");
        let rename = wait_for_test_task(&queue, &rename.task_id);
        assert!(
            matches!(rename.status, TaskStatus::Success),
            "重命名仓库条目失败：{:?}",
            rename.error
        );
        let renamed_content = Command::new("svn")
            .arg("cat")
            .arg(format!("{repository_url}/archive/renamed/note.txt"))
            .output()
            .expect("read renamed repository entry");
        assert!(renamed_content.status.success());
        assert_eq!(renamed_content.stdout, b"move content");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn deletes_repository_entry_with_commit_message() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("repository-entry-delete-integration");
        let repository = root.join("repository");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("mkdir")
                .arg(format!("{repository_url}/obsolete"))
                .args(["-m", "create obsolete"]),
        );

        let queue = TaskQueue::new();
        let task = queue
            .create_repository_delete_task(CreateRepositoryDeleteTaskRequest {
                url: format!("{repository_url}/obsolete"),
                message: "删除废弃目录".to_string(),
                svn_executable: None,
            })
            .expect("create repository delete task");
        let task = wait_for_test_task(&queue, &task.task_id);
        assert!(
            matches!(task.status, TaskStatus::Success),
            "删除仓库条目失败：{:?}",
            task.error
        );

        let info = Command::new("svn")
            .arg("info")
            .arg(format!("{repository_url}/obsolete"))
            .output()
            .expect("deleted repository entry info runs");
        assert!(!info.status.success());
        let missing_message = queue
            .create_repository_delete_task(CreateRepositoryDeleteTaskRequest {
                url: format!("{repository_url}/another"),
                message: " ".to_string(),
                svn_executable: None,
            })
            .expect_err("delete message is required");
        assert!(matches!(
            missing_message,
            NovaError::Command { ref code, .. } if code == "REPOSITORY_DELETE_MESSAGE_REQUIRED"
        ));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn validates_checkout_destination_empty_or_missing() {
        let root = test_temp_dir("checkout-destination");
        let missing = root.join("missing-target");
        let empty = root.join("empty-target");
        let occupied = root.join("occupied-target");
        fs::create_dir_all(&empty).expect("create empty destination");
        fs::create_dir_all(&occupied).expect("create occupied destination");
        fs::write(occupied.join("keep.txt"), "keep").expect("write occupied file");

        assert!(validate_checkout_destination(&missing).is_ok());
        assert!(validate_checkout_destination(&empty).is_ok());
        let occupied_error =
            validate_checkout_destination(&occupied).expect_err("非空目录应被拒绝");
        assert!(matches!(
            occupied_error,
            NovaError::Command { ref code, .. } if code == "REPOSITORY_CHECKOUT_DESTINATION_NOT_EMPTY"
        ));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn checks_out_repository_url_at_historical_revision() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("repository-checkout-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        let checkout_target = root.join("checkout-target");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        let history_dir = working_copy.join("history");
        fs::create_dir_all(&history_dir).expect("create history dir");
        fs::write(history_dir.join("note.txt"), "revision one").expect("write note");
        run_test_command(Command::new("svn").arg("add").arg(&history_dir));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "add history"]),
        );
        fs::write(history_dir.join("note.txt"), "revision two").expect("update note");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "update history"]),
        );
        run_test_command(Command::new("svn").arg("update").arg(&working_copy));
        run_test_command(Command::new("svn").arg("delete").arg(&history_dir));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "delete history at head"]),
        );

        let state = repository_file_test_state("repository-checkout");
        run_repository_checkout_task(
            &state,
            "repository-checkout",
            RepositoryCheckoutTaskPayload {
                url: format!("{repository_url}/history"),
                local_path: checkout_target.display().to_string(),
                revision: Some("1".to_string()),
                svn_executable: "svn".to_string(),
            },
        );

        let task = state.lock().unwrap().tasks[0].clone();
        assert!(matches!(task.status, TaskStatus::Success));
        assert!(checkout_target.join("note.txt").is_file());
        assert_eq!(
            fs::read_to_string(checkout_target.join("note.txt")).expect("read checked out note"),
            "revision one"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn validates_export_paths() {
        assert!(normalize_export_path("C:\\exports\\trunk").is_ok());
        assert!(normalize_export_path("~/NovaSVN/export").is_ok());
        assert!(normalize_export_path("relative\\export").is_err());
        assert!(normalize_export_path("C:\\exports\ntrunk").is_err());
    }

    #[test]
    fn validates_export_destination_empty_or_missing() {
        let root = test_temp_dir("export-destination");
        let missing = root.join("missing-target");
        let empty = root.join("empty-target");
        let occupied = root.join("occupied-target");
        fs::create_dir_all(&empty).expect("create empty destination");
        fs::create_dir_all(&occupied).expect("create occupied destination");
        fs::write(occupied.join("keep.txt"), "keep").expect("write occupied file");

        assert!(validate_export_destination(&missing).is_ok());
        assert!(validate_export_destination(&empty).is_ok());
        let occupied_error = validate_export_destination(&occupied).expect_err("非空目录应被拒绝");
        assert!(matches!(
            occupied_error,
            NovaError::Command { ref code, .. } if code == "REPOSITORY_EXPORT_DESTINATION_NOT_EMPTY"
        ));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn exports_repository_url_at_historical_revision_without_metadata() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("repository-export-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        let export_target = root.join("export-target");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        let history_dir = working_copy.join("history");
        fs::create_dir_all(&history_dir).expect("create history dir");
        fs::write(history_dir.join("note.txt"), "revision one").expect("write note");
        run_test_command(Command::new("svn").arg("add").arg(&history_dir));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "add history"]),
        );
        fs::write(history_dir.join("note.txt"), "revision two").expect("update note");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "update history"]),
        );
        run_test_command(Command::new("svn").arg("update").arg(&working_copy));
        run_test_command(Command::new("svn").arg("delete").arg(&history_dir));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "delete history at head"]),
        );

        let state = repository_file_test_state("repository-export");
        run_repository_export_task(
            &state,
            "repository-export",
            RepositoryExportTaskPayload {
                url: format!("{repository_url}/history"),
                local_path: export_target.display().to_string(),
                revision: Some("1".to_string()),
                svn_executable: "svn".to_string(),
                cleanup_on_failure: false,
            },
        );

        let task = state.lock().unwrap().tasks[0].clone();
        assert!(matches!(task.status, TaskStatus::Success));
        let result = task
            .result
            .and_then(|result| result.repository_export)
            .expect("repository export result");
        assert_eq!(result.local_path, export_target.display().to_string());
        assert_eq!(result.file_name, "export-target");
        assert!(export_target.join("note.txt").is_file());
        assert!(!export_target.join(".svn").exists());
        assert_eq!(
            fs::read_to_string(export_target.join("note.txt")).expect("read exported note"),
            "revision one"
        );

        let drag_container = root.join("drag-export-file");
        fs::create_dir_all(&drag_container).expect("create drag export container");
        let drag_target = drag_container.join("报告.txt");
        let drag_state = repository_file_test_state("repository-drag-export");
        run_repository_export_task(
            &drag_state,
            "repository-drag-export",
            RepositoryExportTaskPayload {
                url: format!("{repository_url}/history/note.txt"),
                local_path: drag_target.display().to_string(),
                revision: Some("1".to_string()),
                svn_executable: "svn".to_string(),
                cleanup_on_failure: true,
            },
        );
        let drag_task = drag_state.lock().unwrap().tasks[0].clone();
        assert!(matches!(drag_task.status, TaskStatus::Success));
        let drag_result = drag_task
            .result
            .and_then(|result| result.repository_export)
            .expect("repository drag export result");
        assert_eq!(drag_result.local_path, drag_target.display().to_string());
        assert_eq!(drag_result.file_name, "报告.txt");
        assert_eq!(
            fs::read_to_string(&drag_target).expect("read drag exported file"),
            "revision one"
        );

        let failed_container = root.join("failed-drag-export");
        fs::create_dir_all(&failed_container).expect("create failed drag export container");
        let failed_state = repository_file_test_state("repository-drag-export-failed");
        run_repository_export_task(
            &failed_state,
            "repository-drag-export-failed",
            RepositoryExportTaskPayload {
                url: format!("{repository_url}/history"),
                local_path: failed_container.join("history").display().to_string(),
                revision: Some("1".to_string()),
                svn_executable: "missing-svn-executable".to_string(),
                cleanup_on_failure: true,
            },
        );
        assert!(matches!(
            failed_state.lock().unwrap().tasks[0].status,
            TaskStatus::Failed
        ));
        assert!(!failed_container.exists());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn normalizes_repository_drag_export_names_for_all_platforms() {
        assert_eq!(
            normalize_repository_drag_export_name("报告 2026.txt").unwrap(),
            "报告 2026.txt"
        );
        assert_eq!(
            normalize_repository_drag_export_name("../../bad:name?.txt").unwrap(),
            ".._.._bad_name_.txt"
        );
        assert_eq!(
            normalize_repository_drag_export_name("CON.txt").unwrap(),
            "_CON.txt"
        );
        assert!(normalize_repository_drag_export_name("  ").is_err());
    }

    #[test]
    fn explains_repository_write_permission_and_authentication_errors() {
        for detail in [
            "svn: E175013: Access to '/svn/trunk' forbidden",
            "svn: E170001: Authentication failed",
            "Authorization failed",
            "服务器拒绝访问：没有权限",
        ] {
            let formatted = format_repository_write_error_detail(detail);
            assert!(formatted.starts_with("仓库写入被拒绝"));
            assert!(formatted.contains(detail));
        }

        let unrelated = "svn: E160013: path not found";
        assert_eq!(format_repository_write_error_detail(unrelated), unrelated);
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
    fn validates_revert_target_revision_values() {
        assert_eq!(normalize_revert_target_revision(" 42 ").unwrap(), "42");
        for invalid in ["", "HEAD", "-1", "1:2", "1\n2"] {
            let error = normalize_revert_target_revision(invalid)
                .expect_err("Revert 目标必须是数字 revision");
            assert!(matches!(
                error,
                NovaError::Command { ref code, .. } if code == "REVERT_REVISION_TARGET_INVALID"
            ));
        }
    }

    #[test]
    fn normalizes_batch_revert_revisions_from_newest_to_oldest() {
        assert_eq!(
            normalize_revert_target_revisions(
                None,
                Some(&["8".to_string(), "12".to_string(), "8".to_string()]),
                false,
            )
            .unwrap(),
            vec!["12".to_string(), "8".to_string()]
        );
        assert!(
            normalize_revert_target_revisions(Some("12"), Some(&["8".to_string()]), false,)
                .is_err()
        );
        assert!(normalize_revert_target_revisions(
            None,
            Some(&["12".to_string(), "8".to_string()]),
            true,
        )
        .is_err());
        assert!(normalize_revert_target_revisions(
            None,
            Some(&["0".to_string(), "8".to_string()]),
            false,
        )
        .is_err());
    }

    #[test]
    fn keeps_revert_targets_inside_the_working_copy() {
        let parent = test_temp_dir("revert-target-paths");
        let working_copy = parent.join("working-copy");
        let nested = working_copy.join("src").join("tracked.txt");
        let outside = parent.join("outside.txt");
        fs::create_dir_all(nested.parent().expect("nested parent")).expect("create nested path");
        fs::write(&nested, "tracked\n").expect("write nested target");
        fs::write(&outside, "outside\n").expect("write outside target");

        assert_eq!(
            normalize_revert_target_path(&working_copy, None).unwrap(),
            working_copy
        );
        assert_eq!(
            normalize_revert_target_path(&working_copy, Some("src/tracked.txt")).unwrap(),
            nested
        );
        assert_eq!(
            normalize_revert_target_path(&working_copy, Some("src/missing.txt")).unwrap(),
            working_copy.join("src").join("missing.txt")
        );
        let error =
            normalize_revert_target_path(&working_copy, Some(outside.to_string_lossy().as_ref()))
                .expect_err("outside target must be rejected");
        assert!(matches!(
            error,
            NovaError::Command { ref code, .. }
                if code == "REVERT_REVISION_TARGET_OUTSIDE_WORKSPACE"
        ));

        fs::remove_dir_all(parent).ok();
    }

    #[test]
    fn validates_repository_list_revision_values() {
        assert_eq!(normalize_repository_list_revision(None).unwrap(), None);
        assert_eq!(
            normalize_repository_list_revision(Some(" HEAD ")).unwrap(),
            None
        );
        assert_eq!(
            normalize_repository_list_revision(Some(" 0010 ")).unwrap(),
            Some("10".to_string())
        );
        for invalid in ["1:2", "-1", "BASE", "1\n2"] {
            let error = normalize_repository_list_revision(Some(invalid))
                .expect_err("Repository revision 必须是单个数字");
            assert!(matches!(
                error,
                NovaError::Command { ref code, .. } if code == "REPOSITORY_LIST_REVISION_INVALID"
            ));
        }
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
            (SvnOperationKind::UnaddFile, "UNADD_FILE_PATH_INVALID"),
            (SvnOperationKind::DeletePath, "DELETE_PATH_INVALID"),
            (
                SvnOperationKind::DeleteUnversionedFile,
                "DELETE_UNVERSIONED_FILE_PATH_INVALID",
            ),
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
    fn auto_deletes_missing_files_before_commit_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-commit-auto-delete-missing-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = test_file_repository_url(&repository);
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("gone.txt"), "remove me\n").expect("write tracked file");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("gone.txt")),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "init"])
                .arg(&working_copy),
        );
        fs::remove_file(working_copy.join("gone.txt")).expect("remove tracked file locally");

        let queue = TaskQueue::new();
        let commit_task = queue
            .create_commit_task(CreateCommitTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                message: "commit missing file as delete".to_string(),
                files: vec!["gone.txt".to_string()],
                svn_executable: None,
            })
            .expect("commit task with missing file should be created");
        let commit_task = wait_for_test_task(&queue, &commit_task.task_id);
        assert!(
            matches!(commit_task.status, TaskStatus::Success),
            "提交前自动 Delete 后应提交成功：{:?}",
            commit_task.error
        );
        assert!(
            commit_task
                .logs
                .iter()
                .any(|log| log.message.contains("自动 Delete")),
            "任务日志应包含自动 Delete：{:?}",
            commit_task.logs
        );

        let listed = run_test_command(Command::new("svn").arg("list").arg(&repository_url));
        assert!(
            !String::from_utf8_lossy(&listed.stdout).contains("gone.txt"),
            "丢失文件应从仓库删除"
        );
        let clean_status = run_test_command(Command::new("svn").arg("status").arg(&working_copy));
        assert!(
            clean_status.stdout.is_empty(),
            "提交后工作副本应干净：{}",
            String::from_utf8_lossy(&clean_status.stdout)
        );
        fs::remove_dir_all(root).ok();
    }
    #[test]
    fn preserves_changelist_after_all_members_are_committed() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-commit-keep-changelist-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = test_file_repository_url(&repository);
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("alpha.txt"), "base\n").expect("write alpha baseline");
        fs::write(working_copy.join("beta.txt"), "base\n").expect("write beta baseline");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("alpha.txt"))
                .arg(working_copy.join("beta.txt")),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "init"])
                .arg(&working_copy),
        );

        fs::write(working_copy.join("alpha.txt"), "alpha changed\n").expect("modify alpha");
        fs::write(working_copy.join("beta.txt"), "beta changed\n").expect("modify beta");
        run_test_command(
            Command::new("svn")
                .arg("changelist")
                .arg("release")
                .arg(working_copy.join("alpha.txt"))
                .arg(working_copy.join("beta.txt")),
        );

        let queue = TaskQueue::new();
        let commit_task = queue
            .create_commit_task(CreateCommitTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                message: "commit complete changelist".to_string(),
                files: vec!["alpha.txt".to_string(), "beta.txt".to_string()],
                svn_executable: None,
            })
            .expect("changelist commit task should be created");
        let commit_task = wait_for_test_task(&queue, &commit_task.task_id);
        assert!(
            matches!(commit_task.status, TaskStatus::Success),
            "Changelist 全量提交应成功：{:?}",
            commit_task.error
        );

        fs::write(working_copy.join("alpha.txt"), "changed again\n")
            .expect("modify alpha after commit");
        let status = run_test_command(
            Command::new("svn")
                .arg("status")
                .args(["--changelist", "release"])
                .arg(&working_copy),
        );
        assert!(
            String::from_utf8_lossy(&status.stdout).contains("alpha.txt"),
            "提交后再次修改的文件应仍属于原 Changelist：{}",
            String::from_utf8_lossy(&status.stdout)
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn auto_adds_unversioned_files_before_commit_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-commit-auto-add-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = test_file_repository_url(&repository);
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("tracked.txt"), "base\n").expect("write tracked file");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("tracked.txt")),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "init"])
                .arg(&working_copy),
        );

        fs::write(working_copy.join("tracked.txt"), "changed\n").expect("modify tracked file");
        fs::create_dir_all(working_copy.join("nested")).expect("create nested directory");
        fs::write(working_copy.join("nested/new.txt"), "brand new\n")
            .expect("write unversioned file");
        fs::write(working_copy.join("root-new.txt"), "root new\n").expect("write root unversioned");

        let queue = TaskQueue::new();
        // Intentionally pass a non-canonical WC root (as the UI does) so auto-add must
        // canonicalize before validate_add_target — this used to fail on Windows.
        let commit_task = queue
            .create_commit_task(CreateCommitTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                message: "commit with auto-add".to_string(),
                files: vec![
                    "tracked.txt".to_string(),
                    "root-new.txt".to_string(),
                    "nested/new.txt".to_string(),
                ],
                svn_executable: None,
            })
            .expect("commit task with unversioned files should be created");
        let commit_task = wait_for_test_task(&queue, &commit_task.task_id);
        assert!(
            matches!(commit_task.status, TaskStatus::Success),
            "提交前自动 Add 后应提交成功：{:?}",
            commit_task.error
        );
        assert!(
            commit_task
                .logs
                .iter()
                .any(|log| log.message.contains("自动 Add")),
            "任务日志应包含自动 Add：{:?}",
            commit_task.logs
        );

        let root_new = run_test_command(
            Command::new("svn")
                .arg("cat")
                .arg(format!("{repository_url}/root-new.txt")),
        );
        assert_eq!(String::from_utf8_lossy(&root_new.stdout), "root new\n");
        let nested_new = run_test_command(
            Command::new("svn")
                .arg("cat")
                .arg(format!("{repository_url}/nested/new.txt")),
        );
        assert_eq!(String::from_utf8_lossy(&nested_new.stdout), "brand new\n");
        let tracked = run_test_command(
            Command::new("svn")
                .arg("cat")
                .arg(format!("{repository_url}/tracked.txt")),
        );
        assert_eq!(String::from_utf8_lossy(&tracked.stdout), "changed\n");

        let clean_status = run_test_command(Command::new("svn").arg("status").arg(&working_copy));
        assert!(
            clean_status.stdout.is_empty(),
            "提交后工作副本应干净：{}",
            String::from_utf8_lossy(&clean_status.stdout)
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn commit_does_not_include_unselected_changes_under_versioned_parents() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-commit-selected-only");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = test_file_repository_url(&repository);
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        let assets = working_copy.join("assets");
        fs::create_dir_all(&assets).expect("create assets directory");
        fs::write(assets.join("keep.txt"), "keep-base\n").expect("write keep.txt");
        fs::write(assets.join("skip.mat.meta"), "meta-base\n").expect("write skip.mat.meta");
        run_test_command(Command::new("svn").arg("add").arg(&assets));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "init"])
                .arg(&working_copy),
        );

        fs::write(assets.join("keep.txt"), "keep-changed\n").expect("modify keep.txt");
        fs::write(assets.join("skip.mat.meta"), "meta-changed\n").expect("modify skip.mat.meta");
        fs::write(assets.join("new.txt"), "brand new\n").expect("write unversioned file");

        let queue = TaskQueue::new();
        let commit_task = queue
            .create_commit_task(CreateCommitTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                message: "commit selected files only".to_string(),
                files: vec!["assets/keep.txt".to_string(), "assets/new.txt".to_string()],
                svn_executable: None,
            })
            .expect("selected-only commit task should be created");
        let commit_task = wait_for_test_task(&queue, &commit_task.task_id);
        assert!(
            matches!(commit_task.status, TaskStatus::Success),
            "只提交勾选文件应成功：{:?}",
            commit_task.error
        );

        let keep = run_test_command(
            Command::new("svn")
                .arg("cat")
                .arg(format!("{repository_url}/assets/keep.txt")),
        );
        assert_eq!(String::from_utf8_lossy(&keep.stdout), "keep-changed\n");
        let new_file = run_test_command(
            Command::new("svn")
                .arg("cat")
                .arg(format!("{repository_url}/assets/new.txt")),
        );
        assert_eq!(String::from_utf8_lossy(&new_file.stdout), "brand new\n");
        let skipped = run_test_command(
            Command::new("svn")
                .arg("cat")
                .arg(format!("{repository_url}/assets/skip.mat.meta")),
        );
        assert_eq!(
            String::from_utf8_lossy(&skipped.stdout),
            "meta-base\n",
            "未勾选的 .mat.meta 不应被父目录提交带上"
        );

        let leftover = run_test_command(
            Command::new("svn")
                .arg("status")
                .arg(working_copy.join("assets/skip.mat.meta")),
        );
        assert!(
            String::from_utf8_lossy(&leftover.stdout).contains("skip.mat.meta"),
            "未勾选文件应仍是本地修改：{}",
            String::from_utf8_lossy(&leftover.stdout)
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn auto_adds_many_unversioned_files_via_targets_file_before_commit() {
        if !svn_tools_available() {
            return;
        }

        // Enough paths that a naive argv join would exceed Windows CreateProcess limits.
        const FILE_COUNT: usize = 400;
        let root = test_temp_dir("svn-commit-auto-add-many");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = test_file_repository_url(&repository);
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("tracked.txt"), "base\n").expect("write tracked file");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("tracked.txt")),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "init"])
                .arg(&working_copy),
        );

        let bulk_dir = working_copy.join("bulk");
        fs::create_dir_all(&bulk_dir).expect("create bulk directory");
        let mut files = Vec::with_capacity(FILE_COUNT + 1);
        files.push("tracked.txt".to_string());
        for index in 0..FILE_COUNT {
            let relative = format!("bulk/file-{index:04}.txt");
            fs::write(working_copy.join(&relative), format!("content-{index}\n"))
                .expect("write bulk unversioned file");
            files.push(relative);
        }
        fs::write(working_copy.join("tracked.txt"), "changed\n").expect("modify tracked file");

        let queue = TaskQueue::new();
        let commit_task = queue
            .create_commit_task(CreateCommitTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                message: "commit many auto-add files".to_string(),
                files,
                svn_executable: None,
            })
            .expect("large auto-add commit task should be created");
        let commit_task = wait_for_test_task(&queue, &commit_task.task_id);
        assert!(
            matches!(commit_task.status, TaskStatus::Success),
            "大量未版本文件自动 Add 后应提交成功：{:?}",
            commit_task.error
        );
        assert!(
            commit_task
                .logs
                .iter()
                .any(|log| log.message.contains("自动 Add") && log.message.contains("400")),
            "任务日志应记录自动 Add 数量：{:?}",
            commit_task.logs
        );

        let listed = run_test_command(
            Command::new("svn")
                .arg("list")
                .arg(format!("{repository_url}/bulk")),
        );
        let listing = String::from_utf8_lossy(&listed.stdout);
        assert!(
            listing.lines().count() >= FILE_COUNT,
            "仓库应包含 bulk 下全部新文件，实际列表：{listing}"
        );

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn adds_commits_and_reverts_nested_file_in_real_working_copy() {
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
        fs::write(working_copy.join("unadd.txt"), "keep me\n").expect("write unadd file");
        let unadd_setup = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::AddFile,
                file_path: Some("unadd.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("unadd setup task should be created");
        let unadd_setup = wait_for_test_task(&queue, &unadd_setup.task_id);
        assert!(matches!(unadd_setup.status, TaskStatus::Success));

        let unadd_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::UnaddFile,
                file_path: Some("unadd.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("unadd task should be created");
        let unadd_task = wait_for_test_task(&queue, &unadd_task.task_id);
        assert!(
            matches!(unadd_task.status, TaskStatus::Success),
            "Unadd 任务失败：{:?}",
            unadd_task.error
        );
        assert_eq!(
            fs::read_to_string(working_copy.join("unadd.txt")).unwrap(),
            "keep me\n"
        );
        let unadd_status = run_test_command(
            Command::new("svn")
                .args(["status", "--xml"])
                .arg(working_copy.join("unadd.txt")),
        );
        let unadd_xml = String::from_utf8_lossy(&unadd_status.stdout);
        assert!(unadd_xml.contains("item=\"unversioned\""));

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

        let commit_task = queue
            .create_commit_task(CreateCommitTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                message: "commit nested file".to_string(),
                files: vec!["nested".to_string()],
                svn_executable: None,
            })
            .expect("commit task should be created");
        let commit_task = wait_for_test_task(&queue, &commit_task.task_id);
        assert!(
            matches!(commit_task.status, TaskStatus::Success),
            "Commit 任务失败：{:?}",
            commit_task.error
        );
        let repository_content = run_test_command(
            Command::new("svn")
                .arg("cat")
                .arg(format!("{repository_url}/nested/new.txt")),
        );
        assert_eq!(
            String::from_utf8_lossy(&repository_content.stdout),
            "new file\n"
        );

        fs::write(working_copy.join("nested/new.txt"), "local change\n")
            .expect("modify committed file");
        let revert_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::RevertFile,
                file_path: Some("nested/new.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("revert task should be created");
        let revert_task = wait_for_test_task(&queue, &revert_task.task_id);
        assert!(
            matches!(revert_task.status, TaskStatus::Success),
            "Revert 任务失败：{:?}",
            revert_task.error
        );
        assert_eq!(
            fs::read_to_string(working_copy.join("nested/new.txt")).unwrap(),
            "new file\n"
        );
        fs::remove_file(working_copy.join("unadd.txt")).expect("remove unversioned test file");
        let clean_status = run_test_command(Command::new("svn").arg("status").arg(&working_copy));
        assert!(clean_status.stdout.is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_invalid_add_targets_in_real_working_copy() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-add-invalid-targets");
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
        run_test_command(
            Command::new("svn")
                .args(["propset", "svn:ignore", "ignored.tmp"])
                .arg(&working_copy),
        );
        fs::write(working_copy.join("ignored.tmp"), "ignored\n").expect("write ignored file");
        fs::write(root.join("outside.txt"), "outside\n").expect("write outside file");

        let queue = TaskQueue::new();
        for (file_path, expected_code) in [
            ("missing.txt", "ADD_TARGET_NOT_FOUND"),
            ("ignored.tmp", "ADD_TARGET_IGNORED"),
            ("../outside.txt", "ADD_TARGET_OUTSIDE_WORKING_COPY"),
        ] {
            let error = queue
                .create_svn_operation_task(CreateSvnOperationTaskRequest {
                    working_copy_root: working_copy.display().to_string(),
                    kind: SvnOperationKind::AddFile,
                    file_path: Some(file_path.to_string()),
                    target_path: None,
                    svn_executable: None,
                })
                .expect_err("无效 Add 目标不得进入任务队列");
            assert!(matches!(
                error,
                NovaError::Command { ref code, .. } if code == expected_code
            ));
        }

        fs::write(working_copy.join("queued.txt"), "queued\n").expect("write queued file");
        queue.create_mock_task(CreateMockTaskRequest {
            title: Some("阻塞 Add 测试队列".to_string()),
            outcome: MockTaskOutcome::Success,
        });
        let queued_add = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::AddFile,
                file_path: Some("queued.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("存在的未版本控制文件应进入 Add 队列");
        fs::remove_file(working_copy.join("queued.txt")).expect("remove queued Add target");
        let queued_add = wait_for_test_task(&queue, &queued_add.task_id);
        assert!(matches!(queued_add.status, TaskStatus::Failed));
        assert!(queued_add
            .error
            .as_deref()
            .is_some_and(|error| error.contains("Add 目标不存在")));

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
    fn deletes_unversioned_regular_file_and_rejects_versioned_or_changed_targets() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("svn-delete-unversioned-integration");
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

        let tracked = working_copy.join("tracked.txt");
        fs::write(&tracked, "tracked\n").expect("write tracked file");
        run_test_command(Command::new("svn").arg("add").arg(&tracked));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .args(["-m", "初始化未版本控制删除测试"])
                .arg(&working_copy),
        );

        let unversioned = working_copy.join("unversioned.txt");
        fs::write(&unversioned, "unversioned\n").expect("write unversioned file");
        let queue = TaskQueue::new();
        let unversioned_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeleteUnversionedFile,
                file_path: Some("unversioned.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("unversioned file delete task should be created");
        assert_eq!(unversioned_task.title, "删除未版本控制文件 unversioned.txt");
        let unversioned_task = wait_for_test_task(&queue, &unversioned_task.task_id);
        assert!(
            matches!(unversioned_task.status, TaskStatus::Success),
            "未版本控制文件删除任务失败：{:?}",
            unversioned_task.error
        );
        assert!(!unversioned.exists());

        let tracked_error = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeleteUnversionedFile,
                file_path: Some("tracked.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect_err("versioned file must not be treated as unversioned");
        assert!(matches!(
            tracked_error,
            NovaError::Command { ref code, .. } if code == "DELETE_UNVERSIONED_FILE_STATUS_CHANGED"
        ));
        assert!(tracked.exists());

        let changing = working_copy.join("changing.txt");
        fs::write(&changing, "before\n").expect("write changing file");
        queue.create_mock_task(CreateMockTaskRequest {
            title: Some("阻塞未版本控制删除身份测试队列".to_string()),
            outcome: MockTaskOutcome::Success,
        });
        let changing_task = queue
            .create_svn_operation_task(CreateSvnOperationTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                kind: SvnOperationKind::DeleteUnversionedFile,
                file_path: Some("changing.txt".to_string()),
                target_path: None,
                svn_executable: None,
            })
            .expect("changing unversioned file delete task should be created");
        fs::write(&changing, "after\n").expect("change queued file");
        let changing_task = wait_for_test_task(&queue, &changing_task.task_id);
        assert!(
            matches!(changing_task.status, TaskStatus::Failed),
            "排队后变更的未版本控制文件必须拒绝删除"
        );
        assert!(changing_task
            .logs
            .iter()
            .any(|log| log.message.contains("发生变化")));
        assert!(changing_task
            .error
            .as_deref()
            .is_some_and(|error| error.contains("排队时")));
        assert!(changing.exists());

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
        let output = "UU        /tmp/wc/applied.txt\n U        /tmp/wc/applied.txt\n>         applied hunk @@ -1,1 +1,1 @@ with offset 2\nC         /tmp/wc/conflict.txt\nCC        /tmp/wc/conflict.txt\n>         rejected hunk @@ -1,1 +1,1 @@\nSkipped missing target: '/tmp/wc/missing.txt'\nSummary of conflicts:\n  Text conflicts: 1\n  Skipped paths: 1\n";

        let stats = parse_apply_patch_stats(output);
        assert_eq!(
            stats,
            ApplyPatchStats {
                applied: 1,
                offset_hunks: 1,
                rejected: 1,
                skipped: 1,
                conflicted: 1,
            }
        );
        assert!(!stats.allows_apply());
    }

    #[test]
    fn bounds_apply_patch_ipc_preview_and_task_log_lines() {
        let large_output = "应用行-中文\n".repeat(APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES / 4);
        let (preview, truncated) = bounded_apply_patch_output(large_output);
        assert!(truncated);
        assert!(preview.len() <= APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES);
        assert!(preview.contains("Patch 输出预览已截断"));
        assert!(preview.is_char_boundary(preview.len()));

        let many_lines = (0..(APPLY_PATCH_TASK_LOG_MAX_LINES + 50))
            .map(|index| format!("U file-{index}.txt\n"))
            .collect::<String>();
        let (lines, log_truncated) = apply_patch_log_preview(many_lines.as_bytes(), b"");
        assert!(log_truncated);
        assert_eq!(lines.len(), APPLY_PATCH_TASK_LOG_MAX_LINES);
        assert!(lines.iter().map(String::len).sum::<usize>() <= APPLY_PATCH_TASK_LOG_MAX_BYTES);
    }

    #[test]
    fn streams_apply_patch_output_statistics_and_limits_preview() {
        let mut collector = ApplyPatchOutputCollector::default();
        collector
            .consume_bytes(
                b"U         src/one.txt\n>         applied hunk with offset 2\nC         src/two.txt\n",
            )
            .expect("Patch 输出应能流式统计");
        collector.finish_line().expect("最后一行应能完成");
        let analysis = collector.finish().expect("Patch 输出分析应成功");
        assert_eq!(analysis.stats.applied, 1);
        assert_eq!(analysis.stats.offset_hunks, 1);
        assert_eq!(analysis.stats.conflicted, 1);
        assert!(!analysis.output_truncated);
        assert_eq!(analysis.log_lines.len(), 3);

        let mut oversized_line = ApplyPatchOutputCollector::default();
        let error = oversized_line
            .consume_bytes(&vec![b'x'; MAX_APPLY_PATCH_OUTPUT_LINE_BYTES + 1])
            .expect_err("过长单行应被拒绝");
        assert!(matches!(
            error,
            NovaError::Command { code, .. } if code == "APPLY_PATCH_OUTPUT_LINE_LIMIT_EXCEEDED"
        ));
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
        fs::write(
            import_source.join("offset.txt"),
            "prefix\nbefore\ncontext\n",
        )
        .expect("write offset file");
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

        let offset_patch_file = root.join("offset.patch");
        fs::write(
            &offset_patch_file,
            "Index: offset.txt\n===================================================================\n--- offset.txt\t(revision 1)\n+++ offset.txt\t(working copy)\n@@ -1,2 +1,2 @@\n-before\n+after-offset\n context\n",
        )
        .expect("write offset patch");
        let offset_dry_run = queue
            .create_apply_patch_task(CreateApplyPatchTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                patch_file_path: offset_patch_file.display().to_string(),
                dry_run: true,
                expected_patch_digest: None,
                svn_executable: None,
            })
            .expect("create offset dry-run task");
        let offset_dry_run = wait_for_test_task(&queue, &offset_dry_run.task_id);
        assert!(matches!(offset_dry_run.status, TaskStatus::Success));
        let offset_dry_run_result = offset_dry_run
            .result
            .and_then(|result| result.apply_patch_result)
            .expect("offset dry-run result exists");
        assert_eq!(offset_dry_run_result.applied, 1);
        assert!(offset_dry_run_result.offset_hunks > 0);

        let offset_apply = queue
            .create_apply_patch_task(CreateApplyPatchTaskRequest {
                working_copy_root: working_copy.display().to_string(),
                patch_file_path: offset_patch_file.display().to_string(),
                dry_run: false,
                expected_patch_digest: Some(offset_dry_run_result.patch_digest),
                svn_executable: None,
            })
            .expect("create offset apply task");
        let offset_apply = wait_for_test_task(&queue, &offset_apply.task_id);
        assert!(
            matches!(offset_apply.status, TaskStatus::Success),
            "偏移 Patch 应用失败：{:?}",
            offset_apply.error
        );
        let offset_apply_result = offset_apply
            .result
            .and_then(|result| result.apply_patch_result)
            .expect("offset apply result exists");
        assert!(offset_apply_result.offset_hunks > 0);
        assert_eq!(
            fs::read_to_string(working_copy.join("offset.txt")).unwrap(),
            "prefix\nafter-offset\ncontext\n"
        );

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
                file_path: None,
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
                file_path: None,
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
                file_path: None,
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
    fn validates_working_copy_file_revision_diff_target() {
        let dir = test_temp_dir("revision-diff-working-copy-file");
        let payload = normalize_revision_diff_payload(
            CreateRevisionDiffTaskRequest {
                mode: RevisionDiffMode::WorkingCopyToRevision,
                working_copy_root: Some(dir.display().to_string()),
                file_path: Some("src/main.rs".to_string()),
                target_url: None,
                left_revision: None,
                right_revision: Some("10".to_string()),
                left_url: None,
                right_url: None,
                svn_executable: None,
            },
            "svn".to_string(),
            dir.join("output"),
        )
        .expect("working-copy file target should be accepted");

        assert_eq!(payload.file_path.as_deref(), Some("src/main.rs"));
        assert_eq!(payload.right_revision.as_deref(), Some("10"));

        for invalid_path in ["../secret.txt", "/tmp/secret.txt", "src/main.rs\nnext"] {
            let error = normalize_revision_diff_payload(
                CreateRevisionDiffTaskRequest {
                    mode: RevisionDiffMode::WorkingCopyToRevision,
                    working_copy_root: Some(dir.display().to_string()),
                    file_path: Some(invalid_path.to_string()),
                    target_url: None,
                    left_revision: None,
                    right_revision: Some("10".to_string()),
                    left_url: None,
                    right_url: None,
                    svn_executable: None,
                },
                "svn".to_string(),
                dir.join("invalid-output"),
            )
            .expect_err("unsafe working-copy file target must be rejected");
            match error {
                NovaError::Command { code, .. } => {
                    assert_eq!(code, "REVISION_DIFF_FILE_PATH_INVALID");
                }
            }
        }

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn matches_tortoise_reverts_with_scoped_target_local_changes_and_mixed_revisions() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("revert-revision-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = test_file_repository_url(&repository);
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        let file = working_copy.join("tracked.txt");
        let local_file = working_copy.join("local.txt");
        fs::write(&file, "revision one\n").expect("write revision one");
        fs::write(&local_file, "local base\n").expect("write local base");
        run_test_command(Command::new("svn").arg("add").arg(&file).arg(&local_file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "revision one"]),
        );
        fs::write(&file, "revision two\n").expect("write revision two");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "revision two"]),
        );
        run_test_command(Command::new("svn").arg("update").arg(&working_copy));
        let unversioned = working_copy.join("generated.tmp");
        fs::write(&unversioned, "generated\n").expect("write unversioned file");
        fs::write(&local_file, "local edit before single revert\n").expect("write local edit");

        let payload = RevertRevisionTaskPayload {
            working_copy_root: working_copy.display().to_string(),
            target_path: file.display().to_string(),
            source_url: None,
            target_revisions: vec!["2".to_string()],
            svn_executable: "svn".to_string(),
            whole_workspace: false,
        };
        let state = Arc::new(Mutex::new(TaskQueueState::default()));
        let (output, source_url) =
            execute_revert_revision(&state, "revert-revision-test", &payload)
                .expect("reverse merge should succeed");

        assert!(output.status.success());
        assert!(source_url.starts_with("file:"));
        assert!(source_url.ends_with("/tracked.txt@HEAD"));
        assert_eq!(
            fs::read_to_string(&file).expect("read reverted file"),
            "revision one\n"
        );
        assert_eq!(
            fs::read_to_string(&local_file).expect("read local file"),
            "local edit before single revert\n"
        );
        assert_eq!(
            fs::read_to_string(&unversioned).expect("read unversioned file"),
            "generated\n"
        );
        let status = run_test_command(
            Command::new("svn")
                .arg("status")
                .arg("--xml")
                .arg(&working_copy),
        );
        assert!(String::from_utf8_lossy(&status.stdout).contains("item=\"modified\""));

        run_test_command(Command::new("svn").arg("revert").arg(&local_file));
        fs::write(&file, "revision three\n").expect("write revision three");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "revision three"]),
        );
        fs::write(&local_file, "local edit before revert to revision\n")
            .expect("write second local edit");

        let payload = RevertRevisionTaskPayload {
            working_copy_root: working_copy.display().to_string(),
            target_path: working_copy.display().to_string(),
            source_url: None,
            target_revisions: vec!["1".to_string()],
            svn_executable: "svn".to_string(),
            whole_workspace: true,
        };
        let state = Arc::new(Mutex::new(TaskQueueState::default()));
        let (output, source_url) =
            execute_revert_revision(&state, "revert-workspace-test", &payload)
                .expect("whole workspace reverse merge should succeed");

        assert!(output.status.success());
        assert!(source_url.ends_with("/repository@HEAD"));
        assert_eq!(
            fs::read_to_string(&file).expect("read workspace reverted file"),
            "revision one\n"
        );
        assert_eq!(
            fs::read_to_string(&local_file).expect("read second local edit"),
            "local edit before revert to revision\n"
        );
        assert_eq!(
            fs::read_to_string(&unversioned).expect("read unversioned file"),
            "generated\n"
        );

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn batch_reverts_non_contiguous_revisions_in_one_merge() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("batch-revert-revisions-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = test_file_repository_url(&repository);
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        let local_file = working_copy.join("local.txt");
        fs::write(&local_file, "local base\n").expect("write local base");
        run_test_command(Command::new("svn").arg("add").arg(&local_file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "revision one"]),
        );

        let removed_r2 = working_copy.join("remove-r2.txt");
        let kept_r3 = working_copy.join("keep-r3.txt");
        let removed_r4 = working_copy.join("remove-r4.txt");
        for (path, contents, message) in [
            (&removed_r2, "remove revision two\n", "revision two"),
            (&kept_r3, "keep revision three\n", "revision three"),
            (&removed_r4, "remove revision four\n", "revision four"),
        ] {
            fs::write(path, contents).expect("write batch revert revision");
            run_test_command(Command::new("svn").arg("add").arg(path));
            run_test_command(
                Command::new("svn")
                    .arg("commit")
                    .arg(path)
                    .args(["-m", message]),
            );
        }
        fs::write(&local_file, "local edit kept during batch revert\n").expect("write local edit");

        let payload = RevertRevisionTaskPayload {
            working_copy_root: working_copy.display().to_string(),
            target_path: working_copy.display().to_string(),
            source_url: None,
            target_revisions: vec!["4".to_string(), "2".to_string()],
            svn_executable: "svn".to_string(),
            whole_workspace: false,
        };
        let state = Arc::new(Mutex::new(TaskQueueState::default()));
        let (output, source_url) = execute_revert_revision(&state, "batch-revert-test", &payload)
            .expect("batch reverse merge should succeed");

        assert!(output.status.success());
        assert!(source_url.ends_with("/repository@HEAD"));
        assert!(!removed_r2.exists());
        assert!(!removed_r4.exists());
        assert_eq!(
            fs::read_to_string(&kept_r3).expect("read untouched revision file"),
            "keep revision three\n"
        );
        assert_eq!(
            fs::read_to_string(&local_file).expect("read preserved local edit"),
            "local edit kept during batch revert\n"
        );

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn follows_copy_history_when_reverting_a_pre_copy_revision() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("revert-copy-history-integration");
        let repository = root.join("repository");
        let seed_working_copy = root.join("seed-working-copy");
        let branch_working_copy = root.join("branch-working-copy");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = test_file_repository_url(&repository);
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&seed_working_copy),
        );

        let trunk = seed_working_copy.join("trunk");
        let branches = seed_working_copy.join("branches");
        fs::create_dir_all(&trunk).expect("create trunk");
        fs::create_dir_all(&branches).expect("create branches");
        let trunk_file = trunk.join("tracked.txt");
        fs::write(&trunk_file, "revision one\n").expect("write revision one");
        run_test_command(Command::new("svn").arg("add").arg(&trunk).arg(&branches));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&seed_working_copy)
                .args(["-m", "create layout"]),
        );
        fs::write(&trunk_file, "revision two\n").expect("write revision two");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&trunk_file)
                .args(["-m", "change before copy"]),
        );

        let trunk_url = format!("{repository_url}/trunk");
        let branch_url = format!("{repository_url}/branches/feature");
        run_test_command(
            Command::new("svn")
                .arg("copy")
                .arg(&trunk_url)
                .arg(&branch_url)
                .args(["-m", "copy branch"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&branch_url)
                .arg(&branch_working_copy),
        );

        let branch_file = branch_working_copy.join("tracked.txt");
        let payload = RevertRevisionTaskPayload {
            working_copy_root: branch_working_copy.display().to_string(),
            target_path: branch_file.display().to_string(),
            source_url: Some(format!("{branch_url}/tracked.txt")),
            target_revisions: vec!["2".to_string()],
            svn_executable: "svn".to_string(),
            whole_workspace: false,
        };
        let state = Arc::new(Mutex::new(TaskQueueState::default()));
        let (output, source_url) =
            execute_revert_revision(&state, "revert-copy-history-test", &payload)
                .expect("reverse merge should follow copy history");

        assert!(output.status.success());
        assert!(source_url.ends_with("/branches/feature/tracked.txt@HEAD"));
        assert_eq!(
            fs::read_to_string(&branch_file).expect("read reverted branch file"),
            "revision one\n"
        );

        fs::remove_dir_all(root).ok();
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
    fn builds_safe_repository_temp_file_names_and_preserves_extension() {
        let url = format!(
            "https://example.com/svn/trunk/{}.archive.JSON",
            "a".repeat(200)
        );
        let name = repository_temp_file_name(&url, "task:42");

        assert!(name.starts_with("task-42-"));
        assert!(name.ends_with(".JSON"));
        assert!(!name.contains(['\\', '/', ':', '?', '"', '<', '>', '|']));
    }

    #[test]
    fn appends_repository_peg_revision_for_historical_and_at_sign_urls() {
        assert_eq!(
            repository_url_with_peg_revision(
                "https://example.com/svn/trunk/deleted.txt",
                Some("10")
            ),
            "https://example.com/svn/trunk/deleted.txt@10"
        );
        assert_eq!(
            repository_url_with_peg_revision("https://example.com/svn/trunk/name@domain.txt", None),
            "https://example.com/svn/trunk/name@domain.txt@"
        );
        assert_eq!(
            repository_url_with_peg_revision("https://example.com/svn/trunk/readme.txt", None),
            "https://example.com/svn/trunk/readme.txt"
        );
    }

    #[test]
    fn creates_unique_repository_temp_files_without_overwriting() {
        let root = test_temp_dir("repository-temp-file-unique");
        let output_dir = root.join("repository-files");
        fs::create_dir(&output_dir).unwrap();
        let output_dir = normalize_repository_output_dir(&output_dir).unwrap();
        let (_, first_path, first_name) = create_repository_temp_file(
            &output_dir,
            "https://example.com/svn/trunk/readme.txt",
            "task-1",
        )
        .unwrap();
        fs::write(&first_path, "first").unwrap();
        let (_, second_path, second_name) = create_repository_temp_file(
            &output_dir,
            "https://example.com/svn/trunk/readme.txt",
            "task-1",
        )
        .unwrap();

        assert_ne!(first_path, second_path);
        assert_eq!(fs::read_to_string(&first_path).unwrap(), "first");
        assert!(first_name.ends_with(".txt"));
        assert!(second_name.ends_with(".txt"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_repository_output_directory_symlink_escape() {
        let root = test_temp_dir("repository-output-link");
        let app_data = root.join("app-data");
        let outside = root.join("outside");
        let linked_output = app_data.join("repository-files");
        fs::create_dir_all(&app_data).unwrap();
        fs::create_dir_all(&outside).unwrap();

        #[cfg(unix)]
        let link_created = std::os::unix::fs::symlink(&outside, &linked_output).is_ok();
        #[cfg(windows)]
        let link_created = std::os::windows::fs::symlink_dir(&outside, &linked_output).is_ok();

        if link_created {
            assert!(matches!(
                normalize_repository_output_dir(&linked_output),
                Err(NovaError::Command { ref code, .. })
                    if code == "REPOSITORY_FILE_DIR_OUTSIDE_APP_DATA"
            ));
        }
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn downloads_binary_repository_file_at_revision_and_cleans_failed_output() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("repository-file-integration");
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        let output_dir = root.join("repository-files");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        let file = working_copy.join("binary.bin");
        let revision_one = vec![0, 1, 2, 13, 10, 127, 128, 254, 255];
        let revision_two = vec![9, 8, 7, 0, 255];
        fs::write(&file, &revision_one).expect("write revision one binary");
        run_test_command(Command::new("svn").arg("add").arg(&file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "binary revision one"]),
        );
        fs::write(&file, &revision_two).expect("write revision two binary");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "binary revision two"]),
        );
        run_test_command(Command::new("svn").arg("delete").arg(&file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "delete binary at head"]),
        );

        let file_url = format!("{repository_url}/binary.bin");
        let success_state = repository_file_test_state("repository-file-success");
        run_repository_file_task(
            &success_state,
            "repository-file-success",
            RepositoryFileTaskPayload {
                url: file_url.clone(),
                revision: Some("1".to_string()),
                svn_executable: "svn".to_string(),
                output_dir: output_dir.clone(),
            },
        );
        let success_task = success_state.lock().unwrap().tasks[0].clone();
        assert!(matches!(success_task.status, TaskStatus::Success));
        let result = success_task
            .result
            .and_then(|result| result.repository_file)
            .expect("repository file result");
        assert_eq!(result.revision.as_deref(), Some("1"));
        assert_eq!(result.bytes, revision_one.len() as u64);
        assert!(result.file_name.ends_with(".bin"));
        assert_eq!(fs::read(&result.file_path).unwrap(), revision_one);

        let failed_output_dir = root.join("failed-repository-files");
        let failed_state = repository_file_test_state("repository-file-failed");
        run_repository_file_task(
            &failed_state,
            "repository-file-failed",
            RepositoryFileTaskPayload {
                url: format!("{repository_url}/missing.bin"),
                revision: Some("1".to_string()),
                svn_executable: "svn".to_string(),
                output_dir: failed_output_dir.clone(),
            },
        );
        let failed_task = failed_state.lock().unwrap().tasks[0].clone();
        assert!(matches!(failed_task.status, TaskStatus::Failed));
        assert_eq!(fs::read_dir(&failed_output_dir).unwrap().count(), 0);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn validates_merge_revision_range() {
        let range = normalize_merge_selection(Some("10".to_string()), Some("12".to_string()), None)
            .expect("range valid");

        assert_eq!(
            range,
            MergeRevisionSelection {
                start_revision: Some("10".to_string()),
                end_revision: Some("12".to_string()),
                revisions: vec![],
            }
        );
        assert!(normalize_merge_selection(Some("10".to_string()), None, None).is_err());
    }

    #[test]
    fn normalizes_discrete_merge_revisions() {
        let selection = normalize_merge_selection(
            None,
            None,
            Some(vec![
                "105".to_string(),
                "101".to_string(),
                "105".to_string(),
            ]),
        )
        .expect("revision selection valid");

        assert_eq!(
            selection,
            MergeRevisionSelection {
                start_revision: None,
                end_revision: None,
                revisions: vec!["101".to_string(), "105".to_string()],
            }
        );
        assert_eq!(
            merge_revision_arguments(&None, &None, &selection.revisions),
            vec!["-c", "101", "-c", "105"]
        );
        assert!(normalize_merge_selection(
            Some("100".to_string()),
            Some("105".to_string()),
            Some(vec!["103".to_string()]),
        )
        .is_err());
    }

    #[test]
    fn counts_merge_output_file_lines() {
        let output = "U    src/a.txt\nA    src/b.txt\nD    src/old.txt\n C   src/conflict.txt\n U   .\n--- Merging r1 through r2 into '.':\n";

        assert_eq!(
            summarize_merge_output(output),
            MergeOutputSummary {
                file_count: 5,
                added: 1,
                deleted: 1,
                updated: 2,
                conflicted: 1,
            }
        );
    }

    #[test]
    fn streams_merge_output_statistics_and_limits_single_lines() {
        let mut collector = MergeOutputCollector::default();
        collector
            .consume_bytes(b"U    src/a.txt\nC    src/conflict.txt\n")
            .expect("Merge 输出应能流式统计");
        collector.finish_line().expect("最后一行应能完成");
        let analysis = collector.finish();
        assert_eq!(analysis.summary.file_count, 2);
        assert_eq!(analysis.summary.updated, 1);
        assert_eq!(analysis.summary.conflicted, 1);
        assert_eq!(analysis.line_count, 2);
        assert!(!analysis.output_truncated);

        let mut oversized_line = MergeOutputCollector::default();
        let error = oversized_line
            .consume_bytes(&vec![b'x'; MAX_MERGE_OUTPUT_LINE_BYTES + 1])
            .expect_err("过长单行应被拒绝");
        assert!(matches!(
            error,
            NovaError::Command { code, .. } if code == "MERGE_OUTPUT_LINE_LIMIT_EXCEEDED"
        ));
    }

    #[test]
    fn rejects_conflicting_merge_tracking_options() {
        let error = validate_merge_tracking_options(true, true)
            .expect_err("record-only and ignore-ancestry must conflict");

        assert!(matches!(
            error,
            NovaError::Command { ref code, .. } if code == "MERGE_TRACKING_OPTIONS_CONFLICT"
        ));
        assert!(validate_merge_tracking_options(true, false).is_ok());
        assert!(validate_merge_tracking_options(false, true).is_ok());
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
                revisions: None,
                dry_run: false,
                allow_local_changes: false,
                record_only: false,
                ignore_ancestry: false,
                force: false,
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
    fn allows_non_dry_run_merge_with_local_changes_when_requested() {
        let queue = TaskQueue::new();
        let dir = test_temp_dir("merge-dirty-allowed");
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
                revisions: None,
                dry_run: false,
                allow_local_changes: true,
                record_only: false,
                ignore_ancestry: false,
                force: false,
                svn_executable: Some(svn.display().to_string()),
            })
            .expect("explicit dirty merge should be queued");

        assert!(matches!(
            task.payload,
            TaskPayload::Merge(payload) if payload.allow_local_changes && !payload.dry_run
        ));

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
                revisions: None,
                dry_run: true,
                allow_local_changes: false,
                record_only: true,
                ignore_ancestry: false,
                force: true,
                svn_executable: Some(svn.display().to_string()),
            })
            .expect("dry-run merge should not require a clean workspace");

        assert!(matches!(
            task.payload,
            TaskPayload::Merge(payload)
                if payload.dry_run && payload.record_only && payload.force
        ));

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn rechecks_workspace_status_immediately_before_merge_execution() {
        let dir = test_temp_dir("merge-execution-guard");
        let svn = write_svn_status_stub(
            &dir,
            r#"<status><target path="wc"><entry path="queued-change.txt"><wc-status item="modified" /></entry></target></status>"#,
        );
        let payload = MergeTaskPayload {
            app: None,
            working_copy_root: dir.display().to_string(),
            source_url: "https://example.com/svn/branches/feature".to_string(),
            start_revision: Some("10".to_string()),
            end_revision: Some("12".to_string()),
            revisions: Vec::new(),
            dry_run: false,
            allow_local_changes: false,
            record_only: false,
            ignore_ancestry: false,
            force: false,
            svn_executable: svn.display().to_string(),
            preview_id: None,
            expected_snapshot_digest: None,
        };
        let state = repository_file_test_state("merge-execution-guard");

        run_merge_task(&state, "merge-execution-guard", payload.clone());

        let task = state.lock().unwrap().tasks[0].clone();
        assert!(matches!(task.status, TaskStatus::Failed));
        assert!(task
            .error
            .as_deref()
            .is_some_and(|error| error.contains("任务等待期间出现了本地改动")));
        assert!(!task
            .logs
            .iter()
            .any(|log| log.message.starts_with("执行 svn merge")));

        let dirty_allowed_state = repository_file_test_state("merge-dirty-execution-allowed");
        run_merge_task(
            &dirty_allowed_state,
            "merge-dirty-execution-allowed",
            MergeTaskPayload {
                allow_local_changes: true,
                ..payload.clone()
            },
        );
        let dirty_allowed_task = dirty_allowed_state.lock().unwrap().tasks[0].clone();
        assert!(matches!(dirty_allowed_task.status, TaskStatus::Success));
        assert!(dirty_allowed_task
            .logs
            .iter()
            .any(|log| log.message.contains("Merge 将与现有改动叠加")));
        assert!(dirty_allowed_task
            .logs
            .iter()
            .any(|log| log.message.starts_with("执行 svn merge")));

        let dry_run_state = repository_file_test_state("merge-dry-run-execution-guard");
        run_merge_task(
            &dry_run_state,
            "merge-dry-run-execution-guard",
            MergeTaskPayload {
                dry_run: true,
                ..payload
            },
        );
        let dry_run_task = dry_run_state.lock().unwrap().tasks[0].clone();
        assert!(matches!(dry_run_task.status, TaskStatus::Success));
        assert!(dry_run_task
            .logs
            .iter()
            .any(|log| log.message.contains("dry-run 将继续生成预览")));

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn merges_revision_range_and_records_mergeinfo_in_real_repository() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("merge-integration");
        let repository = root.join("repository");
        let trunk = root.join("trunk");
        let branch = root.join("branch");
        let record_only_target = root.join("record-only-target");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        let trunk_url = format!("{repository_url}/trunk");
        let branch_url = format!("{repository_url}/branches/feature");
        run_test_command(
            Command::new("svn")
                .arg("mkdir")
                .arg(&trunk_url)
                .arg(format!("{repository_url}/branches"))
                .args(["-m", "create layout"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&trunk_url)
                .arg(&trunk),
        );

        let trunk_file = trunk.join("tracked.txt");
        fs::write(&trunk_file, "trunk\n").expect("write trunk file");
        run_test_command(Command::new("svn").arg("add").arg(&trunk_file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&trunk)
                .args(["-m", "add trunk file"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("copy")
                .arg(&trunk_url)
                .arg(&branch_url)
                .args(["-m", "create feature branch"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&branch_url)
                .arg(&branch),
        );
        fs::write(branch.join("tracked.txt"), "feature\n").expect("write branch file");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&branch)
                .args(["-m", "update feature"]),
        );
        run_test_command(Command::new("svn").arg("update").arg(&trunk));
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&trunk_url)
                .arg(&record_only_target),
        );

        let queue = TaskQueue::new();
        let dry_run = queue
            .create_merge_task(CreateMergeTaskRequest {
                working_copy_root: trunk.display().to_string(),
                source_url: branch_url.clone(),
                start_revision: Some("3".to_string()),
                end_revision: Some("4".to_string()),
                revisions: None,
                dry_run: true,
                allow_local_changes: false,
                record_only: false,
                ignore_ancestry: false,
                force: false,
                svn_executable: None,
            })
            .expect("create merge dry-run task");
        let dry_run = wait_for_test_task(&queue, &dry_run.task_id);
        assert!(
            matches!(dry_run.status, TaskStatus::Success),
            "Merge dry-run 失败：{:?}",
            dry_run.error
        );
        let dry_run_result = dry_run
            .result
            .and_then(|result| result.merge_result)
            .expect("merge dry-run result");
        assert!(dry_run_result.dry_run);
        assert_eq!(dry_run_result.revision_range, "3:4");
        assert!(dry_run_result.updated >= 1);
        assert_eq!(fs::read_to_string(&trunk_file).unwrap(), "trunk\n");
        let clean_status = run_test_command(Command::new("svn").arg("status").arg(&trunk));
        assert!(clean_status.stdout.is_empty());

        let merge = queue
            .create_merge_task(CreateMergeTaskRequest {
                working_copy_root: trunk.display().to_string(),
                source_url: branch_url.clone(),
                start_revision: Some("3".to_string()),
                end_revision: Some("4".to_string()),
                revisions: None,
                dry_run: false,
                allow_local_changes: false,
                record_only: false,
                ignore_ancestry: false,
                force: true,
                svn_executable: None,
            })
            .expect("create merge task");
        let merge = wait_for_test_task(&queue, &merge.task_id);
        assert!(
            matches!(merge.status, TaskStatus::Success),
            "Merge 失败：{:?}",
            merge.error
        );
        let merge_result = merge
            .result
            .and_then(|result| result.merge_result)
            .expect("merge result");
        assert!(merge_result.force);
        assert_eq!(fs::read_to_string(&trunk_file).unwrap(), "feature\n");
        let mergeinfo = run_test_command(
            Command::new("svn")
                .arg("propget")
                .arg("svn:mergeinfo")
                .arg(&trunk),
        );
        assert!(String::from_utf8_lossy(&mergeinfo.stdout).contains("/branches/feature:4"));

        let record_queue = TaskQueue::new();
        let record_only = record_queue
            .create_merge_task(CreateMergeTaskRequest {
                working_copy_root: record_only_target.display().to_string(),
                source_url: branch_url,
                start_revision: Some("3".to_string()),
                end_revision: Some("4".to_string()),
                revisions: None,
                dry_run: false,
                allow_local_changes: false,
                record_only: true,
                ignore_ancestry: false,
                force: false,
                svn_executable: None,
            })
            .expect("create record-only merge task");
        let record_only = wait_for_test_task(&record_queue, &record_only.task_id);
        assert!(
            matches!(record_only.status, TaskStatus::Success),
            "Record-only Merge 失败：{:?}",
            record_only.error
        );
        let record_only_result = record_only
            .result
            .and_then(|result| result.merge_result)
            .expect("record-only merge result");
        assert!(record_only_result.record_only);
        assert_eq!(
            fs::read_to_string(record_only_target.join("tracked.txt")).unwrap(),
            "trunk\n"
        );
        let record_mergeinfo = run_test_command(
            Command::new("svn")
                .arg("propget")
                .arg("svn:mergeinfo")
                .arg(&record_only_target),
        );
        assert!(String::from_utf8_lossy(&record_mergeinfo.stdout).contains("/branches/feature:4"));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn merges_into_nested_working_copy_directory() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("merge-nested-target");
        let repository = root.join("repository");
        let trunk = root.join("trunk");
        let branch = root.join("branch");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        let trunk_url = format!("{repository_url}/trunk");
        let branch_url = format!("{repository_url}/branches/feature");
        run_test_command(
            Command::new("svn")
                .arg("mkdir")
                .arg(&trunk_url)
                .arg(format!("{repository_url}/branches"))
                .args(["-m", "create layout"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&trunk_url)
                .arg(&trunk),
        );
        let target = trunk.join("game/client");
        fs::create_dir_all(&target).expect("create nested target");
        fs::write(target.join("tracked.txt"), "trunk\n").expect("write nested trunk file");
        run_test_command(Command::new("svn").arg("add").arg(trunk.join("game")));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&trunk)
                .args(["-m", "add nested trunk file"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("copy")
                .arg(&trunk_url)
                .arg(&branch_url)
                .args(["-m", "create feature branch"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&branch_url)
                .arg(&branch),
        );
        fs::write(branch.join("game/client/tracked.txt"), "feature\n")
            .expect("update nested branch file");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&branch)
                .args(["-m", "update nested feature file"]),
        );
        run_test_command(Command::new("svn").arg("update").arg(&trunk));

        let (copy_root, relative_target) =
            merge_preview_copy_context("svn", &target).expect("resolve preview copy context");
        assert_eq!(copy_root, fs::canonicalize(&trunk).unwrap());
        assert_eq!(relative_target, PathBuf::from("game").join("client"));

        let source_url = format!("{branch_url}/game/client");
        let queue = TaskQueue::new();
        let dry_run = queue
            .create_merge_task(CreateMergeTaskRequest {
                working_copy_root: target.display().to_string(),
                source_url: source_url.clone(),
                start_revision: Some("3".to_string()),
                end_revision: Some("4".to_string()),
                revisions: None,
                dry_run: true,
                allow_local_changes: false,
                record_only: false,
                ignore_ancestry: false,
                force: false,
                svn_executable: None,
            })
            .expect("create nested merge dry-run");
        let dry_run = wait_for_test_task(&queue, &dry_run.task_id);
        assert!(
            matches!(dry_run.status, TaskStatus::Success),
            "Nested merge dry-run failed: {:?}",
            dry_run.error
        );
        assert_eq!(
            fs::read_to_string(target.join("tracked.txt")).unwrap(),
            "trunk\n"
        );

        let merge = queue
            .create_merge_task(CreateMergeTaskRequest {
                working_copy_root: target.display().to_string(),
                source_url,
                start_revision: Some("3".to_string()),
                end_revision: Some("4".to_string()),
                revisions: None,
                dry_run: false,
                allow_local_changes: false,
                record_only: false,
                ignore_ancestry: false,
                force: false,
                svn_executable: None,
            })
            .expect("create nested merge");
        let merge = wait_for_test_task(&queue, &merge.task_id);
        assert!(
            matches!(merge.status, TaskStatus::Success),
            "Nested merge failed: {:?}",
            merge.error
        );
        assert_eq!(
            fs::read_to_string(target.join("tracked.txt")).unwrap(),
            "feature\n"
        );

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn merges_only_selected_discrete_revisions_in_real_repository() {
        if !svn_tools_available() {
            return;
        }

        let root = test_temp_dir("merge-discrete-integration");
        let repository = root.join("repository");
        let trunk = root.join("trunk");
        let branch = root.join("branch");
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        let trunk_url = format!("{repository_url}/trunk");
        let branch_url = format!("{repository_url}/branches/feature");
        run_test_command(
            Command::new("svn")
                .arg("mkdir")
                .arg(&trunk_url)
                .arg(format!("{repository_url}/branches"))
                .args(["-m", "create layout"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("copy")
                .arg(&trunk_url)
                .arg(&branch_url)
                .args(["-m", "create feature branch"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&branch_url)
                .arg(&branch),
        );
        for (name, content, message) in [
            ("selected-first.txt", "first\n", "first selected change"),
            ("skipped.txt", "skip\n", "unselected change"),
            ("selected-last.txt", "last\n", "last selected change"),
        ] {
            let path = branch.join(name);
            fs::write(&path, content).expect("write branch file");
            run_test_command(Command::new("svn").arg("add").arg(&path));
            run_test_command(
                Command::new("svn")
                    .arg("commit")
                    .arg(&branch)
                    .args(["-m", message]),
            );
        }
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&trunk_url)
                .arg(&trunk),
        );

        let queue = TaskQueue::new();
        let merge = queue
            .create_merge_task(CreateMergeTaskRequest {
                working_copy_root: trunk.display().to_string(),
                source_url: branch_url,
                start_revision: None,
                end_revision: None,
                revisions: Some(vec!["5".to_string(), "3".to_string()]),
                dry_run: false,
                allow_local_changes: false,
                record_only: false,
                ignore_ancestry: false,
                force: false,
                svn_executable: None,
            })
            .expect("create discrete merge task");
        let merge = wait_for_test_task(&queue, &merge.task_id);
        assert!(
            matches!(merge.status, TaskStatus::Success),
            "离散 Revision Merge 失败：{:?}",
            merge.error
        );
        let merge_result = merge
            .result
            .and_then(|result| result.merge_result)
            .expect("discrete merge result");
        assert_eq!(merge_result.revision_range, "3,5");
        assert!(trunk.join("selected-first.txt").is_file());
        assert!(trunk.join("selected-last.txt").is_file());
        assert!(!trunk.join("skipped.txt").exists());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn counts_svn_diff_files() {
        let diff = "Index: a.txt\n--- a.txt\n+++ a.txt\ndiff --git b/c b/c\n";

        let analysis =
            analyze_revision_diff_reader(Cursor::new(diff.as_bytes())).expect("diff 输出应能分析");
        assert_eq!(analysis.file_count, 2);
        assert_eq!(analysis.line_count, 4);
    }

    #[test]
    fn truncates_revision_diff_preview_on_utf8_boundary() {
        let text = "abc中文def";
        let truncated = truncate_utf8(text, 5);

        assert_eq!(truncated, "abc");
        assert!(truncated.is_char_boundary(truncated.len()));
    }

    #[test]
    fn bounds_merge_result_preview_and_reports_truncation() {
        let full_output = "U    中文文件.txt\n".repeat(MERGE_OUTPUT_PREVIEW_MAX_BYTES / 22 + 100);
        let output_truncated = full_output.len() > MERGE_OUTPUT_PREVIEW_MAX_BYTES;
        let preview = bounded_text_preview(
            full_output,
            MERGE_OUTPUT_PREVIEW_MAX_BYTES,
            "Merge 输出预览已截断",
        );

        assert!(output_truncated);
        assert!(preview.len() <= MERGE_OUTPUT_PREVIEW_MAX_BYTES);
        assert!(preview.contains("Merge 输出预览已截断"));
        assert!(preview.is_char_boundary(preview.len()));
    }

    #[test]
    fn writes_complete_revision_diff_patch_beyond_preview_limit() {
        let output_dir = test_temp_dir("revision-diff-complete-patch");
        let payload = RevisionDiffTaskPayload {
            mode: RevisionDiffMode::Revisions,
            working_copy_root: Some("C:/repo/wc".to_string()),
            file_path: None,
            target_url: None,
            left_revision: Some("10".to_string()),
            right_revision: Some("12".to_string()),
            left_url: None,
            right_url: None,
            svn_executable: "svn".to_string(),
            patch_output_dir: output_dir.clone(),
        };
        let diff_text = format!(
            "Index: large.txt\n{}",
            "a".repeat(REVISION_DIFF_PREVIEW_MAX_BYTES + 1024)
        );

        let source_path = output_dir.join("source.patch");
        fs::write(&source_path, &diff_text).expect("写入源 patch");
        let analysis = analyze_revision_diff_file(&source_path).expect("分析完整 patch");
        let patch = copy_revision_diff_patch(
            &payload,
            "task-large",
            "r10:r12",
            &source_path,
            analysis.total_bytes,
        )
        .expect("complete patch should be written")
        .expect("non-empty diff should create a patch file");

        assert!(diff_text.len() > REVISION_DIFF_PREVIEW_MAX_BYTES);
        assert_ne!(
            truncate_utf8(&diff_text, REVISION_DIFF_PREVIEW_MAX_BYTES),
            diff_text
        );
        assert_eq!(fs::read_to_string(&patch.path).unwrap(), diff_text);
        fs::remove_dir_all(output_dir).ok();
    }

    #[test]
    fn rejects_revision_diff_output_beyond_patch_limit_without_buffering_it() {
        let mut reader = Cursor::new(b"0123456789".to_vec());
        let error = analyze_revision_diff_reader_with_limit(&mut reader, 4)
            .expect_err("超过 Patch 限制应失败");
        assert!(matches!(
            error,
            NovaError::Command { code, .. } if code == "REVISION_DIFF_OUTPUT_LIMIT_EXCEEDED"
        ));
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

        let result = parse_repository_list_xml_reader(
            Cursor::new(xml.as_bytes()),
            "https://example.com/svn",
            Some("8"),
        )
        .expect("list parses");

        assert_eq!(result.url, "https://example.com/svn");
        assert_eq!(result.revision.as_deref(), Some("8"));
        assert_eq!(result.entries.len(), 3);
        assert_eq!(result.entries[0].name, "branches");
        assert_eq!(result.entries[1].name, "trunk");
        assert_eq!(result.entries[2].name, "zeta.txt");
        assert_eq!(result.entries[0].kind, "dir");
        assert_eq!(result.entries[0].revision, "7");
        assert_eq!(result.entries[0].author, "dev");
        assert_eq!(result.entries[0].date, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn streams_repository_list_xml_and_enforces_entry_limit() {
        let xml = r#"
<lists><list path="https://example.com/svn">
  <entry kind="file"><name>one.txt</name><commit revision="1" /></entry>
  <entry kind="file"><name>two.txt</name><commit revision="2" /></entry>
</list></lists>
"#;

        let error = parse_repository_list_xml_reader_with_limits(
            Cursor::new(xml.as_bytes()),
            "https://example.com/svn",
            None,
            1,
            MAX_REPOSITORY_LIST_TEXT_BYTES,
        )
        .expect_err("超过条目限制应失败");

        assert!(matches!(
            error,
            NovaError::Command { code, .. } if code == "SVN_LIST_ENTRY_LIMIT_EXCEEDED"
        ));
    }

    #[test]
    fn streams_repository_list_entities_and_enforces_text_limit() {
        let xml = r#"
<lists><list path="https://example.com/svn">
  <entry kind="file"><name>中文&amp;file.txt</name><commit revision="1"><author>dev</author></commit></entry>
</list></lists>
"#;
        let result = parse_repository_list_xml_reader(
            Cursor::new(xml.as_bytes()),
            "https://example.com/svn",
            None,
        )
        .expect("实体和中文应能流式解析");
        assert_eq!(result.entries[0].name, "中文&file.txt");

        let error = parse_repository_list_xml_reader_with_limits(
            Cursor::new(xml.as_bytes()),
            "https://example.com/svn",
            None,
            MAX_REPOSITORY_LIST_ENTRIES,
            4,
        )
        .expect_err("超过文本限制应失败");
        assert!(matches!(
            error,
            NovaError::Command { code, .. } if code == "SVN_LIST_TEXT_LIMIT_EXCEEDED"
        ));
    }
}
