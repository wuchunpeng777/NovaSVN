use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::PathBuf,
    process::Command,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::NovaError;

#[derive(Debug, Clone, Deserialize)]
pub struct ShadowWorkspaceRequest {
    pub working_copy_root: String,
    pub repository_url: String,
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShadowWorkspaceStatus {
    pub shadow_path: String,
    pub exists: bool,
    pub valid: bool,
    pub revision: Option<String>,
    pub message: String,
}

pub fn shadow_status(
    app: &AppHandle,
    request: &ShadowWorkspaceRequest,
) -> Result<ShadowWorkspaceStatus, NovaError> {
    let shadow_path = shadow_workspace_path(app, request)?;
    if !shadow_path.exists() {
        return Ok(ShadowWorkspaceStatus {
            shadow_path: shadow_path.display().to_string(),
            exists: false,
            valid: false,
            revision: None,
            message: "影子工作副本尚未创建".to_string(),
        });
    }

    let executable = svn_executable(request);
    let output = Command::new(&executable)
        .args(["info", "--xml"])
        .arg(&shadow_path)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SHADOW_INFO_FAILED",
                "无法检查影子工作副本",
                Some(format!("执行 `{executable} info --xml` 失败：{error}")),
                true,
            )
        })?;

    if !output.status.success() {
        return Ok(ShadowWorkspaceStatus {
            shadow_path: shadow_path.display().to_string(),
            exists: true,
            valid: false,
            revision: None,
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(ShadowWorkspaceStatus {
        shadow_path: shadow_path.display().to_string(),
        exists: true,
        valid: true,
        revision: parse_info_revision(&String::from_utf8_lossy(&output.stdout)),
        message: "影子工作副本可用".to_string(),
    })
}

pub fn shadow_workspace_path(
    app: &AppHandle,
    request: &ShadowWorkspaceRequest,
) -> Result<PathBuf, NovaError> {
    let dir = app.path().app_data_dir().map_err(|error| {
        NovaError::command(
            "APP_DATA_DIR_FAILED",
            "无法获取应用数据目录",
            Some(error.to_string()),
            true,
        )
    })?;

    Ok(dir
        .join("shadow-workspaces")
        .join(shadow_cache_key(
            &request.working_copy_root,
            &request.repository_url,
        )))
}

pub fn svn_executable(request: &ShadowWorkspaceRequest) -> String {
    request
        .svn_executable
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "svn".to_string())
}

pub fn remove_shadow_workspace(
    app: &AppHandle,
    request: &ShadowWorkspaceRequest,
) -> Result<(), NovaError> {
    let path = shadow_workspace_path(app, request)?;
    if path.exists() {
        fs::remove_dir_all(&path).map_err(|error| {
            NovaError::command(
                "SHADOW_REMOVE_FAILED",
                "无法删除影子工作副本",
                Some(format!("路径：{}。错误：{error}", path.display())),
                true,
            )
        })?;
    }
    Ok(())
}

fn shadow_cache_key(working_copy_root: &str, repository_url: &str) -> String {
    let mut hasher = DefaultHasher::new();
    working_copy_root.hash(&mut hasher);
    repository_url.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn parse_info_revision(xml: &str) -> Option<String> {
    let marker = "revision=\"";
    let start = xml.find(marker)? + marker.len();
    let rest = &xml[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}
