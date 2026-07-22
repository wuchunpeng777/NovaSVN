use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::NovaError;

#[derive(Debug, Clone, Serialize)]
pub struct StartupIntent {
    pub action: Option<String>,
    pub path: Option<String>,
    pub repository_root: Option<String>,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LaunchLogWindowRequest {
    pub repository_url: String,
    pub repository_root: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LaunchedLogWindow {
    pub repository_url: String,
    pub repository_root: String,
    pub revision: String,
}

pub fn startup_intent() -> StartupIntent {
    startup_intent_from_args(std::env::args().skip(1))
}

fn startup_intent_from_args<I, S>(args: I) -> StartupIntent
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut action = None;
    let mut path = None;
    let mut repository_root = None;
    let mut revision = None;
    let mut args = args.into_iter().map(Into::into);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--novasvn-action" => {
                action = args.next().and_then(normalize_action);
            }
            "--novasvn-path" => path = args.next().and_then(normalize_startup_path),
            "--novasvn-repository-root" => {
                repository_root = args.next().and_then(normalize_startup_path)
            }
            "--novasvn-revision" => revision = args.next().and_then(normalize_startup_revision),
            _ if path.is_none() => path = normalize_startup_path(arg),
            _ => {}
        }
    }

    StartupIntent {
        action,
        path,
        repository_root,
        revision,
    }
}

fn normalize_action(action: String) -> Option<String> {
    let value = action.trim();
    if matches!(
        value,
        "open"
            | "commit"
            | "update"
            | "diff"
            | "log"
            | "blame"
            | "revert"
            | "cleanup"
            | "branch-workspace"
    ) {
        Some(value.to_string())
    } else {
        None
    }
}

fn normalize_startup_path(path: String) -> Option<String> {
    let value = path.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        None
    } else {
        Some(value.to_string())
    }
}

fn normalize_startup_revision(revision: String) -> Option<String> {
    let value = revision.trim();
    (!value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| value.to_string())
}

pub fn launch_log_window(request: LaunchLogWindowRequest) -> Result<LaunchedLogWindow, NovaError> {
    let repository_root = normalize_repository_argument(
        &request.repository_root,
        "LOG_WINDOW_REPOSITORY_ROOT_INVALID",
        "无法打开文件 Log",
    )?;
    let repository_url = normalize_repository_argument(
        &request.repository_url,
        "LOG_WINDOW_REPOSITORY_URL_INVALID",
        "无法打开文件 Log",
    )?;
    if repository_url != repository_root
        && !repository_url
            .strip_prefix(&repository_root)
            .is_some_and(|suffix| suffix.starts_with('/'))
    {
        return Err(NovaError::command(
            "LOG_WINDOW_REPOSITORY_MISMATCH",
            "无法打开文件 Log",
            Some("文件 URL 不属于当前 SVN 仓库。".to_string()),
            true,
        ));
    }
    let revision = request.revision.trim();
    if revision.is_empty() || !revision.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(NovaError::command(
            "LOG_WINDOW_REVISION_INVALID",
            "无法打开文件 Log",
            Some("文件 Log 的 peg revision 必须是数字。".to_string()),
            true,
        ));
    }

    let executable = std::env::current_exe().map_err(|error| {
        NovaError::command(
            "LOG_WINDOW_EXECUTABLE_MISSING",
            "无法启动新的 Log 窗口",
            Some(error.to_string()),
            true,
        )
    })?;
    let arguments = log_window_arguments(&repository_url, &repository_root, revision);
    Command::new(&executable)
        .args(arguments)
        .spawn()
        .map_err(|error| {
            NovaError::command(
                "LOG_WINDOW_LAUNCH_FAILED",
                "无法启动新的 Log 窗口",
                Some(format!("执行 `{}` 失败：{error}", executable.display())),
                true,
            )
        })?;

    Ok(LaunchedLogWindow {
        repository_url,
        repository_root,
        revision: revision.to_string(),
    })
}

fn normalize_repository_argument(
    value: &str,
    code: &'static str,
    message: &'static str,
) -> Result<String, NovaError> {
    let normalized = value.trim().trim_end_matches('/');
    if normalized.is_empty() || normalized.chars().any(char::is_control) {
        return Err(NovaError::command(
            code,
            message,
            Some("SVN 仓库 URL 无效。".to_string()),
            true,
        ));
    }
    Ok(normalized.to_string())
}

fn log_window_arguments(
    repository_url: &str,
    repository_root: &str,
    revision: &str,
) -> Vec<String> {
    vec![
        "--novasvn-action".to_string(),
        "log".to_string(),
        "--novasvn-path".to_string(),
        repository_url.to_string(),
        "--novasvn-repository-root".to_string(),
        repository_root.to_string(),
        "--novasvn-revision".to_string(),
        revision.to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_explicit_action_and_path_flags() {
        let intent =
            startup_intent_from_args(["--novasvn-action", "commit", "--novasvn-path", "C:\\wc"]);

        assert_eq!(intent.action.as_deref(), Some("commit"));
        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
        assert_eq!(intent.repository_root, None);
        assert_eq!(intent.revision, None);
    }

    #[test]
    fn parses_repository_log_window_arguments() {
        let arguments = log_window_arguments(
            "https://example.com/svn/trunk/src/main.rs",
            "https://example.com/svn",
            "42",
        );
        let intent = startup_intent_from_args(arguments);

        assert_eq!(intent.action.as_deref(), Some("log"));
        assert_eq!(
            intent.path.as_deref(),
            Some("https://example.com/svn/trunk/src/main.rs")
        );
        assert_eq!(
            intent.repository_root.as_deref(),
            Some("https://example.com/svn")
        );
        assert_eq!(intent.revision.as_deref(), Some("42"));
    }

    #[test]
    fn accepts_file_blame_action() {
        let intent = startup_intent_from_args([
            "--novasvn-action",
            "blame",
            "--novasvn-path",
            "C:\\wc\\src\\main.rs",
        ]);

        assert_eq!(intent.action.as_deref(), Some("blame"));
        assert_eq!(intent.path.as_deref(), Some("C:\\wc\\src\\main.rs"));
    }

    #[test]
    fn treats_first_plain_arg_as_path() {
        let intent = startup_intent_from_args(["C:\\wc", "--ignored"]);

        assert_eq!(intent.action, None);
        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
    }

    #[test]
    fn ignores_unknown_startup_actions() {
        let intent =
            startup_intent_from_args(["--novasvn-action", "unknown", "--novasvn-path", "C:\\wc"]);

        assert_eq!(intent.action, None);
        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
    }

    #[test]
    fn normalizes_startup_paths() {
        let intent = startup_intent_from_args(["--novasvn-path", " C:\\wc "]);

        assert_eq!(intent.path.as_deref(), Some("C:\\wc"));
    }

    #[test]
    fn ignores_blank_or_control_character_startup_paths() {
        let blank = startup_intent_from_args(["--novasvn-path", "   "]);
        let control = startup_intent_from_args(["--novasvn-path", "C:\\wc\nnext"]);

        assert_eq!(blank.path, None);
        assert_eq!(control.path, None);
    }
}
