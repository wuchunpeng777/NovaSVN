use std::{
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

use crate::error::NovaError;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalToolKind {
    Diff,
    Merge,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LaunchExternalToolRequest {
    pub kind: ExternalToolKind,
    pub tool_path: String,
    pub working_copy_root: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExternalToolLaunch {
    pub kind: String,
    pub tool_path: String,
    pub target_path: String,
}

pub fn launch_external_tool(
    request: LaunchExternalToolRequest,
) -> Result<ExternalToolLaunch, NovaError> {
    let tool = request.tool_path.trim();
    if tool.is_empty() {
        return Err(NovaError::command(
            "EXTERNAL_TOOL_EMPTY",
            "请先配置外部工具路径",
            None,
            true,
        ));
    }

    let root = normalize_root(&request.working_copy_root)?;
    let target = normalize_file_path(&root, &request.file_path)?;

    Command::new(tool).arg(&target).spawn().map_err(|error| {
        NovaError::command(
            "EXTERNAL_TOOL_LAUNCH_FAILED",
            "无法启动外部工具",
            Some(format!(
                "执行 `{tool}` 打开 `{}` 失败：{error}",
                target.display()
            )),
            true,
        )
    })?;

    Ok(ExternalToolLaunch {
        kind: match request.kind {
            ExternalToolKind::Diff => "diff".to_string(),
            ExternalToolKind::Merge => "merge".to_string(),
        },
        tool_path: tool.to_string(),
        target_path: target.display().to_string(),
    })
}

fn normalize_root(path: &str) -> Result<PathBuf, NovaError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "WORKSPACE_REQUIRED",
            "请先打开 SVN 工作副本",
            None,
            true,
        ));
    }

    Ok(PathBuf::from(trimmed))
}

fn normalize_file_path(root: &Path, file_path: &str) -> Result<PathBuf, NovaError> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "EXTERNAL_TOOL_FILE_EMPTY",
            "请选择要打开的文件",
            None,
            true,
        ));
    }

    let relative = PathBuf::from(trimmed);
    if relative.is_absolute() || trimmed.contains("..") {
        return Err(NovaError::command(
            "EXTERNAL_TOOL_FILE_INVALID",
            "外部工具目标文件无效",
            Some("文件路径必须是当前工作副本内的相对路径。".to_string()),
            true,
        ));
    }

    Ok(root.join(relative))
}
