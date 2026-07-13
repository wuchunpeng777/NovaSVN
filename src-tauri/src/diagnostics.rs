use std::{
    fs, panic,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{
    error::NovaError,
    task::{Task, TaskQueue},
};

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticExport {
    pub path: String,
    pub file_name: String,
    pub bytes: usize,
}

pub fn install_panic_hook(app_data_dir: PathBuf) {
    panic::set_hook(Box::new(move |panic_info| {
        let message = format!("[{}] {}\n", timestamp_millis(), panic_info);

        let path = app_data_dir.join("crash.log");
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut file| {
                use std::io::Write;
                file.write_all(message.as_bytes())
            });
    }));
}

pub fn export_diagnostics(
    app: &AppHandle,
    queue: &TaskQueue,
) -> Result<DiagnosticExport, NovaError> {
    let app_data_dir = app_data_dir(app)?;
    let diagnostics_dir = app_data_dir.join("diagnostics");
    fs::create_dir_all(&diagnostics_dir).map_err(|error| {
        NovaError::command(
            "DIAGNOSTICS_DIR_FAILED",
            "创建诊断日志目录失败",
            Some(format!(
                "路径：{}。错误：{error}",
                diagnostics_dir.display()
            )),
            true,
        )
    })?;

    let file_name = format!("novasvn-diagnostics-{}.txt", timestamp_millis());
    let path = diagnostics_dir.join(&file_name);
    let tasks = queue.all_tasks();
    let content = build_diagnostics(app, &app_data_dir, &tasks)?;

    fs::write(&path, &content).map_err(|error| {
        NovaError::command(
            "DIAGNOSTICS_WRITE_FAILED",
            "写入诊断日志失败",
            Some(format!("路径：{}。错误：{error}", path.display())),
            true,
        )
    })?;

    Ok(DiagnosticExport {
        path: path.display().to_string(),
        file_name,
        bytes: content.len(),
    })
}

fn build_diagnostics(
    app: &AppHandle,
    app_data_dir: &Path,
    tasks: &[Task],
) -> Result<String, NovaError> {
    let package = app.package_info();
    Ok(build_diagnostics_content(
        &package.version.to_string(),
        app_data_dir,
        tasks,
    ))
}

fn build_diagnostics_content(app_version: &str, app_data_dir: &Path, tasks: &[Task]) -> String {
    let mut lines = vec![
        "NovaSVN 诊断日志".to_string(),
        format!("生成时间：{}", timestamp_millis()),
        format!("应用版本：{app_version}"),
        format!("平台：{} {}", std::env::consts::OS, std::env::consts::ARCH),
        format!("当前目录：{}", current_dir_label()),
        format!("应用数据目录：{}", app_data_dir.display()),
        format!("PATH 可用：{}", env_presence_label("PATH")),
        format!("HOME 可用：{}", env_presence_label("HOME")),
        format!("USERPROFILE 可用：{}", env_presence_label("USERPROFILE")),
        String::new(),
        "== 配置文件 ==".to_string(),
    ];

    append_file_summary(&mut lines, &app_data_dir.join("recent-workspace.json"));
    append_file_summary(&mut lines, &app_data_dir.join("branch-pool.json"));
    append_file_summary(&mut lines, &app_data_dir.join("task-workspaces.json"));
    append_file_summary(&mut lines, &app_data_dir.join("task-history.json"));
    append_file_summary(&mut lines, &app_data_dir.join("crash.log"));

    lines.push(String::new());
    lines.push("== SVN 命令行 ==".to_string());
    append_svn_cli_summary(&mut lines);

    lines.push(String::new());
    lines.push("== 崩溃日志 ==".to_string());
    append_optional_file(&mut lines, &app_data_dir.join("crash.log"), 32_000);

    lines.push(String::new());
    lines.push("== 任务日志 ==".to_string());
    if tasks.is_empty() {
        lines.push("暂无任务。".to_string());
    } else {
        for task in tasks {
            lines.push(format!(
                "[{}] {} / {:?} / created={} / updated={}",
                task.task_id, task.title, task.status, task.created_at, task.updated_at
            ));
            if let Some(error) = &task.error {
                lines.push(format!("  error: {error}"));
            }
            for log in &task.logs {
                lines.push(format!("  - {} {}", log.created_at, log.message));
            }
        }
    }

    lines.push(String::new());
    lines.join("\n")
}

fn append_file_summary(lines: &mut Vec<String>, path: &Path) {
    match fs::metadata(path) {
        Ok(metadata) => lines.push(format!(
            "{}：存在，{} bytes",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown"),
            metadata.len()
        )),
        Err(_) => lines.push(format!(
            "{}：不存在",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
        )),
    }
}

fn append_svn_cli_summary(lines: &mut Vec<String>) {
    match Command::new("svn").args(["--version", "--quiet"]).output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if version.is_empty() {
                lines.push("svn：可执行，但未返回版本号".to_string());
            } else {
                lines.push(format!("svn：可用，版本 {version}"));
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("退出码 {:?}", output.status.code())
            };
            lines.push(format!("svn：不可用，{detail}"));
        }
        Err(error) => {
            lines.push(format!("svn：不可用，{error}"));
        }
    }
}

fn append_optional_file(lines: &mut Vec<String>, path: &Path, max_bytes: usize) {
    match fs::read_to_string(path) {
        Ok(content) => {
            if content.len() > max_bytes {
                lines.push(content.chars().take(max_bytes).collect::<String>());
                lines.push(format!("... 已截断，原始大小 {} bytes", content.len()));
            } else {
                lines.push(content);
            }
        }
        Err(_) => lines.push("暂无崩溃日志。".to_string()),
    }
}

fn current_dir_label() -> String {
    std::env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "未知".to_string())
}

fn env_presence_label(name: &str) -> &'static str {
    match std::env::var_os(name) {
        Some(value) if !value.is_empty() => "是",
        _ => "否",
    }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, NovaError> {
    app.path().app_data_dir().map_err(|error| {
        NovaError::command(
            "APP_DATA_DIR_FAILED",
            "无法获取应用数据目录",
            Some(error.to_string()),
            true,
        )
    })
}

fn timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_content_includes_runtime_and_file_summaries() {
        let app_data_dir =
            std::env::temp_dir().join(format!("novasvn-diagnostics-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&app_data_dir);
        fs::create_dir_all(&app_data_dir).unwrap();
        fs::write(app_data_dir.join("crash.log"), "panic sample").unwrap();

        let content = build_diagnostics_content("9.8.7", &app_data_dir, &[]);

        assert!(content.contains("NovaSVN 诊断日志"));
        assert!(content.contains("应用版本：9.8.7"));
        assert!(content.contains("平台："));
        assert!(content.contains("当前目录："));
        assert!(content.contains("PATH 可用："));
        assert!(content.contains("recent-workspace.json：不存在"));
        assert!(content.contains("crash.log：存在"));
        assert!(content.contains("== SVN 命令行 =="));
        assert!(content.contains("svn："));
        assert!(content.contains("panic sample"));
        assert!(content.contains("暂无任务。"));

        let _ = fs::remove_dir_all(&app_data_dir);
    }
}
