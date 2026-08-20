use std::{
    env,
    path::PathBuf,
    process::Command,
    sync::{OnceLock, RwLock},
};

use keyring::v1::{Entry as KeyringEntry, Error as KeyringError};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SvnCertificateFailure {
    UnknownCa,
    CnMismatch,
    Expired,
    NotYetValid,
    Other,
}

impl SvnCertificateFailure {
    fn as_str(self) -> &'static str {
        match self {
            Self::UnknownCa => "unknown-ca",
            Self::CnMismatch => "cn-mismatch",
            Self::Expired => "expired",
            Self::NotYetValid => "not-yet-valid",
            Self::Other => "other",
        }
    }
}

#[derive(Deserialize)]
pub struct ConfigureSvnCertificateTrustRequest {
    pub failures: Vec<SvnCertificateFailure>,
    #[serde(default)]
    pub confirmed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnCertificateTrustStatus {
    pub active: bool,
    pub failures: Vec<SvnCertificateFailure>,
}

#[derive(Clone, Default)]
struct SvnAuthentication {
    mode: SvnAuthenticationMode,
    username: Option<String>,
    password: Option<String>,
    remember_password: bool,
}

const SVN_CREDENTIAL_SERVICE: &str = "com.novasvn.client.svn";
const SVN_CREDENTIAL_ACCOUNT: &str = "password-authentication";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
struct SavedSvnCredential {
    username: String,
    password: String,
}

trait SvnCredentialStore {
    fn load(&self) -> Result<Option<SavedSvnCredential>, NovaError>;
    fn save(&self, credential: &SavedSvnCredential) -> Result<(), NovaError>;
    fn delete(&self) -> Result<(), NovaError>;
}

struct SystemSvnCredentialStore;

impl SystemSvnCredentialStore {
    fn entry(&self) -> Result<KeyringEntry, NovaError> {
        KeyringEntry::new(SVN_CREDENTIAL_SERVICE, SVN_CREDENTIAL_ACCOUNT).map_err(|error| {
            credential_store_error("SVN_AUTH_STORE_UNAVAILABLE", "系统凭据库不可用", error)
        })
    }
}

impl SvnCredentialStore for SystemSvnCredentialStore {
    fn load(&self) -> Result<Option<SavedSvnCredential>, NovaError> {
        let encoded = match self.entry()?.get_password() {
            Ok(value) => value,
            Err(KeyringError::NoEntry) => return Ok(None),
            Err(error) => {
                return Err(credential_store_error(
                    "SVN_AUTH_STORE_READ_FAILED",
                    "无法读取系统保存的 SVN 密码",
                    error,
                ));
            }
        };
        serde_json::from_str(&encoded).map(Some).map_err(|error| {
            credential_store_error("SVN_AUTH_STORE_INVALID", "系统保存的 SVN 凭据无效", error)
        })
    }

    fn save(&self, credential: &SavedSvnCredential) -> Result<(), NovaError> {
        let encoded = serde_json::to_string(credential).map_err(|error| {
            credential_store_error(
                "SVN_AUTH_STORE_ENCODE_FAILED",
                "无法准备要保存的 SVN 凭据",
                error,
            )
        })?;
        self.entry()?.set_password(&encoded).map_err(|error| {
            credential_store_error(
                "SVN_AUTH_STORE_WRITE_FAILED",
                "无法将 SVN 密码保存到系统凭据库",
                error,
            )
        })
    }

    fn delete(&self) -> Result<(), NovaError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(credential_store_error(
                "SVN_AUTH_STORE_DELETE_FAILED",
                "无法删除系统保存的 SVN 密码",
                error,
            )),
        }
    }
}

fn credential_store_error(
    code: &'static str,
    message: &'static str,
    error: impl std::fmt::Display,
) -> NovaError {
    NovaError::command(code, message, Some(error.to_string()), true)
}

static SVN_AUTHENTICATION: OnceLock<RwLock<SvnAuthentication>> = OnceLock::new();
static SVN_CERTIFICATE_TRUST: OnceLock<RwLock<Vec<SvnCertificateFailure>>> = OnceLock::new();

pub(crate) fn command(executable: &str) -> Command {
    let authentication = current_authentication();
    let certificate_failures = current_certificate_trust();
    command_with_configuration(executable, &authentication, &certificate_failures)
}

