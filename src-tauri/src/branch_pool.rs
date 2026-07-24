use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{error::NovaError, path_utils};

static BRANCH_POOL_MUTATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchPoolEntry {
    pub id: String,
    #[serde(default)]
    pub display_name: String,
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
pub struct SaveBranchPoolEntriesRequest {
    pub entries: Vec<SaveBranchPoolEntryRequest>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveBranchPoolEntryRequest {
    pub id: String,
    pub delete_local_copy: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReorderBranchPoolEntriesRequest {
    pub entry_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RenameBranchPoolEntryRequest {
    pub id: String,
    pub display_name: String,
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
    save_branch_pool_entries(
        app,
        SaveBranchPoolEntriesRequest {
            entries: vec![request],
        },
    )
}

pub fn save_branch_pool_entries(
    app: &AppHandle,
    request: SaveBranchPoolEntriesRequest,
) -> Result<BranchPool, NovaError> {
    let entries = request
        .entries
        .into_iter()
        .map(|entry| {
            Ok((
                normalize_branch_url(&entry.branch_url)?,
                normalize_local_path(&entry.local_path)?,
                normalize_revision(entry.revision.as_deref())?,
                entry.local_changes.unwrap_or_default(),
            ))
        })
        .collect::<Result<Vec<_>, NovaError>>()?;
    let _mutation_guard = BRANCH_POOL_MUTATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let mut pool = read_branch_pool(app)?;
    let now = timestamp_millis();
    for (branch_url, local_path, revision, local_changes) in entries {
        upsert_branch_pool_entry(
            &mut pool,
            branch_url,
            local_path,
            revision,
            local_changes,
            now,
        );
    }

    write_branch_pool(app, &pool)?;
    Ok(pool)
}

fn upsert_branch_pool_entry(
    pool: &mut BranchPool,
    branch_url: String,
    local_path: String,
    revision: String,
    local_changes: usize,
    now: u64,
) {
    if let Some(entry) = pool
        .entries
        .iter_mut()
        .find(|entry| same_local_path(&entry.local_path, &local_path))
    {
        entry.branch_url = branch_url;
        entry.local_path = local_path;
        entry.revision = revision;
        entry.local_changes = local_changes;
        entry.updated_at = now;
        return;
    }

    let id = entry_id(&branch_url, &local_path_identity(&local_path));
    pool.entries.push(BranchPoolEntry {
        id,
        display_name: String::new(),
        branch_url,
        local_path,
        revision,
        local_changes,
        created_at: now,
        updated_at: now,
    });
}

pub fn reorder_branch_pool_entries(
    app: &AppHandle,
    request: ReorderBranchPoolEntriesRequest,
) -> Result<BranchPool, NovaError> {
    let _mutation_guard = BRANCH_POOL_MUTATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut pool = read_branch_pool(app)?;
    apply_branch_pool_order(&mut pool, &request.entry_ids)?;
    write_branch_pool(app, &pool)?;
    Ok(pool)
}

pub fn rename_branch_pool_entry(
    app: &AppHandle,
    request: RenameBranchPoolEntryRequest,
) -> Result<BranchPool, NovaError> {
    let display_name = normalize_display_name(&request.display_name)?;
    let _mutation_guard = BRANCH_POOL_MUTATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut pool = read_branch_pool(app)?;
    let Some(entry) = pool.entries.iter_mut().find(|entry| entry.id == request.id) else {
        return Err(NovaError::command(
            "BRANCH_POOL_ENTRY_NOT_FOUND",
            "未找到要修改的项目",
            Some(format!("项目 ID：{}", request.id)),
            true,
        ));
    };

    entry.display_name = display_name;
    entry.updated_at = timestamp_millis();
    write_branch_pool(app, &pool)?;
    Ok(pool)
}

fn apply_branch_pool_order(pool: &mut BranchPool, entry_ids: &[String]) -> Result<(), NovaError> {
    let existing_ids = pool
        .entries
        .iter()
        .map(|entry| entry.id.as_str())
        .collect::<HashSet<_>>();
    let requested_ids = entry_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    if entry_ids.len() != pool.entries.len()
        || requested_ids.len() != entry_ids.len()
        || requested_ids != existing_ids
    {
        return Err(NovaError::command(
            "BRANCH_POOL_ORDER_INVALID",
            "项目顺序无效",
            Some("项目顺序必须完整包含当前分支池中的所有项目，且不能重复。".to_string()),
            true,
        ));
    }

    let mut entries_by_id = pool
        .entries
        .drain(..)
        .map(|entry| (entry.id.clone(), entry))
        .collect::<HashMap<_, _>>();
    pool.entries = entry_ids
        .iter()
        .filter_map(|id| entries_by_id.remove(id))
        .collect();
    Ok(())
}

pub fn remove_branch_pool_entry(
    app: &AppHandle,
    request: RemoveBranchPoolEntryRequest,
) -> Result<BranchPool, NovaError> {
    let _mutation_guard = BRANCH_POOL_MUTATION_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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

fn normalize_branch_url(url: &str) -> Result<String, NovaError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "BRANCH_POOL_URL_REQUIRED",
            "分支 URL 不能为空",
            None,
            true,
        ));
    }

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "BRANCH_POOL_URL_INVALID",
            "分支 URL 无效",
            Some("分支 URL 不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(trimmed.trim_end_matches('/').to_string())
}

fn normalize_local_path(path: &str) -> Result<String, NovaError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(NovaError::command(
            "BRANCH_POOL_LOCAL_PATH_REQUIRED",
            "本地工作副本路径不能为空",
            None,
            true,
        ));
    }

    if trimmed.chars().any(char::is_control) {
        return Err(NovaError::command(
            "BRANCH_POOL_LOCAL_PATH_INVALID",
            "本地工作副本路径无效",
            Some("本地路径不能包含控制字符。".to_string()),
            true,
        ));
    }

    let path = Path::new(trimmed);
    if !path_utils::is_absolute_or_home_path(path, trimmed) {
        return Err(NovaError::command(
            "BRANCH_POOL_LOCAL_PATH_INVALID",
            "本地工作副本路径无效",
            Some("本地路径必须是绝对路径或 ~/ 开头路径。".to_string()),
            true,
        ));
    }

    Ok(trimmed.to_string())
}

