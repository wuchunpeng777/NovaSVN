use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::{error::NovaError, svn};

pub const MERGE_PREVIEW_MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;
const SESSION_FILE_NAME: &str = "session.json";
const SESSION_LIFETIME_MILLIS: u64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergePreviewFile {
    pub path: String,
    pub action: String,
    pub conflicted: bool,
    pub property_only: bool,
    pub binary: bool,
    pub too_large: bool,
    pub original_exists: bool,
    pub modified_exists: bool,
    pub original_bytes: u64,
    pub modified_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergePreviewSession {
    pub preview_id: String,
    pub working_copy_root: String,
    #[serde(default)]
    pub target_relative_path: String,
    pub source_url: String,
    pub revision_range: String,
    pub start_revision: Option<String>,
    pub end_revision: Option<String>,
    pub revisions: Vec<String>,
    pub record_only: bool,
    pub ignore_ancestry: bool,
    pub force: bool,
    pub svn_executable: String,
    pub snapshot_digest: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub output_text: String,
    pub files: Vec<MergePreviewFile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MergePreviewIdRequest {
    pub preview_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GetMergePreviewFileRequest {
    pub preview_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergePreviewFileContent {
    pub path: String,
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

#[derive(Debug, Clone, Serialize)]
pub struct ReleasedMergePreview {
    pub preview_id: String,
    pub released: bool,
}

pub fn preview_root(app: &AppHandle) -> Result<PathBuf, NovaError> {
    let root = app.path().app_cache_dir().map_err(|error| {
        NovaError::command(
            "MERGE_PREVIEW_CACHE_UNAVAILABLE",
            "无法定位 Merge 预览缓存目录",
            Some(error.to_string()),
            true,
        )
    })?;
    Ok(root.join("merge-previews"))
}

pub fn session_dir(app: &AppHandle, preview_id: &str) -> Result<PathBuf, NovaError> {
    validate_preview_id(preview_id)?;
    Ok(preview_root(app)?.join(preview_id))
}

pub fn prepare_session_dir(
    app: &AppHandle,
    preview_id: &str,
    working_copy_root: &Path,
) -> Result<PathBuf, NovaError> {
    cleanup_expired_sessions(app)?;
    let directory = session_dir(app, preview_id)?;
    let root = preview_root(app)?;
    if root.starts_with(working_copy_root) {
        return Err(NovaError::command(
            "MERGE_PREVIEW_CACHE_INSIDE_WORKSPACE",
            "Merge 预览缓存不能位于目标工作副本内",
            Some(root.display().to_string()),
            true,
        ));
    }
    fs::create_dir_all(directory.parent().unwrap_or(&root)).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_CACHE_CREATE_FAILED",
            "无法创建 Merge 预览缓存目录",
            &root,
            error,
        )
    })?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let marker = directory.with_extension("creating");
    options.open(&marker).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_SESSION_EXISTS",
            "Merge 预览会话已存在",
            &marker,
            error,
        )
    })?;
    let created = fs::create_dir(&directory);
    let _ = fs::remove_file(&marker);
    created.map_err(|error| {
        io_error(
            "MERGE_PREVIEW_SESSION_CREATE_FAILED",
            "无法创建 Merge 预览会话",
            &directory,
            error,
        )
    })?;
    Ok(directory)
}

pub fn write_session(app: &AppHandle, session: &MergePreviewSession) -> Result<(), NovaError> {
    let directory = session_dir(app, &session.preview_id)?;
    let path = directory.join(SESSION_FILE_NAME);
    let temporary = directory.join("session.json.tmp");
    let bytes = serde_json::to_vec_pretty(session).map_err(|error| {
        NovaError::command(
            "MERGE_PREVIEW_SERIALIZE_FAILED",
            "无法保存 Merge 预览会话",
            Some(error.to_string()),
            true,
        )
    })?;
    fs::write(&temporary, bytes).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_WRITE_FAILED",
            "无法保存 Merge 预览会话",
            &temporary,
            error,
        )
    })?;
    fs::rename(&temporary, &path).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_WRITE_FAILED",
            "无法保存 Merge 预览会话",
            &path,
            error,
        )
    })
}

