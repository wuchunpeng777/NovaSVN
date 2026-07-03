use std::{
    fs,
    path::{Path, PathBuf},
};

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
    let name = normalize_task_name(&request.name)?;
    let local_path = normalize_local_path(&request.local_path)?;
    let branch_url = normalize_branch_url(&request.branch_url)?;
    let draft_key = normalize_draft_key(&request.draft_key)?;
    let branch_pool_entry_id = normalize_optional_id(
        request.branch_pool_entry_id.as_deref(),
        "TASK_WORKSPACE_BRANCH_POOL_ID_INVALID",
        "绑定分支工作副本 ID 无效",
    )?;

    let mut list = read_task_workspaces(app)?;
    let now = timestamp_millis();
    let id = normalize_optional_id(
        request.id.as_deref(),
        "TASK_WORKSPACE_ID_INVALID",
        "任务工作区 ID 无效",
    )?
    .unwrap_or_else(|| entry_id(&name, &local_path, now));
    let entry = TaskWorkspaceEntry {
        id: id.clone(),
        name,
        branch_pool_entry_id,
        branch_url,
        local_path,
        draft_key,
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

fn normalize_task_name(name: &str) -> Result<String, NovaError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "TASK_WORKSPACE_NAME_REQUIRED",
            "任务名称不能为空",
            None,
            true,
        ));
    }

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "TASK_WORKSPACE_NAME_INVALID",
            "任务名称无效",
            Some("任务名称不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(trimmed.to_string())
}

fn normalize_branch_url(url: &str) -> Result<String, NovaError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "TASK_WORKSPACE_BRANCH_URL_REQUIRED",
            "分支 URL 不能为空",
            None,
            true,
        ));
    }

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "TASK_WORKSPACE_BRANCH_URL_INVALID",
            "分支 URL 无效",
            Some("分支 URL 不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(trimmed.trim_end_matches('/').to_string())
}

fn normalize_local_path(path: &str) -> Result<String, NovaError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "TASK_WORKSPACE_LOCAL_PATH_REQUIRED",
            "工作副本路径不能为空",
            None,
            true,
        ));
    }

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "TASK_WORKSPACE_LOCAL_PATH_INVALID",
            "工作副本路径无效",
            Some("工作副本路径不能包含控制字符。".to_string()),
            true,
        ));
    }

    let path = Path::new(trimmed);
    let home_relative = trimmed.starts_with("~/") || trimmed.starts_with("~\\");
    if !path.is_absolute() && !home_relative {
        return Err(NovaError::command(
            "TASK_WORKSPACE_LOCAL_PATH_INVALID",
            "工作副本路径无效",
            Some("工作副本路径必须是绝对路径或 ~/ 开头路径。".to_string()),
            true,
        ));
    }

    Ok(trimmed.to_string())
}

fn normalize_draft_key(draft_key: &str) -> Result<String, NovaError> {
    let trimmed = draft_key.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "TASK_WORKSPACE_DRAFT_KEY_REQUIRED",
            "任务草稿键不能为空",
            None,
            true,
        ));
    }

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "TASK_WORKSPACE_DRAFT_KEY_INVALID",
            "任务草稿键无效",
            Some("任务草稿键不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(trimmed.to_string())
}

fn normalize_optional_id(
    id: Option<&str>,
    code: &'static str,
    message: &'static str,
) -> Result<Option<String>, NovaError> {
    let Some(value) = id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if value.chars().any(char::is_control) {
        return Err(NovaError::command(
            code,
            message,
            Some("ID 不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(Some(value.to_string()))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_task_workspace_fields() {
        assert_eq!(normalize_task_name(" 修复登录 ").unwrap(), "修复登录");
        assert_eq!(
            normalize_branch_url(" https://example.com/svn/branches/feature/ ").unwrap(),
            "https://example.com/svn/branches/feature"
        );
        assert_eq!(
            normalize_local_path(" C:\\wc\\feature ").unwrap(),
            "C:\\wc\\feature"
        );
        assert_eq!(
            normalize_draft_key(" task-workspace:pool-1:feature ").unwrap(),
            "task-workspace:pool-1:feature"
        );
        assert_eq!(
            normalize_optional_id(Some(" pool-1 "), "INVALID", "invalid").unwrap(),
            Some("pool-1".to_string())
        );
        assert_eq!(
            normalize_optional_id(Some(" "), "INVALID", "invalid").unwrap(),
            None
        );
    }

    #[test]
    fn rejects_invalid_task_workspace_fields() {
        assert!(normalize_task_name(" ").is_err());
        assert!(normalize_task_name("task\nname").is_err());
        assert!(normalize_branch_url(" ").is_err());
        assert!(normalize_branch_url("https://example.com/svn\nbranches").is_err());
        assert!(normalize_local_path("relative\\feature").is_err());
        assert!(normalize_local_path("C:\\wc\nfeature").is_err());
        assert!(normalize_draft_key(" ").is_err());
        assert!(normalize_draft_key("draft\nkey").is_err());
        assert!(normalize_optional_id(Some("pool\n1"), "INVALID", "invalid").is_err());
    }
}
