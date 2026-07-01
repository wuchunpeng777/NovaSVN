use thiserror::Error;

#[derive(Debug, Error)]
pub enum NovaError {
    #[error("{0}")]
    Message(String),
}