pub fn read_session(app: &AppHandle, preview_id: &str) -> Result<MergePreviewSession, NovaError> {
    let path = session_dir(app, preview_id)?.join(SESSION_FILE_NAME);
    let bytes = fs::read(&path).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_NOT_FOUND",
            "Merge 预览不存在或已过期",
            &path,
            error,
        )
    })?;
    let session: MergePreviewSession = serde_json::from_slice(&bytes).map_err(|error| {
        NovaError::command(
            "MERGE_PREVIEW_INVALID",
            "Merge 预览数据已损坏",
            Some(error.to_string()),
            true,
        )
    })?;
    if session.expires_at <= timestamp_millis() {
        let _ = release_session(app, preview_id);
        return Err(NovaError::command(
            "MERGE_PREVIEW_EXPIRED",
            "Merge 预览已过期",
            Some("请返回 Log 窗口重新生成预览。".to_string()),
            true,
        ));
    }
    Ok(session)
}

pub fn release_session(
    app: &AppHandle,
    preview_id: &str,
) -> Result<ReleasedMergePreview, NovaError> {
    let directory = session_dir(app, preview_id)?;
    if !directory.exists() {
        return Ok(ReleasedMergePreview {
            preview_id: preview_id.to_string(),
            released: false,
        });
    }
    fs::remove_dir_all(&directory).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_RELEASE_FAILED",
            "无法清理 Merge 预览",
            &directory,
            error,
        )
    })?;
    Ok(ReleasedMergePreview {
        preview_id: preview_id.to_string(),
        released: true,
    })
}

pub fn read_preview_file(
    app: &AppHandle,
    request: &GetMergePreviewFileRequest,
) -> Result<MergePreviewFileContent, NovaError> {
    let session = read_session(app, &request.preview_id)?;
    let file = session
        .files
        .iter()
        .find(|file| file.path == request.path)
        .ok_or_else(|| {
            NovaError::command(
                "MERGE_PREVIEW_FILE_NOT_FOUND",
                "Merge 预览文件不存在",
                Some(request.path.clone()),
                true,
            )
        })?;
    let directory = session_dir(app, &request.preview_id)?;
    let relative = safe_relative_path(&file.path)?;
    let modified_root = session_working_target_dir(&directory, &session.target_relative_path)?;
    let original_path = directory.join("original").join(&relative);
    let modified_path = modified_root.join(&relative);

    if file.too_large {
        return Ok(MergePreviewFileContent {
            path: file.path.clone(),
            original_text: String::new(),
            modified_text: String::new(),
            language: language_for_path(&file.path),
            binary: file.binary,
            too_large: true,
            max_bytes: MERGE_PREVIEW_MAX_TEXT_BYTES,
            is_image: false,
            image_mime: None,
            original_bytes_base64: None,
            modified_bytes_base64: None,
            original_byte_size: file.original_bytes,
            modified_byte_size: file.modified_bytes,
        });
    }

    if is_previewable_image(&file.path) {
        let original_bytes = if file.original_exists {
            read_bytes_file(&original_path)?
        } else {
            Vec::new()
        };
        let modified_bytes = if file.modified_exists {
            read_bytes_file(&modified_path)?
        } else {
            Vec::new()
        };
        return Ok(MergePreviewFileContent {
            path: file.path.clone(),
            original_text: String::new(),
            modified_text: String::new(),
            language: language_for_path(&file.path),
            binary: true,
            too_large: false,
            max_bytes: MERGE_PREVIEW_MAX_TEXT_BYTES,
            is_image: true,
            image_mime: Some(image_mime_for_path(&file.path).to_string()),
            original_byte_size: original_bytes.len() as u64,
            modified_byte_size: modified_bytes.len() as u64,
            original_bytes_base64: if original_bytes.is_empty() {
                None
            } else {
                Some(BASE64.encode(&original_bytes))
            },
            modified_bytes_base64: if modified_bytes.is_empty() {
                None
            } else {
                Some(BASE64.encode(&modified_bytes))
            },
        });
    }

    if file.binary {
        return Ok(MergePreviewFileContent {
            path: file.path.clone(),
            original_text: String::new(),
            modified_text: String::new(),
            language: language_for_path(&file.path),
            binary: true,
            too_large: false,
            max_bytes: MERGE_PREVIEW_MAX_TEXT_BYTES,
            is_image: false,
            image_mime: None,
            original_bytes_base64: None,
            modified_bytes_base64: None,
            original_byte_size: file.original_bytes,
            modified_byte_size: file.modified_bytes,
        });
    }

    let original = if file.original_exists {
        read_utf8_file(&original_path)?
    } else {
        String::new()
    };
    let modified = if file.modified_exists {
        read_utf8_file(&modified_path)?
    } else {
        String::new()
    };
    Ok(MergePreviewFileContent {
        path: file.path.clone(),
        original_text: original,
        modified_text: modified,
        language: language_for_path(&file.path),
        binary: false,
        too_large: false,
        max_bytes: MERGE_PREVIEW_MAX_TEXT_BYTES,
        is_image: false,
        image_mime: None,
        original_bytes_base64: None,
        modified_bytes_base64: None,
        original_byte_size: file.original_bytes,
        modified_byte_size: file.modified_bytes,
    })
}

