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

#[derive(Debug, Clone, Deserialize)]
pub struct ScanWorkspaceStatusRequest {
    pub working_copy_root: String,
    pub svn_executable: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkingCopyStatus {
    pub working_copy_root: String,
    pub total: usize,
    pub returned: usize,
    pub offset: usize,
    pub limit: usize,
    pub modified: usize,
    pub added: usize,
    pub deleted: usize,
    pub missing: usize,
    pub unversioned: usize,
    pub conflicted: usize,
    pub obstructed: usize,
    pub property_changed: usize,
    pub files: Vec<ChangedFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub property_status: Option<String>,
    pub property_changed: bool,
    pub abnormal: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetFileDiffRequest {
    pub working_copy_root: String,
    pub file_path: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub text: String,
    pub binary: bool,
    pub empty: bool,
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

pub fn get_file_diff(request: GetFileDiffRequest) -> Result<FileDiff, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let file_path = normalize_relative_file_path(&request.file_path)?;
    let target = root.join(&file_path);
    let executable = request
        .svn_executable
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "svn".to_string());

    let output = Command::new(&executable)
        .arg("diff")
        .arg(&target)
        .current_dir(&root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_DIFF_FAILED",
                "无法读取文件 Diff",
                Some(format!(
                    "执行 `{executable} diff {}` 失败：{error}",
                    target.display()
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_DIFF_COMMAND_FAILED",
            "文件 Diff 读取失败",
            Some(svn_diff_error_detail(&executable, &target, &output)),
            true,
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let text = if stdout.trim().is_empty() && !stderr.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    let binary = is_binary_diff(&text);

    Ok(FileDiff {
        path: file_path.replace('\\', "/"),
        empty: text.trim().is_empty(),
        text,
        binary,
    })
}

pub fn scan_workspace_status(
    request: ScanWorkspaceStatusRequest,
) -> Result<WorkingCopyStatus, NovaError> {
    let path = normalize_workspace_path(&request.working_copy_root)?;
    let executable = request
        .svn_executable
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "svn".to_string());

    let output = Command::new(&executable)
        .args(["status", "--xml"])
        .arg(&path)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_STATUS_FAILED",
                "无法扫描工作副本状态",
                Some(format!(
                    "执行 `{executable} status --xml {}` 失败：{error}",
                    path.display()
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_STATUS_COMMAND_FAILED",
            "工作副本状态扫描失败",
            Some(svn_status_error_detail(&executable, &path, &output)),
            true,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    parse_svn_status_xml(
        &xml,
        &path,
        request.offset.unwrap_or(0),
        request.limit.unwrap_or(500),
    )
}

fn normalize_relative_file_path(path: &str) -> Result<String, NovaError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "DIFF_PATH_EMPTY",
            "请选择要查看 Diff 的文件",
            None,
            true,
        ));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() || trimmed.contains("..") {
        return Err(NovaError::command(
            "DIFF_PATH_INVALID",
            "Diff 文件路径无效",
            Some("文件路径必须是当前工作副本内的相对路径。".to_string()),
            true,
        ));
    }

    Ok(trimmed.to_string())
}

fn is_binary_diff(text: &str) -> bool {
    let lowered = text.to_lowercase();
    lowered.contains("cannot display: file marked as a binary type")
        || lowered.contains("cannot display: file marked as binary")
        || lowered.contains("diff of binary files")
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

fn parse_svn_status_xml(
    xml: &str,
    working_copy_root: &Path,
    offset: usize,
    limit: usize,
) -> Result<WorkingCopyStatus, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "SVN_STATUS_XML_PARSE_FAILED",
            "解析 SVN 状态失败",
            Some(format!("svn status --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;

    let mut files = Vec::new();
    for entry in document
        .descendants()
        .filter(|node| node.has_tag_name("entry"))
    {
        let raw_path = entry.attribute("path").unwrap_or("").trim();
        if raw_path.is_empty() {
            continue;
        }

        let Some(wc_status) = entry.children().find(|node| node.has_tag_name("wc-status")) else {
            continue;
        };

        let item = wc_status.attribute("item").unwrap_or("normal").to_string();
        let props = wc_status.attribute("props").map(ToString::to_string);
        if item == "normal" && props.as_deref().unwrap_or("none") == "none" {
            continue;
        }

        let property_changed = props
            .as_deref()
            .map(|value| value != "none" && value != "normal")
            .unwrap_or(false);

        files.push(ChangedFile {
            path: display_status_path(raw_path, working_copy_root),
            status: normalize_status(&item),
            property_status: props,
            property_changed,
            abnormal: is_abnormal_status(&item),
        });
    }

    let total = files.len();
    let safe_offset = offset.min(total);
    let safe_limit = limit.clamp(1, 5000);
    let paged_files: Vec<ChangedFile> = files
        .iter()
        .skip(safe_offset)
        .take(safe_limit)
        .cloned()
        .collect();

    Ok(WorkingCopyStatus {
        working_copy_root: working_copy_root.display().to_string(),
        total,
        returned: paged_files.len(),
        offset: safe_offset,
        limit: safe_limit,
        modified: count_status(&files, "modified"),
        added: count_status(&files, "added"),
        deleted: count_status(&files, "deleted"),
        missing: count_status(&files, "missing"),
        unversioned: count_status(&files, "unversioned"),
        conflicted: count_status(&files, "conflicted"),
        obstructed: count_status(&files, "obstructed"),
        property_changed: files.iter().filter(|file| file.property_changed).count(),
        files: paged_files,
    })
}

fn normalize_status(status: &str) -> String {
    match status {
        "external" | "ignored" | "incomplete" | "normal" | "none" | "replaced" => {
            status.to_string()
        }
        "modified" | "added" | "deleted" | "missing" | "unversioned" | "conflicted"
        | "obstructed" => status.to_string(),
        other => other.to_string(),
    }
}

fn is_abnormal_status(status: &str) -> bool {
    matches!(
        status,
        "missing" | "conflicted" | "obstructed" | "incomplete"
    )
}

fn count_status(files: &[ChangedFile], status: &str) -> usize {
    files.iter().filter(|file| file.status == status).count()
}

fn display_status_path(raw_path: &str, working_copy_root: &Path) -> String {
    let path = PathBuf::from(raw_path);
    path.strip_prefix(working_copy_root)
        .ok()
        .and_then(|relative| relative.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| value.replace('\\', "/"))
        .unwrap_or_else(|| raw_path.to_string())
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

fn svn_status_error_detail(executable: &str, path: &Path, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        return format!(
            "`{executable} status --xml {}` 返回失败：{stderr}",
            path.display()
        );
    }

    if !stdout.is_empty() {
        return format!(
            "`{executable} status --xml {}` 返回失败：{stdout}",
            path.display()
        );
    }

    format!(
        "`{executable} status --xml {}` 返回退出码 {:?}，但没有输出。",
        path.display(),
        output.status.code()
    )
}

fn svn_diff_error_detail(executable: &str, path: &Path, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        return format!("`{executable} diff {}` 返回失败：{stderr}", path.display());
    }

    if !stdout.is_empty() {
        return format!("`{executable} diff {}` 返回失败：{stdout}", path.display());
    }

    format!(
        "`{executable} diff {}` 返回退出码 {:?}，但没有输出。",
        path.display(),
        output.status.code()
    )
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
