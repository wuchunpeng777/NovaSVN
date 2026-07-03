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

    let executable = normalize_tool_path(tool)?;

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

    let (program, args) = open_file_location_command(&root, &target);
    let mut command = Command::new(program);
    command.args(args);

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

fn open_file_location_command(root: &Path, target: &Path) -> (&'static str, Vec<String>) {
    if cfg!(target_os = "windows") {
        return ("explorer", vec![format!("/select,{}", target.display())]);
    }

    if cfg!(target_os = "macos") {
        return (
            "open",
            vec!["-R".to_string(), target.display().to_string()],
        );
    }

    (
        "xdg-open",
        vec![target.parent().unwrap_or(root).display().to_string()],
    )
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

fn normalize_tool_path(value: &str) -> Result<PathBuf, NovaError> {
    if value.chars().any(char::is_control) {
        return Err(NovaError::command(
            "EXTERNAL_TOOL_PATH_INVALID",
            "外部工具路径无效",
            Some("外部工具路径不能包含控制字符。".to_string()),
            true,
        ));
    }

    let trimmed = value.trim();
    if is_simple_command_name(trimmed) {
        return Ok(PathBuf::from(trimmed));
    }

    let expanded = expand_home_path(trimmed);
    let home_relative = trimmed.starts_with("~/") || trimmed.starts_with("~\\");
    if expanded.is_absolute() || home_relative {
        return Ok(expanded);
    }

    Err(NovaError::command(
        "EXTERNAL_TOOL_PATH_INVALID",
        "外部工具路径无效",
        Some("外部工具路径必须是命令名、绝对路径或 ~/ 开头路径。".to_string()),
        true,
    ))
}

fn is_simple_command_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
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
    fn validates_external_tool_paths() {
        assert_eq!(normalize_tool_path("code").unwrap(), PathBuf::from("code"));
        assert!(normalize_tool_path("C:\\Tools\\diff.exe").is_ok());
        assert!(normalize_tool_path("~/bin/diff").is_ok());
        assert!(normalize_tool_path("tools\\diff.exe").is_err());
        assert!(normalize_tool_path("code\n").is_err());
    }

    #[test]
    fn rejects_absolute_or_parent_file_targets() {
        assert!(normalize_file_path(Path::new("C:\\wc"), "..\\secret.txt").is_err());
        assert!(normalize_file_path(Path::new("C:\\wc"), "C:\\other\\a.txt").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn uses_single_explorer_select_argument() {
        let target = Path::new("C:\\wc\\src\\main.rs");
        let (program, args) = open_file_location_command(Path::new("C:\\wc"), target);

        assert_eq!(program, "explorer");
        assert_eq!(args, vec![format!("/select,{}", target.display())]);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn opens_file_location_parent_on_linux_like_platforms() {
        let root = Path::new("/tmp/wc");
        let target = root.join("src/main.rs");
        let (program, args) = open_file_location_command(root, &target);

        if cfg!(target_os = "macos") {
            assert_eq!(program, "open");
            assert_eq!(args, vec!["-R".to_string(), target.display().to_string()]);
        } else {
            assert_eq!(program, "xdg-open");
            assert_eq!(args, vec![root.join("src").display().to_string()]);
        }
    }
}