pub fn workspace_snapshot_digest(executable: &str, root: &Path) -> Result<String, NovaError> {
    workspace_snapshot_digest_with(executable, root, |command| command.output(), || false)
}

pub fn workspace_snapshot_digest_with<RunCommand, ShouldCancel>(
    executable: &str,
    root: &Path,
    mut run_command: RunCommand,
    should_cancel: ShouldCancel,
) -> Result<String, NovaError>
where
    RunCommand: FnMut(&mut Command) -> std::io::Result<Output>,
    ShouldCancel: Fn() -> bool,
{
    let mut hasher = Sha256::new();
    for arguments in [
        vec!["status", "--xml", "--no-ignore"],
        vec!["info", "--show-item", "url"],
        vec!["info", "--show-item", "revision"],
    ] {
        ensure_preview_not_cancelled(&should_cancel)?;
        let mut command = svn::command(executable);
        command.args(arguments).arg(root).current_dir(root);
        let output = run_command(&mut command).map_err(|error| {
            NovaError::command(
                "MERGE_PREVIEW_SNAPSHOT_FAILED",
                "无法读取 Merge 目标快照",
                Some(error.to_string()),
                true,
            )
        })?;
        if !output.status.success() {
            return Err(NovaError::command(
                "MERGE_PREVIEW_SNAPSHOT_FAILED",
                "无法读取 Merge 目标快照",
                Some(command_output_detail(executable, &output)),
                true,
            ));
        }
        hasher.update(&output.stdout);
    }
    hash_workspace_tree(root, root, &mut hasher, &should_cancel)?;
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
pub fn copy_working_copy(source: &Path, destination: &Path) -> Result<(), NovaError> {
    copy_working_copy_with_cancel(source, destination, || false)
}

pub fn copy_working_copy_with_cancel<ShouldCancel>(
    source: &Path,
    destination: &Path,
    should_cancel: ShouldCancel,
) -> Result<(), NovaError>
where
    ShouldCancel: Fn() -> bool,
{
    if destination.exists() {
        return Err(NovaError::command(
            "MERGE_PREVIEW_COPY_TARGET_EXISTS",
            "Merge 预览目标目录已存在",
            Some(destination.display().to_string()),
            true,
        ));
    }
    copy_tree(source, destination, &should_cancel)
}

#[cfg(test)]
pub fn save_original_file(
    session_directory: &Path,
    work_directory: &Path,
    relative_path: &str,
) -> Result<(bool, u64), NovaError> {
    save_original_file_with_cancel(session_directory, work_directory, relative_path, || false)
}

pub fn save_original_file_with_cancel<ShouldCancel>(
    session_directory: &Path,
    work_directory: &Path,
    relative_path: &str,
    should_cancel: ShouldCancel,
) -> Result<(bool, u64), NovaError>
where
    ShouldCancel: Fn() -> bool,
{
    ensure_preview_not_cancelled(&should_cancel)?;
    let relative = safe_relative_path(relative_path)?;
    let source = work_directory.join(&relative);
    if !source.is_file() {
        return Ok((false, 0));
    }
    let destination = session_directory.join("original").join(relative);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            io_error(
                "MERGE_PREVIEW_ORIGINAL_CREATE_FAILED",
                "无法保存 Merge 前文件",
                parent,
                error,
            )
        })?;
    }
    let metadata = source.metadata().map_err(|error| {
        io_error(
            "MERGE_PREVIEW_ORIGINAL_COPY_FAILED",
            "无法读取 Merge 前文件",
            &source,
            error,
        )
    })?;
    copy_file(&source, &destination, &metadata, &should_cancel)?;
    Ok((true, metadata.len()))
}

