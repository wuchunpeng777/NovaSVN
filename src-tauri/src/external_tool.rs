use std::{
    env,
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

#[derive(Debug, Clone, Deserialize)]
pub struct OpenFileLocationRequest {
    pub working_copy_root: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExternalToolLaunch {
    pub kind: String,
    pub tool_path: String,
    pub target_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenFileLocation {
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

    let executable = expand_home_path(tool);

    Command::new(&executable).arg(&target).spawn().map_err(|error| {
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
        tool_path: executable.display().to_string(),
        target_path: target.display().to_string(),
    })
}

pub fn open_file_location(
    request: OpenFileLocationRequest,
) -> Result<OpenFileLocation, NovaError> {
    let root = normalize_root(&request.working_copy_root)?;
    let target = normalize_file_path(&root, &request.file_path)?;

    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg("/select,").arg(&target);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg("-R").arg(&target);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(target.parent().unwrap_or(&root));
        command
    };

    command.spawn().map_err(|error| {
        NovaError::command(
            "OPEN_FILE_LOCATION_FAILED",
            "无法打开文件位置",
            Some(format!("目标：{}。错误：{error}", target.display())),
            true,
        )
    })?;

    Ok(OpenFileLocation {
        target_path: target.display().to_string(),
    })
}

fn expand_home_path(value: &str) -> PathBuf {
    let path = value.trim();
    if path == "~" || path.starts_with("~/") || path.starts_with("~\\") {
        if let Some(home) = home_dir() {
            let relative = path
                .trim_start_matches('~')
                .trim_start_matches(['/', '\\']);
            return home.join(relative);
        }
    }

    PathBuf::from(path)
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("USERPROFILE")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_plain_command_names() {
        assert_eq!(expand_home_path("code"), PathBuf::from("code"));
    }

    #[test]
    fn rejects_absolute_or_parent_file_targets() {
        assert!(normalize_file_path(Path::new("C:\\wc"), "..\\secret.txt").is_err());
        assert!(normalize_file_path(Path::new("C:\\wc"), "C:\\other\\a.txt").is_err());
    }
}
