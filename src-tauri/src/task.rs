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

use serde::{Deserialize, Serialize};

use crate::error::NovaError;

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
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSvnOperationTaskRequest {
    pub working_copy_root: String,
    pub kind: SvnOperationKind,
    pub file_path: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone)]
enum TaskPayload {
    Mock(MockTaskOutcome),
    SvnCommit(CommitTaskPayload),
    SvnOperation(SvnOperationTaskPayload),
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

        let svn_executable = request
            .svn_executable
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "svn".to_string());
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
            SvnOperationKind::Update | SvnOperationKind::Cleanup => None,
        };
        let svn_executable = request
            .svn_executable
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "svn".to_string());
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

    pub fn list_tasks(&self) -> TaskSnapshot {
        let state = self.state.lock().expect("任务队列锁已损坏");
        TaskSnapshot {
            tasks: state.tasks.iter().map(TaskSummary::from).collect(),
            running_task_id: state.running_task_id.clone(),
        }
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
        }
    }
}

fn run_mock_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    outcome: MockTaskOutcome,
) {
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

fn run_commit_task(
    state: &Arc<Mutex<TaskQueueState>>,
    task_id: &str,
    payload: CommitTaskPayload,
) {
    update_task(state, task_id, TaskStatus::Running, "提交任务开始执行", None);
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
    update_task(state, task_id, TaskStatus::Running, "SVN 操作开始执行", None);

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
    }
    command.current_dir(&root);

    match command.output() {
        Ok(output) if output.status.success() => {
            append_command_output(state, task_id, &output);
            update_task(state, task_id, TaskStatus::Success, "SVN 操作执行成功", None);
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

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("系统时间早于 UNIX_EPOCH")
        .as_millis() as u64
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
    }
}