pub fn inspect_preview_file(
    session_directory: &Path,
    modified_root: &Path,
    relative_path: &str,
    action: String,
    conflicted: bool,
    property_only: bool,
) -> Result<MergePreviewFile, NovaError> {
    let relative = safe_relative_path(relative_path)?;
    let original = session_directory.join("original").join(&relative);
    let modified = modified_root.join(&relative);
    let original_exists = original.is_file();
    let modified_exists = modified.is_file();
    let original_bytes = file_size(&original);
    let modified_bytes = file_size(&modified);
    let too_large = original_bytes > MERGE_PREVIEW_MAX_TEXT_BYTES
        || modified_bytes > MERGE_PREVIEW_MAX_TEXT_BYTES;
    let binary = (!too_large && original_exists && file_is_binary(&original)?)
        || (!too_large && modified_exists && file_is_binary(&modified)?);
    Ok(MergePreviewFile {
        path: relative_path.replace('\\', "/"),
        action,
        conflicted,
        property_only,
        binary,
        too_large,
        original_exists,
        modified_exists,
        original_bytes,
        modified_bytes,
    })
}

pub fn new_session_expiry(created_at: u64) -> u64 {
    created_at.saturating_add(SESSION_LIFETIME_MILLIS)
}

fn validate_preview_id(preview_id: &str) -> Result<(), NovaError> {
    if preview_id.len() != 64 || !preview_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(NovaError::command(
            "MERGE_PREVIEW_ID_INVALID",
            "Merge 预览标识无效",
            None,
            false,
        ));
    }
    Ok(())
}

pub fn cleanup_expired_sessions(app: &AppHandle) -> Result<(), NovaError> {
    let root = preview_root(app)?;
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(());
    };
    let now = timestamp_millis();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let expired = fs::read(path.join(SESSION_FILE_NAME))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<MergePreviewSession>(&bytes).ok())
            .map(|session| session.expires_at <= now)
            .unwrap_or_else(|| {
                entry
                    .metadata()
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|modified| modified.elapsed().ok())
                    .is_some_and(|age| age.as_millis() as u64 > SESSION_LIFETIME_MILLIS)
            });
        if expired {
            let _ = fs::remove_dir_all(path);
        }
    }
    Ok(())
}