fn same_local_path(left: &str, right: &str) -> bool {
    local_path_identity(left) == local_path_identity(right)
}

fn local_path_identity(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    let windows_path = normalized.starts_with("//")
        || normalized.as_bytes().get(..3).is_some_and(|prefix| {
            prefix[0].is_ascii_alphabetic() && prefix[1] == b':' && prefix[2] == b'/'
        });
    if windows_path {
        normalized.to_ascii_lowercase()
    } else {
        normalized.to_string()
    }
}

fn normalize_revision(revision: Option<&str>) -> Result<String, NovaError> {
    let Some(value) = revision.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(String::new());
    };

    if value.chars().any(char::is_control) {
        return Err(NovaError::command(
            "BRANCH_POOL_REVISION_INVALID",
            "分支工作副本 revision 无效",
            Some("Revision 不能包含控制字符。".to_string()),
            true,
        ));
    }

    Ok(value.to_string())
}

fn normalize_display_name(display_name: &str) -> Result<String, NovaError> {
    let value = display_name.trim();
    if value.chars().any(char::is_control) || value.chars().count() > 80 {
        return Err(NovaError::command(
            "BRANCH_POOL_DISPLAY_NAME_INVALID",
            "项目备注名无效",
            Some("项目备注名不能包含控制字符，且不能超过 80 个字符。".to_string()),
            true,
        ));
    }
    Ok(value.to_string())
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
            display_name: String::new(),
            branch_url: "https://example.com/svn/branches/feature".to_string(),
            local_path: path.to_string_lossy().to_string(),
            revision: "123".to_string(),
            local_changes: 0,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn normalizes_branch_pool_entry_fields() {
        assert_eq!(
            normalize_branch_url(" https://example.com/svn/branches/feature/ ").unwrap(),
            "https://example.com/svn/branches/feature"
        );
        assert_eq!(
            normalize_local_path(" C:\\wc\\feature ").unwrap(),
            "C:\\wc\\feature"
        );
        assert_eq!(
            normalize_revision(Some(" 123 ")).unwrap(),
            "123".to_string()
        );
        assert_eq!(normalize_revision(Some(" ")).unwrap(), String::new());
        assert_eq!(normalize_revision(None).unwrap(), String::new());
    }

    #[test]
    fn rejects_invalid_branch_pool_entry_fields() {
        assert!(normalize_branch_url(" ").is_err());
        assert!(normalize_branch_url("https://example.com/svn\nbranches").is_err());
        assert!(normalize_local_path("relative\\feature").is_err());
        assert!(normalize_local_path("C:\\wc\nfeature").is_err());
        assert!(normalize_revision(Some("123\n124")).is_err());
        assert!(normalize_display_name("feature\nname").is_err());
        assert!(normalize_display_name(&"x".repeat(81)).is_err());
    }

    #[test]
    fn accepts_trimmed_and_empty_display_names() {
        assert_eq!(normalize_display_name("  客户项目  ").unwrap(), "客户项目");
        assert_eq!(normalize_display_name("   ").unwrap(), "");
    }

    #[test]
    fn upserts_equivalent_windows_paths_without_creating_duplicates() {
        let mut pool = BranchPool {
            entries: vec![BranchPoolEntry {
                id: "existing".to_string(),
                display_name: "主项目".to_string(),
                branch_url: "https://example.com/svn/trunk/old".to_string(),
                local_path: "C:/Work/Game".to_string(),
                revision: "10".to_string(),
                local_changes: 1,
                created_at: 1,
                updated_at: 1,
            }],
        };

        upsert_branch_pool_entry(
            &mut pool,
            "https://example.com/svn/trunk/new".to_string(),
            "c:\\work\\game\\".to_string(),
            "20".to_string(),
            2,
            3,
        );

        assert_eq!(pool.entries.len(), 1);
        assert_eq!(pool.entries[0].id, "existing");
        assert_eq!(pool.entries[0].display_name, "主项目");
        assert_eq!(pool.entries[0].revision, "20");
        assert_eq!(pool.entries[0].local_changes, 2);
    }

    #[test]
    fn upserts_multiple_projects_without_dropping_existing_entries() {
        let mut pool = BranchPool {
            entries: vec![BranchPoolEntry {
                id: "existing".to_string(),
                ..branch_entry(Path::new("C:\\wc\\existing"))
            }],
        };

        upsert_branch_pool_entry(
            &mut pool,
            "https://example.com/svn/trunk/first".to_string(),
            "C:\\wc\\first".to_string(),
            "10".to_string(),
            0,
            2,
        );
        upsert_branch_pool_entry(
            &mut pool,
            "https://example.com/svn/trunk/second".to_string(),
            "C:\\wc\\second".to_string(),
            "11".to_string(),
            1,
            2,
        );

        assert_eq!(pool.entries.len(), 3);
        assert!(pool
            .entries
            .iter()
            .any(|entry| entry.local_path == "C:\\wc\\first"));
        assert!(pool
            .entries
            .iter()
            .any(|entry| entry.local_path == "C:\\wc\\second"));
    }

    #[test]
    fn reorders_entries_only_with_a_complete_unique_id_list() {
        let mut pool = BranchPool {
            entries: vec![
                BranchPoolEntry {
                    id: "first".to_string(),
                    ..branch_entry(Path::new("C:\\wc\\first"))
                },
                BranchPoolEntry {
                    id: "second".to_string(),
                    ..branch_entry(Path::new("C:\\wc\\second"))
                },
            ],
        };

        apply_branch_pool_order(&mut pool, &["second".to_string(), "first".to_string()])
            .expect("reorder entries");
        assert_eq!(
            pool.entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["second", "first"]
        );
        assert!(
            apply_branch_pool_order(&mut pool, &["second".to_string(), "second".to_string()])
                .is_err()
        );
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
