use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::NovaError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchPoolEntry {
    pub id: String,
    pub branch_url: String,
    pub local_path: String,
    pub revision: String,
    pub local_changes: usize,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BranchPool {
    pub entries: Vec<BranchPoolEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveBranchPoolEntryRequest {
    pub branch_url: String,
    pub local_path: String,
    pub revision: Option<String>,
    pub local_changes: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveBranchPoolEntryRequest {
    pub id: String,
    pub delete_local_copy: Option<bool>,
}

pub fn read_branch_pool(app: &AppHandle) -> Result<BranchPool, NovaError> {
    let path = branch_pool_path(app)?;
    if !path.exists() {
        return Ok(BranchPool::default());
    }

    let content = fs::read_to_string(&path).map_err(|error| {
        NovaError::command(
            "BRANCH_POOL_READ_FAILED",
            "读取分支工作副本池失败",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    serde_json::from_str(&content).map_err(|error| {
        NovaError::command(
            "BRANCH_POOL_PARSE_FAILED",
            "解析分支工作副本池失败",
            Some(error.to_string()),
            true,
        )
    })
}

pub fn save_branch_pool_entry(
    app: &AppHandle,
    request: SaveBranchPoolEntryRequest,
) -> Result<BranchPool, NovaError> {
    let branch_url = request.branch_url.trim();
    let local_path = request.local_path.trim();
    if branch_url.is_empty() || local_path.is_empty() {
        return Err(NovaError::command(
            "BRANCH_POOL_ENTRY_INVALID",
            "分支 URL 和本地路径不能为空",
            None,
            true,
        ));
    }

    let mut pool = read_branch_pool(app)?;
    let now = timestamp_millis();
    let id = entry_id(branch_url, local_path);
    let revision = request.revision.unwrap_or_default();
    let local_changes = request.local_changes.unwrap_or_default();

    if let Some(entry) = pool.entries.iter_mut().find(|entry| entry.id == id) {
        entry.branch_url = branch_url.to_string();
        entry.local_path = local_path.to_string();
        entry.revision = revision;
        entry.local_changes = local_changes;
        entry.updated_at = now;
    } else {
        pool.entries.push(BranchPoolEntry {
            id,
            branch_url: branch_url.to_string(),
            local_path: local_path.to_string(),
            revision,
            local_changes,
            created_at: now,
            updated_at: now,
        });
    }

    write_branch_pool(app, &pool)?;
    Ok(pool)
}

pub fn remove_branch_pool_entry(
    app: &AppHandle,
    request: RemoveBranchPoolEntryRequest,
) -> Result<BranchPool, NovaError> {
    let mut pool = read_branch_pool(app)?;
    let Some(index) = pool.entries.iter().position(|entry| entry.id == request.id) else {
        return Ok(pool);
    };

    let entry = pool.entries[index].clone();
    if request.delete_local_copy.unwrap_or(false) {
        remove_local_working_copy(&entry)?;
    }

    pool.entries.remove(index);
    write_branch_pool(app, &pool)?;
    Ok(pool)
}

fn remove_local_working_copy(entry: &BranchPoolEntry) -> Result<(), NovaError> {
    let path = PathBuf::from(entry.local_path.trim());
    if path.as_os_str().is_empty() {
        return Err(NovaError::command(
            "BRANCH_POOL_LOCAL_PATH_EMPTY",
            "分支工作副本路径为空，无法清理",
            Some(format!("池项：{}", entry.branch_url)),
            true,
        ));
    }

    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        NovaError::command(
            "BRANCH_POOL_LOCAL_PATH_MISSING",
            "分支工作副本路径不存在，未移除池项",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(NovaError::command(
            "BRANCH_POOL_LOCAL_PATH_INVALID",
            "分支工作副本路径不是普通目录，未移除池项",
            Some(format!("路径：{}", path.display())),
            true,
        ));
    }

    if !path.join(".svn").is_dir() {
        return Err(NovaError::command(
            "BRANCH_POOL_LOCAL_PATH_NOT_SVN",
            "分支工作副本路径不是 SVN 工作副本根目录，未移除池项",
            Some(format!("路径：{}", path.display())),
            true,
        ));
    }

    fs::remove_dir_all(&path).map_err(|error| {
        NovaError::command(
            "BRANCH_POOL_LOCAL_DELETE_FAILED",
            "删除分支工作副本目录失败，未移除池项",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })
}

fn write_branch_pool(app: &AppHandle, pool: &BranchPool) -> Result<(), NovaError> {
    let path = branch_pool_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            NovaError::command(
                "BRANCH_POOL_DIR_FAILED",
                "创建分支工作副本池目录失败",
                Some(format!("路径：{}。错误：{error}", parent.display())),
                true,
            )
        })?;
    }

    let content = serde_json::to_string_pretty(pool).map_err(|error| {
        NovaError::command(
            "BRANCH_POOL_SERIALIZE_FAILED",
            "序列化分支工作副本池失败",
            Some(error.to_string()),
            true,
        )
    })?;
    fs::write(&path, content).map_err(|error| {
        NovaError::command(
            "BRANCH_POOL_WRITE_FAILED",
            "保存分支工作副本池失败",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })
}

fn branch_pool_path(app: &AppHandle) -> Result<PathBuf, NovaError> {
    let dir = app.path().app_data_dir().map_err(|error| {
        NovaError::command(
            "APP_DATA_DIR_FAILED",
            "无法获取应用数据目录",
            Some(error.to_string()),
            true,
        )
    })?;

    Ok(dir.join("branch-pool.json"))
}

fn entry_id(branch_url: &str, local_path: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in format!("{branch_url}\n{local_path}").as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }

    format!("pool-{hash:016x}")
}

fn timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("系统时间早于 UNIX_EPOCH")
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_branch_pool_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "novasvn-branch-pool-{name}-{}-{}",
            std::process::id(),
            timestamp_millis()
        ))
    }

    fn branch_entry(path: &std::path::Path) -> BranchPoolEntry {
        BranchPoolEntry {
            id: "pool-test".to_string(),
            branch_url: "https://example.com/svn/branches/feature".to_string(),
            local_path: path.to_string_lossy().to_string(),
            revision: "123".to_string(),
            local_changes: 0,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn removes_local_svn_working_copy_directory() {
        let root = temp_branch_pool_dir("remove");
        let working_copy = root.join("feature");
        fs::create_dir_all(working_copy.join(".svn")).expect("create fake working copy");
        fs::write(working_copy.join("README.txt"), "demo").expect("create file");

        remove_local_working_copy(&branch_entry(&working_copy)).expect("remove local copy");

        assert!(!working_copy.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_to_remove_non_svn_directory() {
        let root = temp_branch_pool_dir("non-svn");
        fs::create_dir_all(&root).expect("create normal directory");

        let error = remove_local_working_copy(&branch_entry(&root)).expect_err("reject non svn");

        match error {
            NovaError::Command { code, .. } => {
                assert_eq!(code, "BRANCH_POOL_LOCAL_PATH_NOT_SVN");
            }
        }
        assert!(root.exists());
        let _ = fs::remove_dir_all(root);
    }
}
