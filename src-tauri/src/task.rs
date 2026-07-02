use std::{
    collections::VecDeque,
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
    outcome: MockTaskOutcome,
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
            outcome: request.outcome.clone(),
        };

        {
            let mut state = self.state.lock().expect("任务队列锁已损坏");
            state.pending.push_back(task_id);
            state.tasks.push(task.clone());
        }

        self.ensure_worker();
        task
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
                    .map(|task| (task_id, task.outcome.clone()))
            })
        };

        let Some((task_id, outcome)) = next_task else {
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

        update_task(&state, &task_id, TaskStatus::Running, "任务开始执行", None);
        thread::sleep(Duration::from_millis(450));
        append_task_log(&state, &task_id, "准备模拟命令环境");
        thread::sleep(Duration::from_millis(450));
        append_task_log(&state, &task_id, "模拟命令运行中");
        thread::sleep(Duration::from_millis(450));

        match outcome {
            MockTaskOutcome::Success => {
                update_task(&state, &task_id, TaskStatus::Success, "任务执行成功", None)
            }
            MockTaskOutcome::Failed => update_task(
                &state,
                &task_id,
                TaskStatus::Failed,
                "任务执行失败",
                Some("模拟任务失败，用于验证失败状态和日志展示。".to_string()),
            ),
        }
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

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("系统时间早于 UNIX_EPOCH")
        .as_millis() as u64
}
