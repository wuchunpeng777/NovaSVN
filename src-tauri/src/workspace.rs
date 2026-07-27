use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    thread,
};

use quick_xml::{
    encoding::Decoder,
    escape::{resolve_xml_entity, unescape},
    events::{attributes::Attribute, Event},
    Reader as XmlReader,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    error::NovaError,
    executable::normalize_executable_setting,
    svn,
    task::{
        normalize_repository_list_revision, normalize_repository_url,
        repository_url_with_peg_revision,
    },
};

#[derive(Debug, Clone, Deserialize)]
pub struct OpenWorkspaceRequest {
    pub path: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InspectUpdateTargetRequest {
    pub path: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetSvnInfoRequest {
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
    pub scope_path: Option<String>,
    pub include_content_digests: Option<bool>,
    pub include_revision_summary: Option<bool>,
    pub include_unversioned: Option<bool>,
    pub svn_executable: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
    pub check_remote_updates: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateTargetSummary {
    pub target_path: String,
    pub working_copy_root: String,
    pub relative_path: Option<String>,
    pub repository_url: String,
    pub repository_root: String,
    pub revision: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnInfo {
    pub target_path: String,
    pub working_copy_root: String,
    pub relative_path: Option<String>,
    pub kind: String,
    pub repository_url: String,
    pub repository_root: String,
    pub repository_uuid: Option<String>,
    pub revision: String,
    pub last_changed_revision: Option<String>,
    pub last_changed_author: Option<String>,
    pub last_changed_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListWorkspaceFilesRequest {
    pub working_copy_root: String,
    pub svn_executable: Option<String>,
    pub max_files: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetWorkspacePathSizesRequest {
    pub working_copy_root: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspacePathSize {
    pub path: String,
    pub bytes: u64,
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
    pub remote_updates_checked: bool,
    pub repository_revision: Option<String>,
    pub local_changes: usize,
    pub remote_changes: usize,
    pub combined_changes: usize,
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
    pub changelist: Option<String>,
    pub revision: Option<String>,
    pub property_status: Option<String>,
    pub property_changed: bool,
    pub remote_status: Option<String>,
    pub remote_property_status: Option<String>,
    pub change_scope: ChangeScope,
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
    pub changelist: Option<String>,
    pub remote_status: Option<String>,
    pub remote_property_status: Option<String>,
    pub change_scope: ChangeScope,
    pub revision: Option<String>,
    pub base_revision: Option<String>,
    pub last_revision: Option<String>,
    pub last_changed_date: Option<String>,
    pub last_changed_author: Option<String>,
    pub file_size: Option<u64>,
    pub changed: bool,
    pub versioned: bool,
    pub children: Vec<WorkspaceFileNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeScope {
    None,
    Local,
    Remote,
    Both,
}

impl ChangeScope {
    fn from_changes(local: bool, remote: bool) -> Self {
        match (local, remote) {
            (true, true) => Self::Both,
            (true, false) => Self::Local,
            (false, true) => Self::Remote,
            (false, false) => Self::None,
        }
    }

    fn combine(self, other: Self) -> Self {
        Self::from_changes(
            matches!(self, Self::Local | Self::Both) || matches!(other, Self::Local | Self::Both),
            matches!(self, Self::Remote | Self::Both) || matches!(other, Self::Remote | Self::Both),
        )
    }
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
pub struct ResolveTextConflictRequest {
    pub working_copy_root: String,
    pub file_path: String,
    pub resolved_text: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetRevisionFileContentDiffRequest {
    pub target_url: String,
    pub file_path: String,
    pub left_revision: String,
    pub right_revision: String,
    pub action: String,
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
pub struct GetPathSvnLogRequest {
    pub path: String,
    pub svn_executable: Option<String>,
    pub limit: Option<usize>,
    pub start_revision: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetRepositoryFileLogRequest {
    pub url: String,
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
    pub limit: Option<usize>,
    pub start_revision: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetSvnBlameRequest {
    pub working_copy_root: String,
    pub file_path: String,
    pub svn_executable: Option<String>,
    pub max_lines: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetRepositoryFileBlameRequest {
    pub url: String,
    pub revision: Option<String>,
    pub svn_executable: Option<String>,
    pub max_lines: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetSvnPropertiesRequest {
    pub working_copy_root: String,
    pub file_path: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetRepositoryFilePropertiesRequest {
    pub url: String,
    pub revision: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
pub struct IgnoreWorkspacePathRequest {
    pub working_copy_root: String,
    pub file_path: String,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetWorkspaceChangelistRequest {
    pub working_copy_root: String,
    pub file_paths: Vec<String>,
    pub changelist: Option<String>,
    pub svn_executable: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceChangelistResult {
    pub changelist: Option<String>,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDiff {
    pub path: String,
    pub node_kind: String,
    pub text: String,
    pub binary: bool,
    pub empty: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileContentDiff {
    pub path: String,
    pub node_kind: String,
    pub original_text: String,
    pub modified_text: String,
    pub language: String,
    pub binary: bool,
    pub too_large: bool,
    pub max_bytes: u64,
    pub is_image: bool,
    pub image_mime: Option<String>,
    pub original_bytes_base64: Option<String>,
    pub modified_bytes_base64: Option<String>,
    pub original_byte_size: u64,
    pub modified_byte_size: u64,
}

impl FileContentDiff {
    fn empty_text(path: String, node_kind: String, max_bytes: u64) -> Self {
        Self {
            path,
            node_kind,
            original_text: String::new(),
            modified_text: String::new(),
            language: "plaintext".to_string(),
            binary: false,
            too_large: false,
            max_bytes,
            is_image: false,
            image_mime: None,
            original_bytes_base64: None,
            modified_bytes_base64: None,
            original_byte_size: 0,
            modified_byte_size: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolveTextConflictResult {
    pub path: String,
    pub resolved: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnLog {
    pub target: String,
    pub working_copy_root: Option<String>,
    pub working_copy_revision: Option<String>,
    pub repository_root: Option<String>,
    pub repository_url: Option<String>,
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
pub struct SvnBlame {
    pub target: String,
    pub language: String,
    pub lines: Vec<SvnBlameLine>,
    pub total_lines: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SvnBlameLine {
    pub line_number: usize,
    pub revision: String,
    pub author: String,
    pub date: String,
    pub content: String,
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
    let summary = read_workspace_summary(&path, &executable)?;
    save_recent_workspace(app, &summary)?;
    Ok(summary)
}

pub fn inspect_update_target(
    request: InspectUpdateTargetRequest,
) -> Result<UpdateTargetSummary, NovaError> {
    let target = normalize_update_target_path(&request.path)?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let summary = read_workspace_summary(&target, &executable)?;
    let canonical_target = fs::canonicalize(&target).map_err(|error| {
        NovaError::command(
            "UPDATE_TARGET_RESOLVE_FAILED",
            "无法解析 Update 目标",
            Some(format!("路径：{}；错误：{error}", target.display())),
            true,
        )
    })?;
    let canonical_root = fs::canonicalize(&summary.working_copy_root).map_err(|error| {
        NovaError::command(
            "UPDATE_WORKSPACE_ROOT_RESOLVE_FAILED",
            "无法解析 Update 工作副本",
            Some(format!(
                "路径：{}；错误：{error}",
                summary.working_copy_root
            )),
            true,
        )
    })?;
    let relative_path = canonical_target
        .strip_prefix(&canonical_root)
        .map_err(|_| {
            NovaError::command(
                "UPDATE_TARGET_OUTSIDE_WORKSPACE",
                "Update 目标不在工作副本内",
                Some(format!(
                    "目标：{}；工作副本：{}",
                    canonical_target.display(),
                    canonical_root.display()
                )),
                true,
            )
        })?
        .to_str()
        .ok_or_else(|| {
            NovaError::command(
                "UPDATE_TARGET_ENCODING_INVALID",
                "Update 目标路径编码无效",
                Some(format!("路径：{}", canonical_target.display())),
                true,
            )
        })?
        .trim_matches(['/', '\\'])
        .to_string();

    Ok(UpdateTargetSummary {
        target_path: target.display().to_string(),
        working_copy_root: summary.working_copy_root,
        relative_path: (!relative_path.is_empty())
            .then(|| normalize_runtime_separators(&relative_path)),
        repository_url: summary.repository_url,
        repository_root: summary.repository_root,
        revision: summary.revision,
        kind: if target.is_dir() {
            "dir".to_string()
        } else {
            "file".to_string()
        },
    })
}

pub fn get_svn_info(request: GetSvnInfoRequest) -> Result<SvnInfo, NovaError> {
    let target = normalize_standalone_target_path(
        &request.path,
        "SVN_INFO_TARGET_INVALID",
        "SVN_INFO_TARGET_NOT_ABSOLUTE",
        "SVN_INFO_TARGET_NOT_FOUND",
        "SVN_INFO_TARGET_UNSUPPORTED",
        "SVN Info 目标",
    )?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let output = svn::command(&executable)
        .args(["info", "--xml", "--"])
        .arg(&target)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_INFO_FAILED",
                "无法读取 SVN 信息",
                Some(format!(
                    "执行 `svn info --xml {}` 失败：{error}",
                    target.display()
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_INFO_FAILED",
            "无法读取 SVN 信息",
            Some(svn_info_error_detail(&executable, &target, &output)),
            true,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    parse_svn_info_details_xml(&xml, &target)
}

fn read_workspace_summary(path: &Path, executable: &str) -> Result<WorkspaceSummary, NovaError> {
    let output = svn::command(executable)
        .args(["info", "--xml"])
        .arg(path)
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
            Some(svn_info_error_detail(executable, path, &output)),
            true,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    parse_svn_info_xml(&xml, path)
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
    let workspace = read_workspace_summary(&target, &executable)?;
    let working_copy_revision =
        read_log_working_copy_revision(&executable, &target, &workspace.revision);
    let limit = request.limit.unwrap_or(50).clamp(1, 200);
    let start_revision = request
        .start_revision
        .as_deref()
        .map(normalize_log_revision_value)
        .transpose()?;
    let display_target = display_status_path(&target.display().to_string(), &root);
    let mut log = run_svn_log(
        &executable,
        &target,
        &root,
        &display_target,
        limit,
        start_revision.as_deref(),
    )?;
    log.working_copy_root = Some(workspace.working_copy_root);
    log.working_copy_revision = Some(working_copy_revision);
    log.repository_root = Some(workspace.repository_root);
    log.repository_url = Some(workspace.repository_url);
    Ok(log)
}

pub fn get_path_svn_log(request: GetPathSvnLogRequest) -> Result<SvnLog, NovaError> {
    let target = normalize_svn_log_target_path(&request.path)?;
    let current_dir = if target.is_dir() {
        target.clone()
    } else {
        target.parent().map(Path::to_path_buf).ok_or_else(|| {
            NovaError::command(
                "SVN_LOG_TARGET_PARENT_MISSING",
                "无法定位日志目标所在目录",
                Some(format!("路径：{}", target.display())),
                true,
            )
        })?
    };
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let workspace = read_workspace_summary(&target, &executable)?;
    let working_copy_revision =
        read_log_working_copy_revision(&executable, &target, &workspace.revision);
    let limit = request.limit.unwrap_or(50).clamp(1, 200);
    let start_revision = request
        .start_revision
        .as_deref()
        .map(normalize_log_revision_value)
        .transpose()?;
    let display_target = target.display().to_string();
    let mut log = run_svn_log(
        &executable,
        &target,
        &current_dir,
        &display_target,
        limit,
        start_revision.as_deref(),
    )?;
    log.working_copy_root = Some(workspace.working_copy_root);
    log.working_copy_revision = Some(working_copy_revision);
    log.repository_root = Some(workspace.repository_root);
    log.repository_url = Some(workspace.repository_url);
    Ok(log)
}

fn run_svn_log(
    executable: &str,
    target: &Path,
    current_dir: &Path,
    display_target: &str,
    limit: usize,
    start_revision: Option<&str>,
) -> Result<SvnLog, NovaError> {
    let mut command = svn::command(executable);
    command
        .args(["log", "--xml", "--verbose", "--limit"])
        .arg((limit + 1).to_string());
    let revision = start_revision.unwrap_or("HEAD");
    command.arg("-r").arg(format!("{revision}:0"));
    command.arg("--").arg(target).current_dir(current_dir);

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
            Some(command_error_detail(executable, "log", &output)),
            true,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    let mut log = parse_svn_log_xml(&xml, display_target)?;
    trim_svn_log_page(&mut log, limit);
    Ok(log)
}

pub fn get_repository_file_log(request: GetRepositoryFileLogRequest) -> Result<SvnLog, NovaError> {
    let url = normalize_repository_url(&request.url)?;
    let revision = normalize_repository_list_revision(request.revision.as_deref())?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let limit = request.limit.unwrap_or(50).clamp(1, 200);
    let start_revision = request
        .start_revision
        .as_deref()
        .map(normalize_log_revision_value)
        .transpose()?;
    if let (Some(start_revision), Some(revision)) = (start_revision.as_deref(), revision.as_deref())
    {
        let start_revision_number = start_revision.parse::<u64>().unwrap_or(u64::MAX);
        let revision_number = revision.parse::<u64>().unwrap_or(0);
        if start_revision_number > revision_number {
            return Err(NovaError::command(
                "REPOSITORY_FILE_LOG_START_AFTER_REVISION",
                "仓库文件日志分页 Revision 无效",
                Some("分页起点不能晚于当前仓库历史快照。".to_string()),
                true,
            ));
        }
    }
    let effective_start_revision = start_revision.as_deref().or(revision.as_deref());
    let command_target = repository_url_with_peg_revision(&url, revision.as_deref());
    let mut command = svn::command(&executable);
    command
        .args(["log", "--xml", "--verbose", "--limit"])
        .arg((limit + 1).to_string());
    if let Some(start_revision) = effective_start_revision {
        command.arg("-r").arg(format!("{start_revision}:0"));
    }
    command.arg("--").arg(command_target);

    let output = command.output().map_err(|error| {
        NovaError::command(
            "REPOSITORY_FILE_LOG_FAILED",
            "无法读取仓库文件日志",
            Some(format!(
                "执行 `{executable} log --xml --verbose --limit {}` 失败：{error}",
                limit + 1
            )),
            true,
        )
    })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "REPOSITORY_FILE_LOG_COMMAND_FAILED",
            "仓库文件日志读取失败",
            Some(command_error_detail(&executable, "log", &output)),
            true,
        ));
    }

    let xml = String::from_utf8_lossy(&output.stdout);
    let mut log = parse_svn_log_xml(&xml, &url)?;
    log.repository_url = Some(url);
    trim_svn_log_page(&mut log, limit);
    Ok(log)
}

pub fn get_svn_blame(request: GetSvnBlameRequest) -> Result<SvnBlame, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let file_path = normalize_relative_file_path(&request.file_path)?;
    let target = root.join(&file_path);
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let max_lines = request.max_lines.unwrap_or(5000).clamp(1, 20000);

    let blame_output = svn::command(&executable)
        .args(["blame", "--xml"])
        .arg(&target)
        .current_dir(&root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_BLAME_FAILED",
                "无法读取文件 Blame",
                Some(format!("执行 `{executable} blame --xml` 失败：{error}")),
                true,
            )
        })?;

    if !blame_output.status.success() {
        return Err(NovaError::command(
            "SVN_BLAME_COMMAND_FAILED",
            "文件 Blame 读取失败",
            Some(command_error_detail(&executable, "blame", &blame_output)),
            true,
        ));
    }

    let content_output = svn::command(&executable)
        .args(["cat", "-r", "BASE"])
        .arg(&target)
        .current_dir(&root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_BLAME_CAT_FAILED",
                "无法读取 Blame 对应的文件内容",
                Some(format!("执行 `{executable} cat -r BASE` 失败：{error}")),
                true,
            )
        })?;

    if !content_output.status.success() {
        return Err(NovaError::command(
            "SVN_BLAME_CAT_COMMAND_FAILED",
            "Blame 文件内容读取失败",
            Some(command_error_detail(&executable, "cat", &content_output)),
            true,
        ));
    }

    let xml = String::from_utf8(blame_output.stdout).map_err(|error| {
        NovaError::command(
            "SVN_BLAME_XML_ENCODING_INVALID",
            "解析 SVN Blame 失败",
            Some(format!("svn blame --xml 返回了无效 UTF-8：{error}")),
            true,
        )
    })?;
    let content = String::from_utf8(content_output.stdout).map_err(|_| {
        NovaError::command(
            "SVN_BLAME_BINARY_UNSUPPORTED",
            "该文件不是可显示的 UTF-8 文本",
            Some("Blame 目前仅支持 UTF-8 文本文件。".to_string()),
            true,
        )
    })?;

    parse_svn_blame_xml(&xml, &content, &file_path, max_lines)
}

pub fn get_repository_file_blame(
    request: GetRepositoryFileBlameRequest,
) -> Result<SvnBlame, NovaError> {
    let url = normalize_repository_url(&request.url)?;
    let revision = normalize_repository_list_revision(request.revision.as_deref())?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let max_lines = request.max_lines.unwrap_or(5000).clamp(1, 20000);
    let command_target = repository_url_with_peg_revision(&url, revision.as_deref());

    let mut blame_command = svn::command(&executable);
    blame_command.args(["blame", "--xml"]);
    if let Some(revision) = revision.as_deref() {
        blame_command.arg("-r").arg(format!("1:{revision}"));
    }
    let blame_output = blame_command
        .arg("--")
        .arg(&command_target)
        .output()
        .map_err(|error| {
            NovaError::command(
                "REPOSITORY_FILE_BLAME_FAILED",
                "无法读取仓库文件 Blame",
                Some(format!("执行 `{executable} blame --xml` 失败：{error}")),
                true,
            )
        })?;
    if !blame_output.status.success() {
        return Err(NovaError::command(
            "REPOSITORY_FILE_BLAME_COMMAND_FAILED",
            "仓库文件 Blame 读取失败",
            Some(command_error_detail(&executable, "blame", &blame_output)),
            true,
        ));
    }

    let mut content_command = svn::command(&executable);
    content_command.arg("cat");
    if let Some(revision) = revision.as_deref() {
        content_command.args(["-r", revision]);
    }
    let content_output = content_command
        .arg("--")
        .arg(&command_target)
        .output()
        .map_err(|error| {
            NovaError::command(
                "REPOSITORY_FILE_BLAME_CAT_FAILED",
                "无法读取仓库 Blame 对应的文件内容",
                Some(format!("执行 `{executable} cat` 失败：{error}")),
                true,
            )
        })?;
    if !content_output.status.success() {
        return Err(NovaError::command(
            "REPOSITORY_FILE_BLAME_CAT_COMMAND_FAILED",
            "仓库 Blame 文件内容读取失败",
            Some(command_error_detail(&executable, "cat", &content_output)),
            true,
        ));
    }

    let xml = String::from_utf8(blame_output.stdout).map_err(|error| {
        NovaError::command(
            "REPOSITORY_FILE_BLAME_XML_ENCODING_INVALID",
            "解析仓库文件 Blame 失败",
            Some(format!("svn blame --xml 返回了无效 UTF-8：{error}")),
            true,
        )
    })?;
    let content = String::from_utf8(content_output.stdout).map_err(|_| {
        NovaError::command(
            "REPOSITORY_FILE_BLAME_BINARY_UNSUPPORTED",
            "该仓库文件不是可显示的 UTF-8 文本",
            Some("Repository Blame 目前仅支持 UTF-8 文本文件。".to_string()),
            true,
        )
    })?;

    parse_svn_blame_xml(&xml, &content, &url, max_lines)
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

    let output = svn::command(&executable)
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

pub fn get_repository_file_properties(
    request: GetRepositoryFilePropertiesRequest,
) -> Result<SvnProperties, NovaError> {
    let url = normalize_repository_url(&request.url)?;
    let revision = normalize_repository_list_revision(request.revision.as_deref())?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let command_target = repository_url_with_peg_revision(&url, revision.as_deref());
    let mut command = svn::command(&executable);
    command.args(["proplist", "--xml", "--verbose"]);
    if let Some(revision) = revision.as_deref() {
        command.args(["-r", revision]);
    }
    let output = command
        .arg("--")
        .arg(command_target)
        .output()
        .map_err(|error| {
            NovaError::command(
                "REPOSITORY_FILE_PROPERTIES_FAILED",
                "无法读取仓库文件 Properties",
                Some(format!(
                    "执行 `{executable} proplist --xml --verbose` 失败：{error}"
                )),
                true,
            )
        })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "REPOSITORY_FILE_PROPERTIES_COMMAND_FAILED",
            "仓库文件 Properties 读取失败",
            Some(command_error_detail(&executable, "proplist", &output)),
            true,
        ));
    }

    let xml = String::from_utf8(output.stdout).map_err(|error| {
        NovaError::command(
            "REPOSITORY_FILE_PROPERTIES_XML_ENCODING_INVALID",
            "解析仓库文件 Properties 失败",
            Some(format!("svn proplist --xml 返回了无效 UTF-8：{error}")),
            true,
        )
    })?;
    parse_repository_properties_xml(&xml, &url)
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

    let mut command = svn::command(&executable);
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

pub fn ignore_workspace_path(
    request: IgnoreWorkspacePathRequest,
) -> Result<SvnProperties, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let file_path = normalize_relative_file_path(&request.file_path)?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let target = root.join(&file_path);
    let (parent_path, pattern) = file_path
        .rsplit_once('/')
        .map(|(parent, name)| (Some(parent.to_string()), name.to_string()))
        .unwrap_or_else(|| (None, file_path.clone()));
    let parent_target = parent_path
        .as_deref()
        .map(|parent| root.join(parent))
        .unwrap_or_else(|| root.clone());
    let parent_info = svn::command(&executable)
        .args(["info", "--xml"])
        .arg(&parent_target)
        .current_dir(&root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_IGNORE_PARENT_STATUS_FAILED",
                "无法确认 Ignore 规则作用目录",
                Some(format!("执行 `{executable} info --xml` 失败：{error}")),
                true,
            )
        })?;
    if !parent_info.status.success() {
        return Err(NovaError::command(
            "SVN_IGNORE_PARENT_NOT_VERSIONED",
            "Ignore 规则作用目录未纳入版本控制",
            Some(format!(
                "作用目录：{}。{}",
                display_status_path(&parent_target.display().to_string(), &root),
                command_error_detail(&executable, "info --xml", &parent_info)
            )),
            true,
        ));
    }
    let parent_info_xml = String::from_utf8_lossy(&parent_info.stdout);
    let parent_summary = parse_svn_info_xml(&parent_info_xml, &parent_target).map_err(|error| {
        NovaError::command(
            "SVN_IGNORE_PARENT_STATUS_INVALID",
            "Ignore 规则作用目录信息无法解析",
            Some(error.to_string()),
            true,
        )
    })?;
    let canonical_root = fs::canonicalize(&root).map_err(|error| {
        NovaError::command(
            "SVN_IGNORE_ROOT_INVALID",
            "无法确认当前工作副本根目录",
            Some(format!("路径：{}。错误：{error}", root.display())),
            true,
        )
    })?;
    let canonical_parent_root =
        fs::canonicalize(&parent_summary.working_copy_root).map_err(|error| {
            NovaError::command(
                "SVN_IGNORE_PARENT_ROOT_INVALID",
                "无法确认 Ignore 规则作用目录所属工作副本",
                Some(format!(
                    "SVN 返回：{}。错误：{error}",
                    parent_summary.working_copy_root
                )),
                true,
            )
        })?;
    if canonical_parent_root != canonical_root {
        return Err(NovaError::command(
            "SVN_IGNORE_PARENT_OUTSIDE_WORKING_COPY",
            "Ignore 规则作用目录不属于当前工作副本",
            Some(format!(
                "当前工作副本：{}。作用目录所属工作副本：{}。",
                canonical_root.display(),
                canonical_parent_root.display()
            )),
            true,
        ));
    }
    let status_output = svn::command(&executable)
        .args(["status", "--xml", "--no-ignore"])
        .arg(&target)
        .current_dir(&root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "SVN_IGNORE_STATUS_FAILED",
                "无法确认 Ignore 目标状态",
                Some(format!(
                    "执行 `{executable} status --xml --no-ignore` 失败：{error}"
                )),
                true,
            )
        })?;
    if !status_output.status.success() {
        return Err(NovaError::command(
            "SVN_IGNORE_STATUS_FAILED",
            "Ignore 目标状态读取失败",
            Some(command_error_detail(
                &executable,
                "status --xml --no-ignore",
                &status_output,
            )),
            true,
        ));
    }
    let status_xml = String::from_utf8_lossy(&status_output.stdout);
    let document = Document::parse(&status_xml).map_err(|error| {
        NovaError::command(
            "SVN_IGNORE_STATUS_INVALID",
            "Ignore 目标状态无法解析",
            Some(format!("svn status --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;
    let item = document
        .descendants()
        .find(|node| node.has_tag_name("wc-status"))
        .and_then(|node| node.attribute("item"))
        .ok_or_else(|| {
            NovaError::command(
                "SVN_IGNORE_TARGET_NOT_UNVERSIONED",
                "Ignore 目标不是未版本控制路径",
                Some(format!("路径：{file_path}")),
                true,
            )
        })?;
    if item == "ignored" {
        return Err(NovaError::command(
            "SVN_IGNORE_ALREADY_IGNORED",
            "目标已经被 Ignore",
            Some(format!("路径：{file_path}")),
            true,
        ));
    }
    if item != "unversioned" {
        return Err(NovaError::command(
            "SVN_IGNORE_TARGET_NOT_UNVERSIONED",
            "只能 Ignore 未版本控制路径",
            Some(format!("路径：{file_path}；当前状态：{item}")),
            true,
        ));
    }

    let properties = get_svn_properties(GetSvnPropertiesRequest {
        working_copy_root: request.working_copy_root.clone(),
        file_path: parent_path.clone(),
        svn_executable: Some(executable.clone()),
    })?;
    let current_value = properties
        .properties
        .iter()
        .find(|property| property.name == "svn:ignore")
        .map(|property| property.value.as_str())
        .unwrap_or("");
    if current_value.lines().any(|line| line == pattern) {
        return Err(NovaError::command(
            "SVN_IGNORE_RULE_EXISTS",
            "父目录已经包含相同的 Ignore 规则",
            Some(format!("作用目录：{}；规则：{pattern}", properties.target)),
            true,
        ));
    }
    let value = if current_value.is_empty() {
        pattern
    } else if current_value.ends_with('\n') {
        format!("{current_value}{pattern}")
    } else {
        format!("{current_value}\n{pattern}")
    };

    set_svn_property(SetSvnPropertyRequest {
        working_copy_root: request.working_copy_root,
        file_path: parent_path,
        name: "svn:ignore".to_string(),
        value,
        svn_executable: Some(executable),
    })
}

pub fn get_file_diff(request: GetFileDiffRequest) -> Result<FileDiff, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let file_path = normalize_relative_file_path(&request.file_path)?;
    let target = root.join(&file_path);
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let node_kind = read_diff_target_kind(&executable, &root, &target);

    let output = svn::command(&executable)
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
        path: file_path,
        node_kind,
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
    let max_bytes = request.max_bytes.unwrap_or(20 * 1024 * 1024);
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let node_kind = read_diff_target_kind(&executable, &root, &target);

    if node_kind == "dir" {
        return Ok(FileContentDiff::empty_text(file_path, node_kind, max_bytes));
    }

    if is_previewable_image(&file_path) {
        let working = read_limited_bytes_file(&target, max_bytes)?;
        let original = read_svn_base_bytes(&executable, &root, &target, max_bytes)?;
        return Ok(build_image_content_diff(
            file_path,
            node_kind,
            &original,
            &working,
            max_bytes,
        ));
    }

    let working = read_limited_text_file(&target, max_bytes)?;
    let original = read_svn_base_text(&executable, &root, &target, max_bytes)?;
    let binary = working.binary || original.binary;
    let too_large = working.too_large || original.too_large;
    let language = language_for_path(&file_path);

    Ok(FileContentDiff {
        path: file_path,
        node_kind,
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
        language,
        binary,
        too_large,
        max_bytes,
        is_image: false,
        image_mime: None,
        original_bytes_base64: None,
        modified_bytes_base64: None,
        original_byte_size: 0,
        modified_byte_size: 0,
    })
}

fn read_diff_target_kind(executable: &str, root: &Path, target: &Path) -> String {
    if let Ok(metadata) = fs::metadata(target) {
        return if metadata.is_dir() { "dir" } else { "file" }.to_string();
    }

    let Ok(output) = svn::command(executable)
        .args(["info", "--xml"])
        .arg(target)
        .current_dir(root)
        .output()
    else {
        return "file".to_string();
    };
    if !output.status.success() {
        return "file".to_string();
    }

    Document::parse(&String::from_utf8_lossy(&output.stdout))
        .ok()
        .and_then(|document| {
            document
                .descendants()
                .find(|node| node.has_tag_name("entry"))
                .and_then(|entry| entry.attribute("kind"))
                .filter(|kind| matches!(*kind, "file" | "dir"))
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "file".to_string())
}

pub fn resolve_text_conflict(
    request: ResolveTextConflictRequest,
) -> Result<ResolveTextConflictResult, NovaError> {
    const MAX_RESOLVED_TEXT_BYTES: usize = 2 * 1024 * 1024;

    let root = normalize_workspace_path(&request.working_copy_root)?;
    let file_path = normalize_relative_file_path(&request.file_path)?;
    let target = root.join(&file_path);
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;

    if request.resolved_text.len() > MAX_RESOLVED_TEXT_BYTES {
        return Err(NovaError::command(
            "CONFLICT_RESOLUTION_TOO_LARGE",
            "冲突解决结果过大",
            Some(format!(
                "合并结果不能超过 {} MiB。",
                MAX_RESOLVED_TEXT_BYTES / 1024 / 1024
            )),
            true,
        ));
    }

    let canonical_root = fs::canonicalize(&root).map_err(|error| {
        NovaError::command(
            "CONFLICT_WORKSPACE_CANONICALIZE_FAILED",
            "无法确认冲突文件所属工作副本",
            Some(format!("工作副本：{}。错误：{error}", root.display())),
            true,
        )
    })?;
    let canonical_target = fs::canonicalize(&target).map_err(|error| {
        NovaError::command(
            "CONFLICT_FILE_NOT_FOUND",
            "冲突文件不存在",
            Some(format!("文件：{}。错误：{error}", target.display())),
            true,
        )
    })?;
    let metadata = fs::symlink_metadata(&target).map_err(|error| {
        NovaError::command(
            "CONFLICT_FILE_METADATA_FAILED",
            "无法读取冲突文件信息",
            Some(format!("文件：{}。错误：{error}", target.display())),
            true,
        )
    })?;
    if !canonical_target.starts_with(&canonical_root)
        || !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
    {
        return Err(NovaError::command(
            "CONFLICT_FILE_UNSAFE",
            "冲突文件不允许写入",
            Some("只能解决当前工作副本内的普通文件。".to_string()),
            true,
        ));
    }

    let status_output = svn::command(&executable)
        .args(["status", "--xml", "--"])
        .arg(&canonical_target)
        .current_dir(&canonical_root)
        .output()
        .map_err(|error| {
            NovaError::command(
                "CONFLICT_STATUS_FAILED",
                "无法确认文件冲突状态",
                Some(format!("执行 `{executable} status --xml` 失败：{error}")),
                true,
            )
        })?;
    if !status_output.status.success() {
        return Err(NovaError::command(
            "CONFLICT_STATUS_COMMAND_FAILED",
            "文件冲突状态读取失败",
            Some(command_error_detail(
                &executable,
                "status --xml",
                &status_output,
            )),
            true,
        ));
    }
    let status_xml = String::from_utf8_lossy(&status_output.stdout);
    if !parse_text_conflict_status(&status_xml)? {
        return Err(NovaError::command(
            "CONFLICT_STATUS_STALE",
            "文件已不再处于文本冲突状态",
            Some("请刷新工作副本后重新选择冲突文件。".to_string()),
            true,
        ));
    }

    let original = fs::read(&canonical_target).map_err(|error| {
        NovaError::command(
            "CONFLICT_FILE_READ_FAILED",
            "无法备份冲突文件",
            Some(format!(
                "文件：{}。错误：{error}",
                canonical_target.display()
            )),
            true,
        )
    })?;
    fs::write(&canonical_target, request.resolved_text.as_bytes()).map_err(|error| {
        NovaError::command(
            "CONFLICT_FILE_WRITE_FAILED",
            "无法保存冲突解决结果",
            Some(format!(
                "文件：{}。错误：{error}",
                canonical_target.display()
            )),
            true,
        )
    })?;

    let resolve_output = svn::command(&executable)
        .args(["resolve", "--accept", "working", "--"])
        .arg(&canonical_target)
        .current_dir(&canonical_root)
        .output();
    match resolve_output {
        Ok(output) if output.status.success() => Ok(ResolveTextConflictResult {
            path: file_path,
            resolved: true,
        }),
        Ok(output) => {
            let restore_error = fs::write(&canonical_target, &original).err();
            let mut detail = command_error_detail(&executable, "resolve --accept working", &output);
            if let Some(error) = restore_error {
                detail.push_str(&format!("；恢复原冲突内容失败：{error}"));
            }
            Err(NovaError::command(
                "CONFLICT_RESOLVE_COMMAND_FAILED",
                "SVN 未能标记冲突已解决",
                Some(detail),
                true,
            ))
        }
        Err(error) => {
            let restore_error = fs::write(&canonical_target, &original).err();
            let mut detail = format!("执行 `{executable} resolve --accept working` 失败：{error}");
            if let Some(error) = restore_error {
                detail.push_str(&format!("；恢复原冲突内容失败：{error}"));
            }
            Err(NovaError::command(
                "CONFLICT_RESOLVE_FAILED",
                "无法执行 SVN 冲突解决命令",
                Some(detail),
                true,
            ))
        }
    }
}

fn parse_text_conflict_status(xml: &str) -> Result<bool, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "CONFLICT_STATUS_XML_PARSE_FAILED",
            "解析文件冲突状态失败",
            Some(format!("svn status --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;
    Ok(document
        .descendants()
        .any(|node| node.has_tag_name("wc-status") && node.attribute("item") == Some("conflicted")))
}

pub fn get_revision_file_content_diff(
    request: GetRevisionFileContentDiffRequest,
) -> Result<FileContentDiff, NovaError> {
    let target_url = normalize_repository_url(&request.target_url)?;
    let file_path = normalize_revision_diff_path(&request.file_path)?;
    let left_revision = normalize_revision_diff_revision(&request.left_revision)?;
    let right_revision = normalize_revision_diff_revision(&request.right_revision)?;
    let action = request.action.trim().to_ascii_uppercase();
    let max_bytes = request.max_bytes.unwrap_or(20 * 1024 * 1024);
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;

    if is_previewable_image(&file_path) {
        let original = if action == "A" {
            LimitedBytes::empty()
        } else {
            read_repository_revision_bytes(&executable, &target_url, &left_revision, max_bytes)?
        };
        let modified = if action == "D" {
            LimitedBytes::empty()
        } else {
            read_repository_revision_bytes(&executable, &target_url, &right_revision, max_bytes)?
        };
        return Ok(build_image_content_diff(
            file_path,
            "file".to_string(),
            &original,
            &modified,
            max_bytes,
        ));
    }

    let original = if action == "A" {
        LimitedText::empty()
    } else {
        read_repository_revision_text(&executable, &target_url, &left_revision, max_bytes)?
    };
    let modified = if action == "D" {
        LimitedText::empty()
    } else {
        read_repository_revision_text(&executable, &target_url, &right_revision, max_bytes)?
    };
    let binary = original.binary || modified.binary;
    let too_large = original.too_large || modified.too_large;

    Ok(FileContentDiff {
        path: file_path.clone(),
        node_kind: "file".to_string(),
        original_text: if binary || too_large {
            String::new()
        } else {
            original.text
        },
        modified_text: if binary || too_large {
            String::new()
        } else {
            modified.text
        },
        language: language_for_path(&file_path),
        binary,
        too_large,
        max_bytes,
        is_image: false,
        image_mime: None,
        original_bytes_base64: None,
        modified_bytes_base64: None,
        original_byte_size: 0,
        modified_byte_size: 0,
    })
}

pub fn scan_workspace_status(
    request: ScanWorkspaceStatusRequest,
) -> Result<WorkingCopyStatus, NovaError> {
    let root = normalize_workspace_path(&request.working_copy_root)?;
    let scope_path = request
        .scope_path
        .as_deref()
        .map(normalize_status_scope_path)
        .transpose()?;
    let mut status_path = scope_path
        .as_ref()
        .map(|path| root.join(path))
        .unwrap_or_else(|| root.clone());
    while status_path != root && !status_path.exists() {
        if !status_path.pop() {
            status_path = root.clone();
            break;
        }
    }
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;

    let include_unversioned = request.include_unversioned.unwrap_or(true);
    let output = if request.check_remote_updates.unwrap_or(true) {
        run_status_with_updates(&executable, &status_path, include_unversioned)?
    } else {
        run_status_without_updates(&executable, &status_path, include_unversioned)?
    };

    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_STATUS_COMMAND_FAILED",
            "工作副本状态扫描失败",
            Some(svn_status_error_detail(&executable, &status_path, &output)),
            true,
        ));
    }

    let revision_summary = if request.include_revision_summary.unwrap_or(true) {
        read_workspace_revision_summary(&executable, &status_path)
    } else {
        RevisionSummary::default()
    };
    let xml = String::from_utf8_lossy(&output.stdout);
    parse_svn_status_xml(
        &xml,
        &root,
        request.offset.unwrap_or(0),
        request.limit.unwrap_or(500),
        revision_summary,
        request.include_content_digests.unwrap_or(true),
    )
}

pub fn set_workspace_changelist(
    request: SetWorkspaceChangelistRequest,
) -> Result<WorkspaceChangelistResult, NovaError> {
    const MAX_PATHS: usize = 5000;
    const MAX_NAME_CHARS: usize = 128;

    let root = normalize_workspace_path(&request.working_copy_root)?;
    if request.file_paths.is_empty() || request.file_paths.len() > MAX_PATHS {
        return Err(NovaError::command(
            "SVN_CHANGELIST_PATHS_INVALID",
            "请选择要加入 Changelist 的文件",
            Some(format!("每次必须选择 1 到 {MAX_PATHS} 个文件。")),
            true,
        ));
    }

    let changelist = request
        .changelist
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToString::to_string);
    if request.changelist.is_some() && changelist.is_none() {
        return Err(NovaError::command(
            "SVN_CHANGELIST_NAME_EMPTY",
            "Changelist 名称不能为空",
            None,
            true,
        ));
    }
    if changelist.as_ref().is_some_and(|name| {
        name.chars().count() > MAX_NAME_CHARS || name.chars().any(char::is_control)
    }) {
        return Err(NovaError::command(
            "SVN_CHANGELIST_NAME_INVALID",
            "Changelist 名称无效",
            Some(format!(
                "名称不能包含控制字符，且不能超过 {MAX_NAME_CHARS} 个字符。"
            )),
            true,
        ));
    }

    let mut seen = HashSet::new();
    let mut file_paths = Vec::with_capacity(request.file_paths.len());
    for path in &request.file_paths {
        let normalized = normalize_relative_file_path(path)?;
        if seen.insert(normalized.clone()) {
            file_paths.push(normalized);
        }
    }

    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let mut command = svn::command(&executable);
    command.arg("changelist");
    if let Some(name) = &changelist {
        command.arg("--").arg(name);
    } else {
        command.args(["--remove", "--"]);
    }
    command.args(&file_paths).current_dir(&root);
    let output = command.output().map_err(|error| {
        NovaError::command(
            "SVN_CHANGELIST_FAILED",
            "无法更新 Changelist",
            Some(format!("执行 `{executable} changelist` 失败：{error}")),
            true,
        )
    })?;
    if !output.status.success() {
        return Err(NovaError::command(
            "SVN_CHANGELIST_COMMAND_FAILED",
            "Changelist 更新失败",
            Some(command_error_detail(&executable, "changelist", &output)),
            true,
        ));
    }

    Ok(WorkspaceChangelistResult {
        changelist,
        file_paths,
    })
}

pub fn list_workspace_files(
    request: ListWorkspaceFilesRequest,
) -> Result<WorkspaceFileTree, NovaError> {
    let path = normalize_workspace_path(&request.working_copy_root)?;
    let executable = normalize_svn_executable(request.svn_executable.as_deref())?;
    let status = scan_workspace_status(ScanWorkspaceStatusRequest {
        working_copy_root: path.display().to_string(),
        scope_path: None,
        include_content_digests: None,
        include_revision_summary: None,
        include_unversioned: None,
        svn_executable: Some(executable.clone()),
        offset: Some(0),
        limit: Some(5000),
        check_remote_updates: Some(false),
    })?;
    let status_by_path = status
        .files
        .iter()
        .map(|file| (normalize_tree_path(&file.path), file))
        .collect::<HashMap<_, _>>();
    let versioned_paths = read_versioned_workspace_paths(&executable, &path)?;
    let max_files = request.max_files.unwrap_or(5000).clamp(1, 20000);
    let mut read_state = WorkspaceFileTreeReadState {
        max_files,
        returned_files: 0,
        total_files: 0,
        truncated: false,
    };
    let mut nodes = read_workspace_children(
        &path,
        &path,
        &status_by_path,
        &versioned_paths,
        &mut read_state,
    )?;

    add_missing_status_nodes(&mut nodes, &status_by_path, &versioned_paths);
    sort_workspace_nodes(&mut nodes);

    Ok(WorkspaceFileTree {
        working_copy_root: path.display().to_string(),
        total_files: read_state.total_files,
        returned_files: read_state.returned_files,
        truncated: read_state.truncated,
        nodes,
    })
}

pub fn get_workspace_path_sizes(
    request: GetWorkspacePathSizesRequest,
) -> Result<Vec<WorkspacePathSize>, NovaError> {
    const MAX_PATHS: usize = 5000;

    if request.paths.len() > MAX_PATHS {
        return Err(NovaError::command(
            "WORKSPACE_PATH_SIZE_LIMIT_EXCEEDED",
            "读取文件大小的路径过多",
            Some(format!("最多允许读取 {MAX_PATHS} 个路径。")),
            true,
        ));
    }

    let root = normalize_workspace_path(&request.working_copy_root)?;
    request
        .paths
        .into_iter()
        .map(|path| {
            let normalized_path = normalize_relative_file_path(&path)?;
            let bytes = fs::metadata(root.join(&normalized_path))
                .ok()
                .filter(|metadata| metadata.is_file())
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            Ok(WorkspacePathSize {
                path: normalized_path,
                bytes,
            })
        })
        .collect()
}

fn run_status_with_updates(
    executable: &str,
    path: &Path,
    include_unversioned: bool,
) -> Result<std::process::Output, NovaError> {
    let mut command = svn::command(executable);
    command.args(["status", "--xml", "--show-updates"]);
    if !include_unversioned {
        command.arg("--quiet");
    }
    let output = command.arg(path).output().map_err(|error| {
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

    run_status_without_updates(executable, path, include_unversioned)
}

fn run_status_without_updates(
    executable: &str,
    path: &Path,
    include_unversioned: bool,
) -> Result<std::process::Output, NovaError> {
    let mut command = svn::command(executable);
    command.args(["status", "--xml"]);
    if !include_unversioned {
        command.arg("--quiet");
    }
    command.arg(path).output().map_err(|error| {
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

fn read_versioned_workspace_paths(
    executable: &str,
    working_copy_root: &Path,
) -> Result<VersionedWorkspaceIndex, NovaError> {
    let canonical_root = fs::canonicalize(working_copy_root).map_err(|error| {
        NovaError::command(
            "WORKSPACE_FILE_TREE_ROOT_FAILED",
            "无法确认文件树的工作副本根目录",
            Some(format!(
                "路径：{}。错误：{error}",
                working_copy_root.display()
            )),
            true,
        )
    })?;
    let mut child = svn::command(executable)
        .args(["info", "--xml", "--depth", "infinity"])
        .arg(".")
        .current_dir(&canonical_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            NovaError::command(
                "SVN_FILE_TREE_INFO_FAILED",
                "无法读取文件树的 SVN 版本控制信息",
                Some(format!(
                    "执行 `{executable} info --xml --depth infinity .` 失败（工作副本：{}）：{error}",
                    working_copy_root.display()
                )),
                true,
            )
        })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        NovaError::command(
            "SVN_FILE_TREE_INFO_FAILED",
            "无法读取文件树的 SVN 版本控制信息",
            Some("无法读取 svn info 标准输出".to_string()),
            true,
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        NovaError::command(
            "SVN_FILE_TREE_INFO_FAILED",
            "无法读取文件树的 SVN 版本控制信息",
            Some("无法读取 svn info 标准错误".to_string()),
            true,
        )
    })?;
    let stderr_reader = thread::spawn(move || read_bounded_command_output(stderr, 64 * 1024));
    let paths_result =
        parse_versioned_workspace_paths_reader(BufReader::new(stdout), &canonical_root);
    let killed_for_parse_error = paths_result.is_err() && child.kill().is_ok();
    let status = child.wait().map_err(|error| {
        NovaError::command(
            "SVN_FILE_TREE_INFO_FAILED",
            "无法等待文件树的 SVN 版本控制信息命令",
            Some(format!(
                "工作副本：{}。错误：{error}",
                working_copy_root.display()
            )),
            true,
        )
    })?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| {
            NovaError::command(
                "SVN_FILE_TREE_INFO_FAILED",
                "无法读取文件树的 SVN 版本控制信息",
                Some("读取 svn info 标准错误的线程异常退出".to_string()),
                true,
            )
        })?
        .map_err(|error| {
            NovaError::command(
                "SVN_FILE_TREE_INFO_FAILED",
                "无法读取文件树的 SVN 版本控制信息",
                Some(format!("读取 svn info 标准错误失败：{error}")),
                true,
            )
        })?;

    if killed_for_parse_error {
        return paths_result;
    }

    if !status.success() {
        return Err(NovaError::command(
            "SVN_FILE_TREE_INFO_FAILED",
            "无法读取文件树的 SVN 版本控制信息",
            Some(svn_file_tree_info_error_detail(
                executable,
                working_copy_root,
                status,
                &stderr,
            )),
            true,
        ));
    }

    paths_result
}

#[cfg(test)]
fn parse_versioned_workspace_paths(
    xml: &str,
    canonical_root: &Path,
) -> Result<VersionedWorkspaceIndex, NovaError> {
    parse_versioned_workspace_paths_reader(xml.as_bytes(), canonical_root)
}

const MAX_VERSIONED_WORKSPACE_PATHS: usize = 1_000_000;
const MAX_SVN_INFO_PATH_BYTES: usize = 32 * 1024;
const MAX_SVN_INFO_METADATA_BYTES: usize = 64 * 1024;
const MAX_SVN_INFO_METADATA_POOL_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default)]
struct CompactWorkspaceMetadata {
    base_revision: u64,
    last_revision: u64,
    author_id: u32,
    date_id: u32,
}

#[derive(Debug, Default)]
struct MetadataStringPool {
    ids: HashMap<String, u32>,
    values: Vec<String>,
    bytes: usize,
}

impl MetadataStringPool {
    fn intern(&mut self, value: String) -> Result<u32, NovaError> {
        self.intern_with_limit(value, MAX_SVN_INFO_METADATA_POOL_BYTES)
    }

    fn intern_with_limit(&mut self, value: String, max_bytes: usize) -> Result<u32, NovaError> {
        if value.is_empty() {
            return Ok(0);
        }
        if let Some(id) = self.ids.get(&value) {
            return Ok(*id);
        }
        let next_bytes = self.bytes.saturating_add(value.len());
        if next_bytes > max_bytes {
            return Err(NovaError::command(
                "SVN_FILE_TREE_INFO_METADATA_LIMIT_EXCEEDED",
                "SVN 文件树元数据占用过多内存",
                Some(format!("去重后的作者或日期字段超过 {} 字节", max_bytes)),
                true,
            ));
        }
        let id = u32::try_from(self.values.len())
            .ok()
            .and_then(|index| index.checked_add(1))
            .unwrap_or(u32::MAX);
        self.values.push(value.clone());
        self.ids.insert(value, id);
        self.bytes = next_bytes;
        Ok(id)
    }

    fn resolve(&self, id: u32) -> Option<&str> {
        let index = usize::try_from(id.checked_sub(1)?).ok()?;
        self.values.get(index).map(String::as_str)
    }
}

#[derive(Debug, Default)]
struct VersionedWorkspaceIndex {
    entries: HashMap<String, CompactWorkspaceMetadata>,
    authors: MetadataStringPool,
    dates: MetadataStringPool,
}

#[derive(Debug, Default)]
struct ResolvedWorkspaceMetadata {
    base_revision: Option<String>,
    last_revision: Option<String>,
    last_changed_date: Option<String>,
    last_changed_author: Option<String>,
}

impl VersionedWorkspaceIndex {
    fn contains(&self, path: &str) -> bool {
        self.entries.contains_key(path)
    }

    fn insert(&mut self, path: String, entry: &StreamingInfoEntry) -> Result<(), NovaError> {
        let author_id = self.authors.intern(entry.author.clone())?;
        let date_id = self.dates.intern(entry.date.clone())?;
        self.entries.insert(
            path,
            CompactWorkspaceMetadata {
                base_revision: entry.base_revision,
                last_revision: entry.last_revision,
                author_id,
                date_id,
            },
        );
        Ok(())
    }

    fn resolve(&self, path: &str, fallback_revision: Option<&str>) -> ResolvedWorkspaceMetadata {
        let Some(metadata) = self.entries.get(path) else {
            return ResolvedWorkspaceMetadata {
                base_revision: fallback_revision.map(ToString::to_string),
                ..ResolvedWorkspaceMetadata::default()
            };
        };
        ResolvedWorkspaceMetadata {
            base_revision: revision_value(metadata.base_revision)
                .or_else(|| fallback_revision.map(ToString::to_string)),
            last_revision: revision_value(metadata.last_revision),
            last_changed_date: self
                .dates
                .resolve(metadata.date_id)
                .map(ToString::to_string),
            last_changed_author: self
                .authors
                .resolve(metadata.author_id)
                .map(ToString::to_string),
        }
    }

    #[cfg(test)]
    fn from_paths(paths: impl IntoIterator<Item = String>) -> Self {
        Self {
            entries: paths
                .into_iter()
                .map(|path| (path, CompactWorkspaceMetadata::default()))
                .collect(),
            ..Self::default()
        }
    }
}

fn revision_value(revision: u64) -> Option<String> {
    (revision > 0).then(|| revision.to_string())
}

#[derive(Debug)]
struct StreamingInfoEntry {
    path: String,
    wc_root: String,
    base_revision: u64,
    last_revision: u64,
    author: String,
    date: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamingInfoTextField {
    WcRoot,
    Author,
    Date,
}

fn parse_streaming_revision_attribute(
    attribute: &Attribute<'_>,
    decoder: Decoder,
    field: &str,
) -> Result<u64, NovaError> {
    let value = attribute
        .decode_and_unescape_value(decoder)
        .map_err(|error| {
            svn_file_tree_info_xml_error(format!("svn info {field} 解码失败：{error}"))
        })?;
    // Revision metadata is optional for the tree; local-state sentinels must not discard paths.
    Ok(value.trim().parse::<u64>().unwrap_or_default())
}

fn parse_versioned_workspace_paths_reader<R: BufRead>(
    reader: R,
    canonical_root: &Path,
) -> Result<VersionedWorkspaceIndex, NovaError> {
    parse_versioned_workspace_paths_reader_with_limit(
        reader,
        canonical_root,
        MAX_VERSIONED_WORKSPACE_PATHS,
    )
}

fn parse_versioned_workspace_paths_reader_with_limit<R: BufRead>(
    reader: R,
    canonical_root: &Path,
    max_paths: usize,
) -> Result<VersionedWorkspaceIndex, NovaError> {
    let mut reader = XmlReader::from_reader(reader);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut current_entry: Option<StreamingInfoEntry> = None;
    let mut reading_field: Option<StreamingInfoTextField> = None;
    let mut reported_root: Option<String> = None;
    let mut pending_entries = Vec::new();
    let mut paths = VersionedWorkspaceIndex::default();
    let mut entry_count = 0usize;

    loop {
        let event = reader.read_event_into(&mut buffer).map_err(|error| {
            svn_file_tree_info_xml_error(format!(
                "svn info --xml --depth infinity 返回了无法解析的 XML：{error}"
            ))
        })?;
        match event {
            Event::Start(start) if start.name().as_ref() == b"entry" => {
                entry_count = entry_count.saturating_add(1);
                if entry_count > max_paths.saturating_add(1) {
                    return Err(NovaError::command(
                        "SVN_FILE_TREE_INFO_LIMIT_EXCEEDED",
                        "工作副本包含过多版本控制路径",
                        Some(format!("svn info 路径数超过安全上限 {max_paths}")),
                        true,
                    ));
                }
                let mut path = None;
                let mut base_revision = 0;
                for attribute in start.attributes() {
                    let attribute = attribute.map_err(|error| {
                        svn_file_tree_info_xml_error(format!(
                            "svn info entry 属性无法解析：{error}"
                        ))
                    })?;
                    if attribute.key.as_ref() == b"path" {
                        path = Some(
                            attribute
                                .decode_and_unescape_value(reader.decoder())
                                .map_err(|error| {
                                    svn_file_tree_info_xml_error(format!(
                                        "svn info entry path 解码失败：{error}"
                                    ))
                                })?
                                .into_owned(),
                        );
                    } else if attribute.key.as_ref() == b"revision" {
                        base_revision = parse_streaming_revision_attribute(
                            &attribute,
                            reader.decoder(),
                            "entry revision",
                        )?;
                    }
                }
                let path = path.ok_or_else(|| {
                    svn_file_tree_info_xml_error("svn info entry 缺少 path 属性".to_string())
                })?;
                if path.len() > MAX_SVN_INFO_PATH_BYTES {
                    return Err(NovaError::command(
                        "SVN_FILE_TREE_INFO_PATH_TOO_LONG",
                        "SVN 文件树信息包含过长路径",
                        Some(format!("单个路径超过 {MAX_SVN_INFO_PATH_BYTES} 字节")),
                        true,
                    ));
                }
                current_entry = Some(StreamingInfoEntry {
                    path,
                    wc_root: String::new(),
                    base_revision,
                    last_revision: 0,
                    author: String::new(),
                    date: String::new(),
                });
            }
            Event::Start(start) if start.name().as_ref() == b"commit" => {
                if let Some(entry) = current_entry.as_mut() {
                    for attribute in start.attributes() {
                        let attribute = attribute.map_err(|error| {
                            svn_file_tree_info_xml_error(format!(
                                "svn info commit 属性无法解析：{error}"
                            ))
                        })?;
                        if attribute.key.as_ref() == b"revision" {
                            entry.last_revision = parse_streaming_revision_attribute(
                                &attribute,
                                reader.decoder(),
                                "commit revision",
                            )?;
                        }
                    }
                }
            }
            Event::Start(start) if start.name().as_ref() == b"wcroot-abspath" => {
                reading_field = current_entry
                    .as_ref()
                    .map(|_| StreamingInfoTextField::WcRoot);
            }
            Event::Start(start) if start.name().as_ref() == b"author" => {
                reading_field = current_entry
                    .as_ref()
                    .map(|_| StreamingInfoTextField::Author);
            }
            Event::Start(start) if start.name().as_ref() == b"date" => {
                reading_field = current_entry.as_ref().map(|_| StreamingInfoTextField::Date);
            }
            Event::Text(text) if reading_field.is_some() => {
                let decoded = text.decode().map_err(|error| {
                    svn_file_tree_info_xml_error(format!("svn info 元数据解码失败：{error}"))
                })?;
                let decoded = unescape(&decoded).map_err(|error| {
                    svn_file_tree_info_xml_error(format!(
                        "svn info 元数据转义字符解析失败：{error}"
                    ))
                })?;
                if let (Some(entry), Some(field)) = (current_entry.as_mut(), reading_field) {
                    append_streaming_info_text(entry, field, &decoded)?;
                }
            }
            Event::GeneralRef(reference) if reading_field.is_some() => {
                let decoded = reference.decode().map_err(|error| {
                    svn_file_tree_info_xml_error(format!("svn info 元数据实体解码失败：{error}"))
                })?;
                let resolved = if let Some(character) =
                    reference.resolve_char_ref().map_err(|error| {
                        svn_file_tree_info_xml_error(format!(
                            "svn info 元数据字符引用解析失败：{error}"
                        ))
                    })? {
                    character.to_string()
                } else {
                    resolve_xml_entity(&decoded)
                        .ok_or_else(|| {
                            svn_file_tree_info_xml_error(format!(
                                "svn info 元数据包含未知实体：&{decoded};"
                            ))
                        })?
                        .to_string()
                };
                if let (Some(entry), Some(field)) = (current_entry.as_mut(), reading_field) {
                    append_streaming_info_text(entry, field, &resolved)?;
                }
            }
            Event::End(end)
                if matches!(end.name().as_ref(), b"wcroot-abspath" | b"author" | b"date") =>
            {
                reading_field = None;
            }
            Event::End(end) if end.name().as_ref() == b"entry" => {
                reading_field = None;
                if let Some(entry) = current_entry.take() {
                    process_streaming_info_entry(
                        entry,
                        canonical_root,
                        &mut reported_root,
                        &mut pending_entries,
                        &mut paths,
                    )?;
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }

    let Some(reported_root) = reported_root else {
        return Err(NovaError::command(
            "SVN_FILE_TREE_INFO_ROOT_MISSING",
            "SVN 文件树信息缺少工作副本根节点",
            None,
            true,
        ));
    };
    for entry in pending_entries {
        insert_streaming_info_path(entry, &reported_root, canonical_root, &mut paths)?;
    }
    Ok(paths)
}

fn append_streaming_info_text(
    entry: &mut StreamingInfoEntry,
    field: StreamingInfoTextField,
    value: &str,
) -> Result<(), NovaError> {
    let (target, max_bytes, code, message) = match field {
        StreamingInfoTextField::WcRoot => (
            &mut entry.wc_root,
            MAX_SVN_INFO_PATH_BYTES,
            "SVN_FILE_TREE_INFO_PATH_TOO_LONG",
            "SVN 文件树信息包含过长根路径",
        ),
        StreamingInfoTextField::Author => (
            &mut entry.author,
            MAX_SVN_INFO_METADATA_BYTES,
            "SVN_FILE_TREE_INFO_METADATA_TOO_LONG",
            "SVN 文件树信息包含过长作者字段",
        ),
        StreamingInfoTextField::Date => (
            &mut entry.date,
            MAX_SVN_INFO_METADATA_BYTES,
            "SVN_FILE_TREE_INFO_METADATA_TOO_LONG",
            "SVN 文件树信息包含过长日期字段",
        ),
    };
    target.push_str(value);
    if target.len() > max_bytes {
        return Err(NovaError::command(
            code,
            message,
            Some(format!("单个字段超过 {max_bytes} 字节")),
            true,
        ));
    }
    Ok(())
}

fn process_streaming_info_entry(
    entry: StreamingInfoEntry,
    canonical_root: &Path,
    reported_root: &mut Option<String>,
    pending_entries: &mut Vec<StreamingInfoEntry>,
    paths: &mut VersionedWorkspaceIndex,
) -> Result<(), NovaError> {
    if entry.path == "." {
        let root = entry.wc_root.trim();
        if root.is_empty() {
            return Err(NovaError::command(
                "SVN_FILE_TREE_INFO_ROOT_MISSING",
                "SVN 文件树信息缺少工作副本根路径",
                None,
                true,
            ));
        }
        validate_reported_workspace_root(root, canonical_root)?;
        *reported_root = Some(root.to_string());
        return Ok(());
    }

    if let Some(root) = reported_root.as_deref() {
        insert_streaming_info_path(entry, root, canonical_root, paths)?;
    } else {
        pending_entries.push(entry);
    }
    Ok(())
}

fn validate_reported_workspace_root(
    reported_root: &str,
    canonical_root: &Path,
) -> Result<(), NovaError> {
    let canonical_reported_root = fs::canonicalize(reported_root).map_err(|error| {
        NovaError::command(
            "SVN_FILE_TREE_INFO_ROOT_INVALID",
            "无法确认 SVN 文件树信息的工作副本根目录",
            Some(format!("SVN 返回的根路径：{reported_root}。错误：{error}")),
            true,
        )
    })?;
    if canonical_reported_root != canonical_root {
        return Err(NovaError::command(
            "SVN_FILE_TREE_INFO_ROOT_MISMATCH",
            "SVN 文件树信息不属于当前工作副本",
            Some(format!(
                "当前工作副本：{}。SVN 返回：{}。",
                canonical_root.display(),
                canonical_reported_root.display()
            )),
            true,
        ));
    }
    Ok(())
}

fn insert_streaming_info_path(
    entry: StreamingInfoEntry,
    reported_root: &str,
    canonical_root: &Path,
    paths: &mut VersionedWorkspaceIndex,
) -> Result<(), NovaError> {
    if entry.wc_root.trim() != reported_root {
        return Ok(());
    }
    if let Some(relative_path) = info_entry_relative_path(&entry.path, canonical_root) {
        paths.insert(relative_path, &entry)?;
    }
    Ok(())
}

fn svn_file_tree_info_xml_error(detail: String) -> NovaError {
    NovaError::command(
        "SVN_FILE_TREE_INFO_XML_PARSE_FAILED",
        "解析文件树的 SVN 版本控制信息失败",
        Some(detail),
        true,
    )
}

#[derive(Debug)]
struct BoundedCommandOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_bounded_command_output<R: Read>(
    reader: R,
    max_bytes: usize,
) -> std::io::Result<BoundedCommandOutput> {
    let mut bytes = Vec::with_capacity(max_bytes.min(8192));
    reader
        .take(max_bytes.saturating_add(1) as u64)
        .read_to_end(&mut bytes)?;
    let truncated = bytes.len() > max_bytes;
    bytes.truncate(max_bytes);
    Ok(BoundedCommandOutput { bytes, truncated })
}

fn info_entry_relative_path(raw_path: &str, working_copy_root: &Path) -> Option<String> {
    let windows_separators = workspace_uses_windows_separators(working_copy_root);
    let raw_path = normalize_workspace_separators(raw_path, windows_separators);
    let raw_path = raw_path.trim_end_matches('/');
    if raw_path == "." {
        return None;
    }
    let path = PathBuf::from(raw_path);
    if path.is_absolute()
        || (windows_separators
            && (is_explicit_windows_absolute_path(raw_path) || raw_path.starts_with('/')))
    {
        return None;
    }

    let relative_path = raw_path.strip_prefix("./").unwrap_or(raw_path);
    if relative_path.is_empty()
        || relative_path.chars().any(char::is_control)
        || relative_path
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return None;
    }

    Some(relative_path.to_string())
}

fn normalize_relative_file_path(path: &str) -> Result<String, NovaError> {
    if path.is_empty() {
        return Err(NovaError::command(
            "DIFF_PATH_EMPTY",
            "请选择要查看 Diff 的文件",
            None,
            true,
        ));
    }

    if path.chars().any(char::is_control) {
        return Err(NovaError::command(
            "DIFF_PATH_INVALID",
            "Diff 文件路径无效",
            Some("文件路径不能包含控制字符。".to_string()),
            true,
        ));
    }

    let target = PathBuf::from(path);
    if target.is_absolute()
        || (cfg!(windows)
            && (is_explicit_windows_absolute_path(path)
                || path.starts_with('\\')
                || path.starts_with('/')))
        || has_runtime_parent_segment(path)
    {
        return Err(NovaError::command(
            "DIFF_PATH_INVALID",
            "Diff 文件路径无效",
            Some("文件路径必须是当前工作副本内的相对路径。".to_string()),
            true,
        ));
    }

    Ok(normalize_runtime_separators(path))
}

fn normalize_status_scope_path(path: &str) -> Result<String, NovaError> {
    if path.is_empty() || path.chars().any(char::is_control) {
        return Err(NovaError::command(
            "SVN_STATUS_SCOPE_INVALID",
            "状态扫描范围无效",
            Some("扫描范围必须是工作副本内的相对路径。".to_string()),
            true,
        ));
    }

    let target = PathBuf::from(path);
    if target.is_absolute()
        || (cfg!(windows)
            && (is_explicit_windows_absolute_path(path)
                || path.starts_with('\\')
                || path.starts_with('/')))
        || has_runtime_parent_segment(path)
    {
        return Err(NovaError::command(
            "SVN_STATUS_SCOPE_INVALID",
            "状态扫描范围无效",
            Some("扫描范围不能超出当前工作副本。".to_string()),
            true,
        ));
    }

    Ok(normalize_runtime_separators(path))
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

fn normalize_svn_log_target_path(path: &str) -> Result<PathBuf, NovaError> {
    normalize_standalone_target_path(
        path,
        "SVN_LOG_TARGET_INVALID",
        "SVN_LOG_TARGET_NOT_ABSOLUTE",
        "SVN_LOG_TARGET_NOT_FOUND",
        "SVN_LOG_TARGET_UNSUPPORTED",
        "日志目标",
    )
}

fn normalize_update_target_path(path: &str) -> Result<PathBuf, NovaError> {
    normalize_standalone_target_path(
        path,
        "UPDATE_TARGET_INVALID",
        "UPDATE_TARGET_NOT_ABSOLUTE",
        "UPDATE_TARGET_NOT_FOUND",
        "UPDATE_TARGET_UNSUPPORTED",
        "Update 目标",
    )
}

fn normalize_standalone_target_path(
    path: &str,
    invalid_code: &'static str,
    absolute_code: &'static str,
    not_found_code: &'static str,
    unsupported_code: &'static str,
    label: &str,
) -> Result<PathBuf, NovaError> {
    let value = path.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err(NovaError::command(
            invalid_code,
            format!("{label}路径无效"),
            Some(format!("{label}必须是有效的本地文件或目录路径。")),
            true,
        ));
    }

    let target = PathBuf::from(value);
    if !target.is_absolute() {
        return Err(NovaError::command(
            absolute_code,
            format!("{label}必须是绝对路径"),
            Some(format!("路径：{}", target.display())),
            true,
        ));
    }
    if !target.exists() {
        return Err(NovaError::command(
            not_found_code,
            format!("{label}不存在"),
            Some(format!("路径：{}", target.display())),
            true,
        ));
    }
    if !target.is_file() && !target.is_dir() {
        return Err(NovaError::command(
            unsupported_code,
            format!("{label}不是文件或目录"),
            Some(format!("路径：{}", target.display())),
            true,
        ));
    }

    Ok(target)
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

impl LimitedText {
    fn empty() -> Self {
        Self {
            text: String::new(),
            binary: false,
            too_large: false,
        }
    }
}

#[derive(Debug)]
struct LimitedBytes {
    bytes: Vec<u8>,
    byte_size: u64,
    too_large: bool,
}

impl LimitedBytes {
    fn empty() -> Self {
        Self {
            bytes: Vec::new(),
            byte_size: 0,
            too_large: false,
        }
    }
}

fn is_previewable_image(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico"
    )
}

fn image_mime_for_path(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn build_image_content_diff(
    path: String,
    node_kind: String,
    original: &LimitedBytes,
    modified: &LimitedBytes,
    max_bytes: u64,
) -> FileContentDiff {
    let too_large = original.too_large || modified.too_large;
    FileContentDiff {
        image_mime: Some(image_mime_for_path(&path).to_string()),
        language: language_for_path(&path),
        path,
        node_kind,
        original_text: String::new(),
        modified_text: String::new(),
        binary: true,
        too_large,
        max_bytes,
        is_image: !too_large,
        original_bytes_base64: if too_large || original.bytes.is_empty() {
            None
        } else {
            Some(BASE64.encode(&original.bytes))
        },
        modified_bytes_base64: if too_large || modified.bytes.is_empty() {
            None
        } else {
            Some(BASE64.encode(&modified.bytes))
        },
        original_byte_size: original.byte_size,
        modified_byte_size: modified.byte_size,
    }
}

fn read_limited_bytes_file(path: &Path, max_bytes: u64) -> Result<LimitedBytes, NovaError> {
    if !path.exists() {
        return Ok(LimitedBytes::empty());
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
        return Ok(LimitedBytes {
            bytes: Vec::new(),
            byte_size: metadata.len(),
            too_large: true,
        });
    }

    let bytes = fs::read(path).map_err(|error| {
        NovaError::command(
            "FILE_CONTENT_READ_FAILED",
            "无法读取文件内容",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    Ok(LimitedBytes {
        byte_size: bytes.len() as u64,
        bytes,
        too_large: false,
    })
}

fn read_svn_base_bytes(
    executable: &str,
    root: &Path,
    target: &Path,
    max_bytes: u64,
) -> Result<LimitedBytes, NovaError> {
    let output = svn::command(executable)
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
        return Ok(LimitedBytes::empty());
    }

    if output.stdout.len() as u64 > max_bytes {
        return Ok(LimitedBytes {
            bytes: Vec::new(),
            byte_size: output.stdout.len() as u64,
            too_large: true,
        });
    }

    Ok(LimitedBytes {
        byte_size: output.stdout.len() as u64,
        bytes: output.stdout,
        too_large: false,
    })
}

fn read_repository_revision_bytes(
    executable: &str,
    target_url: &str,
    revision: &str,
    max_bytes: u64,
) -> Result<LimitedBytes, NovaError> {
    let output = svn::command(executable)
        .args(["cat", "-r", revision, "--"])
        .arg(target_url)
        .output()
        .map_err(|error| {
            NovaError::command(
                "REVISION_FILE_CONTENT_FAILED",
                "无法读取历史文件内容",
                Some(format!(
                    "执行 `{executable} cat -r {revision}` 失败：{error}"
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "REVISION_FILE_CONTENT_COMMAND_FAILED",
            "历史文件内容读取失败",
            Some(command_error_detail(executable, "cat", &output)),
            true,
        ));
    }

    if output.stdout.len() as u64 > max_bytes {
        return Ok(LimitedBytes {
            bytes: Vec::new(),
            byte_size: output.stdout.len() as u64,
            too_large: true,
        });
    }

    Ok(LimitedBytes {
        byte_size: output.stdout.len() as u64,
        bytes: output.stdout,
        too_large: false,
    })
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
    let output = svn::command(executable)
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

fn read_repository_revision_text(
    executable: &str,
    target_url: &str,
    revision: &str,
    max_bytes: u64,
) -> Result<LimitedText, NovaError> {
    let output = svn::command(executable)
        .args(["cat", "-r", revision, "--"])
        .arg(target_url)
        .output()
        .map_err(|error| {
            NovaError::command(
                "REVISION_FILE_CONTENT_FAILED",
                "无法读取历史文件内容",
                Some(format!(
                    "执行 `{executable} cat -r {revision}` 失败：{error}"
                )),
                true,
            )
        })?;

    if !output.status.success() {
        return Err(NovaError::command(
            "REVISION_FILE_CONTENT_COMMAND_FAILED",
            "历史文件内容读取失败",
            Some(command_error_detail(executable, "cat", &output)),
            true,
        ));
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

fn normalize_revision_diff_path(path: &str) -> Result<String, NovaError> {
    let value = path.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err(NovaError::command(
            "REVISION_FILE_PATH_INVALID",
            "历史文件路径无效",
            Some("文件路径不能为空或包含控制字符。".to_string()),
            true,
        ));
    }
    Ok(value.to_string())
}

fn normalize_revision_diff_revision(revision: &str) -> Result<String, NovaError> {
    let value = revision.trim();
    if value.is_empty() || !value.chars().all(|character| character.is_ascii_digit()) {
        return Err(NovaError::command(
            "REVISION_FILE_REVISION_INVALID",
            "历史文件 Revision 无效",
            Some("Revision 必须是单个数字版本号。".to_string()),
            true,
        ));
    }
    value
        .parse::<u64>()
        .map(|value| value.to_string())
        .map_err(|error| {
            NovaError::command(
                "REVISION_FILE_REVISION_INVALID",
                "历史文件 Revision 无效",
                Some(error.to_string()),
                true,
            )
        })
}

fn bytes_to_limited_text(bytes: Vec<u8>, too_large: bool) -> Result<LimitedText, NovaError> {
    if bytes.contains(&0) {
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
    include_content_digests: bool,
) -> Result<WorkingCopyStatus, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "SVN_STATUS_XML_PARSE_FAILED",
            "解析 SVN 状态失败",
            Some(format!("svn status --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;

    let against = document
        .descendants()
        .find(|node| node.has_tag_name("against"));
    let remote_updates_checked = against.is_some();
    let repository_revision = against
        .and_then(|node| node.attribute("revision"))
        .map(ToString::to_string);

    let mut files = Vec::new();
    for entry in document
        .descendants()
        .filter(|node| node.has_tag_name("entry"))
    {
        let raw_path = entry.attribute("path").unwrap_or("");
        if raw_path.is_empty() {
            continue;
        }

        let Some(wc_status) = entry.children().find(|node| node.has_tag_name("wc-status")) else {
            continue;
        };

        let item = wc_status.attribute("item").unwrap_or("normal").to_string();
        let props = wc_status.attribute("props").map(ToString::to_string);
        let changelist = entry
            .ancestors()
            .find(|node| node.has_tag_name("changelist"))
            .and_then(|node| node.attribute("name"))
            .map(ToString::to_string);
        let repos_status = entry
            .children()
            .find(|node| node.has_tag_name("repos-status"));
        let remote_status = repos_status
            .and_then(|node| node.attribute("item"))
            .map(ToString::to_string);
        let remote_property_status = repos_status
            .and_then(|node| node.attribute("props"))
            .map(ToString::to_string);

        let property_changed = props
            .as_deref()
            .map(|value| value != "none" && value != "normal")
            .unwrap_or(false);
        let remote_property_changed = remote_property_status
            .as_deref()
            .map(|value| value != "none" && value != "normal")
            .unwrap_or(false);
        let local_changed = local_status_has_change(&item) || property_changed;
        let remote_changed = remote_status
            .as_deref()
            .is_some_and(repository_status_has_update)
            || remote_property_changed;
        let change_scope = ChangeScope::from_changes(local_changed, remote_changed);
        let (lock_state, lock_owner, lock_comment) = parse_lock_info(entry, wc_status);
        let conflict_kind = parse_conflict_kind(entry, wc_status, &item, props.as_deref());
        if matches!(item.as_str(), "normal" | "none")
            && props.as_deref().unwrap_or("none") == "none"
            && !remote_changed
            && lock_state == "none"
            && lock_owner.is_none()
            && lock_comment.is_none()
            && conflict_kind.is_none()
            && changelist.is_none()
        {
            continue;
        }

        let display_path = display_status_path(raw_path, working_copy_root);
        let target_path = status_target_path(raw_path, working_copy_root);

        files.push(ChangedFile {
            path: display_path,
            status: normalize_status(&item, wc_status),
            changelist,
            revision: wc_status.attribute("revision").map(ToString::to_string),
            property_status: props,
            property_changed,
            remote_status,
            remote_property_status,
            change_scope,
            abnormal: is_abnormal_status(&item),
            lock_state,
            lock_owner,
            lock_comment,
            conflict_kind,
            file_size: changed_file_size(&target_path),
            content_digest: if include_content_digests {
                changed_file_digest(&target_path, &item)
            } else {
                String::new()
            },
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
        remote_updates_checked,
        repository_revision,
        local_changes: files
            .iter()
            .filter(|file| matches!(file.change_scope, ChangeScope::Local | ChangeScope::Both))
            .count(),
        remote_changes: files
            .iter()
            .filter(|file| matches!(file.change_scope, ChangeScope::Remote | ChangeScope::Both))
            .count(),
        combined_changes: files
            .iter()
            .filter(|file| file.change_scope == ChangeScope::Both)
            .count(),
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

fn local_status_has_change(status: &str) -> bool {
    matches!(
        status,
        "modified"
            | "added"
            | "deleted"
            | "missing"
            | "unversioned"
            | "conflicted"
            | "obstructed"
            | "incomplete"
            | "replaced"
    )
}

fn repository_status_has_update(status: &str) -> bool {
    matches!(status, "modified" | "added" | "deleted" | "replaced")
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

struct WorkspaceFileTreeReadState {
    max_files: usize,
    returned_files: usize,
    total_files: usize,
    truncated: bool,
}

fn read_workspace_children(
    root: &Path,
    directory: &Path,
    status_by_path: &HashMap<String, &ChangedFile>,
    versioned_paths: &VersionedWorkspaceIndex,
    read_state: &mut WorkspaceFileTreeReadState,
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
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            NovaError::command(
                "WORKSPACE_FILE_TREE_FAILED",
                "无法读取工作副本文件树",
                Some(format!("路径：{}。错误：{error}", path.display())),
                true,
            )
        })?;
        let relative_path = workspace_tree_relative_path(root, &path);
        let normalized_path = normalize_tree_path(&relative_path);
        if should_skip_workspace_tree_entry(
            &name,
            metadata.is_dir(),
            &normalized_path,
            versioned_paths,
        ) {
            continue;
        }
        let status_match = workspace_tree_status_for_path(&relative_path, status_by_path);
        let reparse_point = is_workspace_tree_reparse_point(&metadata);
        if metadata.is_dir() && !reparse_point {
            let versioned = versioned_paths.contains(&normalized_path);
            let children =
                read_workspace_children(root, &path, status_by_path, versioned_paths, read_state)?;
            if children.is_empty() && !versioned {
                continue;
            }

            let changed = status_match.changed || children.iter().any(|child| child.changed);
            let change_scope = children
                .iter()
                .fold(status_match.change_scope, |scope, child| {
                    scope.combine(child.change_scope)
                });
            let svn_metadata =
                versioned_paths.resolve(&normalized_path, status_match.revision.as_deref());
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
                changelist: None,
                remote_status: status_match.remote_status,
                remote_property_status: status_match.remote_property_status,
                change_scope,
                revision: svn_metadata.base_revision.clone(),
                base_revision: svn_metadata.base_revision,
                last_revision: svn_metadata.last_revision,
                last_changed_date: svn_metadata.last_changed_date,
                last_changed_author: svn_metadata.last_changed_author,
                file_size: None,
                changed,
                versioned,
                children,
            });
        } else if metadata.is_file() || metadata.file_type().is_symlink() || reparse_point {
            read_state.total_files += 1;
            if read_state.returned_files >= read_state.max_files {
                read_state.truncated = true;
                continue;
            }

            read_state.returned_files += 1;
            nodes.push(workspace_file_node(
                relative_path,
                name,
                Some(metadata.len()),
                status_by_path,
                versioned_paths,
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
    versioned_paths: &VersionedWorkspaceIndex,
) -> WorkspaceFileNode {
    let normalized_path = normalize_tree_path(&path);
    let status_match = workspace_tree_status_for_path(&normalized_path, status_by_path);
    let svn_metadata = versioned_paths.resolve(&normalized_path, status_match.revision.as_deref());
    WorkspaceFileNode {
        path,
        name,
        kind: "file".to_string(),
        status: status_match.status.unwrap_or_else(|| "normal".to_string()),
        changelist: status_match.changelist,
        remote_status: status_match.remote_status,
        remote_property_status: status_match.remote_property_status,
        change_scope: status_match.change_scope,
        revision: svn_metadata.base_revision.clone(),
        base_revision: svn_metadata.base_revision,
        last_revision: svn_metadata.last_revision,
        last_changed_date: svn_metadata.last_changed_date,
        last_changed_author: svn_metadata.last_changed_author,
        file_size: status_match.file_size.or(file_size),
        changed: status_match.changed,
        versioned: versioned_paths.contains(&normalized_path),
        children: Vec::new(),
    }
}

#[derive(Debug, Clone)]
struct WorkspaceTreeStatusMatch {
    status: Option<String>,
    changelist: Option<String>,
    remote_status: Option<String>,
    remote_property_status: Option<String>,
    change_scope: ChangeScope,
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
            changelist: file.changelist.clone(),
            remote_status: file.remote_status.clone(),
            remote_property_status: file.remote_property_status.clone(),
            change_scope: file.change_scope,
            revision: file.revision.clone(),
            file_size: file.file_size,
            changed: file.change_scope != ChangeScope::None,
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
        changelist: None,
        remote_status: None,
        remote_property_status: None,
        change_scope: if inside_unversioned_dir {
            ChangeScope::Local
        } else {
            ChangeScope::None
        },
        revision: None,
        file_size: None,
        changed: inside_unversioned_dir,
    }
}

fn add_missing_status_nodes(
    nodes: &mut Vec<WorkspaceFileNode>,
    status_by_path: &HashMap<String, &ChangedFile>,
    versioned_paths: &VersionedWorkspaceIndex,
) {
    for file in status_by_path.values() {
        let normalized_path = normalize_tree_path(&file.path);
        if normalized_path.is_empty() || tree_contains_path(nodes, &normalized_path) {
            continue;
        }

        insert_status_node(nodes, &normalized_path, file, versioned_paths);
    }
}

fn tree_contains_path(nodes: &[WorkspaceFileNode], target: &str) -> bool {
    nodes.iter().any(|node| {
        normalize_tree_path(&node.path) == target || tree_contains_path(&node.children, target)
    })
}

fn insert_status_node(
    nodes: &mut Vec<WorkspaceFileNode>,
    path: &str,
    file: &ChangedFile,
    versioned_paths: &VersionedWorkspaceIndex,
) {
    let segments = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    insert_status_node_segments(nodes, path, &segments, "", file, versioned_paths);
}

fn insert_status_node_segments(
    nodes: &mut Vec<WorkspaceFileNode>,
    full_path: &str,
    segments: &[&str],
    parent_path: &str,
    file: &ChangedFile,
    versioned_paths: &VersionedWorkspaceIndex,
) {
    let Some((segment, remaining_segments)) = segments.split_first() else {
        return;
    };

    if remaining_segments.is_empty() {
        let svn_metadata = versioned_paths.resolve(full_path, file.revision.as_deref());
        nodes.push(WorkspaceFileNode {
            path: full_path.to_string(),
            name: (*segment).to_string(),
            kind: "file".to_string(),
            status: file.status.clone(),
            changelist: file.changelist.clone(),
            remote_status: file.remote_status.clone(),
            remote_property_status: file.remote_property_status.clone(),
            change_scope: file.change_scope,
            revision: svn_metadata.base_revision.clone(),
            base_revision: svn_metadata.base_revision,
            last_revision: svn_metadata.last_revision,
            last_changed_date: svn_metadata.last_changed_date,
            last_changed_author: svn_metadata.last_changed_author,
            file_size: file.file_size,
            changed: true,
            versioned: versioned_paths.contains(full_path),
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
            let svn_metadata = versioned_paths.resolve(&directory_path, None);
            nodes.push(WorkspaceFileNode {
                path: directory_path.clone(),
                name: (*segment).to_string(),
                kind: "dir".to_string(),
                status: "changed".to_string(),
                changelist: None,
                remote_status: None,
                remote_property_status: None,
                change_scope: file.change_scope,
                revision: svn_metadata.base_revision.clone(),
                base_revision: svn_metadata.base_revision,
                last_revision: svn_metadata.last_revision,
                last_changed_date: svn_metadata.last_changed_date,
                last_changed_author: svn_metadata.last_changed_author,
                file_size: None,
                changed: true,
                versioned: versioned_paths.contains(&directory_path),
                children: Vec::new(),
            });
            nodes.len() - 1
        });
    nodes[index].changed = true;
    nodes[index].status = "changed".to_string();
    nodes[index].change_scope = nodes[index].change_scope.combine(file.change_scope);
    insert_status_node_segments(
        &mut nodes[index].children,
        full_path,
        remaining_segments,
        &directory_path,
        file,
        versioned_paths,
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
        .map(normalize_runtime_separators)
        .unwrap_or_else(|| normalize_runtime_separators(&path.display().to_string()))
}

fn normalize_tree_path(path: &str) -> String {
    normalize_runtime_separators(path)
        .trim_matches('/')
        .to_string()
}

fn normalize_runtime_separators(path: &str) -> String {
    normalize_workspace_separators(path, cfg!(windows))
}

fn normalize_workspace_separators(path: &str, windows_separators: bool) -> String {
    if windows_separators {
        path.replace('\\', "/")
    } else {
        path.to_string()
    }
}

fn workspace_uses_windows_separators(working_copy_root: &Path) -> bool {
    cfg!(windows) || is_explicit_windows_absolute_path(&working_copy_root.display().to_string())
}

fn is_explicit_windows_absolute_path(path: &str) -> bool {
    let value = path.trim();
    let bytes = value.as_bytes();
    (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/'))
        || value.starts_with("\\\\")
}

fn has_runtime_parent_segment(path: &str) -> bool {
    if cfg!(windows) {
        path.split(['/', '\\']).any(|segment| segment == "..")
    } else {
        path.split('/').any(|segment| segment == "..")
    }
}

#[cfg(windows)]
fn is_workspace_tree_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_workspace_tree_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn should_skip_workspace_tree_entry(
    name: &str,
    is_directory: bool,
    normalized_path: &str,
    versioned_paths: &VersionedWorkspaceIndex,
) -> bool {
    if !is_directory {
        return false;
    }
    match name.to_ascii_lowercase().as_str() {
        ".svn" | ".git" => true,
        "node_modules" | "target" | "dist" => !versioned_paths.contains(normalized_path),
        _ => false,
    }
}

#[derive(Debug, Clone, Default)]
struct RevisionSummary {
    range: Option<String>,
    mixed: bool,
}

fn read_workspace_revision_summary(executable: &str, working_copy_root: &Path) -> RevisionSummary {
    let svnversion = svnversion_executable(executable);
    let mut command = Command::new(svnversion);
    svn::configure_hidden_console(&mut command);
    let Ok(output) = command.arg(working_copy_root).output() else {
        return RevisionSummary::default();
    };

    if !output.status.success() {
        return RevisionSummary::default();
    }

    parse_svnversion_output(&String::from_utf8_lossy(&output.stdout))
}

fn read_log_working_copy_revision(executable: &str, target: &Path, fallback: &str) -> String {
    read_workspace_revision_summary(executable, target)
        .range
        .as_deref()
        .and_then(highest_svnversion_revision)
        .unwrap_or_else(|| fallback.to_string())
}

fn highest_svnversion_revision(value: &str) -> Option<String> {
    let revision = value
        .trim()
        .trim_end_matches(['M', 'S', 'P', 'U'])
        .rsplit(':')
        .next()?
        .trim();
    (!revision.is_empty() && revision.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| revision.to_string())
}

fn parse_svnversion_output(output: &str) -> RevisionSummary {
    let trimmed = output.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("exported") {
        return RevisionSummary::default();
    }

    let range = trimmed.trim_end_matches(['M', 'S', 'P', 'U']).to_string();

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
    let windows_separators = workspace_uses_windows_separators(working_copy_root);
    let raw_native_path = Path::new(raw_path);
    if let Ok(relative_path) = raw_native_path.strip_prefix(working_copy_root) {
        if !relative_path.as_os_str().is_empty() {
            return normalize_workspace_separators(
                &relative_path.display().to_string(),
                windows_separators,
            );
        }
    }

    let raw_path = normalize_workspace_separators(raw_path, windows_separators);
    let root = normalize_workspace_separators(
        &working_copy_root.display().to_string(),
        windows_separators,
    );
    let root = root.trim_end_matches('/');
    let root_prefix = if root.is_empty() {
        "/".to_string()
    } else {
        format!("{root}/")
    };

    raw_path
        .strip_prefix(&root_prefix)
        .unwrap_or(&raw_path)
        .to_string()
}

fn status_target_path(raw_path: &str, working_copy_root: &Path) -> PathBuf {
    let path = PathBuf::from(raw_path);
    let windows_separators = workspace_uses_windows_separators(working_copy_root);
    if path.is_absolute()
        || (windows_separators && is_explicit_windows_absolute_path(raw_path))
        || (windows_separators && (raw_path.starts_with('\\') || raw_path.starts_with('/')))
    {
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

fn parse_svn_info_details_xml(xml: &str, requested_path: &Path) -> Result<SvnInfo, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "SVN_INFO_XML_PARSE_FAILED",
            "解析 SVN 信息失败",
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
                "SVN 信息缺少 entry 节点",
                None,
                true,
            )
        })?;

    let target_path = entry
        .attribute("path")
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| requested_path.display().to_string());
    let working_copy_root = text_child(entry, "wcroot-abspath")
        .unwrap_or_else(|_| requested_path.display().to_string());
    let relative_path = relative_path_from_root(requested_path, Path::new(&working_copy_root));
    let repository = entry
        .descendants()
        .find(|node| node.has_tag_name("repository"));
    let repository_root = repository
        .and_then(|node| optional_text_child(node, "root"))
        .unwrap_or_default();
    let repository_uuid = repository.and_then(|node| optional_text_child(node, "uuid"));
    let commit = entry.children().find(|node| node.has_tag_name("commit"));

    Ok(SvnInfo {
        target_path,
        working_copy_root,
        relative_path,
        kind: entry
            .attribute("kind")
            .unwrap_or_else(|| {
                if requested_path.is_dir() {
                    "dir"
                } else {
                    "file"
                }
            })
            .to_string(),
        repository_url: text_child(entry, "url")?,
        repository_root,
        repository_uuid,
        revision: entry.attribute("revision").unwrap_or("").to_string(),
        last_changed_revision: commit
            .and_then(|node| node.attribute("revision").map(ToString::to_string)),
        last_changed_author: commit.and_then(|node| optional_text_child(node, "author")),
        last_changed_date: commit.and_then(|node| optional_text_child(node, "date")),
    })
}

fn relative_path_from_root(target: &Path, root: &Path) -> Option<String> {
    let canonical_target = fs::canonicalize(target).ok()?;
    let canonical_root = fs::canonicalize(root).ok()?;
    let relative = canonical_target
        .strip_prefix(canonical_root)
        .ok()?
        .to_str()?;
    let relative = relative.trim_matches(['/', '\\']);
    (!relative.is_empty()).then(|| normalize_runtime_separators(relative))
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
        working_copy_root: None,
        working_copy_revision: None,
        repository_root: None,
        repository_url: None,
        entries,
        has_more: false,
        next_start_revision: None,
    })
}

fn parse_svn_blame_xml(
    xml: &str,
    content: &str,
    target: &str,
    max_lines: usize,
) -> Result<SvnBlame, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "SVN_BLAME_XML_PARSE_FAILED",
            "解析 SVN Blame 失败",
            Some(format!("svn blame --xml 返回了无法解析的 XML：{error}")),
            true,
        )
    })?;
    let content_lines = content.lines().collect::<Vec<_>>();
    let mut metadata = Vec::new();

    for entry in document
        .descendants()
        .filter(|node| node.has_tag_name("entry"))
    {
        let line_number = entry
            .attribute("line-number")
            .ok_or_else(|| {
                NovaError::command(
                    "SVN_BLAME_LINE_NUMBER_MISSING",
                    "解析 SVN Blame 失败",
                    Some("Blame 条目缺少行号。".to_string()),
                    true,
                )
            })?
            .parse::<usize>()
            .map_err(|error| {
                NovaError::command(
                    "SVN_BLAME_LINE_NUMBER_INVALID",
                    "解析 SVN Blame 失败",
                    Some(format!("Blame 条目行号无效：{error}")),
                    true,
                )
            })?;
        let commit = entry.children().find(|node| node.has_tag_name("commit"));
        let revision = commit
            .and_then(|node| node.attribute("revision"))
            .unwrap_or("")
            .to_string();
        let author = commit
            .and_then(|node| optional_text_child(node, "author"))
            .unwrap_or_default();
        let date = commit
            .and_then(|node| optional_text_child(node, "date"))
            .unwrap_or_default();
        metadata.push((line_number, revision, author, date));
    }

    if metadata.len() != content_lines.len() {
        return Err(NovaError::command(
            "SVN_BLAME_CONTENT_MISMATCH",
            "Blame 元数据与文件内容不一致",
            Some(format!(
                "Blame 返回 {} 行元数据，但 BASE 文件包含 {} 行。",
                metadata.len(),
                content_lines.len()
            )),
            true,
        ));
    }

    let total_lines = metadata.len();
    let lines = metadata
        .into_iter()
        .zip(content_lines)
        .take(max_lines)
        .map(
            |((line_number, revision, author, date), content)| SvnBlameLine {
                line_number,
                revision,
                author,
                date,
                content: content.to_string(),
            },
        )
        .collect::<Vec<_>>();

    Ok(SvnBlame {
        target: target.to_string(),
        language: language_for_path(target),
        truncated: lines.len() < total_lines,
        total_lines,
        lines,
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

fn parse_repository_properties_xml(xml: &str, target: &str) -> Result<SvnProperties, NovaError> {
    let document = Document::parse(xml).map_err(|error| {
        NovaError::command(
            "REPOSITORY_FILE_PROPERTIES_XML_PARSE_FAILED",
            "解析仓库文件 Properties 失败",
            Some(format!(
                "svn proplist --xml --verbose 返回了无法解析的 XML：{error}"
            )),
            true,
        )
    })?;
    let mut properties = document
        .descendants()
        .filter(|node| node.has_tag_name("property"))
        .filter_map(|node| {
            let name = node.attribute("name")?.to_string();
            let raw_value = node.text().unwrap_or_default();
            let value = if node.attribute("encoding") == Some("base64") {
                format!("[base64] {raw_value}")
            } else {
                raw_value.to_string()
            };
            Some(SvnProperty { name, value })
        })
        .collect::<Vec<_>>();
    properties.sort_by(|left, right| left.name.cmp(&right.name));
    let externals = properties
        .iter()
        .find(|property| property.name == "svn:externals")
        .map(|property| property.value.clone());

    Ok(SvnProperties {
        target: target.to_string(),
        properties,
        externals,
    })
}

fn get_svn_property_value(
    executable: &str,
    root: &Path,
    target: &Path,
    name: &str,
) -> Result<String, NovaError> {
    let output = svn::command(executable)
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

fn svn_file_tree_info_error_detail(
    executable: &str,
    path: &Path,
    status: ExitStatus,
    stderr: &BoundedCommandOutput,
) -> String {
    let stderr_text = String::from_utf8_lossy(&stderr.bytes).trim().to_string();

    if !stderr_text.is_empty() {
        let suffix = if stderr.truncated {
            "（输出已截断）"
        } else {
            ""
        };
        return format!(
            "`{executable} info --xml --depth infinity .` 返回失败（工作副本：{}）：{stderr}",
            path.display(),
            stderr = format_args!("{stderr_text}{suffix}"),
        );
    }

    format!(
        "`{executable} info --xml --depth infinity .` 返回退出码 {:?}，但没有输出（工作副本：{}）。",
        status.code(),
        path.display(),
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

    fn run_test_command(command: &mut Command) {
        let output = command.output().expect("测试命令应能启动");
        assert!(
            output.status.success(),
            "测试命令执行失败：{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn svn_test_tools_available() -> bool {
        Command::new("svn")
            .arg("--version")
            .arg("--quiet")
            .output()
            .is_ok()
            && Command::new("svnadmin")
                .arg("--version")
                .arg("--quiet")
                .output()
                .is_ok()
    }

    #[test]
    fn parses_changelist_names_from_status_xml() {
        let root = PathBuf::from("C:/workspace");
        let xml = r#"
<status>
  <target path="C:/workspace">
    <changelist name="release-ready">
      <entry path="C:/workspace/src/main.rs">
        <wc-status item="modified" props="none" revision="42" />
      </entry>
    </changelist>
  </target>
</status>
"#;

        let status = parse_svn_status_xml(xml, &root, 0, 100, parse_svnversion_output("42"), false)
            .expect("changelist status parses");

        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].path, "src/main.rs");
        assert_eq!(status.files[0].changelist.as_deref(), Some("release-ready"));
    }

    #[test]
    fn extracts_highest_revision_from_mixed_svnversion_output() {
        assert_eq!(
            highest_svnversion_revision("997080:997084"),
            Some("997084".to_string())
        );
        assert_eq!(
            highest_svnversion_revision("997080:997084MS"),
            Some("997084".to_string())
        );
        assert_eq!(
            highest_svnversion_revision("997084M"),
            Some("997084".to_string())
        );
        assert_eq!(highest_svnversion_revision("exported"), None);
    }

    #[test]
    fn assigns_and_removes_workspace_changelists() {
        if !svn_test_tools_available() {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-changelist-integration-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(&import_dir).expect("create changelist import directory");
        fs::write(import_dir.join("alpha.txt"), "base").expect("write alpha baseline");
        fs::write(import_dir.join("beta.txt"), "base").expect("write beta baseline");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("alpha.txt"), "alpha changed").expect("change alpha");
        fs::write(working_copy.join("beta.txt"), "beta changed").expect("change beta");

        let assigned = set_workspace_changelist(SetWorkspaceChangelistRequest {
            working_copy_root: working_copy.display().to_string(),
            file_paths: vec!["alpha.txt".to_string(), "beta.txt".to_string()],
            changelist: Some("release ready".to_string()),
            svn_executable: None,
        })
        .expect("assign changelist");
        assert_eq!(assigned.changelist.as_deref(), Some("release ready"));

        let assigned_status = scan_workspace_status(ScanWorkspaceStatusRequest {
            working_copy_root: working_copy.display().to_string(),
            scope_path: None,
            include_content_digests: Some(false),
            include_revision_summary: None,
            include_unversioned: None,
            svn_executable: None,
            offset: Some(0),
            limit: Some(100),
            check_remote_updates: Some(false),
        })
        .expect("read assigned changelist");
        assert!(assigned_status
            .files
            .iter()
            .filter(|file| ["alpha.txt", "beta.txt"].contains(&file.path.as_str()))
            .all(|file| file.changelist.as_deref() == Some("release ready")));

        set_workspace_changelist(SetWorkspaceChangelistRequest {
            working_copy_root: working_copy.display().to_string(),
            file_paths: vec!["alpha.txt".to_string()],
            changelist: None,
            svn_executable: None,
        })
        .expect("remove changelist");
        let removed_status = scan_workspace_status(ScanWorkspaceStatusRequest {
            working_copy_root: working_copy.display().to_string(),
            scope_path: None,
            include_content_digests: Some(false),
            include_revision_summary: None,
            include_unversioned: None,
            svn_executable: None,
            offset: Some(0),
            limit: Some(100),
            check_remote_updates: Some(false),
        })
        .expect("read removed changelist");
        assert_eq!(
            removed_status
                .files
                .iter()
                .find(|file| file.path == "alpha.txt")
                .and_then(|file| file.changelist.as_deref()),
            None
        );
        assert_eq!(
            removed_status
                .files
                .iter()
                .find(|file| file.path == "beta.txt")
                .and_then(|file| file.changelist.as_deref()),
            Some("release ready")
        );

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn returns_directory_content_diff_without_reading_the_directory_as_a_file() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-directory-content-diff-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("src")).expect("create directory target");

        let diff = get_file_content_diff(GetFileContentDiffRequest {
            working_copy_root: root.display().to_string(),
            file_path: "src".to_string(),
            svn_executable: None,
            max_bytes: None,
        })
        .expect("directory content diff");

        assert_eq!(diff.node_kind, "dir");
        assert!(diff.original_text.is_empty());
        assert!(diff.modified_text.is_empty());
        assert!(!diff.binary);
        assert!(!diff.too_large);
        assert!(!diff.is_image);
        assert_eq!(diff.max_bytes, 20 * 1024 * 1024);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn returns_image_content_diff_with_base64_payload() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-image-content-diff-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create root");
        // 最小有效 PNG 头 + 占位数据，足够验证二进制载荷通道。
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xdeimage-diff-payload".to_vec();
        fs::write(root.join("icon.png"), &png).expect("write png");
        fs::write(root.join("data.bin"), [0u8, 1, 2, 0]).expect("write bin");

        let diff = get_file_content_diff(GetFileContentDiffRequest {
            working_copy_root: root.display().to_string(),
            file_path: "icon.png".to_string(),
            svn_executable: None,
            max_bytes: None,
        })
        .expect("image content diff");

        let encoded = BASE64.encode(&png);
        assert!(diff.is_image);
        assert!(diff.binary);
        assert!(!diff.too_large);
        assert_eq!(diff.image_mime.as_deref(), Some("image/png"));
        assert!(diff.original_bytes_base64.is_none());
        assert_eq!(diff.modified_bytes_base64.as_deref(), Some(encoded.as_str()));
        assert_eq!(diff.modified_byte_size, png.len() as u64);
        assert_eq!(diff.original_byte_size, 0);

        let binary = get_file_content_diff(GetFileContentDiffRequest {
            working_copy_root: root.display().to_string(),
            file_path: "data.bin".to_string(),
            svn_executable: None,
            max_bytes: None,
        })
        .expect("binary content diff");
        assert!(binary.binary);
        assert!(!binary.is_image);
        assert!(binary.original_bytes_base64.is_none());
        assert!(binary.modified_bytes_base64.is_none());

        let oversized = get_file_content_diff(GetFileContentDiffRequest {
            working_copy_root: root.display().to_string(),
            file_path: "icon.png".to_string(),
            svn_executable: None,
            max_bytes: Some(8),
        })
        .expect("oversized image content diff");
        assert!(oversized.too_large);
        assert!(!oversized.is_image);
        assert!(oversized.modified_bytes_base64.is_none());
        assert_eq!(oversized.modified_byte_size, png.len() as u64);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn previewable_image_extension_helpers_cover_common_formats() {
        assert!(is_previewable_image("assets/logo.PNG"));
        assert!(is_previewable_image("a/b/c.jpeg"));
        assert!(is_previewable_image("icon.webp"));
        assert!(!is_previewable_image("notes.svg"));
        assert!(!is_previewable_image("archive.zip"));
        assert_eq!(image_mime_for_path("photo.jpg"), "image/jpeg");
        assert_eq!(image_mime_for_path("badge.ico"), "image/x-icon");
    }

    #[test]
    fn reads_revision_file_content_for_modified_added_and_deleted_files() {
        if !svn_test_tools_available() {
            return;
        }

        let root = std::env::temp_dir().join(format!(
            "novasvn-revision-file-content-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(&import_dir).expect("create import directory");
        fs::write(import_dir.join("modified.txt"), "before").expect("write baseline");
        fs::write(import_dir.join("deleted.txt"), "deleted").expect("write deleted baseline");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("modified.txt"), "after").expect("modify file");
        fs::write(working_copy.join("added.txt"), "added").expect("write added file");
        run_test_command(
            Command::new("svn")
                .arg("add")
                .arg(working_copy.join("added.txt")),
        );
        run_test_command(
            Command::new("svn")
                .arg("delete")
                .arg(working_copy.join("deleted.txt")),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "mixed changes"]),
        );

        let request = |name: &str, peg: &str, action: &str| {
            get_revision_file_content_diff(GetRevisionFileContentDiffRequest {
                target_url: format!("{repository_url}/{name}@{peg}"),
                file_path: format!("/{name}"),
                left_revision: "1".to_string(),
                right_revision: "2".to_string(),
                action: action.to_string(),
                svn_executable: None,
                max_bytes: Some(1024),
            })
            .expect("revision content diff reads")
        };

        let modified = request("modified.txt", "2", "M");
        assert_eq!(modified.original_text, "before");
        assert_eq!(modified.modified_text, "after");

        let added = request("added.txt", "2", "A");
        assert_eq!(added.original_text, "");
        assert_eq!(added.modified_text, "added");

        let deleted = request("deleted.txt", "1", "D");
        assert_eq!(deleted.original_text, "deleted");
        assert_eq!(deleted.modified_text, "");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reads_remote_head_log_when_working_copy_is_not_updated() {
        if !svn_test_tools_available() {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-remote-log-integration-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let local_working_copy = root.join("local-working-copy");
        let remote_working_copy = root.join("remote-working-copy");
        fs::create_dir_all(&import_dir).expect("create log import tree");
        fs::write(import_dir.join("tracked.txt"), "initial\n").expect("write log fixture");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&local_working_copy),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&remote_working_copy),
        );
        fs::write(remote_working_copy.join("tracked.txt"), "remote change\n")
            .expect("write remote log change");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&remote_working_copy)
                .args(["-m", "remote change"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("update")
                .arg(local_working_copy.join("tracked.txt")),
        );

        let workspace_log = get_svn_log(GetSvnLogRequest {
            working_copy_root: local_working_copy.display().to_string(),
            file_path: None,
            svn_executable: None,
            limit: Some(10),
            start_revision: None,
        })
        .expect("workspace log reads repository HEAD");
        assert_eq!(workspace_log.entries[0].revision, "2");
        assert_eq!(workspace_log.entries[0].message, "remote change");
        assert_eq!(workspace_log.working_copy_revision.as_deref(), Some("2"));

        let standalone_log = get_path_svn_log(GetPathSvnLogRequest {
            path: local_working_copy.display().to_string(),
            svn_executable: None,
            limit: Some(10),
            start_revision: None,
        })
        .expect("standalone log reads repository HEAD");
        assert_eq!(standalone_log.entries[0].revision, "2");
        assert_eq!(standalone_log.entries[0].message, "remote change");
        assert_eq!(standalone_log.working_copy_revision.as_deref(), Some("2"));

        let _ = fs::remove_dir_all(root);
    }

    fn create_ignore_test_working_copy(test_name: &str) -> (PathBuf, PathBuf) {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-ignore-{test_name}-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(import_dir.join("tracked")).expect("create ignore import tree");
        fs::write(import_dir.join("tracked/versioned.txt"), "versioned")
            .expect("write versioned ignore fixture");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );

        (root, working_copy)
    }

    fn assert_command_error_code(error: NovaError, expected: &str) {
        match error {
            NovaError::Command { code, .. } => assert_eq!(code, expected),
        }
    }

    fn find_workspace_node<'a>(
        nodes: &'a [WorkspaceFileNode],
        path: &str,
    ) -> Option<&'a WorkspaceFileNode> {
        nodes.iter().find_map(|node| {
            (node.path == path)
                .then_some(node)
                .or_else(|| find_workspace_node(&node.children, path))
        })
    }

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
    fn parses_detailed_svn_info_xml() {
        let xml = r#"
<info>
  <entry kind="file" path="C:\wc\src\main.rs" revision="42">
    <url>https://example.com/svn/trunk/src/main.rs</url>
    <repository>
      <root>https://example.com/svn</root>
      <uuid>abc-123</uuid>
    </repository>
    <wc-info><wcroot-abspath>C:\wc</wcroot-abspath></wc-info>
    <commit revision="41"><author>alice</author><date>2026-07-23T10:20:30.000000Z</date></commit>
  </entry>
</info>
"#;

        let info = parse_svn_info_details_xml(xml, Path::new("C:\\wc\\src\\main.rs"))
            .expect("detailed info parses");

        assert_eq!(info.kind, "file");
        assert_eq!(
            info.repository_url,
            "https://example.com/svn/trunk/src/main.rs"
        );
        assert_eq!(info.repository_root, "https://example.com/svn");
        assert_eq!(info.repository_uuid.as_deref(), Some("abc-123"));
        assert_eq!(info.revision, "42");
        assert_eq!(info.last_changed_revision.as_deref(), Some("41"));
        assert_eq!(info.last_changed_author.as_deref(), Some("alice"));
        assert_eq!(
            info.last_changed_date.as_deref(),
            Some("2026-07-23T10:20:30.000000Z")
        );
    }

    #[test]
    fn reads_deleted_repository_file_log_at_revision_with_pagination() {
        if !svn_test_tools_available() {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-repository-file-log-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(&root).unwrap();
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        let file = working_copy.join("history.txt");
        fs::write(&file, "revision one\n").unwrap();
        run_test_command(Command::new("svn").arg("add").arg(&file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "file revision one"]),
        );
        fs::write(&file, "revision two\n").unwrap();
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "file revision two"]),
        );
        run_test_command(Command::new("svn").arg("delete").arg(&file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "delete file at head"]),
        );

        let file_url = format!("{repository_url}/history.txt");
        let first_page = get_repository_file_log(GetRepositoryFileLogRequest {
            url: file_url.clone(),
            revision: Some("2".to_string()),
            svn_executable: None,
            limit: Some(1),
            start_revision: None,
        })
        .expect("historical file log first page");
        assert_eq!(first_page.target, file_url);
        assert_eq!(first_page.entries.len(), 1);
        assert_eq!(first_page.entries[0].revision, "2");
        assert_eq!(first_page.entries[0].message, "file revision two");
        assert!(first_page.has_more);
        assert_eq!(first_page.next_start_revision.as_deref(), Some("1"));

        let second_page = get_repository_file_log(GetRepositoryFileLogRequest {
            url: file_url,
            revision: Some("2".to_string()),
            svn_executable: None,
            limit: Some(1),
            start_revision: first_page.next_start_revision,
        })
        .expect("historical file log second page");
        assert_eq!(second_page.entries.len(), 1);
        assert_eq!(second_page.entries[0].revision, "1");
        assert_eq!(second_page.entries[0].message, "file revision one");
        assert!(!second_page.has_more);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn rejects_repository_file_log_page_after_snapshot_revision() {
        let error = get_repository_file_log(GetRepositoryFileLogRequest {
            url: "https://example.com/svn/trunk/history.txt".to_string(),
            revision: Some("10".to_string()),
            svn_executable: None,
            limit: Some(50),
            start_revision: Some("11".to_string()),
        })
        .expect_err("repository log pagination must remain within snapshot");

        assert_command_error_code(error, "REPOSITORY_FILE_LOG_START_AFTER_REVISION");
    }

    #[test]
    fn reads_deleted_repository_file_blame_at_revision() {
        if !svn_test_tools_available() {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-repository-file-blame-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(&root).unwrap();
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        let file = working_copy.join("blame.txt");
        fs::write(&file, "alpha\nbeta\n").unwrap();
        run_test_command(Command::new("svn").arg("add").arg(&file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "blame revision one"]),
        );
        fs::write(&file, "alpha\nbeta changed\n").unwrap();
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "blame revision two"]),
        );
        run_test_command(Command::new("svn").arg("delete").arg(&file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "delete blame file at head"]),
        );

        let file_url = format!("{repository_url}/blame.txt");
        let blame = get_repository_file_blame(GetRepositoryFileBlameRequest {
            url: file_url.clone(),
            revision: Some("2".to_string()),
            svn_executable: None,
            max_lines: Some(10),
        })
        .expect("historical repository file blame");
        assert_eq!(blame.target, file_url);
        assert_eq!(blame.total_lines, 2);
        assert!(!blame.truncated);
        assert_eq!(blame.lines[0].revision, "1");
        assert_eq!(blame.lines[0].content, "alpha");
        assert_eq!(blame.lines[1].revision, "2");
        assert_eq!(blame.lines[1].content, "beta changed");

        let truncated = get_repository_file_blame(GetRepositoryFileBlameRequest {
            url: file_url,
            revision: Some("2".to_string()),
            svn_executable: None,
            max_lines: Some(1),
        })
        .expect("truncated repository file blame");
        assert_eq!(truncated.lines.len(), 1);
        assert_eq!(truncated.total_lines, 2);
        assert!(truncated.truncated);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn reads_deleted_repository_file_properties_at_revision() {
        if !svn_test_tools_available() {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-repository-file-properties-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(&root).unwrap();
        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        let file = working_copy.join("properties.txt");
        fs::write(&file, "content\n").unwrap();
        run_test_command(Command::new("svn").arg("add").arg(&file));
        run_test_command(
            Command::new("svn")
                .args(["propset", "custom:note", "revision one"])
                .arg(&file),
        );
        run_test_command(
            Command::new("svn")
                .args(["propset", "svn:mime-type", "text/plain"])
                .arg(&file),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "properties revision one"]),
        );
        run_test_command(
            Command::new("svn")
                .args(["propset", "custom:note", "revision two"])
                .arg(&file),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "properties revision two"]),
        );
        run_test_command(Command::new("svn").arg("delete").arg(&file));
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "delete properties file at head"]),
        );

        let file_url = format!("{repository_url}/properties.txt");
        let revision_one = get_repository_file_properties(GetRepositoryFilePropertiesRequest {
            url: file_url.clone(),
            revision: Some("1".to_string()),
            svn_executable: None,
        })
        .expect("repository file properties revision one");
        assert_eq!(revision_one.target, file_url);
        assert_eq!(revision_one.properties.len(), 2);
        assert_eq!(revision_one.properties[0].name, "custom:note");
        assert_eq!(revision_one.properties[0].value, "revision one");
        assert_eq!(revision_one.properties[1].name, "svn:mime-type");
        assert_eq!(revision_one.properties[1].value, "text/plain");

        let revision_two = get_repository_file_properties(GetRepositoryFilePropertiesRequest {
            url: file_url,
            revision: Some("2".to_string()),
            svn_executable: None,
        })
        .expect("repository file properties revision two");
        assert_eq!(revision_two.properties[0].value, "revision two");

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn parses_repository_properties_values_and_base64_marker() {
        let xml = r#"<properties><target path="https://example.com/file.txt">
<property name="custom:multiline">line one&#13;
line two</property>
<property name="custom:binary" encoding="base64">AAEC</property>
</target></properties>"#;

        let result = parse_repository_properties_xml(xml, "https://example.com/svn/trunk/file.txt")
            .expect("repository properties parse");

        assert_eq!(result.properties[0].name, "custom:binary");
        assert_eq!(result.properties[0].value, "[base64] AAEC");
        assert_eq!(result.properties[1].name, "custom:multiline");
        assert_eq!(result.properties[1].value, "line one\r\nline two");
    }

    #[test]
    fn parses_only_versioned_paths_from_current_working_copy() {
        let root = std::env::temp_dir().join(format!(
            "novasvn-versioned-paths-test-{}",
            std::process::id()
        ));
        let foreign_root = std::env::temp_dir().join(format!(
            "novasvn-versioned-paths-foreign-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&foreign_root);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&foreign_root).unwrap();
        let canonical_root = fs::canonicalize(&root).unwrap();
        let xml = format!(
            r#"
<info>
  <entry path="."><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
  <entry path="tracked.txt" revision="42">
    <wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info>
    <commit revision="40"><author>alice &amp; bob &#x26; carol</author><date>2026-07-11T01:02:03Z</date></commit>
  </entry>
  <entry path="escaped&amp;name.txt"><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
  <entry path="src\windows.txt"><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
  <entry path=".env"><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
  <entry path="../outside.txt"><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
  <entry path="/absolute.txt"><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
  <entry path="C:\absolute.txt"><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
  <entry path="external/nested.txt"><wc-info><wcroot-abspath>{foreign_root}</wcroot-abspath></wc-info></entry>
</info>
"#,
            root = canonical_root.display(),
            foreign_root = foreign_root.display()
        );

        let paths =
            parse_versioned_workspace_paths(&xml, &canonical_root).expect("versioned paths parse");

        assert!(paths.contains("tracked.txt"));
        let metadata = paths.resolve("tracked.txt", None);
        assert_eq!(metadata.base_revision.as_deref(), Some("42"));
        assert_eq!(metadata.last_revision.as_deref(), Some("40"));
        assert_eq!(
            metadata.last_changed_author.as_deref(),
            Some("alice & bob & carol")
        );
        assert_eq!(
            metadata.last_changed_date.as_deref(),
            Some("2026-07-11T01:02:03Z")
        );
        assert!(paths.contains("escaped&name.txt"));
        if cfg!(windows) {
            assert!(paths.contains("src/windows.txt"));
        } else {
            assert!(paths.contains("src\\windows.txt"));
            assert!(paths.contains("C:\\absolute.txt"));
        }
        assert!(paths.contains(".env"));
        assert!(!paths.contains("outside.txt"));
        assert!(!paths.contains("absolute.txt"));
        assert!(!paths.contains("external/nested.txt"));
        assert!(!paths.contains("unmanaged.txt"));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&foreign_root);
    }

    #[test]
    fn keeps_versioned_paths_with_non_numeric_info_revisions() {
        let root = std::env::temp_dir().join(format!(
            "novasvn-versioned-path-revision-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let canonical_root = fs::canonicalize(&root).unwrap();
        let xml = format!(
            r#"<info>
<entry path="."><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
<entry path="uncommitted.txt" revision="-1">
  <wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info>
  <commit revision="unknown" />
</entry>
</info>"#,
            root = canonical_root.display()
        );

        let paths =
            parse_versioned_workspace_paths(&xml, &canonical_root).expect("versioned paths parse");

        assert!(paths.contains("uncommitted.txt"));
        let metadata = paths.resolve("uncommitted.txt", Some("42"));
        assert_eq!(metadata.base_revision.as_deref(), Some("42"));
        assert_eq!(metadata.last_revision, None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn limits_streamed_versioned_workspace_paths() {
        let root = std::env::temp_dir().join(format!(
            "novasvn-versioned-path-limit-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let canonical_root = fs::canonicalize(&root).unwrap();
        let xml = format!(
            r#"<info>
<entry path="."><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
<entry path="first.txt"><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
<entry path="second.txt"><wc-info><wcroot-abspath>{root}</wcroot-abspath></wc-info></entry>
</info>"#,
            root = canonical_root.display()
        );

        let error =
            parse_versioned_workspace_paths_reader_with_limit(xml.as_bytes(), &canonical_root, 1)
                .expect_err("path limit must fail");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "SVN_FILE_TREE_INFO_LIMIT_EXCEEDED");
            }
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn bounds_command_error_output() {
        let output =
            read_bounded_command_output("abcdef".as_bytes(), 4).expect("bounded output reads");

        assert_eq!(output.bytes, b"abcd");
        assert!(output.truncated);
    }

    #[test]
    fn bounds_and_deduplicates_streamed_metadata_strings() {
        let mut pool = MetadataStringPool::default();

        let first = pool
            .intern_with_limit("alice".to_string(), 5)
            .expect("first metadata value fits");
        let duplicate = pool
            .intern_with_limit("alice".to_string(), 5)
            .expect("duplicate metadata value reuses storage");
        assert_eq!(first, duplicate);
        assert_eq!(pool.bytes, 5);

        let error = pool
            .intern_with_limit("b".to_string(), 5)
            .expect_err("unique metadata beyond the pool limit must fail");
        assert_command_error_code(error, "SVN_FILE_TREE_INFO_METADATA_LIMIT_EXCEEDED");
    }

    #[test]
    fn rejects_versioned_path_info_without_matching_root() {
        let root = std::env::temp_dir().join(format!(
            "novasvn-versioned-paths-root-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let canonical_root = fs::canonicalize(&root).unwrap();

        let error = parse_versioned_workspace_paths(
            "<info><entry path=\"tracked.txt\" /></info>",
            &canonical_root,
        )
        .expect_err("missing root must fail");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "SVN_FILE_TREE_INFO_ROOT_MISSING");
            }
        }

        let foreign_root = std::env::temp_dir().join(format!(
            "novasvn-versioned-paths-mismatch-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&foreign_root);
        fs::create_dir_all(&foreign_root).unwrap();
        let mismatch_xml = format!(
            "<info><entry path=\".\"><wc-info><wcroot-abspath>{}</wcroot-abspath></wc-info></entry></info>",
            foreign_root.display()
        );
        let error = parse_versioned_workspace_paths(&mismatch_xml, &canonical_root)
            .expect_err("mismatched root must fail");
        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "SVN_FILE_TREE_INFO_ROOT_MISMATCH");
            }
        }

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&foreign_root);
    }

    #[test]
    fn parses_status_xml_with_conflict_lock_and_paging() {
        let xml = r#"
<status>
  <target path="C:\wc">
    <entry path="C:\wc\src\main.ts">
      <wc-status item="modified" props="none" revision="42">
        <lock><owner>alice</owner><comment>editing</comment></lock>
      </wc-status>
      <repos-status item="modified" props="none" />
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
    <entry path="C:\wc\src\remote.ts">
      <wc-status item="normal" props="none" revision="42" />
      <repos-status item="modified" props="none" />
    </entry>
    <entry path="C:\wc\src\remote-props.ts">
      <wc-status item="normal" props="none" revision="42" />
      <repos-status item="none" props="modified" />
    </entry>
    <against revision="44" />
  </target>
</status>
"#;

        let status = parse_svn_status_xml(
            xml,
            Path::new("C:\\wc"),
            0,
            10,
            parse_svnversion_output("41:42M"),
            true,
        )
        .expect("status parses");

        assert_eq!(status.total, 6);
        assert_eq!(status.revision_range.as_deref(), Some("41:42M"));
        assert!(status.mixed_revision);
        assert!(status.remote_updates_checked);
        assert_eq!(status.repository_revision.as_deref(), Some("44"));
        assert_eq!(status.local_changes, 3);
        assert_eq!(status.remote_changes, 3);
        assert_eq!(status.combined_changes, 1);
        assert_eq!(status.modified, 1);
        assert_eq!(status.conflicted, 1);
        assert_eq!(status.obstructed, 1);
        assert_eq!(status.files[0].path, "src/main.ts");
        assert_eq!(status.files[0].change_scope, ChangeScope::Both);
        assert_eq!(status.files[0].remote_status.as_deref(), Some("modified"));
        assert_eq!(status.files[0].lock_owner.as_deref(), Some("alice"));
        assert_eq!(
            status.files[1].conflict_kind.as_deref(),
            Some("tree:update")
        );
        assert!(status.files[2].abnormal);
        let locked = status
            .files
            .iter()
            .find(|file| file.path == "docs/locked.txt")
            .expect("remote lock remains visible");
        assert_eq!(locked.status, "normal");
        assert_eq!(locked.change_scope, ChangeScope::None);
        assert_eq!(locked.lock_state, "locked");
        assert_eq!(locked.lock_owner.as_deref(), Some("bob"));
        assert!(status.files.iter().any(|file| {
            file.path == "src/remote.ts"
                && file.status == "normal"
                && file.change_scope == ChangeScope::Remote
        }));
        assert!(status.files.iter().any(|file| {
            file.path == "src/remote-props.ts"
                && file.remote_status.as_deref() == Some("none")
                && file.remote_property_status.as_deref() == Some("modified")
                && file.change_scope == ChangeScope::Remote
        }));
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
            true,
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
        assert!(!status.remote_updates_checked);
        assert_eq!(status.repository_revision, None);
        assert_eq!(status.local_changes, 7);
        assert_eq!(status.remote_changes, 0);
        assert_eq!(status.combined_changes, 0);
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
        fs::create_dir_all(root.join("empty")).unwrap();
        fs::create_dir_all(root.join(".svn")).unwrap();
        fs::create_dir_all(root.join("target")).unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("src/main.rs"), "changed").unwrap();
        fs::write(root.join("src/lib.rs"), "normal").unwrap();
        fs::write(root.join("ignored.txt"), "ignored").unwrap();
        fs::write(root.join(".svn/entries"), "internal").unwrap();
        fs::write(root.join("target/tracked.txt"), "tracked target").unwrap();
        fs::write(root.join("dist/generated.txt"), "generated dist").unwrap();
        fs::write(root.join("node_modules/tracked.js"), "tracked dependency").unwrap();

        let xml = format!(
            r#"
<status>
  <target path="{root}">
    <entry path="{root}/src/main.rs">
      <wc-status item="modified" props="none" />
      <repos-status item="modified" props="none" />
    </entry>
    <entry path="{root}/src/lib.rs">
      <wc-status item="normal" props="none" revision="42" />
      <repos-status item="modified" props="none" />
    </entry>
    <entry path="{root}/docs/missing.md">
      <wc-status item="missing" props="none" />
    </entry>
    <against revision="44" />
  </target>
</status>
"#,
            root = root.display()
        );
        let status = parse_svn_status_xml(&xml, &root, 0, 100, parse_svnversion_output("42"), true)
            .expect("status parses");
        let status_by_path = status
            .files
            .iter()
            .map(|file| (normalize_tree_path(&file.path), file))
            .collect::<HashMap<_, _>>();
        let versioned_paths = VersionedWorkspaceIndex::from_paths(
            [
                "src",
                "src/main.rs",
                "src/lib.rs",
                "empty",
                "target",
                "target/tracked.txt",
                "node_modules",
                "node_modules/tracked.js",
                "docs",
                "docs/missing.md",
            ]
            .into_iter()
            .map(ToString::to_string),
        );
        let mut read_state = WorkspaceFileTreeReadState {
            max_files: 100,
            returned_files: 0,
            total_files: 0,
            truncated: false,
        };
        let mut nodes = read_workspace_children(
            &root,
            &root,
            &status_by_path,
            &versioned_paths,
            &mut read_state,
        )
        .expect("tree reads");
        add_missing_status_nodes(&mut nodes, &status_by_path, &versioned_paths);
        sort_workspace_nodes(&mut nodes);

        assert_eq!(read_state.total_files, 5);
        assert!(!read_state.truncated);
        assert!(nodes.iter().all(|node| node.name != ".svn"));
        assert!(nodes.iter().all(|node| node.name != "dist"));
        assert!(nodes
            .iter()
            .find(|node| node.name == "target")
            .is_some_and(|node| node.versioned && node.children[0].path == "target/tracked.txt"));
        assert!(nodes
            .iter()
            .find(|node| node.name == "node_modules")
            .is_some_and(|node| {
                node.versioned && node.children[0].path == "node_modules/tracked.js"
            }));
        let src = nodes.iter().find(|node| node.name == "src").unwrap();
        assert!(src.changed);
        assert!(src.versioned);
        assert_eq!(src.change_scope, ChangeScope::Both);
        assert!(src.children.iter().any(|node| {
            node.path == "src/main.rs"
                && node.status == "modified"
                && node.change_scope == ChangeScope::Both
                && node.changed
                && node.versioned
        }));
        assert!(src.children.iter().any(|node| {
            node.path == "src/lib.rs"
                && node.status == "normal"
                && node.remote_status.as_deref() == Some("modified")
                && node.change_scope == ChangeScope::Remote
                && node.changed
                && node.versioned
        }));
        assert!(nodes
            .iter()
            .find(|node| node.path == "ignored.txt")
            .is_some_and(|node| node.status == "normal" && !node.versioned));
        assert!(nodes
            .iter()
            .find(|node| node.path == "empty")
            .is_some_and(|node| node.kind == "dir" && node.versioned && node.children.is_empty()));
        let docs = nodes.iter().find(|node| node.name == "docs").unwrap();
        assert!(docs.children.iter().any(|node| {
            node.path == "docs/missing.md"
                && node.status == "missing"
                && node.changed
                && node.versioned
        }));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn detects_local_remote_and_combined_changes_in_real_working_copy() {
        if !svn_test_tools_available() {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-remote-status-integration-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let local_working_copy = root.join("local-working-copy");
        let remote_working_copy = root.join("remote-working-copy");
        fs::create_dir_all(&import_dir).expect("create remote status import tree");
        fs::write(import_dir.join("both.txt"), "base").expect("write combined fixture");
        fs::write(import_dir.join("remote.txt"), "base").expect("write remote fixture");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&local_working_copy),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&remote_working_copy),
        );
        fs::write(remote_working_copy.join("both.txt"), "remote")
            .expect("write remote combined change");
        fs::write(remote_working_copy.join("remote.txt"), "remote")
            .expect("write remote-only change");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&remote_working_copy)
                .args(["-m", "remote changes"]),
        );
        fs::write(local_working_copy.join("both.txt"), "local")
            .expect("write local combined change");

        let status = scan_workspace_status(ScanWorkspaceStatusRequest {
            working_copy_root: local_working_copy.display().to_string(),
            scope_path: None,
            include_content_digests: None,
            include_revision_summary: None,
            include_unversioned: None,
            svn_executable: None,
            offset: Some(0),
            limit: Some(100),
            check_remote_updates: Some(true),
        })
        .expect("real local and remote status reads");

        assert!(status.remote_updates_checked);
        assert_eq!(status.repository_revision.as_deref(), Some("2"));
        assert_eq!(status.local_changes, 1);
        assert_eq!(status.remote_changes, 2);
        assert_eq!(status.combined_changes, 1);
        assert!(status
            .files
            .iter()
            .any(|file| { file.path == "both.txt" && file.change_scope == ChangeScope::Both }));
        assert!(status
            .files
            .iter()
            .any(|file| { file.path == "remote.txt" && file.change_scope == ChangeScope::Remote }));

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn treats_directory_symlinks_as_leaf_nodes() {
        let root = std::env::temp_dir().join(format!(
            "novasvn-file-tree-symlink-test-{}",
            std::process::id()
        ));
        let target = std::env::temp_dir().join(format!(
            "novasvn-file-tree-symlink-target-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&target);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("nested.txt"), "outside").unwrap();
        let link = root.join("linked");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(&target, &link).is_err() {
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&target);
            return;
        }

        let status_by_path: HashMap<String, &ChangedFile> = HashMap::new();
        let versioned_paths = VersionedWorkspaceIndex::from_paths(["linked".to_string()]);
        let mut read_state = WorkspaceFileTreeReadState {
            max_files: 100,
            returned_files: 0,
            total_files: 0,
            truncated: false,
        };
        let nodes = read_workspace_children(
            &root,
            &root,
            &status_by_path,
            &versioned_paths,
            &mut read_state,
        )
        .expect("symlink tree reads");

        assert_eq!(read_state.total_files, 1);
        assert_eq!(read_state.returned_files, 1);
        assert!(!read_state.truncated);
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].path, "linked");
        assert_eq!(nodes[0].kind, "file");
        assert!(nodes[0].versioned);
        assert!(nodes[0].children.is_empty());
        assert!(nodes.iter().all(|node| node.path != "linked/nested.txt"));

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&target);
    }

    #[test]
    fn marks_ignored_and_external_entries_unversioned_in_real_working_copy() {
        if Command::new("svn")
            .arg("--version")
            .arg("--quiet")
            .output()
            .is_err()
            || Command::new("svnadmin")
                .arg("--version")
                .arg("--quiet")
                .output()
                .is_err()
        {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-file-tree-integration-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(import_dir.join("main/empty")).expect("create main import tree");
        for directory in ["target", "dist", "node_modules"] {
            fs::create_dir_all(import_dir.join("main").join(directory))
                .expect("create tracked generated-name directory");
            fs::write(
                import_dir.join("main").join(directory).join("tracked.txt"),
                directory,
            )
            .expect("write tracked generated-name file");
        }
        fs::create_dir_all(import_dir.join("external")).expect("create external import tree");
        fs::write(import_dir.join("main/tracked.txt"), "tracked").expect("write tracked file");
        fs::write(import_dir.join("external/nested.txt"), "external").expect("write external file");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(format!("{repository_url}/main"))
                .arg(&working_copy),
        );
        run_test_command(
            Command::new("svn")
                .args(["propset", "svn:ignore", "ignored.txt"])
                .arg(&working_copy),
        );
        run_test_command(
            Command::new("svn")
                .args(["propset", "svn:externals", "^/external external"])
                .arg(&working_copy),
        );
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(&working_copy)
                .args(["-m", "configure tree"]),
        );
        run_test_command(Command::new("svn").arg("update").arg(&working_copy));
        fs::write(working_copy.join("ignored.txt"), "ignored").expect("write ignored file");

        let tree = list_workspace_files(ListWorkspaceFilesRequest {
            working_copy_root: working_copy.display().to_string(),
            svn_executable: None,
            max_files: Some(100),
        })
        .expect("real file tree reads");

        let tracked_node =
            find_workspace_node(&tree.nodes, "tracked.txt").expect("tracked node exists");
        assert_eq!(tracked_node.status, "normal");
        assert!(tracked_node.versioned);
        assert!(tracked_node.base_revision.is_some());
        assert!(tracked_node.last_revision.is_some());
        assert!(tracked_node.last_changed_author.is_some());
        assert!(tracked_node.last_changed_date.is_some());
        assert!(find_workspace_node(&tree.nodes, "empty")
            .is_some_and(|node| node.kind == "dir" && node.versioned));
        for directory in ["target", "dist", "node_modules"] {
            assert!(find_workspace_node(&tree.nodes, directory)
                .is_some_and(|node| node.kind == "dir" && node.versioned));
            assert!(
                find_workspace_node(&tree.nodes, &format!("{directory}/tracked.txt"))
                    .is_some_and(|node| node.kind == "file" && node.versioned)
            );
        }
        assert!(find_workspace_node(&tree.nodes, "ignored.txt")
            .is_some_and(|node| node.status == "normal" && !node.versioned));
        assert!(find_workspace_node(&tree.nodes, "external")
            .is_some_and(|node| node.status == "external" && !node.versioned));
        assert!(find_workspace_node(&tree.nodes, "external/nested.txt")
            .is_some_and(|node| node.status == "normal" && !node.versioned));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn preserves_sparse_working_copy_directories_without_inventing_files() {
        if !svn_test_tools_available() {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-sparse-file-tree-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(import_dir.join("included")).expect("create included fixture");
        fs::create_dir_all(import_dir.join("excluded")).expect("create excluded fixture");
        fs::create_dir_all(import_dir.join("empty")).expect("create empty fixture");
        fs::write(import_dir.join("included/visible.txt"), "visible")
            .expect("write included fixture");
        fs::write(import_dir.join("excluded/hidden.txt"), "hidden")
            .expect("write excluded fixture");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .args(["--depth", "immediates"])
                .arg(&repository_url)
                .arg(&working_copy),
        );
        run_test_command(
            Command::new("svn")
                .arg("update")
                .args(["--set-depth", "infinity"])
                .arg(working_copy.join("included")),
        );

        let tree = list_workspace_files(ListWorkspaceFilesRequest {
            working_copy_root: working_copy.display().to_string(),
            svn_executable: None,
            max_files: Some(100),
        })
        .expect("sparse file tree reads");

        assert_eq!(tree.total_files, 1);
        assert_eq!(tree.returned_files, 1);
        assert!(!tree.truncated);
        assert!(find_workspace_node(&tree.nodes, "included")
            .is_some_and(|node| node.kind == "dir" && node.versioned));
        assert!(find_workspace_node(&tree.nodes, "included/visible.txt")
            .is_some_and(|node| node.kind == "file" && node.versioned));
        for directory in ["excluded", "empty"] {
            assert!(
                find_workspace_node(&tree.nodes, directory).is_some_and(|node| {
                    node.kind == "dir" && node.versioned && node.children.is_empty()
                })
            );
        }
        assert!(find_workspace_node(&tree.nodes, "excluded/hidden.txt").is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn appends_ignore_rule_and_returns_its_versioned_parent() {
        if !svn_test_tools_available() {
            return;
        }

        let (root, working_copy) = create_ignore_test_working_copy("append");
        let tracked = working_copy.join("tracked");
        run_test_command(
            Command::new("svn")
                .args(["propset", "svn:ignore", "build\n*.log\n"])
                .arg(&tracked),
        );
        fs::write(tracked.join("cache.tmp"), "cache").expect("write ignore target");

        let properties = ignore_workspace_path(IgnoreWorkspacePathRequest {
            working_copy_root: working_copy.display().to_string(),
            file_path: "tracked/cache.tmp".to_string(),
            svn_executable: None,
        })
        .expect("ignore rule writes");

        assert_eq!(properties.target, "tracked");
        assert_eq!(
            properties
                .properties
                .iter()
                .find(|property| property.name == "svn:ignore")
                .map(|property| property.value.as_str()),
            Some("build\n*.log\ncache.tmp")
        );
        let status = Command::new("svn")
            .args(["status", "--xml", "--no-ignore"])
            .arg(tracked.join("cache.tmp"))
            .output()
            .expect("ignored target status runs");
        assert!(status.status.success());
        assert!(String::from_utf8_lossy(&status.stdout).contains("item=\"ignored\""));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_invalid_ignore_targets_with_stable_errors() {
        if !svn_test_tools_available() {
            return;
        }

        let (root, working_copy) = create_ignore_test_working_copy("errors");
        fs::write(working_copy.join("ignored.tmp"), "ignored").expect("write ignored target");
        ignore_workspace_path(IgnoreWorkspacePathRequest {
            working_copy_root: working_copy.display().to_string(),
            file_path: "ignored.tmp".to_string(),
            svn_executable: None,
        })
        .expect("first ignore writes");

        let repeated = ignore_workspace_path(IgnoreWorkspacePathRequest {
            working_copy_root: working_copy.display().to_string(),
            file_path: "ignored.tmp".to_string(),
            svn_executable: None,
        })
        .expect_err("repeated ignore must fail");
        assert_command_error_code(repeated, "SVN_IGNORE_ALREADY_IGNORED");

        let versioned = ignore_workspace_path(IgnoreWorkspacePathRequest {
            working_copy_root: working_copy.display().to_string(),
            file_path: "tracked/versioned.txt".to_string(),
            svn_executable: None,
        })
        .expect_err("versioned target must fail");
        assert_command_error_code(versioned, "SVN_IGNORE_TARGET_NOT_UNVERSIONED");

        fs::create_dir_all(working_copy.join("scratch")).expect("create unversioned parent");
        fs::write(working_copy.join("scratch/nested.tmp"), "nested")
            .expect("write nested ignore target");
        let unversioned_parent = ignore_workspace_path(IgnoreWorkspacePathRequest {
            working_copy_root: working_copy.display().to_string(),
            file_path: "scratch/nested.tmp".to_string(),
            svn_executable: None,
        })
        .expect_err("unversioned parent must fail");
        assert_command_error_code(unversioned_parent, "SVN_IGNORE_PARENT_NOT_VERSIONED");

        let nested_working_copy = working_copy.join("nested-working-copy");
        let repository_url = format!("file://{}", root.join("repository").display());
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&nested_working_copy),
        );
        fs::write(nested_working_copy.join("foreign.tmp"), "foreign")
            .expect("write nested working copy ignore target");
        let outside_working_copy = ignore_workspace_path(IgnoreWorkspacePathRequest {
            working_copy_root: working_copy.display().to_string(),
            file_path: "nested-working-copy/foreign.tmp".to_string(),
            svn_executable: None,
        })
        .expect_err("nested working copy parent must fail");
        assert_command_error_code(
            outside_working_copy,
            "SVN_IGNORE_PARENT_OUTSIDE_WORKING_COPY",
        );

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn preserves_distinct_backslash_and_nested_paths_in_real_working_copy() {
        if Command::new("svn")
            .arg("--version")
            .arg("--quiet")
            .output()
            .is_err()
            || Command::new("svnadmin")
                .arg("--version")
                .arg("--quiet")
                .output()
                .is_err()
        {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-backslash-path-integration-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(import_dir.join("literal")).expect("create nested import tree");
        fs::write(import_dir.join("literal\\name.txt"), "flat baseline")
            .expect("write backslash file");
        fs::write(import_dir.join("literal/name.txt"), "nested baseline")
            .expect("write nested file");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("literal\\name.txt"), "flat changed")
            .expect("change backslash file");
        fs::write(working_copy.join("literal/name.txt"), "nested changed")
            .expect("change nested file");

        let status = scan_workspace_status(ScanWorkspaceStatusRequest {
            working_copy_root: working_copy.display().to_string(),
            scope_path: None,
            include_content_digests: None,
            include_revision_summary: None,
            include_unversioned: None,
            svn_executable: None,
            offset: Some(0),
            limit: Some(100),
            check_remote_updates: Some(true),
        })
        .expect("real status reads");
        assert!(status
            .files
            .iter()
            .any(|file| file.path == "literal\\name.txt"));
        assert!(status
            .files
            .iter()
            .any(|file| file.path == "literal/name.txt"));

        let tree = list_workspace_files(ListWorkspaceFilesRequest {
            working_copy_root: working_copy.display().to_string(),
            svn_executable: None,
            max_files: Some(100),
        })
        .expect("real file tree reads");
        assert!(find_workspace_node(&tree.nodes, "literal\\name.txt")
            .is_some_and(|node| node.name == "literal\\name.txt" && node.versioned));
        assert!(find_workspace_node(&tree.nodes, "literal/name.txt")
            .is_some_and(|node| node.name == "name.txt" && node.versioned));

        let content_diff = get_file_content_diff(GetFileContentDiffRequest {
            working_copy_root: working_copy.display().to_string(),
            file_path: "literal\\name.txt".to_string(),
            svn_executable: None,
            max_bytes: Some(1024),
        })
        .expect("backslash file content diff reads");
        assert_eq!(content_diff.path, "literal\\name.txt");
        assert_eq!(content_diff.original_text, "flat baseline");
        assert_eq!(content_diff.modified_text, "flat changed");

        let _ = fs::remove_dir_all(root);
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

    #[cfg(unix)]
    #[test]
    fn preserves_backslashes_in_unix_relative_paths() {
        assert_eq!(
            normalize_relative_file_path("\\name.txt").unwrap(),
            "\\name.txt"
        );
        assert_eq!(
            normalize_relative_file_path("literal\\..\\name.txt").unwrap(),
            "literal\\..\\name.txt"
        );
        assert_eq!(
            normalize_relative_file_path(" leading.txt").unwrap(),
            " leading.txt"
        );
        assert_eq!(
            normalize_relative_file_path("trailing.txt ").unwrap(),
            "trailing.txt "
        );

        let root = Path::new("/tmp/novasvn-backslash-root");
        assert_eq!(
            status_target_path("\\name.txt", root),
            PathBuf::from("/tmp/novasvn-backslash-root/\\name.txt")
        );
        assert_eq!(
            display_status_path("/tmp/novasvn-backslash-root/\\name.txt", root),
            "\\name.txt"
        );
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
    fn parses_svn_blame_xml_and_aligns_file_content() {
        let xml = r#"
<blame>
  <target path="src/main.rs">
    <entry line-number="1">
      <commit revision="7">
        <author>alice</author>
        <date>2026-01-01T00:00:00.000000Z</date>
      </commit>
    </entry>
    <entry line-number="2">
      <commit revision="9">
        <author>bob</author>
        <date>2026-01-02T00:00:00.000000Z</date>
      </commit>
    </entry>
  </target>
</blame>
"#;

        let blame = parse_svn_blame_xml(xml, "第一行\nsecond line\n", "src/main.rs", 100)
            .expect("blame parses");

        assert_eq!(blame.target, "src/main.rs");
        assert_eq!(blame.language, "rust");
        assert_eq!(blame.total_lines, 2);
        assert!(!blame.truncated);
        assert_eq!(blame.lines[0].revision, "7");
        assert_eq!(blame.lines[0].author, "alice");
        assert_eq!(blame.lines[0].content, "第一行");
        assert_eq!(blame.lines[1].line_number, 2);
        assert_eq!(blame.lines[1].content, "second line");
    }

    #[test]
    fn truncates_svn_blame_at_requested_line_limit() {
        let xml = r#"
<blame><target path="a.txt">
  <entry line-number="1"><commit revision="1"/></entry>
  <entry line-number="2"><commit revision="1"/></entry>
</target></blame>
"#;

        let blame = parse_svn_blame_xml(xml, "one\ntwo\n", "a.txt", 1).expect("blame truncates");

        assert_eq!(blame.lines.len(), 1);
        assert_eq!(blame.total_lines, 2);
        assert!(blame.truncated);
    }

    #[test]
    fn rejects_svn_blame_content_line_mismatch() {
        let xml = r#"
<blame><target path="a.txt">
  <entry line-number="1"><commit revision="1"/></entry>
</target></blame>
"#;

        let error = parse_svn_blame_xml(xml, "one\ntwo\n", "a.txt", 100)
            .expect_err("mismatched blame must fail");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "SVN_BLAME_CONTENT_MISMATCH");
            }
        }
    }

    #[test]
    fn identifies_only_text_conflicts_from_status_xml() {
        let conflicted = r#"<status><target path="."><entry path="main.txt"><wc-status item="conflicted" props="none" /></entry></target></status>"#;
        let property_conflict = r#"<status><target path="."><entry path="main.txt"><wc-status item="modified" props="conflicted" /></entry></target></status>"#;

        assert!(parse_text_conflict_status(conflicted).unwrap());
        assert!(!parse_text_conflict_status(property_conflict).unwrap());
        assert!(parse_text_conflict_status("not xml").is_err());
    }

    #[test]
    fn writes_visual_merge_result_and_marks_real_svn_conflict_resolved() {
        if !svn_test_tools_available() {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-conflict-resolution-integration-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let mine = root.join("mine");
        let theirs = root.join("theirs");
        fs::create_dir_all(&import_dir).expect("create conflict fixture");
        fs::write(import_dir.join("main.txt"), "base\n").expect("write conflict base");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&mine),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&theirs),
        );
        fs::write(theirs.join("main.txt"), "theirs\n").expect("write incoming change");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(theirs.join("main.txt"))
                .args(["-m", "incoming"]),
        );
        fs::write(mine.join("main.txt"), "mine\n").expect("write local change");
        run_test_command(Command::new("svn").arg("update").arg(&mine));

        let result = resolve_text_conflict(ResolveTextConflictRequest {
            working_copy_root: mine.display().to_string(),
            file_path: "main.txt".to_string(),
            resolved_text: "resolved\n".to_string(),
            svn_executable: None,
        })
        .expect("visual conflict resolution succeeds");

        assert!(result.resolved);
        assert_eq!(result.path, "main.txt");
        assert_eq!(
            fs::read_to_string(mine.join("main.txt")).unwrap(),
            "resolved\n"
        );
        let status = Command::new("svn")
            .args(["status", "--xml", "--"])
            .arg(mine.join("main.txt"))
            .current_dir(&mine)
            .output()
            .expect("read resolved status");
        assert!(status.status.success());
        assert!(!parse_text_conflict_status(&String::from_utf8_lossy(&status.stdout)).unwrap());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reads_svn_blame_from_real_working_copy() {
        if Command::new("svn")
            .arg("--version")
            .arg("--quiet")
            .output()
            .is_err()
            || Command::new("svnadmin")
                .arg("--version")
                .arg("--quiet")
                .output()
                .is_err()
        {
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "novasvn-blame-integration-{}-{unique}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let import_dir = root.join("import");
        let working_copy = root.join("working-copy");
        fs::create_dir_all(&import_dir).expect("create import directory");
        fs::write(import_dir.join("main.txt"), "first line\nsecond line\n")
            .expect("write imported file");

        run_test_command(Command::new("svnadmin").arg("create").arg(&repository));
        let repository_url = format!("file://{}", repository.display());
        run_test_command(
            Command::new("svn")
                .arg("import")
                .arg(&import_dir)
                .arg(&repository_url)
                .args(["-m", "initial", "--username", "alice"]),
        );
        run_test_command(
            Command::new("svn")
                .arg("checkout")
                .arg(&repository_url)
                .arg(&working_copy),
        );
        fs::write(working_copy.join("main.txt"), "first line\nchanged line\n")
            .expect("update working-copy file");
        run_test_command(
            Command::new("svn")
                .arg("commit")
                .arg(working_copy.join("main.txt"))
                .args(["-m", "change second line", "--username", "bob"]),
        );

        let blame = get_svn_blame(GetSvnBlameRequest {
            working_copy_root: working_copy.display().to_string(),
            file_path: "main.txt".to_string(),
            svn_executable: None,
            max_lines: Some(100),
        })
        .expect("real blame succeeds");

        assert_eq!(blame.total_lines, 2);
        assert_eq!(blame.lines[0].revision, "1");
        assert_eq!(blame.lines[0].content, "first line");
        assert_eq!(blame.lines[1].revision, "2");
        assert_eq!(blame.lines[1].content, "changed line");
        let _ = fs::remove_dir_all(root);
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
    fn requires_existing_absolute_path_for_standalone_log() {
        let absolute = std::env::temp_dir();
        assert_eq!(
            normalize_svn_log_target_path(&absolute.display().to_string()).unwrap(),
            absolute
        );

        let error = normalize_svn_log_target_path("relative/path")
            .expect_err("relative standalone log target must fail");
        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "SVN_LOG_TARGET_NOT_ABSOLUTE");
            }
        }
    }

    #[test]
    fn reports_update_specific_target_validation_errors() {
        let error = normalize_update_target_path("relative/path")
            .expect_err("relative standalone update target must fail");
        match error {
            NovaError::Command { code, message, .. } => {
                assert_eq!(code, "UPDATE_TARGET_NOT_ABSOLUTE");
                assert!(message.contains("Update 目标"));
            }
        }
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
    fn reads_workspace_path_sizes_and_reports_missing_files_as_zero() {
        let root =
            std::env::temp_dir().join(format!("novasvn-path-size-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/main.txt"), b"123456").unwrap();

        let sizes = get_workspace_path_sizes(GetWorkspacePathSizesRequest {
            working_copy_root: root.display().to_string(),
            paths: vec!["src/main.txt".to_string(), "src/missing.txt".to_string()],
        })
        .unwrap();

        assert_eq!(sizes.len(), 2);
        assert_eq!(sizes[0].path, "src/main.txt");
        assert_eq!(sizes[0].bytes, 6);
        assert_eq!(sizes[1].path, "src/missing.txt");
        assert_eq!(sizes[1].bytes, 0);
        fs::remove_dir_all(root).unwrap();
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
