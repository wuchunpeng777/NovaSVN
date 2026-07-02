use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::NovaError;

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
        let executable = normalize_executable(request.executable);
        let version = detect_version(&executable)?;
        let resolved_path = resolve_executable_path(&executable);

        Ok(SvnDetection {
            available: true,
            version,
            executable,
            resolved_path,
        })
    }
}

fn normalize_executable(executable: Option<String>) -> String {
    executable
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "svn".to_string())
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
