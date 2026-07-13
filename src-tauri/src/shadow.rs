use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{error::NovaError, executable::normalize_executable_setting, svn};

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

    let executable = svn_executable(request)?;
    let output = svn::command(&executable)
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

    Ok(dir.join("shadow-workspaces").join(shadow_cache_key(
        &request.working_copy_root,
        &request.repository_url,
    )))
}

pub fn svn_executable(request: &ShadowWorkspaceRequest) -> Result<String, NovaError> {
    normalize_executable_setting(
        request.svn_executable.as_deref(),
        "svn",
        "SVN_EXECUTABLE_INVALID",
        "SVN 可执行文件路径无效",
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    fn request_with_executable(svn_executable: Option<&str>) -> ShadowWorkspaceRequest {
        ShadowWorkspaceRequest {
            working_copy_root: "C:\\wc".to_string(),
            repository_url: "https://example.com/svn/trunk".to_string(),
            revision: None,
            svn_executable: svn_executable.map(ToString::to_string),
        }
    }

    #[test]
    fn validates_shadow_svn_executable_values() {
        assert_eq!(
            svn_executable(&request_with_executable(None)).unwrap(),
            "svn"
        );
        assert_eq!(
            svn_executable(&request_with_executable(Some(" svn.exe "))).unwrap(),
            "svn.exe"
        );
        assert!(svn_executable(&request_with_executable(Some("C:\\Tools\\svn.exe"))).is_ok());
        assert!(svn_executable(&request_with_executable(Some("tools\\svn.exe"))).is_err());
        assert!(svn_executable(&request_with_executable(Some("svn\n"))).is_err());
    }
}
