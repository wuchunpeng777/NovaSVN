use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind")]
pub enum NovaError {
    #[error("{message}")]
    Command {
        code: String,
        message: String,
        detail: Option<String>,
        recoverable: bool,
    },
}

pub type CommandResult<T> = Result<CommandResponse<T>, NovaError>;

#[derive(Debug, Serialize)]
pub struct CommandResponse<T>
where
    T: Serialize,
{
    pub ok: bool,
    pub data: T,
}

impl<T> CommandResponse<T>
where
    T: Serialize,
{
    pub fn success(data: T) -> Self {
        Self { ok: true, data }
    }
}

impl NovaError {
    pub fn command(
        code: impl Into<String>,
        message: impl Into<String>,
        detail: Option<String>,
        recoverable: bool,
    ) -> Self {
        Self::Command {
            code: code.into(),
            message: message.into(),
            detail,
            recoverable,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct HealthPayload {
    pub message: String,
    pub backend: String,
}