pub(crate) fn configure_hidden_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    #[cfg(not(windows))]
    let _ = command;
}

pub fn configure_authentication(
    request: ConfigureSvnAuthenticationRequest,
) -> Result<SvnAuthenticationStatus, NovaError> {
    let authentication = prepare_authentication_with_store(request, &SystemSvnCredentialStore)?;
    let status = authentication_status(&authentication);
    let mut current = authentication_store()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *current = authentication;
    Ok(status)
}

pub fn configure_certificate_trust(
    request: ConfigureSvnCertificateTrustRequest,
) -> Result<SvnCertificateTrustStatus, NovaError> {
    if !request.confirmed {
        return Err(NovaError::command(
            "SVN_CERTIFICATE_CONFIRMATION_REQUIRED",
            "必须明确确认证书风险",
            None,
            true,
        ));
    }
    let failures = normalize_certificate_failures(&request.failures);
    if failures.is_empty() {
        return Err(NovaError::command(
            "SVN_CERTIFICATE_FAILURES_REQUIRED",
            "至少需要确认一种证书失败类型",
            None,
            true,
        ));
    }
    let mut current = certificate_trust_store()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *current = failures.clone();
    Ok(SvnCertificateTrustStatus {
        active: true,
        failures,
    })
}

pub fn clear_certificate_trust() -> SvnCertificateTrustStatus {
    let mut current = certificate_trust_store()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    current.clear();
    SvnCertificateTrustStatus {
        active: false,
        failures: Vec::new(),
    }
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

fn certificate_trust_store() -> &'static RwLock<Vec<SvnCertificateFailure>> {
    SVN_CERTIFICATE_TRUST.get_or_init(|| RwLock::new(Vec::new()))
}

