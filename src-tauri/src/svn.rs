use std::{env, path::PathBuf, process::Command};

use serde::{Deserialize, Serialize};

use crate::{error::NovaError, executable::normalize_executable_setting};

pub(crate) fn command(executable: &str) -> Command {
    let mut command = Command::new(executable);
    command.arg("--non-interactive");
    command
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnDetection {
    pub available: bool,
    pub version: String,
    pub executable: String,
    pub resolved_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DetectSvnRequest {
    pub executable: Option<String>,
}

pub struct SvnClient;

impl SvnClient {
    pub fn detect(request: DetectSvnRequest) -> Result<SvnDetection, NovaError> {
        let executable = normalize_executable_setting(
            request.executable.as_deref(),
            "svn",
            "SVN_EXECUTABLE_INVALID",
            "SVN 可执行文件路径无效",
        )?;
        let requested_executable = request
            .executable
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let detection = detect_version_with_fallbacks(&executable, requested_executable.is_some())?;
        let resolved_path = detection
            .resolved_path
            .or_else(|| resolve_executable_path(&detection.executable));

        Ok(SvnDetection {
            available: true,
            version: detection.version,
            executable: detection.executable,
            resolved_path,
        })
    }
}

struct VersionDetection {
    executable: String,
    version: String,
    resolved_path: Option<String>,
}

fn detect_version_with_fallbacks(
    executable: &str,
    user_configured: bool,
) -> Result<VersionDetection, NovaError> {
    match detect_version(executable) {
        Ok(version) => Ok(VersionDetection {
            executable: executable.to_string(),
            version,
            resolved_path: resolve_executable_path(executable),
        }),
        Err(error) if user_configured => Err(error),
        Err(first_error) => {
            for candidate in fallback_svn_candidates() {
                if candidate == executable {
                    continue;
                }

                if let Ok(version) = detect_version(&candidate) {
                    return Ok(VersionDetection {
                        executable: candidate.clone(),
                        version,
                        resolved_path: Some(candidate),
                    });
                }
            }

            Err(first_error)
        }
    }
}

fn detect_version(executable: &str) -> Result<String, NovaError> {
    let output = Command::new(executable)
        .args(["--version", "--quiet"])
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_NOT_FOUND",
                "未检测到可用的 SVN 命令行",
                Some(format!(
                    "尝试执行 `{executable} --version --quiet` 失败：{error}。请安装 SVN 命令行工具，或输入 svn.exe 的完整路径后重新检测。"
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_VERSION_FAILED",
            "SVN 版本检测失败",
            Some(command_output_detail(executable, &output)),
            true,
        ));
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err(NovaError::command(
            "SVN_VERSION_EMPTY",
            "SVN 版本输出为空",
            Some(format!(
                "`{executable} --version --quiet` 执行成功，但没有返回版本号。"
            )),
            true,
        ));
    }

    Ok(version)
}

fn fallback_svn_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    push_candidate(&mut candidates, "/opt/homebrew/bin/svn");
    push_candidate(&mut candidates, "/usr/local/bin/svn");
    push_candidate(&mut candidates, "/opt/local/bin/svn");
    push_candidate(&mut candidates, "/usr/bin/svn");

    if let Some(home) = home_dir() {
        for relative in [".homebrew/bin/svn", "homebrew/bin/svn", "bin/svn"] {
            push_candidate(&mut candidates, home.join(relative).display().to_string());
        }
    }

    candidates
}

fn push_candidate(candidates: &mut Vec<String>, candidate: impl Into<String>) {
    let candidate = candidate.into();
    if !candidate.trim().is_empty() && !candidates.iter().any(|value| value == &candidate) {
        candidates.push(candidate);
    }
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

fn resolve_executable_path(executable: &str) -> Option<String> {
    if executable.contains('\\') || executable.contains('/') {
        return Some(executable.to_string());
    }

    let output = if cfg!(windows) {
        Command::new("where").arg(executable).output()
    } else {
        Command::new("which").arg(executable).output()
    }
    .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn command_output_detail(executable: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        return format!("`{executable} --version --quiet` 返回失败：{stderr}");
    }

    if !stdout.is_empty() {
        return format!("`{executable} --version --quiet` 返回失败：{stdout}");
    }

    format!(
        "`{executable} --version --quiet` 返回退出码 {:?}，但没有输出。",
        output.status.code()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_non_interactive_before_svn_subcommand() {
        let mut command = command("svn");
        command.arg("status").arg("--").arg("working-copy");

        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(args, ["--non-interactive", "status", "--", "working-copy"]);
    }

    #[test]
    fn includes_common_macos_svn_locations() {
        let candidates = fallback_svn_candidates();

        assert!(candidates
            .iter()
            .any(|path| path == "/opt/homebrew/bin/svn"));
        assert!(candidates.iter().any(|path| path == "/usr/local/bin/svn"));
        assert!(candidates
            .iter()
            .any(|path| path.ends_with("/.homebrew/bin/svn")));
    }
}
