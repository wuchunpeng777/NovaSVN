use std::collections::HashSet;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedDiff {
    pub files: Vec<ParsedFileDiff>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GenerateSelectedPatchRequest {
    pub parsed_diff: ParsedDiff,
    pub selected_hunk_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SelectedPatch {
    pub text: String,
    pub file_count: usize,
    pub hunk_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedFileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub hunks: Vec<ParsedHunk>,
    pub partial_commit_supported: bool,
    pub unsupported_reason: Option<String>,
    pub binary: bool,
    pub property_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedHunk {
    pub id: String,
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub header: String,
    pub lines: Vec<ParsedDiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedDiffLine {
    pub kind: DiffLineKind,
    pub old_line: Option<usize>,
    pub new_line: Option<usize>,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
    NoNewline,
}

pub fn parse_unified_diff(input: &str) -> ParsedDiff {
    let mut files = Vec::new();
    let mut current_file: Option<ParsedFileDiff> = None;
    let mut current_hunk: Option<HunkBuilder> = None;

    for line in input.lines() {
        if let Some(path) = line.strip_prefix("Index: ") {
            finish_hunk(&mut current_file, &mut current_hunk);
            finish_file(&mut files, current_file.take());
            current_file = Some(ParsedFileDiff::new(path.trim().to_string()));
            continue;
        }

        let file = current_file.get_or_insert_with(|| ParsedFileDiff::new(String::new()));

        if let Some(path) = parse_path_header(line, "--- ") {
            file.old_path = Some(path);
            continue;
        }

        if let Some(path) = parse_path_header(line, "+++ ") {
            file.new_path = Some(path);
            continue;
        }

        if line.starts_with("Cannot display: file marked as a binary type.")
            || line.to_lowercase().contains("cannot display")
            || line.to_lowercase().contains("binary files")
        {
            file.binary = true;
            continue;
        }

        if line.starts_with("Property changes on: ") {
            file.property_only = true;
            continue;
        }

        if line.starts_with("======") || line.starts_with("____") {
            continue;
        }

        if let Some(header) = parse_hunk_header(line) {
            let file_path = file.path.clone();
            finish_hunk(&mut current_file, &mut current_hunk);
            current_hunk = Some(HunkBuilder::new(file_path, header, line.to_string()));
            continue;
        }

        if let Some(hunk) = current_hunk.as_mut() {
            hunk.push_line(line);
        }
    }

    finish_hunk(&mut current_file, &mut current_hunk);
    finish_file(&mut files, current_file);

    ParsedDiff { files }
}

pub fn generate_selected_patch(request: GenerateSelectedPatchRequest) -> SelectedPatch {
    let selected_ids: HashSet<&str> = request
        .selected_hunk_ids
        .iter()
        .map(String::as_str)
        .collect();
    let mut text = String::new();
    let mut file_count = 0;
    let mut hunk_count = 0;

    for file in request.parsed_diff.files {
        let selected_hunks: Vec<&ParsedHunk> = file
            .hunks
            .iter()
            .filter(|hunk| selected_ids.contains(hunk.id.as_str()))
            .collect();

        if selected_hunks.is_empty() {
            continue;
        }

        file_count += 1;
        text.push_str(&format!("Index: {}\n", file.path));
        text.push_str("===================================================================\n");
        text.push_str(&format!(
            "--- {}\n",
            file.old_path.as_deref().unwrap_or(file.path.as_str())
        ));
        text.push_str(&format!(
            "+++ {}\n",
            file.new_path.as_deref().unwrap_or(file.path.as_str())
        ));

        for hunk in selected_hunks {
            hunk_count += 1;
            append_selected_hunk(&mut text, hunk);
        }
    }

    SelectedPatch {
        text,
        file_count,
        hunk_count,
    }
}

impl ParsedFileDiff {
    fn new(path: String) -> Self {
        Self {
            path,
            old_path: None,
            new_path: None,
            hunks: Vec::new(),
            partial_commit_supported: false,
            unsupported_reason: None,
            binary: false,
            property_only: false,
        }
    }

    fn finalize_support(&mut self) {
        if self.binary {
            self.partial_commit_supported = false;
            self.unsupported_reason = Some("二进制文件不支持 hunk 级部分提交".to_string());
            return;
        }

        if self.property_only && self.hunks.is_empty() {
            self.partial_commit_supported = false;
            self.unsupported_reason = Some("仅属性变更不支持 hunk 级部分提交".to_string());
            return;
        }

        if self.is_rename_like() {
            self.partial_commit_supported = false;
            self.unsupported_reason = Some("重命名或路径替换不支持 hunk 级部分提交".to_string());
            return;
        }

        if self.hunks.is_empty() {
            self.partial_commit_supported = false;
            self.unsupported_reason = Some("未发现可选择的文本 hunk".to_string());
            return;
        }

        self.partial_commit_supported = true;
        self.unsupported_reason = None;
    }

    fn is_rename_like(&self) -> bool {
        let Some(old_path) = self.old_path.as_deref() else {
            return false;
        };
        let Some(new_path) = self.new_path.as_deref() else {
            return false;
        };

        old_path != new_path && old_path != "/dev/null" && new_path != "/dev/null"
    }
}

#[derive(Debug)]
struct HunkHeader {
    old_start: usize,
    old_lines: usize,
    new_start: usize,
    new_lines: usize,
}

#[derive(Debug)]
struct HunkBuilder {
    file_path: String,
    old_start: usize,
    old_lines: usize,
    new_start: usize,
    new_lines: usize,
    header: String,
    lines: Vec<ParsedDiffLine>,
    next_old_line: usize,
    next_new_line: usize,
}

impl HunkBuilder {
    fn new(file_path: String, parsed: HunkHeader, header: String) -> Self {
        Self {
            file_path,
            old_start: parsed.old_start,
            old_lines: parsed.old_lines,
            new_start: parsed.new_start,
            new_lines: parsed.new_lines,
            header,
            lines: Vec::new(),
            next_old_line: parsed.old_start,
            next_new_line: parsed.new_start,
        }
    }

    fn push_line(&mut self, line: &str) {
        if let Some(content) = line.strip_prefix('+') {
            self.lines.push(ParsedDiffLine {
                kind: DiffLineKind::Added,
                old_line: None,
                new_line: Some(self.next_new_line),
                content: content.to_string(),
            });
            self.next_new_line += 1;
            return;
        }

        if let Some(content) = line.strip_prefix('-') {
            self.lines.push(ParsedDiffLine {
                kind: DiffLineKind::Removed,
                old_line: Some(self.next_old_line),
                new_line: None,
                content: content.to_string(),
            });
            self.next_old_line += 1;
            return;
        }

        if let Some(content) = line.strip_prefix('\\') {
            self.lines.push(ParsedDiffLine {
                kind: DiffLineKind::NoNewline,
                old_line: None,
                new_line: None,
                content: content.to_string(),
            });
            return;
        }

        let content = line.strip_prefix(' ').unwrap_or(line);
        self.lines.push(ParsedDiffLine {
            kind: DiffLineKind::Context,
            old_line: Some(self.next_old_line),
            new_line: Some(self.next_new_line),
            content: content.to_string(),
        });
        self.next_old_line += 1;
        self.next_new_line += 1;
    }

    fn finish(self) -> ParsedHunk {
        ParsedHunk {
            id: format!(
                "{}:{}:{}:{}:{}",
                self.file_path, self.old_start, self.old_lines, self.new_start, self.new_lines
            ),
            old_start: self.old_start,
            old_lines: self.old_lines,
            new_start: self.new_start,
            new_lines: self.new_lines,
            header: self.header,
            lines: self.lines,
        }
    }
}

fn finish_hunk(file: &mut Option<ParsedFileDiff>, hunk: &mut Option<HunkBuilder>) {
    let Some(hunk) = hunk.take() else {
        return;
    };

    if let Some(file) = file.as_mut() {
        file.hunks.push(hunk.finish());
    }
}

fn finish_file(files: &mut Vec<ParsedFileDiff>, file: Option<ParsedFileDiff>) {
    let Some(mut file) = file else {
        return;
    };

    file.finalize_support();
    if !file.path.is_empty() || !file.hunks.is_empty() || file.binary || file.property_only {
        files.push(file);
    }
}

fn append_selected_hunk(output: &mut String, hunk: &ParsedHunk) {
    let old_lines = hunk
        .lines
        .iter()
        .filter(|line| matches!(line.kind, DiffLineKind::Context | DiffLineKind::Removed))
        .count();
    let new_lines = hunk
        .lines
        .iter()
        .filter(|line| matches!(line.kind, DiffLineKind::Context | DiffLineKind::Added))
        .count();

    output.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        hunk.old_start, old_lines, hunk.new_start, new_lines
    ));

    for line in &hunk.lines {
        match line.kind {
            DiffLineKind::Context => {
                output.push(' ');
                output.push_str(&line.content);
                output.push('\n');
            }
            DiffLineKind::Added => {
                output.push('+');
                output.push_str(&line.content);
                output.push('\n');
            }
            DiffLineKind::Removed => {
                output.push('-');
                output.push_str(&line.content);
                output.push('\n');
            }
            DiffLineKind::NoNewline => {
                output.push('\\');
                output.push_str(&line.content);
                output.push('\n');
            }
        }
    }
}

fn parse_path_header(line: &str, prefix: &str) -> Option<String> {
    let value = line.strip_prefix(prefix)?.trim();
    Some(value.split('\t').next().unwrap_or(value).to_string())
}

fn parse_hunk_header(line: &str) -> Option<HunkHeader> {
    let body = line.strip_prefix("@@ ")?;
    let end = body.find(" @@")?;
    let range = &body[..end];
    let mut parts = range.split_whitespace();
    let old = parts.next()?.strip_prefix('-')?;
    let new = parts.next()?.strip_prefix('+')?;
    let (old_start, old_lines) = parse_range(old)?;
    let (new_start, new_lines) = parse_range(new)?;

    Some(HunkHeader {
        old_start,
        old_lines,
        new_start,
        new_lines,
    })
}

fn parse_range(value: &str) -> Option<(usize, usize)> {
    let mut parts = value.splitn(2, ',');
    let start = parts.next()?.parse().ok()?;
    let lines = parts
        .next()
        .map(|value| value.parse().ok())
        .unwrap_or(Some(1))?;
    Some((start, lines))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_multiple_files_and_hunks() {
        let diff = r#"Index: src/main.rs
===================================================================
--- src/main.rs	(revision 1)
+++ src/main.rs	(working copy)
@@ -1,3 +1,4 @@
 fn main() {
-    println!("old");
+    println!("new");
+    println!("extra");
 }
@@ -10,2 +11,2 @@
 let a = 1;
-let b = 2;
+let b = 3;
Index: src/lib.rs
===================================================================
--- src/lib.rs	(revision 1)
+++ src/lib.rs	(working copy)
@@ -1 +1 @@
-old
+new
"#;

        let parsed = parse_unified_diff(diff);

        assert_eq!(parsed.files.len(), 2);
        assert_eq!(parsed.files[0].path, "src/main.rs");
        assert_eq!(parsed.files[0].hunks.len(), 2);
        assert!(parsed.files[0].partial_commit_supported);
        assert_eq!(parsed.files[0].hunks[0].old_start, 1);
        assert_eq!(parsed.files[0].hunks[0].new_start, 1);
        assert_eq!(parsed.files[0].hunks[0].lines[1].kind, DiffLineKind::Removed);
        assert_eq!(parsed.files[0].hunks[0].lines[2].kind, DiffLineKind::Added);
        assert_eq!(parsed.files[1].path, "src/lib.rs");
        assert_eq!(parsed.files[1].hunks.len(), 1);
    }

    #[test]
    fn marks_binary_files_as_unsupported() {
        let diff = r#"Index: assets/logo.png
===================================================================
Cannot display: file marked as a binary type.
svn:mime-type = application/octet-stream
"#;

        let parsed = parse_unified_diff(diff);

        assert_eq!(parsed.files.len(), 1);
        assert!(parsed.files[0].binary);
        assert!(!parsed.files[0].partial_commit_supported);
        assert_eq!(
            parsed.files[0].unsupported_reason.as_deref(),
            Some("二进制文件不支持 hunk 级部分提交")
        );
    }

    #[test]
    fn marks_property_only_files_as_unsupported() {
        let diff = r#"Index: README.md
===================================================================
Property changes on: README.md
___________________________________________________________________
Modified: svn:executable
## -0,0 +1 ##
+*
"#;

        let parsed = parse_unified_diff(diff);

        assert_eq!(parsed.files.len(), 1);
        assert!(parsed.files[0].property_only);
        assert!(!parsed.files[0].partial_commit_supported);
        assert_eq!(
            parsed.files[0].unsupported_reason.as_deref(),
            Some("仅属性变更不支持 hunk 级部分提交")
        );
    }

    #[test]
    fn marks_rename_like_files_as_unsupported() {
        let diff = r#"Index: new-name.txt
===================================================================
--- old-name.txt	(revision 1)
+++ new-name.txt	(working copy)
@@ -1 +1 @@
-old
+new
"#;

        let parsed = parse_unified_diff(diff);

        assert_eq!(parsed.files.len(), 1);
        assert!(!parsed.files[0].partial_commit_supported);
        assert_eq!(
            parsed.files[0].unsupported_reason.as_deref(),
            Some("重命名或路径替换不支持 hunk 级部分提交")
        );
    }

    #[test]
    fn parses_no_newline_marker() {
        let diff = r#"Index: a.txt
===================================================================
--- a.txt	(revision 1)
+++ a.txt	(working copy)
@@ -1 +1 @@
-old
\ No newline at end of file
+new
\ No newline at end of file
"#;

        let parsed = parse_unified_diff(diff);

        assert_eq!(
            parsed.files[0].hunks[0].lines[1].kind,
            DiffLineKind::NoNewline
        );
        assert_eq!(
            parsed.files[0].hunks[0].lines[3].kind,
            DiffLineKind::NoNewline
        );
    }

    #[test]
    fn generates_patch_for_selected_hunks_only() {
        let parsed = parse_unified_diff(
            r#"Index: src/main.rs
===================================================================
--- src/main.rs	(revision 1)
+++ src/main.rs	(working copy)
@@ -1,2 +1,2 @@
-old
+new
 keep
@@ -10,2 +10,2 @@
-skip
+ignored
 keep
"#,
        );
        let selected_hunk_ids = vec![parsed.files[0].hunks[0].id.clone()];

        let patch = generate_selected_patch(GenerateSelectedPatchRequest {
            parsed_diff: parsed,
            selected_hunk_ids,
        });

        assert_eq!(patch.file_count, 1);
        assert_eq!(patch.hunk_count, 1);
        assert!(patch.text.contains("Index: src/main.rs"));
        assert!(patch.text.contains("-old"));
        assert!(patch.text.contains("+new"));
        assert!(!patch.text.contains("-skip"));
        assert!(!patch.text.contains("+ignored"));
    }

    #[test]
    fn generates_patch_for_multiple_files() {
        let parsed = parse_unified_diff(
            r#"Index: a.txt
===================================================================
--- a.txt	(revision 1)
+++ a.txt	(working copy)
@@ -1 +1 @@
-a
+b
Index: b.txt
===================================================================
--- b.txt	(revision 1)
+++ b.txt	(working copy)
@@ -1 +1 @@
-c
+d
"#,
        );
        let selected_hunk_ids = vec![
            parsed.files[0].hunks[0].id.clone(),
            parsed.files[1].hunks[0].id.clone(),
        ];

        let patch = generate_selected_patch(GenerateSelectedPatchRequest {
            parsed_diff: parsed,
            selected_hunk_ids,
        });

        assert_eq!(patch.file_count, 2);
        assert_eq!(patch.hunk_count, 2);
        assert!(patch.text.contains("Index: a.txt"));
        assert!(patch.text.contains("Index: b.txt"));
    }
}