fn current_certificate_trust() -> Vec<SvnCertificateFailure> {
    certificate_trust_store()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn normalize_certificate_failures(
    requested: &[SvnCertificateFailure],
) -> Vec<SvnCertificateFailure> {
    [
        SvnCertificateFailure::UnknownCa,
        SvnCertificateFailure::CnMismatch,
        SvnCertificateFailure::Expired,
        SvnCertificateFailure::NotYetValid,
        SvnCertificateFailure::Other,
    ]
    .into_iter()
    .filter(|failure| requested.contains(failure))
    .collect()
}

fn prepare_authentication_with_store(
    request: ConfigureSvnAuthenticationRequest,
    credential_store: &impl SvnCredentialStore,
) -> Result<SvnAuthentication, NovaError> {
    if request.mode != SvnAuthenticationMode::Password {
        return normalize_authentication(request);
    }

    let username = normalize_username(request.username)?.ok_or_else(|| {
        NovaError::command("SVN_AUTH_USERNAME_REQUIRED", "用户名不能为空", None, true)
    })?;
    let supplied_password = normalize_password(request.password)?;
    let password_was_supplied = supplied_password.is_some();
    let password = match supplied_password {
        Some(password) => password,
        None if request.remember_password => credential_store
            .load()?
            .filter(|credential| credential.username == username)
            .map(|credential| credential.password)
            .ok_or_else(|| {
                NovaError::command(
                    "SVN_AUTH_PASSWORD_REQUIRED",
                    "密码不能为空",
                    Some("系统凭据库中没有当前用户保存的 SVN 密码。".to_string()),
                    true,
                )
            })?,
        None => {
            return Err(NovaError::command(
                "SVN_AUTH_PASSWORD_REQUIRED",
                "密码不能为空",
                None,
                true,
            ));
        }
    };

    let credential = SavedSvnCredential {
        username: username.clone(),
        password: password.clone(),
    };
    if request.remember_password {
        if password_was_supplied {
            credential_store.save(&credential)?;
        }
    } else {
        credential_store.delete()?;
    }

    Ok(SvnAuthentication {
        mode: SvnAuthenticationMode::Password,
        username: Some(username),
        password: Some(password),
        remember_password: request.remember_password,
    })
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

#[cfg(test)]
fn command_with_authentication(executable: &str, authentication: &SvnAuthentication) -> Command {
    command_with_configuration(executable, authentication, &[])
}

fn command_with_configuration(
    executable: &str,
    authentication: &SvnAuthentication,
    certificate_failures: &[SvnCertificateFailure],
) -> Command {
    let mut command = Command::new(executable);
    configure_hidden_console(&mut command);
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
    if !certificate_failures.is_empty() {
        command.arg("--trust-server-cert-failures").arg(
            certificate_failures
                .iter()
                .map(|failure| failure.as_str())
                .collect::<Vec<_>>()
                .join(","),
        );
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
    let mut command = Command::new(executable);
    configure_hidden_console(&mut command);
    let output = command
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

    let mut command = if cfg!(windows) {
        let mut command = Command::new("where");
        command.arg(executable);
        command
    } else {
        let mut command = Command::new("which");
        command.arg(executable);
        command
    };
    configure_hidden_console(&mut command);
    let output = command.output().ok()?;

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

    #[derive(Default)]
    struct TestCredentialStore {
        credential: std::sync::Mutex<Option<SavedSvnCredential>>,
    }

    impl SvnCredentialStore for TestCredentialStore {
        fn load(&self) -> Result<Option<SavedSvnCredential>, NovaError> {
            Ok(self
                .credential
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone())
        }

        fn save(&self, credential: &SavedSvnCredential) -> Result<(), NovaError> {
            *self
                .credential
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(credential.clone());
            Ok(())
        }

        fn delete(&self) -> Result<(), NovaError> {
            self.credential
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();
            Ok(())
        }
    }

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
    fn restores_remembered_password_for_later_svn_commands() {
        let credential_store = TestCredentialStore::default();
        prepare_authentication_with_store(
            ConfigureSvnAuthenticationRequest {
                mode: SvnAuthenticationMode::Password,
                username: Some("alice".to_string()),
                password: Some("saved-secret".to_string()),
                remember_password: true,
            },
            &credential_store,
        )
        .unwrap();

        let restored = prepare_authentication_with_store(
            ConfigureSvnAuthenticationRequest {
                mode: SvnAuthenticationMode::Password,
                username: Some("alice".to_string()),
                password: None,
                remember_password: true,
            },
            &credential_store,
        )
        .unwrap();
        let command = command_with_authentication("svn", &restored);
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(restored.username.as_deref(), Some("alice"));
        assert!(restored.remember_password);
        assert_eq!(
            args,
            [
                "--non-interactive",
                "--username",
                "alice",
                "--password",
                "saved-secret",
            ]
        );
    }

    #[test]
    fn removes_saved_password_when_remembering_is_disabled() {
        let credential_store = TestCredentialStore {
            credential: std::sync::Mutex::new(Some(SavedSvnCredential {
                username: "alice".to_string(),
                password: "old-secret".to_string(),
            })),
        };
        let authentication = prepare_authentication_with_store(
            ConfigureSvnAuthenticationRequest {
                mode: SvnAuthenticationMode::Password,
                username: Some("alice".to_string()),
                password: Some("session-secret".to_string()),
                remember_password: false,
            },
            &credential_store,
        )
        .unwrap();

        assert!(!authentication.remember_password);
        assert!(credential_store.load().unwrap().is_none());
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
    fn adds_only_confirmed_certificate_failures_to_command() {
        let failures = normalize_certificate_failures(&[
            SvnCertificateFailure::Expired,
            SvnCertificateFailure::UnknownCa,
            SvnCertificateFailure::Expired,
        ]);
        let mut command =
            command_with_configuration("svn", &SvnAuthentication::default(), &failures);
        command.arg("list").arg("https://example.test/repository");
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            [
                "--non-interactive",
                "--trust-server-cert-failures",
                "unknown-ca,expired",
                "list",
                "https://example.test/repository",
            ]
        );
    }

    #[test]
    fn requires_explicit_certificate_confirmation() {
        let error = configure_certificate_trust(ConfigureSvnCertificateTrustRequest {
            failures: vec![SvnCertificateFailure::UnknownCa],
            confirmed: false,
        })
        .expect_err("未确认证书风险应失败");

        assert!(matches!(
            error,
            NovaError::Command { ref code, .. }
                if code == "SVN_CERTIFICATE_CONFIRMATION_REQUIRED"
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
