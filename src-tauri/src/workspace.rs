use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use roxmltree::Document;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::NovaError;

#[derive(Debug, Clone, Deserialize)]
pub struct OpenWorkspaceRequest {
    pub path: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSummary {
    pub local_path: String,
    pub working_copy_root: String,
    pub repository_url: String,
    pub repository_root: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecentWorkspace {
    pub workspace: Option<WorkspaceSummary>,
}

pub fn open_workspace(
    app: &AppHandle,
    request: OpenWorkspaceRequest,
) -> Result<WorkspaceSummary, NovaError> {
    let path = normalize_workspace_path(&request.path)?;
    let executable = request
        .svn_executable
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "svn".to_string());

    let output = Command::new(&executable)
        .args(["info", "--xml"])
        .arg(&path)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_INFO_FAILED",
                "无法读取 SVN 工作副本信息",
                Some(format!(
                    "执行 `{executable} info --xml {}` 失败：{error}",
                    path.display()
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "WORKSPACE_NOT_SVN",
            "该目录不是可用的 SVN 工作副本",
            Some(svn_info_error_detail(&executable, &path, &output)),
            true,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    let summary = parse_svn_info_xml(&xml, &path)?;
    save_recent_workspace(app, &summary)?;
    Ok(summary)
}

pub fn read_recent_workspace(app: &AppHandle) -> Result<RecentWorkspace, NovaError> {
    let path = recent_workspace_path(app)?;
    if !path.exists() {
        return Ok(RecentWorkspace { workspace: None });
    }

    let content = fs::read_to_string(&path).map_err(|error| {
        NovaError::command(
            "RECENT_WORKSPACE_READ_FAILED",
            "读取最近工作副本失败",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    let workspace = serde_json::from_str::<WorkspaceSummary>(&content).map_err(|error| {
        NovaError::command(
            "RECENT_WORKSPACE_PARSE_FAILED",
            "最近工作副本记录损坏",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    Ok(RecentWorkspace {
        workspace: Some(workspace),
    })
}

fn normalize_workspace_path(path: &str) -> Result<PathBuf, NovaError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "WORKSPACE_PATH_EMPTY",
            "请选择或输入工作副本目录",
            None,
            true,
        ));
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(NovaError::command(
            "WORKSPACE_PATH_NOT_FOUND",
            "工作副本目录不存在",
            Some(format!("路径：{}", path.display())),
            true,
        ));
    }

    if !path.is_dir() {
        return Err(NovaError::command(
            "WORKSPACE_PATH_NOT_DIRECTORY",
            "工作副本路径不是目录",
            Some(format!("路径：{}", path.display())),
            true,
        ));
    }

    Ok(path)
}

fn parse_svn_info_xml(xml: &str, requested_path: &Path) -> Result<WorkspaceSummary, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "SVN_INFO_XML_PARSE_FAILED",
            "解析 SVN 工作副本信息失败",
            Some(format!("svn info --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;

    let entry = document
        .descendants()
        .find(|node| node.has_tag_name("entry"))
        .ok_or_else(|| {
            NovaError::command(
                "SVN_INFO_ENTRY_MISSING",
                "SVN 工作副本信息缺少 entry 节点",
                None,
                true,
            )
        })?;

    let revision = entry.attribute("revision").unwrap_or("").to_string();
    let local_path = entry
        .attribute("path")
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| requested_path.display().to_string());
    let repository_url = text_child(entry, "url")?;
    let repository_root = text_child(entry, "root")?;
    let working_copy_root = text_child(entry, "wcroot-abspath")
        .unwrap_or_else(|_| requested_path.display().to_string());

    Ok(WorkspaceSummary {
        local_path,
        working_copy_root,
        repository_url,
        repository_root,
        revision,
    })
}

fn text_child(node: roxmltree::Node<'_, '_>, tag_name: &str) -> Result<String, NovaError> {
    node.descendants()
        .find(|child| child.has_tag_name(tag_name))
        .and_then(|child| child.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| {
            NovaError::command(
                "SVN_INFO_FIELD_MISSING",
                "SVN 工作副本信息缺少必要字段",
                Some(format!("缺少字段：{tag_name}")),
                true,
            )
        })
}

fn save_recent_workspace(app: &AppHandle, workspace: &WorkspaceSummary) -> Result<(), NovaError> {
    let path = recent_workspace_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            NovaError::command(
                "RECENT_WORKSPACE_DIR_FAILED",
                "创建最近工作副本目录失败",
                Some(format!("路径：{}。错误：{error}", parent.display())),
                true,
            )
        })?;
    }

    let content = serde_json::to_string_pretty(workspace).map_err(|error| {
        NovaError::command(
            "RECENT_WORKSPACE_SERIALIZE_FAILED",
            "保存最近工作副本失败",
            Some(error.to_string()),
            true,
        )
    })?;

    fs::write(&path, content).map_err(|error| {
        NovaError::command(
            "RECENT_WORKSPACE_WRITE_FAILED",
            "写入最近工作副本失败",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })
}

fn recent_workspace_path(app: &AppHandle) -> Result<PathBuf, NovaError> {
    let dir = app.path().app_data_dir().map_err(|error| {
        NovaError::command(
            "APP_DATA_DIR_FAILED",
            "无法获取应用数据目录",
            Some(error.to_string()),
            true,
        )
    })?;

    Ok(dir.join("recent-workspace.json"))
}

fn svn_info_error_detail(executable: &str, path: &Path, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        return format!(
            "`{executable} info --xml {}` 返回失败：{stderr}。请 checkout 工作副本或重新选择目录。",
            path.display()
        );
    }

    if !stdout.is_empty() {
        return format!(
            "`{executable} info --xml {}` 返回失败：{stdout}。请 checkout 工作副本或重新选择目录。",
            path.display()
        );
    }

    format!(
        "`{executable} info --xml {}` 返回退出码 {:?}，但没有输出。请 checkout 工作副本或重新选择目录。",
        path.display(),
        output.status.code()
    )
}
