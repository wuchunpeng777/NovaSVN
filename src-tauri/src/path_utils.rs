use std::path::Path;

pub fn is_absolute_or_windows_path(path: &Path, raw: &str) -> bool {
    path.is_absolute() || is_windows_absolute_path(raw)
}

pub fn is_home_relative_path(raw: &str) -> bool {
    raw.starts_with("~/") || raw.starts_with("~\\")
}

pub fn is_absolute_or_home_path(path: &Path, raw: &str) -> bool {
    is_absolute_or_windows_path(path, raw) || is_home_relative_path(raw)
}

pub fn has_parent_segment(raw: &str) -> bool {
    raw.split(['/', '\\']).any(|segment| segment == "..")
}

pub fn normalize_relative_separators(raw: &str) -> String {
    raw.replace('\\', "/")
}

pub fn strip_working_copy_prefix(raw_path: &str, working_copy_root: &Path) -> Option<String> {
    let root = normalize_path_for_compare(&working_copy_root.display().to_string());
    let raw = normalize_path_for_compare(raw_path);
    let relative = raw.strip_prefix(&root)?;
    let relative = relative.trim_start_matches('/');
    if relative.is_empty() {
        None
    } else {
        Some(relative.to_string())
    }
}

fn is_windows_absolute_path(raw: &str) -> bool {
    let value = raw.trim();
    let bytes = value.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
    {
        return true;
    }

    value.starts_with("\\\\") || value.starts_with("//")
}

fn normalize_path_for_compare(raw: &str) -> String {
    let mut value = raw.trim().replace('\\', "/");
    while value.len() > 1 && value.ends_with('/') {
        value.pop();
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_windows_absolute_paths_on_any_platform() {
        assert!(is_windows_absolute_path("C:\\wc\\file.txt"));
        assert!(is_windows_absolute_path("D:/wc/file.txt"));
        assert!(is_windows_absolute_path("\\\\server\\share\\wc"));
        assert!(!is_windows_absolute_path("relative\\file.txt"));
    }

    #[test]
    fn strips_windows_working_copy_prefix() {
        assert_eq!(
            strip_working_copy_prefix("C:\\wc\\src\\main.rs", Path::new("C:\\wc")).as_deref(),
            Some("src/main.rs")
        );
    }
}