fn hash_workspace_tree<ShouldCancel>(
    root: &Path,
    directory: &Path,
    hasher: &mut Sha256,
    should_cancel: &ShouldCancel,
) -> Result<(), NovaError>
where
    ShouldCancel: Fn() -> bool,
{
    ensure_preview_not_cancelled(should_cancel)?;
    let mut entries = fs::read_dir(directory)
        .map_err(|error| {
            io_error(
                "MERGE_PREVIEW_SNAPSHOT_READ_FAILED",
                "无法读取 Merge 目标文件",
                directory,
                error,
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            io_error(
                "MERGE_PREVIEW_SNAPSHOT_READ_FAILED",
                "无法读取 Merge 目标文件",
                directory,
                error,
            )
        })?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        ensure_preview_not_cancelled(should_cancel)?;
        if entry.file_name() == ".svn" {
            continue;
        }
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(&path);
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            io_error(
                "MERGE_PREVIEW_SNAPSHOT_READ_FAILED",
                "无法读取 Merge 目标文件",
                &path,
                error,
            )
        })?;
        if is_unsupported_reparse_point(&metadata) {
            return Err(NovaError::command(
                "MERGE_PREVIEW_REPARSE_POINT_UNSUPPORTED",
                "Merge 预览不会跟随目录联接或重解析点",
                Some(path.display().to_string()),
                true,
            ));
        }
        hasher.update(relative.to_string_lossy().as_bytes());
        if metadata.file_type().is_symlink() {
            hasher.update(b"L");
            hasher.update(
                fs::read_link(&path)
                    .map_err(|error| {
                        io_error(
                            "MERGE_PREVIEW_SNAPSHOT_READ_FAILED",
                            "无法读取 Merge 目标链接",
                            &path,
                            error,
                        )
                    })?
                    .to_string_lossy()
                    .as_bytes(),
            );
        } else if metadata.is_dir() {
            hasher.update(b"D");
            hash_workspace_tree(root, &path, hasher, should_cancel)?;
        } else if metadata.is_file() {
            hasher.update(b"F");
            hasher.update(metadata.len().to_le_bytes());
            let mut file = fs::File::open(&path).map_err(|error| {
                io_error(
                    "MERGE_PREVIEW_SNAPSHOT_READ_FAILED",
                    "无法读取 Merge 目标文件",
                    &path,
                    error,
                )
            })?;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                ensure_preview_not_cancelled(should_cancel)?;
                let read = file.read(&mut buffer).map_err(|error| {
                    io_error(
                        "MERGE_PREVIEW_SNAPSHOT_READ_FAILED",
                        "无法读取 Merge 目标文件",
                        &path,
                        error,
                    )
                })?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
        }
    }
    Ok(())
}

fn copy_tree<ShouldCancel>(
    source: &Path,
    destination: &Path,
    should_cancel: &ShouldCancel,
) -> Result<(), NovaError>
where
    ShouldCancel: Fn() -> bool,
{
    ensure_preview_not_cancelled(should_cancel)?;
    let metadata = fs::symlink_metadata(source).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_COPY_FAILED",
            "无法复制 Merge 目标工作副本",
            source,
            error,
        )
    })?;
    if is_unsupported_reparse_point(&metadata) {
        return Err(NovaError::command(
            "MERGE_PREVIEW_REPARSE_POINT_UNSUPPORTED",
            "Merge 预览不会跟随目录联接或重解析点",
            Some(source.display().to_string()),
            true,
        ));
    }
    if metadata.file_type().is_symlink() {
        return copy_symlink(source, destination);
    }
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|error| {
            io_error(
                "MERGE_PREVIEW_COPY_FAILED",
                "无法创建 Merge 预览目录",
                destination,
                error,
            )
        })?;
        let mut entries = fs::read_dir(source)
            .map_err(|error| {
                io_error(
                    "MERGE_PREVIEW_COPY_FAILED",
                    "无法读取 Merge 目标工作副本",
                    source,
                    error,
                )
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                io_error(
                    "MERGE_PREVIEW_COPY_FAILED",
                    "无法读取 Merge 目标工作副本",
                    source,
                    error,
                )
            })?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            copy_tree(
                &entry.path(),
                &destination.join(entry.file_name()),
                should_cancel,
            )?;
        }
        return Ok(());
    }
    if metadata.is_file() {
        copy_file(source, destination, &metadata, should_cancel)?;
    }
    Ok(())
}

fn copy_file<ShouldCancel>(
    source: &Path,
    destination: &Path,
    metadata: &fs::Metadata,
    should_cancel: &ShouldCancel,
) -> Result<(), NovaError>
where
    ShouldCancel: Fn() -> bool,
{
    let mut reader = fs::File::open(source).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_COPY_FAILED",
            "无法读取 Merge 目标文件",
            source,
            error,
        )
    })?;
    let mut writer = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(destination)
        .map_err(|error| {
            io_error(
                "MERGE_PREVIEW_COPY_FAILED",
                "无法创建 Merge 预览文件",
                destination,
                error,
            )
        })?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        ensure_preview_not_cancelled(should_cancel)?;
        let read = reader.read(&mut buffer).map_err(|error| {
            io_error(
                "MERGE_PREVIEW_COPY_FAILED",
                "无法读取 Merge 目标文件",
                source,
                error,
            )
        })?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read]).map_err(|error| {
            io_error(
                "MERGE_PREVIEW_COPY_FAILED",
                "无法写入 Merge 预览文件",
                destination,
                error,
            )
        })?;
    }
    fs::set_permissions(destination, metadata.permissions()).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_COPY_FAILED",
            "无法设置 Merge 预览文件权限",
            destination,
            error,
        )
    })?;
    Ok(())
}

