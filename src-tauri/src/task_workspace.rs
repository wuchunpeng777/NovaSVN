use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::NovaError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskWorkspaceEntry {
    pub id: String,
    pub name: String,
    pub branch_pool_entry_id: Option<String>,
    pub branch_url: String,
    pub local_path: String,
    pub draft_key: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskWorkspaceList {
    pub entries: Vec<TaskWorkspaceEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveTaskWorkspaceRequest {
    pub id: Option<String>,
    pub name: String,
    pub branch_pool_entry_id: Option<String>,
    pub branch_url: String,
    pub local_path: String,
    pub draft_key: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveTaskWorkspaceRequest {
    pub id: String,
}

pub fn read_task_workspaces(app: &AppHandle) -> Result<TaskWorkspaceList, NovaError> {
    let path = task_workspaces_path(app)?;
    if !path.exists() {
        return Ok(TaskWorkspaceList::default());
    }

    let content = fs::read_to_string(&path).map_err(|error| {
        NovaError::command(
            "TASK_WORKSPACES_READ_FAILED",
            "读取任务工作区失败",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    serde_json::from_str(&content).map_err(|error| {
        NovaError::command(
            "TASK_WORKSPACES_PARSE_FAILED",
            "解析任务工作区失败",
            Some(error.to_string()),
            true,
        )
    })
}

pub fn save_task_workspace(
    app: &AppHandle,
    request: SaveTaskWorkspaceRequest,
) -> Result<TaskWorkspaceList, NovaError> {
    let name = request.name.trim();
    let local_path = request.local_path.trim();
    if name.is_empty() || local_path.is_empty() {
        return Err(NovaError::command(
            "TASK_WORKSPACE_INVALID",
            "任务名称和工作副本路径不能为空",
            None,
            true,
        ));
    }

    let mut list = read_task_workspaces(app)?;
    let now = timestamp_millis();
    let id = request.id.unwrap_or_else(|| entry_id(name, local_path, now));
    let entry = TaskWorkspaceEntry {
        id: id.clone(),
        name: name.to_string(),
        branch_pool_entry_id: request
            .branch_pool_entry_id
            .filter(|value| !value.trim().is_empty()),
        branch_url: request.branch_url.trim().to_string(),
        local_path: local_path.to_string(),
        draft_key: request.draft_key.trim().to_string(),
        created_at: list
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.created_at)
            .unwrap_or(now),
        updated_at: now,
    };

    if let Some(existing) = list.entries.iter_mut().find(|entry| entry.id == id) {
        *existing = entry;
    } else {
        list.entries.push(entry);
    }

    write_task_workspaces(app, &list)?;
    Ok(list)
}

pub fn remove_task_workspace(
    app: &AppHandle,
    request: RemoveTaskWorkspaceRequest,
) -> Result<TaskWorkspaceList, NovaError> {
    let mut list = read_task_workspaces(app)?;
    list.entries.retain(|entry| entry.id != request.id);
    write_task_workspaces(app, &list)?;
    Ok(list)
}

fn write_task_workspaces(app: &AppHandle, list: &TaskWorkspaceList) -> Result<(), NovaError> {
    let path = task_workspaces_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            NovaError::command(
                "TASK_WORKSPACES_DIR_FAILED",
                "创建任务工作区目录失败",
                Some(format!("路径：{}。错误：{error}", parent.display())),
                true,
            )
        })?;
    }

    let content = serde_json::to_string_pretty(list).map_err(|error| {
        NovaError::command(
            "TASK_WORKSPACES_SERIALIZE_FAILED",
            "序列化任务工作区失败",
            Some(error.to_string()),
            true,
        )
    })?;
    fs::write(&path, content).map_err(|error| {
        NovaError::command(
            "TASK_WORKSPACES_WRITE_FAILED",
            "保存任务工作区失败",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })
}

fn task_workspaces_path(app: &AppHandle) -> Result<PathBuf, NovaError> {
    let dir = app.path().app_data_dir().map_err(|error| {
        NovaError::command(
            "APP_DATA_DIR_FAILED",
            "无法获取应用数据目录",
            Some(error.to_string()),
            true,
        )
    })?;

    Ok(dir.join("task-workspaces.json"))
}

fn entry_id(name: &str, local_path: &str, created_at: u64) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in format!("{name}\n{local_path}\n{created_at}").as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }

    format!("task-workspace-{hash:016x}")
}

fn timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("系统时间早于 UNIX_EPOCH")
        .as_millis() as u64
}
