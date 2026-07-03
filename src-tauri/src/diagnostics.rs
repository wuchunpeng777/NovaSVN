use std::{fs, panic, path::PathBuf};

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

        let _ = fs::write(path, message);
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
    app_data_dir: &PathBuf,
    tasks: &[Task],
) -> Result<String, NovaError> {
    let package = app.package_info();
    let mut lines = vec![
        "NovaSVN 诊断日志".to_string(),
        format!("生成时间：{}", timestamp_millis()),
        format!("应用版本：{}", package.version),
        format!("平台：{} {}", std::env::consts::OS, std::env::consts::ARCH),
        format!("应用数据目录：{}", app_data_dir.display()),
        String::new(),
        "== 配置文件 ==".to_string(),
    ];

    append_file_summary(&mut lines, &app_data_dir.join("recent-workspace.json"));
    append_file_summary(&mut lines, &app_data_dir.join("branch-pool.json"));
    append_file_summary(&mut lines, &app_data_dir.join("task-workspaces.json"));

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
    Ok(lines.join("\n"))
}

fn append_file_summary(lines: &mut Vec<String>, path: &PathBuf) {
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

fn append_optional_file(lines: &mut Vec<String>, path: &PathBuf, max_bytes: usize) {
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
