use std::{
    env,
    path::PathBuf,
    process::Command,
    sync::{OnceLock, RwLock},
};

use serde::{Deserialize, Serialize};

use crate::{error::NovaError, executable::normalize_executable_setting};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SvnAuthenticationMode {
    #[default]
    System,
    Password,
    Ssh,
}

#[derive(Deserialize)]
pub struct ConfigureSvnAuthenticationRequest {
    pub mode: SvnAuthenticationMode,
    pub username: Option<String>,
    pub password: Option<String>,
    #[serde(default)]
    pub remember_password: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnAuthenticationStatus {
    pub mode: SvnAuthenticationMode,
    pub username: Option<String>,
    pub password_configured: bool,
    pub uses_system_credentials: bool,
    pub remember_password: bool,
}

#[derive(Clone, Default)]
struct SvnAuthentication {
    mode: SvnAuthenticationMode,
    username: Option<String>,
    password: Option<String>,
    remember_password: bool,
}

static SVN_AUTHENTICATION: OnceLock<RwLock<SvnAuthentication>> = OnceLock::new();

pub(crate) fn command(executable: &str) -> Command {
    let authentication = current_authentication();
    command_with_authentication(executable, &authentication)
}

pub fn configure_authentication(
    request: ConfigureSvnAuthenticationRequest,
) -> Result<SvnAuthenticationStatus, NovaError> {
    let authentication = normalize_authentication(request)?;
    let status = authentication_status(&authentication);
    let mut current = authentication_store()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *current = authentication;
    Ok(status)
}

fn authentication_store() -> &'static RwLock<SvnAuthentication> {
    SVN_AUTHENTICATION.get_or_init(|| RwLock::new(SvnAuthentication::default()))
}

fn current_authentication() -> SvnAuthentication {
    authentication_store()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn normalize_authentication(
    request: ConfigureSvnAuthenticationRequest,
) -> Result<SvnAuthentication, NovaError> {
    let username = normalize_username(request.username)?;
    let password = normalize_password(request.password)?;

    match request.mode {
        SvnAuthenticationMode::System | SvnAuthenticationMode::Ssh => Ok(SvnAuthentication {
            mode: request.mode,
            username,
            password: None,
            remember_password: false,
        }),
        SvnAuthenticationMode::Password => {
            let username = username.ok_or_else(|| {
                NovaError::command("SVN_AUTH_USERNAME_REQUIRED", "用户名不能为空", None, true)
            })?;
            let password = password.ok_or_else(|| {
                NovaError::command("SVN_AUTH_PASSWORD_REQUIRED", "密码不能为空", None, true)
            })?;
            Ok(SvnAuthentication {
                mode: request.mode,
                username: Some(username),
                password: Some(password),
                remember_password: request.remember_password,
            })
        }
    }
}

fn normalize_username(username: Option<String>) -> Result<Option<String>, NovaError> {
    let username = username
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(username) = username else {
        return Ok(None);
    };
    if username.len() > 256 || username.chars().any(char::is_control) {
        return Err(NovaError::command(
            "SVN_AUTH_USERNAME_INVALID",
            "用户名无效",
            Some("用户名不能包含控制字符，且长度不能超过 256 字节。".to_string()),
            true,
        ));
    }
    Ok(Some(username))
}

fn normalize_password(password: Option<String>) -> Result<Option<String>, NovaError> {
    let password = password.filter(|value| !value.is_empty());
    let Some(password) = password else {
        return Ok(None);
    };
    if password.len() > 16 * 1024 || password.contains('\0') {
        return Err(NovaError::command(
            "SVN_AUTH_PASSWORD_INVALID",
            "密码无效",
            Some("密码不能包含空字符，且长度不能超过 16 KiB。".to_string()),
            true,
        ));
    }
    Ok(Some(password))
}

fn authentication_status(authentication: &SvnAuthentication) -> SvnAuthenticationStatus {
    SvnAuthenticationStatus {
        mode: authentication.mode,
        username: authentication.username.clone(),
        password_configured: authentication.password.is_some(),
        uses_system_credentials: authentication.mode != SvnAuthenticationMode::Password
            || authentication.remember_password,
        remember_password: authentication.mode == SvnAuthenticationMode::Password
            && authentication.remember_password,
    }
}

fn command_with_authentication(executable: &str, authentication: &SvnAuthentication) -> Command {
    let mut command = Command::new(executable);
    command.arg("--non-interactive");
    if let Some(username) = authentication.username.as_deref() {
        command.arg("--username").arg(username);
    }
    if let Some(password) = authentication.password.as_deref() {
        command.arg("--password").arg(password);
        if !authentication.remember_password {
            command.arg("--no-auth-cache");
        }
    }
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
        let mut command = command_with_authentication("svn", &SvnAuthentication::default());
        command.arg("status").arg("--").arg("working-copy");

        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(args, ["--non-interactive", "status", "--", "working-copy"]);
    }

    #[test]
    fn configures_password_authentication_before_subcommand() {
        let authentication = normalize_authentication(ConfigureSvnAuthenticationRequest {
            mode: SvnAuthenticationMode::Password,
            username: Some(" alice ".to_string()),
            password: Some("secret".to_string()),
            remember_password: false,
        })
        .unwrap();
        let mut command = command_with_authentication("svn", &authentication);
        command.arg("list").arg("https://example.test/repository");

        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            args,
            [
                "--non-interactive",
                "--username",
                "alice",
                "--password",
                "secret",
                "--no-auth-cache",
                "list",
                "https://example.test/repository",
            ]
        );
    }

    #[test]
    fn uses_svn_system_cache_when_password_should_be_remembered() {
        let authentication = normalize_authentication(ConfigureSvnAuthenticationRequest {
            mode: SvnAuthenticationMode::Password,
            username: Some("alice".to_string()),
            password: Some("secret".to_string()),
            remember_password: true,
        })
        .unwrap();
        let status = authentication_status(&authentication);
        let command = command_with_authentication("svn", &authentication);
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(!args.iter().any(|arg| arg == "--no-auth-cache"));
        assert!(status.password_configured);
        assert!(status.uses_system_credentials);
        assert!(status.remember_password);
    }

    #[test]
    fn supports_ssh_agent_authentication_without_password_argument() {
        let authentication = normalize_authentication(ConfigureSvnAuthenticationRequest {
            mode: SvnAuthenticationMode::Ssh,
            username: Some("git-user".to_string()),
            password: Some("ignored".to_string()),
            remember_password: true,
        })
        .unwrap();
        let command = command_with_authentication("svn", &authentication);
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(args, ["--non-interactive", "--username", "git-user"]);
        assert!(!authentication_status(&authentication).password_configured);
    }

    #[test]
    fn rejects_incomplete_password_authentication() {
        let error = normalize_authentication(ConfigureSvnAuthenticationRequest {
            mode: SvnAuthenticationMode::Password,
            username: Some("alice".to_string()),
            password: None,
            remember_password: false,
        })
        .err()
        .expect("缺少密码应失败");

        assert!(matches!(
            error,
            NovaError::Command { ref code, .. } if code == "SVN_AUTH_PASSWORD_REQUIRED"
        ));
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
