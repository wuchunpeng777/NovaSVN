use std::{
    collections::VecDeque,
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
use tauri::AppHandle;

use crate::{
    error::NovaError,
    executable::normalize_executable_setting,
    shadow::{self, ShadowWorkspaceRequest},
};

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
    Cleanup,
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

#[derive(Debug, Clone, Serialize)]
pub struct TaskResult {
    pub repository_list: Option<RepositoryListResult>,
    pub revision_diff: Option<RevisionDiffResult>,
    pub merge_result: Option<MergeResult>,
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

#[derive(Debug, Clone)]
enum TaskPayload {
    Mock(MockTaskOutcome),
    SvnCommit(CommitTaskPayload),
    SvnOperation(SvnOperationTaskPayload),
    ShadowWorkspace(ShadowWorkspaceTaskPayload),
    PartialCommit(PartialCommitTaskPayload),
    RepositoryList(RepositoryListTaskPayload),
    RepositoryCopy(RepositoryCopyTaskPayload),
    BranchCheckout(BranchCheckoutTaskPayload),
    SvnSwitch(SvnSwitchTaskPayload),
    RevisionDiff(RevisionDiffTaskPayload),
    Merge(MergeTaskPayload),
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
    svn_executable: String,
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
    left_revision: Option<String>,
    right_revision: Option<String>,
    left_url: Option<String>,
    right_url: Option<String>,
    svn_executable: String,
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
        let working_copy_root = normalize_workspace_root(&request.working_copy_root)?;
        let file_path = match request.kind {
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
            SvnOperationKind::UnlockFile | SvnOperationKind::ForceUnlockFile => Some(normalize_relative_file_path(
                request.file_path.as_deref().unwrap_or_default(),
                "UNLOCK_FILE_PATH_INVALID",
                "Unlock 文件路径无效",
            )?),
            SvnOperationKind::ResolveWorking
            | SvnOperationKind::ResolveMineFull
            | SvnOperationKind::ResolveTheirsFull => Some(normalize_relative_file_path(
                request.file_path.as_deref().unwrap_or_default(),
                "RESOLVE_FILE_PATH_INVALID",
                "Resolve 文件路径无效",
            )?),
            SvnOperationKind::Update | SvnOperationKind::Cleanup => None,
        };
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let title = operation_title(&request.kind, file_path.as_deref());
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
                svn_executable,
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
        request: CreateRevisionDiffTaskRequest,
    ) -> Result<Task, NovaError> {
        let svn_executable = normalize_svn_executable(request.svn_executable.as_deref())?;
        let payload = normalize_revision_diff_payload(request, svn_executable)?;
        let task_id = format!("task-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
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
                    .iter()
                    .find(|task| task.task_id == task_id)
                    .map(|task| (task_id, task.payload.clone()))
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
        }
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
        SvnOperationKind::Cleanup => {
            command.arg("cleanup").arg(&root);
            append_task_log(state, task_id, "执行 svn cleanup");
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
    let patch_output = Command::new(&executable)
        .arg("patch")
        .arg(&patch_path)
        .current_dir(&shadow_path)
        .output();
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
            command.arg("-r").arg(format!("{left}:{right}")).arg(root);
            format!("{root} r{left}:r{right}")
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
            append_command_output(state, task_id, &output);
            let diff_text = String::from_utf8_lossy(&output.stdout).to_string();
            let result = RevisionDiffResult {
                mode: revision_diff_mode_label(&payload.mode).to_string(),
                target,
                file_count: count_diff_files(&diff_text),
                line_count: diff_text.lines().count(),
                diff_text,
            };
            let file_count = result.file_count;
            let line_count = result.line_count;
            set_task_result(
                state,
                task_id,
                TaskResult {
                    repository_list: None,
                    revision_diff: Some(result),
                    merge_result: None,
                },
            );
            update_task(
                state,
                task_id,
                TaskStatus::Success,
                &format!("Revision diff 完成，{file_count} 个文件，{line_count} 行"),
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
                revision_range: merge_revision_label(&payload.start_revision, &payload.end_revision),
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

fn normalize_commit_files(files: &[String]) -> Result<Vec<String>, NovaError> {
    if files.is_empty() {
        return Err(NovaError::command(
            "COMMIT_FILES_REQUIRED",
            "请先暂存要提交的文件",
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
    let trimmed = file.trim();
    let path = Path::new(trimmed);
    if trimmed.is_empty() || path.is_absolute() || trimmed.contains("..") {
        return Err(NovaError::command(
            code,
            message,
            Some("文件路径必须是工作副本内的相对路径。".to_string()),
            true,
        ));
    }

    Ok(trimmed.replace('\\', "/"))
}

fn operation_title(kind: &SvnOperationKind, file_path: Option<&str>) -> String {
    match kind {
        SvnOperationKind::Update => "更新工作副本".to_string(),
        SvnOperationKind::Cleanup => "清理工作副本".to_string(),
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
    let home_relative = trimmed.starts_with("~/") || trimmed.starts_with("~\\");
    if !path.is_absolute() && !home_relative {
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

            Ok(RevisionDiffTaskPayload {
                mode: RevisionDiffMode::Revisions,
                working_copy_root: Some(working_copy_root.display().to_string()),
                left_revision: Some(left_revision),
                right_revision: Some(right_revision),
                left_url: None,
                right_url: None,
                svn_executable,
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
                left_revision: None,
                right_revision: Some(right_revision),
                left_url: None,
                right_url: None,
                svn_executable,
            })
        }
        RevisionDiffMode::Urls => {
            let left_url = normalize_repository_url(request.left_url.as_deref().unwrap_or(""))?;
            let right_url = normalize_repository_url(request.right_url.as_deref().unwrap_or(""))?;

            Ok(RevisionDiffTaskPayload {
                mode: RevisionDiffMode::Urls,
                working_copy_root: None,
                left_revision: None,
                right_revision: None,
                left_url: Some(left_url),
                right_url: Some(right_url),
                svn_executable,
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

fn merge_revision_arg(start_revision: &Option<String>, end_revision: &Option<String>) -> Option<String> {
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

fn revision_diff_mode_label(mode: &RevisionDiffMode) -> &'static str {
    match mode {
        RevisionDiffMode::Revisions => "revisions",
        RevisionDiffMode::WorkingCopyToRevision => "working_copy_to_revision",
        RevisionDiffMode::Urls => "urls",
    }
}

fn count_diff_files(diff_text: &str) -> usize {
    diff_text
        .lines()
        .filter(|line| line.starts_with("Index: ") || line.starts_with("diff --git "))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(normalize_relative_file_path(
            "../secret.txt",
            "INVALID",
            "invalid",
        )
        .is_err());
        assert!(normalize_relative_file_path(
            "C:\\secret.txt",
            "INVALID",
            "invalid",
        )
        .is_err());
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
        assert_eq!(normalize_svn_executable(Some(" svn.exe ")).unwrap(), "svn.exe");
        assert!(normalize_svn_executable(Some("C:\\Tools\\svn.exe")).is_ok());
        assert!(normalize_svn_executable(Some("tools\\svn.exe")).is_err());
        assert!(normalize_svn_executable(Some("svn\n")).is_err());
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
    fn counts_svn_diff_files() {
        let diff = "Index: a.txt\n--- a.txt\n+++ a.txt\ndiff --git b/c b/c\n";

        assert_eq!(count_diff_files(diff), 2);
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

        let result = parse_repository_list_xml(xml, "https://example.com/svn").expect("list parses");

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