fn ensure_preview_not_cancelled<ShouldCancel>(should_cancel: &ShouldCancel) -> Result<(), NovaError>
where
    ShouldCancel: Fn() -> bool,
{
    if should_cancel() {
        return Err(NovaError::command(
            "MERGE_PREVIEW_CANCELLED",
            "Merge 预览已取消",
            None,
            true,
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn copy_symlink(source: &Path, destination: &Path) -> Result<(), NovaError> {
    use std::os::unix::fs::symlink;
    let target = fs::read_link(source).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_COPY_LINK_FAILED",
            "无法读取 Merge 目标链接",
            source,
            error,
        )
    })?;
    symlink(target, destination).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_COPY_LINK_FAILED",
            "无法复制 Merge 目标链接",
            source,
            error,
        )
    })
}

#[cfg(windows)]
fn copy_symlink(source: &Path, _destination: &Path) -> Result<(), NovaError> {
    Err(NovaError::command(
        "MERGE_PREVIEW_LINK_UNSUPPORTED",
        "Windows Merge 预览不会复制文件系统链接",
        Some(source.display().to_string()),
        true,
    ))
}

#[cfg(windows)]
fn is_unsupported_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        && !metadata.file_type().is_symlink()
}

#[cfg(not(windows))]
fn is_unsupported_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn safe_relative_path(value: &str) -> Result<PathBuf, NovaError> {
    let normalized = value.replace('\\', "/");
    let bytes = normalized.as_bytes();
    let has_windows_drive_prefix =
        bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    let path = PathBuf::from(normalized.replace('/', std::path::MAIN_SEPARATOR_STR));
    if normalized.is_empty()
        || has_windows_drive_prefix
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(NovaError::command(
            "MERGE_PREVIEW_PATH_INVALID",
            "Merge 预览文件路径无效",
            Some(value.to_string()),
            false,
        ));
    }
    Ok(path)
}

fn session_working_target_dir(
    session_directory: &Path,
    target_relative_path: &str,
) -> Result<PathBuf, NovaError> {
    let work_directory = session_directory.join("work");
    if target_relative_path.is_empty() {
        return Ok(work_directory);
    }
    Ok(work_directory.join(safe_relative_path(target_relative_path)?))
}

fn read_utf8_file(path: &Path) -> Result<String, NovaError> {
    let bytes = fs::read(path).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_FILE_READ_FAILED",
            "无法读取 Merge 预览文件",
            path,
            error,
        )
    })?;
    String::from_utf8(bytes).map_err(|error| {
        NovaError::command(
            "MERGE_PREVIEW_FILE_ENCODING_INVALID",
            "Merge 预览文件不是 UTF-8 文本",
            Some(error.to_string()),
            true,
        )
    })
}

fn read_bytes_file(path: &Path) -> Result<Vec<u8>, NovaError> {
    fs::read(path).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_FILE_READ_FAILED",
            "无法读取 Merge 预览文件",
            path,
            error,
        )
    })
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

fn file_is_binary(path: &Path) -> Result<bool, NovaError> {
    let mut file = fs::File::open(path).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_FILE_READ_FAILED",
            "无法检查 Merge 预览文件",
            path,
            error,
        )
    })?;
    let mut buffer = [0_u8; 8192];
    let read = file.read(&mut buffer).map_err(|error| {
        io_error(
            "MERGE_PREVIEW_FILE_READ_FAILED",
            "无法检查 Merge 预览文件",
            path,
            error,
        )
    })?;
    Ok(buffer[..read].contains(&0) || std::str::from_utf8(&buffer[..read]).is_err())
}

fn file_size(path: &Path) -> u64 {
    path.metadata().map(|metadata| metadata.len()).unwrap_or(0)
}

