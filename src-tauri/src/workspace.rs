use std::{
    collections::HashMap,
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::Command,
};

use roxmltree::Document;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{error::NovaError, executable::normalize_executable_setting, path_utils};

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

#[derive(Debug, Clone, Deserialize)]
pub struct ListWorkspaceFilesRequest {
    pub working_copy_root: String,
    pub svn_executable: Option<String>,
    pub max_files: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkingCopyStatus {
    pub working_copy_root: String,
    pub total: usize,
    pub returned: usize,
    pub offset: usize,
    pub limit: usize,
    pub revision_range: Option<String>,
    pub mixed_revision: bool,
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
    pub revision: Option<String>,
    pub property_status: Option<String>,
    pub property_changed: bool,
    pub abnormal: bool,
    pub lock_state: String,
    pub lock_owner: Option<String>,
    pub lock_comment: Option<String>,
    pub conflict_kind: Option<String>,
    pub file_size: Option<u64>,
    pub content_digest: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceFileTree {
    pub working_copy_root: String,
    pub total_files: usize,
    pub returned_files: usize,
    pub truncated: bool,
    pub nodes: Vec<WorkspaceFileNode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceFileNode {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub revision: Option<String>,
    pub file_size: Option<u64>,
    pub changed: bool,
    pub children: Vec<WorkspaceFileNode>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetFileDiffRequest {
    pub working_copy_root: String,
    pub file_path: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetFileContentDiffRequest {
    pub working_copy_root: String,
    pub file_path: String,
    pub svn_executable: Option<String>,
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetSvnLogRequest {
    pub working_copy_root: String,
    pub file_path: Option<String>,
    pub svn_executable: Option<String>,
    pub limit: Option<usize>,
    pub start_revision: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetSvnPropertiesRequest {
    pub working_copy_root: String,
    pub file_path: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetSvnPropertyRequest {
    pub working_copy_root: String,
    pub file_path: Option<String>,
    pub name: String,
    pub value: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub text: String,
    pub binary: bool,
    pub empty: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileContentDiff {
    pub path: String,
    pub original_text: String,
    pub modified_text: String,
    pub language: String,
    pub binary: bool,
    pub too_large: bool,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnLog {
    pub target: String,
    pub entries: Vec<SvnLogEntry>,
    pub has_more: bool,
    pub next_start_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnLogEntry {
    pub revision: String,
    pub author: String,
    pub date: String,
    pub message: String,
    pub changed_paths: Vec<SvnChangedPath>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnChangedPath {
    pub path: String,
    pub action: String,
    pub kind: String,
    pub copy_from_path: Option<String>,
    pub copy_from_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnProperties {
    pub target: String,
    pub properties: Vec<SvnProperty>,
    pub externals: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnProperty {
    pub name: String,
    pub value: String,
}

pub fn open_workspace(
    app: &AppHandle,
    request: OpenWorkspaceRequest,
) -> Result<WorkspaceSummary, NovaError> {
    let path = normalize_workspace_path(&request.path)?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;

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

pub fn get_svn_log(request: GetSvnLogRequest) -> Result<SvnLog, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let file_path = request
        .file_path
        .as_deref()
        .map(normalize_relative_file_path)
        .transpose()?;
    let target = file_path
        .as_ref()
        .map(|path| root.join(path))
        .unwrap_or_else(|| root.clone());
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let limit = request.limit.unwrap_or(50).clamp(1, 200);
    let start_revision = request
        .start_revision
        .as_deref()
        .map(normalize_log_revision_value)
        .transpose()?;
    let mut command = Command::new(&executable);
    command
        .args(["log", "--xml", "--verbose", "--limit"])
        .arg((limit + 1).to_string());
    if let Some(revision) = start_revision.as_deref() {
        command.arg("-r").arg(format!("{revision}:0"));
    }
    command.arg(&target).current_dir(&root);

    let output = command.output().map_err(|error| {
        NovaError::command(
            "SVN_LOG_FAILED",
            "无法读取 SVN 日志",
            Some(format!(
                "执行 `{executable} log --xml --verbose --limit {}` 失败：{error}",
                limit + 1
            )),
            true,
        )
    })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_LOG_COMMAND_FAILED",
            "SVN 日志读取失败",
            Some(command_error_detail(&executable, "log", &output)),
            true,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    let mut log = parse_svn_log_xml(
        &xml,
        &display_status_path(&target.display().to_string(), &root),
    )?;
    trim_svn_log_page(&mut log, limit);
    Ok(log)
}

pub fn get_svn_properties(request: GetSvnPropertiesRequest) -> Result<SvnProperties, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let target = request
        .file_path
        .as_deref()
        .map(normalize_relative_file_path)
        .transpose()?
        .map(|file| root.join(file))
        .unwrap_or_else(|| root.clone());
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;

    let output = Command::new(&executable)
        .args(["proplist", "--xml"])
        .arg(&target)
        .current_dir(&root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_PROPLIST_FAILED",
                "无法读取 SVN 属性列表",
                Some(format!("执行 `{executable} proplist --xml` 失败：{error}")),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_PROPLIST_FAILED",
            "SVN 属性列表读取失败",
            Some(command_error_detail(&executable, "proplist", &output)),
            true,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    let names = parse_svn_property_names(&xml)?;
    let mut properties = Vec::with_capacity(names.len());
    for name in names {
        let value = get_svn_property_value(&executable, &root, &target, &name)?;
        properties.push(SvnProperty { name, value });
    }
    let externals = properties
        .iter()
        .find(|property| property.name == "svn:externals")
        .map(|property| property.value.clone());

    Ok(SvnProperties {
        target: display_status_path(&target.display().to_string(), &root),
        properties,
        externals,
    })
}

pub fn set_svn_property(request: SetSvnPropertyRequest) -> Result<SvnProperties, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let target = request
        .file_path
        .as_deref()
        .map(normalize_relative_file_path)
        .transpose()?
        .map(|file| root.join(file))
        .unwrap_or_else(|| root.clone());
    let name = normalize_svn_property_name(&request.name)?;
    let operation = svn_property_write_operation(&request.value);
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;

    let mut command = Command::new(&executable);
    command.arg(operation.command()).arg(&name);
    if let SvnPropertyWriteOperation::Set = operation {
        command.arg(&request.value);
    }
    let output = command
        .arg(&target)
        .current_dir(&root)
        .output()
        .map_err(|error| {
            NovaError::command(
                operation.error_code(),
                operation.error_message(),
                Some(format!(
                    "执行 `{executable} {}` 失败：{error}",
                    operation.command()
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            operation.error_code(),
            operation.failed_message(),
            Some(command_error_detail(
                &executable,
                operation.command(),
                &output,
            )),
            true,
        ));
    }

    get_svn_properties(GetSvnPropertiesRequest {
        working_copy_root: request.working_copy_root,
        file_path: request.file_path,
        svn_executable: Some(executable),
    })
}

pub fn get_file_diff(request: GetFileDiffRequest) -> Result<FileDiff, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let file_path = normalize_relative_file_path(&request.file_path)?;
    let target = root.join(&file_path);
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;

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

pub fn get_file_content_diff(
    request: GetFileContentDiffRequest,
) -> Result<FileContentDiff, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let file_path = normalize_relative_file_path(&request.file_path)?;
    let target = root.join(&file_path);
    let max_bytes = request.max_bytes.unwrap_or(512 * 1024);
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;

    let working = read_limited_text_file(&target, max_bytes)?;
    let original = read_svn_base_text(&executable, &root, &target, max_bytes)?;
    let binary = working.binary || original.binary;
    let too_large = working.too_large || original.too_large;

    Ok(FileContentDiff {
        path: file_path.replace('\\', "/"),
        original_text: if binary || too_large {
            String::new()
        } else {
            original.text
        },
        modified_text: if binary || too_large {
            String::new()
        } else {
            working.text
        },
        language: language_for_path(&file_path),
        binary,
        too_large,
        max_bytes,
    })
}

pub fn scan_workspace_status(
    request: ScanWorkspaceStatusRequest,
) -> Result<WorkingCopyStatus, NovaError> {
    let path = normalize_workspace_path(&request.working_copy_root)?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;

    let output = run_status_with_updates(&executable, &path)?;

    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_STATUS_COMMAND_FAILED",
            "工作副本状态扫描失败",
            Some(svn_status_error_detail(&executable, &path, &output)),
            true,
        ));
    }

    let revision_summary = read_workspace_revision_summary(&executable, &path);
    let xml = String::from_utf8_lossy(&output.stdout);
    parse_svn_status_xml(
        &xml,
        &path,
        request.offset.unwrap_or(0),
        request.limit.unwrap_or(500),
        revision_summary,
    )
}

pub fn list_workspace_files(
    request: ListWorkspaceFilesRequest,
) -> Result<WorkspaceFileTree, NovaError> {
    let path = normalize_workspace_path(&request.working_copy_root)?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let status = scan_workspace_status(ScanWorkspaceStatusRequest {
        working_copy_root: path.display().to_string(),
        svn_executable: Some(executable),
        offset: Some(0),
        limit: Some(5000),
    })?;
    let status_by_path = status
        .files
        .iter()
        .map(|file| (normalize_tree_path(&file.path), file))
        .collect::<HashMap<_, _>>();
    let max_files = request.max_files.unwrap_or(5000).clamp(1, 20000);
    let mut returned_files = 0;
    let mut total_files = 0;
    let mut truncated = false;
    let mut nodes = read_workspace_children(
        &path,
        &path,
        &status_by_path,
        max_files,
        &mut returned_files,
        &mut total_files,
        &mut truncated,
    )?;

    add_missing_status_nodes(&mut nodes, &status_by_path);
    sort_workspace_nodes(&mut nodes);

    Ok(WorkspaceFileTree {
        working_copy_root: path.display().to_string(),
        total_files,
        returned_files,
        truncated,
        nodes,
    })
}

fn run_status_with_updates(
    executable: &str,
    path: &Path,
) -> Result<std::process::Output, NovaError> {
    let output = Command::new(executable)
        .args(["status", "--xml", "--show-updates"])
        .arg(path)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_STATUS_FAILED",
                "无法扫描工作副本状态",
                Some(format!(
                    "执行 `{executable} status --xml --show-updates {}` 失败：{error}",
                    path.display()
                )),
                true,
            )
        })?;

    if output.status.success() {
        return Ok(output);
    }

    Command::new(executable)
        .args(["status", "--xml"])
        .arg(path)
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
        })
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

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "DIFF_PATH_INVALID",
            "Diff 文件路径无效",
            Some("文件路径不能包含控制字符。".to_string()),
            true,
        ));
    }

    let path = PathBuf::from(trimmed);
    if path_utils::is_absolute_or_windows_path(&path, trimmed)
        || path_utils::has_parent_segment(trimmed)
    {
        return Err(NovaError::command(
            "DIFF_PATH_INVALID",
            "Diff 文件路径无效",
            Some("文件路径必须是当前工作副本内的相对路径。".to_string()),
            true,
        ));
    }

    Ok(path_utils::normalize_relative_separators(trimmed))
}

fn normalize_log_revision_value(revision: &str) -> Result<String, NovaError> {
    let value = revision.trim();
    if value.is_empty() || value.chars().any(|character| !character.is_ascii_digit()) {
        return Err(NovaError::command(
            "SVN_LOG_REVISION_INVALID",
            "日志 revision 无效",
            Some("日志分页 revision 必须是数字。".to_string()),
            true,
        ));
    }

    Ok(value.to_string())
}

fn normalize_svn_executable(executable: Option<&str>) -> Result<String, NovaError> {
    normalize_executable_setting(
        executable,
        "svn",
        "SVN_EXECUTABLE_INVALID",
        "SVN 可执行文件路径无效",
    )
}

fn trim_svn_log_page(log: &mut SvnLog, limit: usize) {
    let fetched_more_than_limit = log.entries.len() > limit;
    if fetched_more_than_limit {
        log.entries.truncate(limit);
    }

    log.next_start_revision = log
        .entries
        .last()
        .and_then(|entry| entry.revision.parse::<u64>().ok())
        .and_then(|revision| revision.checked_sub(1))
        .filter(|revision| *revision > 0)
        .map(|revision| revision.to_string());
    log.has_more = fetched_more_than_limit && log.next_start_revision.is_some();
}

fn is_binary_diff(text: &str) -> bool {
    let lowered = text.to_lowercase();
    lowered.contains("cannot display: file marked as a binary type")
        || lowered.contains("cannot display: file marked as binary")
        || lowered.contains("diff of binary files")
}

#[derive(Debug)]
struct LimitedText {
    text: String,
    binary: bool,
    too_large: bool,
}

fn read_limited_text_file(path: &Path, max_bytes: u64) -> Result<LimitedText, NovaError> {
    if !path.exists() {
        return Ok(LimitedText {
            text: String::new(),
            binary: false,
            too_large: false,
        });
    }

    let metadata = fs::metadata(path).map_err(|error| {
        NovaError::command(
            "FILE_CONTENT_METADATA_FAILED",
            "无法读取文件信息",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    if metadata.len() > max_bytes {
        return Ok(LimitedText {
            text: String::new(),
            binary: false,
            too_large: true,
        });
    }

    let mut file = fs::File::open(path).map_err(|error| {
        NovaError::command(
            "FILE_CONTENT_READ_FAILED",
            "无法读取文件内容",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes).map_err(|error| {
        NovaError::command(
            "FILE_CONTENT_READ_FAILED",
            "无法读取文件内容",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    bytes_to_limited_text(bytes, false)
}

fn read_svn_base_text(
    executable: &str,
    root: &Path,
    target: &Path,
    max_bytes: u64,
) -> Result<LimitedText, NovaError> {
    let output = Command::new(executable)
        .arg("cat")
        .arg(target)
        .current_dir(root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_CAT_FAILED",
                "无法读取文件基线内容",
                Some(format!(
                    "执行 `{executable} cat {}` 失败：{error}",
                    target.display()
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Ok(LimitedText {
            text: String::new(),
            binary: false,
            too_large: false,
        });
    }

    if output.stdout.len() as u64 > max_bytes {
        return Ok(LimitedText {
            text: String::new(),
            binary: false,
            too_large: true,
        });
    }

    bytes_to_limited_text(output.stdout, false)
}

fn bytes_to_limited_text(bytes: Vec<u8>, too_large: bool) -> Result<LimitedText, NovaError> {
    if bytes.iter().any(|byte| *byte == 0) {
        return Ok(LimitedText {
            text: String::new(),
            binary: true,
            too_large,
        });
    }

    let text = String::from_utf8(bytes).map_err(|error| {
        NovaError::command(
            "FILE_CONTENT_NOT_UTF8",
            "文件不是 UTF-8 文本",
            Some(error.to_string()),
            true,
        )
    })?;

    Ok(LimitedText {
        text,
        binary: false,
        too_large,
    })
}

fn language_for_path(path: &str) -> String {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match extension.as_str() {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "svelte" => "html",
        "json" => "json",
        "md" | "markdown" => "markdown",
        "css" => "css",
        "scss" | "sass" => "scss",
        "html" | "htm" => "html",
        "xml" => "xml",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "py" => "python",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "go" => "go",
        "sql" => "sql",
        "sh" | "bash" => "shell",
        "ps1" => "powershell",
        _ => "plaintext",
    }
    .to_string()
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
    revision_summary: RevisionSummary,
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

        let property_changed = props
            .as_deref()
            .map(|value| value != "none" && value != "normal")
            .unwrap_or(false);
        let (lock_state, lock_owner, lock_comment) = parse_lock_info(entry, wc_status);
        let conflict_kind = parse_conflict_kind(entry, wc_status, &item, props.as_deref());
        if item == "normal"
            && props.as_deref().unwrap_or("none") == "none"
            && lock_state == "none"
            && lock_owner.is_none()
            && lock_comment.is_none()
            && conflict_kind.is_none()
        {
            continue;
        }

        let display_path = display_status_path(raw_path, working_copy_root);
        let target_path = status_target_path(raw_path, working_copy_root);

        files.push(ChangedFile {
            path: display_path,
            status: normalize_status(&item, wc_status),
            revision: wc_status.attribute("revision").map(ToString::to_string),
            property_status: props,
            property_changed,
            abnormal: is_abnormal_status(&item),
            lock_state,
            lock_owner,
            lock_comment,
            conflict_kind,
            file_size: changed_file_size(&target_path),
            content_digest: changed_file_digest(&target_path, &item),
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
        revision_range: revision_summary.range,
        mixed_revision: revision_summary.mixed,
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

fn normalize_status<'a, 'input>(status: &str, wc_status: roxmltree::Node<'a, 'input>) -> String {
    if status == "replaced"
        || wc_status
            .children()
            .any(|node| node.has_tag_name("moved-from") || node.has_tag_name("moved-to"))
    {
        return "renamed".to_string();
    }

    match status {
        "external" | "ignored" | "incomplete" | "normal" | "none" => status.to_string(),
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

fn parse_conflict_kind<'a, 'input>(
    entry: roxmltree::Node<'a, 'input>,
    wc_status: roxmltree::Node<'a, 'input>,
    item: &str,
    props: Option<&str>,
) -> Option<String> {
    if let Some(tree_conflict) = entry
        .descendants()
        .find(|node| node.has_tag_name("tree-conflict"))
    {
        return tree_conflict
            .attribute("operation")
            .map(|operation| format!("tree:{operation}"))
            .or_else(|| Some("tree".to_string()));
    }

    if item == "conflicted" {
        return Some("text".to_string());
    }

    if props == Some("conflicted") || wc_status.attribute("props") == Some("conflicted") {
        return Some("property".to_string());
    }

    None
}

fn parse_lock_info<'a, 'input>(
    entry: roxmltree::Node<'a, 'input>,
    wc_status: roxmltree::Node<'a, 'input>,
) -> (String, Option<String>, Option<String>) {
    let repos_status = entry
        .children()
        .find(|node| node.has_tag_name("repos-status"));
    let lock_node = wc_status
        .children()
        .find(|node| node.has_tag_name("lock"))
        .or_else(|| {
            repos_status.and_then(|node| node.children().find(|child| child.has_tag_name("lock")))
        });
    let lock_state = wc_status
        .attribute("wc-locked")
        .or_else(|| repos_status.and_then(|node| node.attribute("item")))
        .unwrap_or("none")
        .to_string();

    (
        lock_state,
        lock_node.and_then(|node| optional_text_child(node, "owner")),
        lock_node.and_then(|node| optional_text_child(node, "comment")),
    )
}

fn count_status(files: &[ChangedFile], status: &str) -> usize {
    files.iter().filter(|file| file.status == status).count()
}

fn read_workspace_children(
    root: &Path,
    directory: &Path,
    status_by_path: &HashMap<String, &ChangedFile>,
    max_files: usize,
    returned_files: &mut usize,
    total_files: &mut usize,
    truncated: &mut bool,
) -> Result<Vec<WorkspaceFileNode>, NovaError> {
    let entries = fs::read_dir(directory).map_err(|error| {
        NovaError::command(
            "WORKSPACE_FILE_TREE_FAILED",
            "无法读取工作副本文件树",
            Some(format!("路径：{}。错误：{error}", directory.display())),
            true,
        )
    })?;

    let mut nodes = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            NovaError::command(
                "WORKSPACE_FILE_TREE_FAILED",
                "无法读取工作副本文件树",
                Some(format!("路径：{}。错误：{error}", directory.display())),
                true,
            )
        })?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_workspace_tree_entry(&name) {
            continue;
        }

        let metadata = entry.metadata().map_err(|error| {
            NovaError::command(
                "WORKSPACE_FILE_TREE_FAILED",
                "无法读取工作副本文件树",
                Some(format!("路径：{}。错误：{error}", path.display())),
                true,
            )
        })?;
        let relative_path = workspace_tree_relative_path(root, &path);
        let status_match = workspace_tree_status_for_path(&relative_path, status_by_path);
        if metadata.is_dir() {
            let children = read_workspace_children(
                root,
                &path,
                status_by_path,
                max_files,
                returned_files,
                total_files,
                truncated,
            )?;
            if children.is_empty() {
                continue;
            }

            let changed = status_match.changed || children.iter().any(|child| child.changed);
            nodes.push(WorkspaceFileNode {
                path: relative_path,
                name,
                kind: "dir".to_string(),
                status: status_match.status.unwrap_or_else(|| {
                    if changed {
                        "changed".to_string()
                    } else {
                        "normal".to_string()
                    }
                }),
                revision: status_match.revision,
                file_size: None,
                changed,
                children,
            });
        } else if metadata.is_file() {
            *total_files += 1;
            if *returned_files >= max_files {
                *truncated = true;
                continue;
            }

            *returned_files += 1;
            nodes.push(workspace_file_node(
                relative_path,
                name,
                Some(metadata.len()),
                status_by_path,
            ));
        }
    }

    Ok(nodes)
}

fn workspace_file_node(
    path: String,
    name: String,
    file_size: Option<u64>,
    status_by_path: &HashMap<String, &ChangedFile>,
) -> WorkspaceFileNode {
    let normalized_path = normalize_tree_path(&path);
    let status_match = workspace_tree_status_for_path(&normalized_path, status_by_path);
    WorkspaceFileNode {
        path,
        name,
        kind: "file".to_string(),
        status: status_match.status.unwrap_or_else(|| "normal".to_string()),
        revision: status_match.revision,
        file_size: status_match.file_size.or(file_size),
        changed: status_match.changed,
        children: Vec::new(),
    }
}

#[derive(Debug, Clone)]
struct WorkspaceTreeStatusMatch {
    status: Option<String>,
    revision: Option<String>,
    file_size: Option<u64>,
    changed: bool,
}

fn workspace_tree_status_for_path(
    path: &str,
    status_by_path: &HashMap<String, &ChangedFile>,
) -> WorkspaceTreeStatusMatch {
    let normalized_path = normalize_tree_path(path);
    if let Some(file) = status_by_path.get(&normalized_path) {
        return WorkspaceTreeStatusMatch {
            status: Some(file.status.clone()),
            revision: file.revision.clone(),
            file_size: file.file_size,
            changed: true,
        };
    }

    let inside_unversioned_dir = normalized_path
        .split('/')
        .scan(String::new(), |prefix, part| {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            Some(prefix.clone())
        })
        .any(|prefix| {
            status_by_path
                .get(&prefix)
                .is_some_and(|file| file.status == "unversioned")
        });

    WorkspaceTreeStatusMatch {
        status: inside_unversioned_dir.then(|| "unversioned".to_string()),
        revision: None,
        file_size: None,
        changed: inside_unversioned_dir,
    }
}

fn add_missing_status_nodes(
    nodes: &mut Vec<WorkspaceFileNode>,
    status_by_path: &HashMap<String, &ChangedFile>,
) {
    for file in status_by_path.values() {
        let normalized_path = normalize_tree_path(&file.path);
        if normalized_path.is_empty() || tree_contains_path(nodes, &normalized_path) {
            continue;
        }

        insert_status_node(nodes, &normalized_path, file);
    }
}

fn tree_contains_path(nodes: &[WorkspaceFileNode], target: &str) -> bool {
    nodes.iter().any(|node| {
        normalize_tree_path(&node.path) == target || tree_contains_path(&node.children, target)
    })
}

fn insert_status_node(nodes: &mut Vec<WorkspaceFileNode>, path: &str, file: &ChangedFile) {
    let segments = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    insert_status_node_segments(nodes, path, &segments, "", file);
}

fn insert_status_node_segments(
    nodes: &mut Vec<WorkspaceFileNode>,
    full_path: &str,
    segments: &[&str],
    parent_path: &str,
    file: &ChangedFile,
) {
    let Some((segment, remaining_segments)) = segments.split_first() else {
        return;
    };

    if remaining_segments.is_empty() {
        nodes.push(WorkspaceFileNode {
            path: full_path.to_string(),
            name: (*segment).to_string(),
            kind: "file".to_string(),
            status: file.status.clone(),
            revision: file.revision.clone(),
            file_size: file.file_size,
            changed: true,
            children: Vec::new(),
        });
        return;
    }

    let directory_path = if parent_path.is_empty() {
        (*segment).to_string()
    } else {
        format!("{parent_path}/{segment}")
    };
    let index = nodes
        .iter()
        .position(|node| node.kind == "dir" && node.name == *segment)
        .unwrap_or_else(|| {
            nodes.push(WorkspaceFileNode {
                path: directory_path.clone(),
                name: (*segment).to_string(),
                kind: "dir".to_string(),
                status: "changed".to_string(),
                revision: None,
                file_size: None,
                changed: true,
                children: Vec::new(),
            });
            nodes.len() - 1
        });
    nodes[index].changed = true;
    nodes[index].status = "changed".to_string();
    insert_status_node_segments(
        &mut nodes[index].children,
        full_path,
        remaining_segments,
        &directory_path,
        file,
    );
}

fn sort_workspace_nodes(nodes: &mut [WorkspaceFileNode]) {
    nodes.sort_by(|left, right| {
        let left_is_file = left.kind == "file";
        let right_is_file = right.kind == "file";
        left_is_file
            .cmp(&right_is_file)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    for node in nodes {
        sort_workspace_nodes(&mut node.children);
    }
}

fn workspace_tree_relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .and_then(|relative| relative.to_str())
        .map(path_utils::normalize_relative_separators)
        .unwrap_or_else(|| path_utils::normalize_relative_separators(&path.display().to_string()))
}

fn normalize_tree_path(path: &str) -> String {
    path_utils::normalize_relative_separators(path)
        .trim_matches('/')
        .to_string()
}

fn should_skip_workspace_tree_entry(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".svn" | ".git" | "node_modules" | "target" | "dist"
    )
}

#[derive(Debug, Clone, Default)]
struct RevisionSummary {
    range: Option<String>,
    mixed: bool,
}

fn read_workspace_revision_summary(executable: &str, working_copy_root: &Path) -> RevisionSummary {
    let svnversion = svnversion_executable(executable);
    let Ok(output) = Command::new(svnversion).arg(working_copy_root).output() else {
        return RevisionSummary::default();
    };

    if !output.status.success() {
        return RevisionSummary::default();
    }

    parse_svnversion_output(&String::from_utf8_lossy(&output.stdout))
}

fn parse_svnversion_output(output: &str) -> RevisionSummary {
    let trimmed = output.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("exported") {
        return RevisionSummary::default();
    }

    let range = trimmed
        .trim_end_matches(|value| matches!(value, 'M' | 'S' | 'P' | 'U'))
        .to_string();

    let mixed = range.contains(':');

    RevisionSummary {
        range: Some(trimmed.to_string()),
        mixed,
    }
}

fn svnversion_executable(svn_executable: &str) -> String {
    let path = Path::new(svn_executable);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(svn_executable)
        .to_ascii_lowercase();

    let svnversion_name = if file_name.ends_with(".exe") {
        "svnversion.exe"
    } else {
        "svnversion"
    };

    if file_name == "svn" || file_name == "svn.exe" {
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            return parent.join(svnversion_name).display().to_string();
        }
    }

    svnversion_name.to_string()
}

fn display_status_path(raw_path: &str, working_copy_root: &Path) -> String {
    path_utils::strip_working_copy_prefix(raw_path, working_copy_root)
        .unwrap_or_else(|| path_utils::normalize_relative_separators(raw_path))
}

fn status_target_path(raw_path: &str, working_copy_root: &Path) -> PathBuf {
    let path = PathBuf::from(raw_path);
    if path_utils::is_absolute_or_windows_path(&path, raw_path) {
        path
    } else {
        working_copy_root.join(path)
    }
}

fn changed_file_digest(path: &Path, status: &str) -> String {
    let metadata = match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(metadata) => {
            return format!("meta:{status}:dir:{}", metadata.len());
        }
        Err(_) => {
            return format!("meta:{status}:missing");
        }
    };

    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => {
            return format!("meta:{status}:unreadable:{}", metadata.len());
        }
    };

    let mut reader = BufReader::new(file);
    let mut buffer = [0_u8; 8192];
    let mut hash = 0xcbf29ce484222325_u64;

    loop {
        let read = match reader.read(&mut buffer) {
            Ok(read) => read,
            Err(_) => {
                return format!("meta:{status}:read-error:{}", metadata.len());
            }
        };

        if read == 0 {
            break;
        }

        for byte in &buffer[..read] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }

    format!("fnv64:{status}:{}:{hash:016x}", metadata.len())
}

fn changed_file_size(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
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

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "WORKSPACE_PATH_INVALID",
            "工作副本路径无效",
            Some("工作副本路径不能包含控制字符。".to_string()),
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

    if path.is_file() {
        return path.parent().map(Path::to_path_buf).ok_or_else(|| {
            NovaError::command(
                "WORKSPACE_PATH_PARENT_MISSING",
                "无法从文件路径定位工作副本目录",
                Some(format!("路径：{}", path.display())),
                true,
            )
        });
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

fn parse_svn_log_xml(xml: &str, target: &str) -> Result<SvnLog, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "SVN_LOG_XML_PARSE_FAILED",
            "解析 SVN 日志失败",
            Some(format!("svn log --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;

    let mut entries = Vec::new();
    for logentry in document
        .descendants()
        .filter(|node| node.has_tag_name("logentry"))
    {
        let revision = logentry.attribute("revision").unwrap_or("").to_string();
        let author = optional_text_child(logentry, "author").unwrap_or_default();
        let date = optional_text_child(logentry, "date").unwrap_or_default();
        let message = optional_text_child(logentry, "msg").unwrap_or_default();
        let changed_paths = logentry
            .descendants()
            .filter(|node| node.has_tag_name("path"))
            .map(|path| SvnChangedPath {
                path: path.text().map(str::trim).unwrap_or("").to_string(),
                action: path.attribute("action").unwrap_or("").to_string(),
                kind: path.attribute("kind").unwrap_or("").to_string(),
                copy_from_path: path.attribute("copyfrom-path").map(ToString::to_string),
                copy_from_revision: path.attribute("copyfrom-rev").map(ToString::to_string),
            })
            .collect();

        entries.push(SvnLogEntry {
            revision,
            author,
            date,
            message,
            changed_paths,
        });
    }

    Ok(SvnLog {
        target: target.to_string(),
        entries,
        has_more: false,
        next_start_revision: None,
    })
}

fn parse_svn_property_names(xml: &str) -> Result<Vec<String>, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "SVN_PROPLIST_XML_PARSE_FAILED",
            "解析 SVN 属性列表失败",
            Some(format!("svn proplist --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;

    Ok(document
        .descendants()
        .filter(|node| node.has_tag_name("property"))
        .filter_map(|node| node.attribute("name"))
        .map(ToString::to_string)
        .collect())
}

fn get_svn_property_value(
    executable: &str,
    root: &Path,
    target: &Path,
    name: &str,
) -> Result<String, NovaError> {
    let output = Command::new(executable)
        .arg("propget")
        .arg(name)
        .arg(target)
        .current_dir(root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_PROPGET_FAILED",
                "无法读取 SVN 属性",
                Some(format!("执行 `{executable} propget {name}` 失败：{error}")),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_PROPGET_FAILED",
            "SVN 属性读取失败",
            Some(command_error_detail(executable, "propget", &output)),
            true,
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end_matches(['\r', '\n'])
        .to_string())
}

fn normalize_svn_property_name(name: &str) -> Result<String, NovaError> {
    let value = name.trim();
    if value.is_empty() {
        return Err(NovaError::command(
            "SVN_PROPERTY_NAME_INVALID",
            "属性名无效",
            Some("属性名不能为空。".to_string()),
            true,
        ));
    }

    if value.chars().any(char::is_control) {
        return Err(NovaError::command(
            "SVN_PROPERTY_NAME_INVALID",
            "属性名无效",
            Some("属性名不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(value.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SvnPropertyWriteOperation {
    Set,
    Delete,
}

impl SvnPropertyWriteOperation {
    fn command(self) -> &'static str {
        match self {
            SvnPropertyWriteOperation::Set => "propset",
            SvnPropertyWriteOperation::Delete => "propdel",
        }
    }

    fn error_code(self) -> &'static str {
        match self {
            SvnPropertyWriteOperation::Set => "SVN_PROPSET_FAILED",
            SvnPropertyWriteOperation::Delete => "SVN_PROPDEL_FAILED",
        }
    }

    fn error_message(self) -> &'static str {
        match self {
            SvnPropertyWriteOperation::Set => "无法设置 SVN 属性",
            SvnPropertyWriteOperation::Delete => "无法删除 SVN 属性",
        }
    }

    fn failed_message(self) -> &'static str {
        match self {
            SvnPropertyWriteOperation::Set => "SVN 属性设置失败",
            SvnPropertyWriteOperation::Delete => "SVN 属性删除失败",
        }
    }
}

fn svn_property_write_operation(value: &str) -> SvnPropertyWriteOperation {
    if value.trim().is_empty() {
        SvnPropertyWriteOperation::Delete
    } else {
        SvnPropertyWriteOperation::Set
    }
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

fn optional_text_child(node: roxmltree::Node<'_, '_>, tag_name: &str) -> Option<String> {
    node.children()
        .find(|child| child.has_tag_name(tag_name))
        .and_then(|child| child.text())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
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

fn command_error_detail(
    executable: &str,
    subcommand: &str,
    output: &std::process::Output,
) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !stderr.is_empty() {
        return format!("`{executable} {subcommand}` 返回失败：{stderr}");
    }

    if !stdout.is_empty() {
        return format!("`{executable} {subcommand}` 返回失败：{stdout}");
    }

    format!(
        "`{executable} {subcommand}` 返回退出码 {:?}，但没有输出。",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_workspace_info_xml() {
        let xml = r#"
<info>
  <entry path="C:\wc" revision="42">
    <url>https://example.com/svn/trunk</url>
    <repository><root>https://example.com/svn</root></repository>
    <wc-info><wcroot-abspath>C:\wc</wcroot-abspath></wc-info>
  </entry>
</info>
"#;

        let summary = parse_svn_info_xml(xml, Path::new("C:\\wc")).expect("info parses");

        assert_eq!(summary.revision, "42");
        assert_eq!(summary.repository_url, "https://example.com/svn/trunk");
        assert_eq!(summary.repository_root, "https://example.com/svn");
        assert_eq!(summary.working_copy_root, "C:\\wc");
    }

    #[test]
    fn parses_status_xml_with_conflict_lock_and_paging() {
        let xml = r#"
<status>
  <target path="C:\wc">
    <entry path="C:\wc\src\main.ts">
      <wc-status item="modified" props="none">
        <lock><owner>alice</owner><comment>editing</comment></lock>
      </wc-status>
    </entry>
    <entry path="C:\wc\src\feature.ts">
      <wc-status item="conflicted" props="none" />
      <tree-conflict operation="update" />
    </entry>
    <entry path="C:\wc\src\blocked.ts">
      <wc-status item="obstructed" props="none" />
    </entry>
    <entry path="C:\wc\docs\locked.txt">
      <wc-status item="normal" props="none" />
      <repos-status item="locked">
        <lock><owner>bob</owner><comment>remote lock</comment></lock>
      </repos-status>
    </entry>
  </target>
</status>
"#;

        let status = parse_svn_status_xml(
            xml,
            Path::new("C:\\wc"),
            0,
            10,
            parse_svnversion_output("41:42M"),
        )
        .expect("status parses");

        assert_eq!(status.total, 4);
        assert_eq!(status.revision_range.as_deref(), Some("41:42M"));
        assert!(status.mixed_revision);
        assert_eq!(status.modified, 1);
        assert_eq!(status.conflicted, 1);
        assert_eq!(status.obstructed, 1);
        assert_eq!(status.files[0].path, "src/main.ts");
        assert_eq!(status.files[0].lock_owner.as_deref(), Some("alice"));
        assert_eq!(
            status.files[1].conflict_kind.as_deref(),
            Some("tree:update")
        );
        assert!(status.files[2].abnormal);
        assert_eq!(status.files[3].status, "normal");
        assert_eq!(status.files[3].lock_state, "locked");
        assert_eq!(status.files[3].lock_owner.as_deref(), Some("bob"));
    }

    #[test]
    fn parses_status_xml_counts_core_svn_states() {
        let xml = r#"
<status>
  <target path="C:\wc">
    <entry path="C:\wc\src\main.rs">
      <wc-status item="modified" props="none" />
    </entry>
    <entry path="C:\wc\src\added.rs">
      <wc-status item="added" props="none" />
    </entry>
    <entry path="C:\wc\src\deleted.rs">
      <wc-status item="deleted" props="none" />
    </entry>
    <entry path="C:\wc\src\missing.rs">
      <wc-status item="missing" props="none" />
    </entry>
    <entry path="C:\wc\src\scratch.tmp">
      <wc-status item="unversioned" props="none" />
    </entry>
    <entry path="C:\wc\src\props.rs">
      <wc-status item="normal" props="modified" />
    </entry>
    <entry path="C:\wc\src\renamed.rs">
      <wc-status item="replaced" props="none">
        <moved-from>src/old.rs</moved-from>
      </wc-status>
    </entry>
  </target>
</status>
"#;

        let status = parse_svn_status_xml(
            xml,
            Path::new("C:\\wc"),
            0,
            100,
            parse_svnversion_output("42"),
        )
        .expect("status parses");

        assert_eq!(status.total, 7);
        assert_eq!(status.modified, 1);
        assert_eq!(status.added, 1);
        assert_eq!(status.deleted, 1);
        assert_eq!(status.missing, 1);
        assert_eq!(status.unversioned, 1);
        assert_eq!(status.property_changed, 1);
        assert_eq!(status.revision_range.as_deref(), Some("42"));
        assert!(!status.mixed_revision);
        assert!(status.files.iter().any(|file| {
            file.path == "src/props.rs"
                && file.status == "normal"
                && file.property_status.as_deref() == Some("modified")
                && file.property_changed
        }));
        assert!(status
            .files
            .iter()
            .any(|file| file.path == "src/renamed.rs" && file.status == "renamed"));
        assert!(status
            .files
            .iter()
            .find(|file| file.path == "src/missing.rs")
            .is_some_and(|file| file.abnormal));
    }

    #[test]
    fn builds_workspace_file_tree_with_changed_statuses() {
        let root =
            std::env::temp_dir().join(format!("novasvn-file-tree-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join(".svn")).unwrap();
        fs::write(root.join("src/main.rs"), "changed").unwrap();
        fs::write(root.join("src/lib.rs"), "normal").unwrap();
        fs::write(root.join(".svn/entries"), "internal").unwrap();

        let xml = format!(
            r#"
<status>
  <target path="{root}">
    <entry path="{root}\src\main.rs">
      <wc-status item="modified" props="none" />
    </entry>
    <entry path="{root}\docs\missing.md">
      <wc-status item="missing" props="none" />
    </entry>
  </target>
</status>
"#,
            root = root.display()
        );
        let status = parse_svn_status_xml(&xml, &root, 0, 100, parse_svnversion_output("42"))
            .expect("status parses");
        let status_by_path = status
            .files
            .iter()
            .map(|file| (normalize_tree_path(&file.path), file))
            .collect::<HashMap<_, _>>();
        let mut returned_files = 0;
        let mut total_files = 0;
        let mut truncated = false;
        let mut nodes = read_workspace_children(
            &root,
            &root,
            &status_by_path,
            100,
            &mut returned_files,
            &mut total_files,
            &mut truncated,
        )
        .expect("tree reads");
        add_missing_status_nodes(&mut nodes, &status_by_path);
        sort_workspace_nodes(&mut nodes);

        assert_eq!(total_files, 2);
        assert!(!truncated);
        assert!(nodes.iter().all(|node| node.name != ".svn"));
        let src = nodes.iter().find(|node| node.name == "src").unwrap();
        assert!(src.changed);
        assert!(src.children.iter().any(|node| {
            node.path == "src/main.rs" && node.status == "modified" && node.changed
        }));
        assert!(src
            .children
            .iter()
            .any(|node| { node.path == "src/lib.rs" && node.status == "normal" && !node.changed }));
        let docs = nodes.iter().find(|node| node.name == "docs").unwrap();
        assert!(docs.children.iter().any(|node| {
            node.path == "docs/missing.md" && node.status == "missing" && node.changed
        }));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn validates_workspace_svn_executable_values() {
        assert_eq!(normalize_svn_executable(None).unwrap(), "svn");
        assert_eq!(
            normalize_svn_executable(Some(" svn.exe ")).unwrap(),
            "svn.exe"
        );
        assert!(normalize_svn_executable(Some("C:\\Tools\\svn.exe")).is_ok());
        assert!(normalize_svn_executable(Some("tools\\svn.exe")).is_err());
        assert!(normalize_svn_executable(Some("svn\n")).is_err());
    }

    #[test]
    fn rejects_workspace_paths_with_control_characters() {
        let error = normalize_workspace_path("C:\\wc\nnext")
            .expect_err("workspace path with control characters must be rejected");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "WORKSPACE_PATH_INVALID");
            }
        }
    }

    #[test]
    fn accepts_file_paths_by_using_parent_directory() {
        let root = std::env::temp_dir().join(format!(
            "novasvn-workspace-file-path-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let file_path = root.join("selected.txt");
        fs::write(&file_path, "selected").unwrap();

        let normalized = normalize_workspace_path(&file_path.display().to_string()).unwrap();

        assert_eq!(normalized, root);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_relative_file_paths_with_control_characters() {
        let error = normalize_relative_file_path("src/main.rs\nnext")
            .expect_err("relative file path with control characters must be rejected");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "DIFF_PATH_INVALID");
            }
        }
    }

    #[test]
    fn parses_svn_log_xml_changed_paths() {
        let xml = r#"
<log>
  <logentry revision="7">
    <author>dev</author>
    <date>2026-01-01T00:00:00.000000Z</date>
    <paths><path action="M" kind="file">/trunk/a.txt</path></paths>
    <msg>change</msg>
  </logentry>
</log>
"#;

        let log = parse_svn_log_xml(xml, "wc").expect("log parses");

        assert_eq!(log.entries.len(), 1);
        assert_eq!(log.entries[0].revision, "7");
        assert_eq!(log.entries[0].changed_paths[0].action, "M");
    }

    #[test]
    fn trims_svn_log_page_and_sets_next_revision() {
        let xml = r#"
<log>
  <logentry revision="9"><msg>newest</msg></logentry>
  <logentry revision="8"><msg>middle</msg></logentry>
  <logentry revision="7"><msg>older</msg></logentry>
</log>
"#;

        let mut log = parse_svn_log_xml(xml, "wc").expect("log parses");
        trim_svn_log_page(&mut log, 2);

        assert_eq!(log.entries.len(), 2);
        assert!(log.has_more);
        assert_eq!(log.next_start_revision.as_deref(), Some("7"));
    }

    #[test]
    fn rejects_invalid_log_revision_cursor() {
        assert!(normalize_log_revision_value("42").is_ok());
        assert!(normalize_log_revision_value(" 42 ").is_ok());
        assert!(normalize_log_revision_value("").is_err());
        assert!(normalize_log_revision_value("42:0").is_err());
    }

    #[test]
    fn parses_property_names() {
        let xml = r#"
<properties>
  <target path=".">
    <property name="svn:externals"/>
    <property name="svn:ignore"/>
  </target>
</properties>
"#;

        let names = parse_svn_property_names(xml).expect("properties parse");

        assert_eq!(names, vec!["svn:externals", "svn:ignore"]);
    }

    #[test]
    fn validates_svn_property_names() {
        assert_eq!(
            normalize_svn_property_name(" svn:externals ").unwrap(),
            "svn:externals"
        );
        assert!(normalize_svn_property_name(" ").is_err());
        assert!(normalize_svn_property_name("svn:ignore\nnext").is_err());
    }
    #[test]
    fn chooses_property_delete_for_blank_values() {
        assert_eq!(
            svn_property_write_operation("ignored"),
            SvnPropertyWriteOperation::Set
        );
        assert_eq!(
            svn_property_write_operation(" \r\n\t "),
            SvnPropertyWriteOperation::Delete
        );
    }
}
