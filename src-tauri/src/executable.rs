use std::{
    env,
    path::{Path, PathBuf},
};

use crate::{error::NovaError, path_utils};

pub fn normalize_executable_setting(
    executable: Option<&str>,
    default_name: &str,
    code: &'static str,
    message: &'static str,
) -> Result<String, NovaError> {
    let Some(raw_value) = executable.filter(|value| !value.trim().is_empty()) else {
        return Ok(default_name.to_string());
    };

    if raw_value.chars().any(char::is_control) {
        return Err(NovaError::command(
            code,
            message,
            Some("可执行文件路径不能包含控制字符。".to_string()),
            true,
        ));
    }

    let value = raw_value.trim();
    if is_simple_command_name(value) {
        return Ok(value.to_string());
    }

    let expanded = expand_home_path(value);
    if path_utils::is_absolute_or_home_path(&expanded, value) {
        return Ok(expanded.display().to_string());
    }

    Err(NovaError::command(
        code,
        message,
        Some("可执行文件路径必须是命令名、绝对路径或 ~/ 开头路径。".to_string()),
        true,
    ))
}

fn is_simple_command_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

fn expand_home_path(value: &str) -> PathBuf {
    if value == "~" || value.starts_with("~/") || value.starts_with("~\\") {
        if let Some(home) = home_dir() {
            let relative = value
                .trim_start_matches('~')
                .trim_start_matches(['/', '\\']);
            return home.join(relative);
        }
    }

    Path::new(value).to_path_buf()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_default_and_command_names() {
        assert_eq!(
            normalize_executable_setting(None, "svn", "INVALID", "invalid").unwrap(),
            "svn"
        );
        assert_eq!(
            normalize_executable_setting(Some(" svn.exe "), "svn", "INVALID", "invalid").unwrap(),
            "svn.exe"
        );
    }

    #[test]
    fn accepts_absolute_and_home_relative_paths() {
        assert!(normalize_executable_setting(
            Some("C:\\Tools\\svn.exe"),
            "svn",
            "INVALID",
            "invalid",
        )
        .is_ok());
        assert!(
            normalize_executable_setting(Some("~/bin/svn"), "svn", "INVALID", "invalid").is_ok()
        );
    }

    #[test]
    fn rejects_unsafe_executable_paths() {
        assert!(
            normalize_executable_setting(Some("tools\\svn.exe"), "svn", "INVALID", "invalid",)
                .is_err()
        );
        assert!(normalize_executable_setting(Some("svn\n"), "svn", "INVALID", "invalid").is_err());
    }
}