fn language_for_path(path: &str) -> String {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "rs" => "rust",
        "css" | "scss" | "less" => "css",
        "html" | "htm" | "svelte" | "vue" => "html",
        "xml" | "csproj" | "props" => "xml",
        "json" => "json",
        "md" | "markdown" => "markdown",
        "sql" => "sql",
        "sh" | "bash" | "ps1" => "shell",
        "yaml" | "yml" => "yaml",
        _ => "plaintext",
    }
    .to_string()
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn command_output_detail(executable: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("`{executable}` 返回退出码 {:?}", output.status.code())
    }
}

fn io_error(
    code: &'static str,
    message: &'static str,
    path: &Path,
    error: std::io::Error,
) -> NovaError {
    NovaError::command(
        code,
        message,
        Some(format!("路径：{}；错误：{error}", path.display())),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn test_directory(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "novasvn-merge-preview-{name}-{}-{}",
            std::process::id(),
            timestamp_millis()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn validates_preview_ids_and_relative_paths() {
        assert!(validate_preview_id(&"a".repeat(64)).is_ok());
        assert!(validate_preview_id("../preview").is_err());
        assert!(safe_relative_path("src/main.rs").is_ok());
        assert!(safe_relative_path("").is_err());
        assert!(safe_relative_path("../outside.txt").is_err());
        assert!(safe_relative_path("..\\outside.txt").is_err());
        assert!(safe_relative_path("C:\\outside.txt").is_err());
        assert!(safe_relative_path("C:/outside.txt").is_err());
        assert!(safe_relative_path("\\\\server\\outside.txt").is_err());
    }

    #[test]
    fn copies_working_copy_and_classifies_text_and_binary_files() {
        let root = test_directory("copy");
        let source = root.join("source");
        let session = root.join("session");
        fs::create_dir_all(source.join("src")).unwrap();
        fs::create_dir_all(&session).unwrap();
        fs::write(source.join("src/main.txt"), "before\n").unwrap();
        fs::write(source.join("src/data.bin"), b"a\0b").unwrap();

        copy_working_copy(&source, &session.join("work")).unwrap();
        save_original_file(&session, &session.join("work"), "src/main.txt").unwrap();
        fs::write(session.join("work/src/main.txt"), "after\n").unwrap();
        save_original_file(&session, &session.join("work"), "src/data.bin").unwrap();

        let text = inspect_preview_file(
            &session,
            &session.join("work"),
            "src/main.txt",
            "M".to_string(),
            false,
            false,
        )
        .unwrap();
        let binary = inspect_preview_file(
            &session,
            &session.join("work"),
            "src/data.bin",
            "M".to_string(),
            false,
            false,
        )
        .unwrap();
        assert!(!text.binary);
        assert!(text.original_exists && text.modified_exists);
        assert!(binary.binary);

        fs::write(session.join("work/src/icon.png"), b"\x89PNG\r\n\x1a\nimage").unwrap();
        save_original_file(&session, &session.join("work"), "src/icon.png").unwrap();
        fs::write(
            session.join("work/src/icon.png"),
            b"\x89PNG\r\n\x1a\nimage-changed",
        )
        .unwrap();
        let image = inspect_preview_file(
            &session,
            &session.join("work"),
            "src/icon.png",
            "M".to_string(),
            false,
            false,
        )
        .unwrap();
        assert!(image.binary);
        assert!(is_previewable_image(&image.path));

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn stops_copying_working_copy_when_cancellation_is_requested() {
        let root = test_directory("cancel-copy");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("large.bin"), vec![7_u8; 256 * 1024]).unwrap();
        let checks = Cell::new(0_u32);

        let error = copy_working_copy_with_cancel(&source, &destination, || {
            let next = checks.get() + 1;
            checks.set(next);
            next >= 3
        })
        .expect_err("copy should stop after cancellation");

        assert!(matches!(
            error,
            NovaError::Command { ref code, .. } if code == "MERGE_PREVIEW_CANCELLED"
        ));
        assert!(checks.get() >= 3);
        fs::remove_dir_all(root).ok();
    }
}
