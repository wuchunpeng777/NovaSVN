#[allow(dead_code)]
pub const BLOCKED_STATUSES: &[&str] = &["missing", "conflicted", "obstructed"];

#[allow(dead_code)]
pub fn is_stageable_status(status: &str) -> bool {
    !BLOCKED_STATUSES.contains(&status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blocked_statuses() {
        assert!(!is_stageable_status("missing"));
        assert!(!is_stageable_status("conflicted"));
        assert!(!is_stageable_status("obstructed"));
    }

    #[test]
    fn accepts_regular_commit_statuses() {
        assert!(is_stageable_status("modified"));
        assert!(is_stageable_status("added"));
        assert!(is_stageable_status("deleted"));
        assert!(is_stageable_status("unversioned"));
    }
}
