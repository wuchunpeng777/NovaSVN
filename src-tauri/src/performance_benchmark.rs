use std::{
    fs::{self, File, OpenOptions},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::workspace::{
    get_file_diff, get_svn_blame, get_svn_log, list_workspace_files, scan_workspace_status,
    GetFileDiffRequest, GetSvnBlameRequest, GetSvnLogRequest, ListWorkspaceFilesRequest,
    ScanWorkspaceStatusRequest,
};

const DATASET_SCHEMA_VERSION: u32 = 2;
const STATUS_PAGE_SIZE: usize = 500;
const FILE_TREE_LIMIT: usize = 5000;
const BLAME_LINE_COUNT: usize = 5000;

#[derive(Debug, Clone)]
struct BenchmarkConfig {
    root: PathBuf,
    file_count: usize,
    changed_count: usize,
    history_count: usize,
    svn_executable: String,
    svnadmin_executable: String,
    reset: bool,
}

impl Default for BenchmarkConfig {
    fn default() -> Self {
        Self {
            root: PathBuf::from(".benchmark/svn-large"),
            file_count: 50_000,
            changed_count: 5_000,
            history_count: 200,
            svn_executable: "svn".to_string(),
            svnadmin_executable: "svnadmin".to_string(),
            reset: false,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct DatasetMetadata {
    schema_version: u32,
    file_count: usize,
    history_count: usize,
}

#[derive(Debug, Serialize)]
struct BenchmarkStep {
    id: String,
    label: String,
    elapsed_ms: u64,
    threshold_ms: u64,
    passed: bool,
    detail: String,
}

#[derive(Debug, Serialize)]
struct BenchmarkReport {
    created_at_unix_ms: u128,
    platform: String,
    architecture: String,
    svn_version: String,
    file_count: usize,
    changed_count: usize,
    history_count: usize,
    working_copy: String,
    ui_guard: String,
    total_elapsed_ms: u64,
    passed: bool,
    results: Vec<BenchmarkStep>,
}

pub fn run_cli<I>(arguments: I) -> Result<(), String>
where
    I: IntoIterator<Item = String>,
{
    let config = parse_arguments(arguments)?;
    run(config)
}

fn parse_arguments<I>(arguments: I) -> Result<BenchmarkConfig, String>
where
    I: IntoIterator<Item = String>,
{
    let mut config = BenchmarkConfig::default();
    let mut arguments = arguments.into_iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--root" => config.root = PathBuf::from(next_argument(&mut arguments, "--root")?),
            "--file-count" => {
                config.file_count = parse_count(
                    &next_argument(&mut arguments, "--file-count")?,
                    "--file-count",
                )?;
            }
            "--changed-count" => {
                config.changed_count = parse_count(
                    &next_argument(&mut arguments, "--changed-count")?,
                    "--changed-count",
                )?;
            }
            "--history-count" => {
                config.history_count = parse_count(
                    &next_argument(&mut arguments, "--history-count")?,
                    "--history-count",
                )?;
            }
            "--svn" => config.svn_executable = next_argument(&mut arguments, "--svn")?,
            "--svnadmin" => {
                config.svnadmin_executable = next_argument(&mut arguments, "--svnadmin")?;
            }
            "--reset" => config.reset = true,
            "--quick" => {
                config.file_count = 2_000;
                config.changed_count = 600;
                config.history_count = 20;
            }
            "--help" | "-h" => return Err(usage().to_string()),
            unknown => return Err(format!("未知性能基准参数：{unknown}\n{}", usage())),
        }
    }

    if config.file_count < 3 {
        return Err("文件数量必须至少为 3。".to_string());
    }
    if config.changed_count == 0 || config.changed_count > config.file_count - 2 {
        return Err("改动数量必须大于 0，并为 Blame 和 Timeline 各保留一个干净文件。".to_string());
    }
    if config.history_count == 0 || config.history_count > 10_000 {
        return Err("历史数量必须在 1 到 10000 之间。".to_string());
    }
    if config.svn_executable.trim().is_empty() || config.svnadmin_executable.trim().is_empty() {
        return Err("SVN 和 svnadmin 可执行文件不能为空。".to_string());
    }
    Ok(config)
}

fn usage() -> &'static str {
    "用法：cargo run --manifest-path src-tauri/Cargo.toml --example performance_benchmark -- [--reset] [--quick] [--root PATH] [--file-count N] [--changed-count N] [--history-count N] [--svn PATH] [--svnadmin PATH]"
}

fn next_argument(
    arguments: &mut impl Iterator<Item = String>,
    name: &str,
) -> Result<String, String> {
    arguments
        .next()
        .ok_or_else(|| format!("参数 {name} 缺少值。"))
}

fn parse_count(value: &str, name: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|error| format!("参数 {name} 不是有效整数：{error}"))
}

fn run(config: BenchmarkConfig) -> Result<(), String> {
    let root = absolute_path(&config.root)?;
    if config.reset && root.exists() {
        println!("删除旧性能基准：{}", root.display());
        fs::remove_dir_all(&root)
            .map_err(|error| format!("无法重置性能基准目录 {}：{error}", root.display()))?;
    }
    fs::create_dir_all(&root)
        .map_err(|error| format!("无法创建性能基准目录 {}：{error}", root.display()))?;

    ensure_tool(&config.svn_executable, "SVN")?;
    ensure_tool(&config.svnadmin_executable, "svnadmin")?;
    let repository = root.join("repo");
    let working_copy = root.join("wc");
    let metadata_path = root.join("dataset.json");
    prepare_dataset(&config, &repository, &working_copy, &metadata_path)?;
    prepare_changes(&config, &working_copy)?;

    println!("开始测量 NovaSVN 生产路径：{}", working_copy.display());
    let mut results = Vec::new();
    let working_copy_text = working_copy.display().to_string();
    let first_file = benchmark_file_path(0);
    let blame_file = benchmark_file_path(config.file_count - 2);
    let timeline_file = benchmark_file_path(config.file_count - 1);

    let first_status = measure_step(
        &mut results,
        "status_first_page",
        "状态首屏分页",
        30_000,
        || {
            scan_workspace_status(ScanWorkspaceStatusRequest {
                working_copy_root: working_copy_text.clone(),
                svn_executable: Some(config.svn_executable.clone()),
                offset: Some(0),
                limit: Some(STATUS_PAGE_SIZE),
                check_remote_updates: Some(true),
            })
            .map_err(|error| error.to_string())
        },
        |status| {
            format!(
                "总改动 {}，返回 {}，offset {}",
                status.total, status.returned, status.offset
            )
        },
    )?;
    if first_status.total != config.changed_count || first_status.returned != STATUS_PAGE_SIZE {
        return Err(format!(
            "状态首屏结果不符合数据集：总改动 {}，返回 {}",
            first_status.total, first_status.returned
        ));
    }

    let last_offset = ((config.changed_count - 1) / STATUS_PAGE_SIZE) * STATUS_PAGE_SIZE;
    let last_status = measure_step(
        &mut results,
        "status_last_page",
        "状态末页分页",
        30_000,
        || {
            scan_workspace_status(ScanWorkspaceStatusRequest {
                working_copy_root: working_copy_text.clone(),
                svn_executable: Some(config.svn_executable.clone()),
                offset: Some(last_offset),
                limit: Some(STATUS_PAGE_SIZE),
                check_remote_updates: Some(true),
            })
            .map_err(|error| error.to_string())
        },
        |status| {
            format!(
                "总改动 {}，返回 {}，offset {}",
                status.total, status.returned, status.offset
            )
        },
    )?;
    if last_status.offset != last_offset
        || last_status.returned != config.changed_count - last_offset
    {
        return Err("状态末页没有返回预期范围。".to_string());
    }

    let file_tree = measure_step(
        &mut results,
        "file_tree",
        "文件树扫描与截断",
        60_000,
        || {
            list_workspace_files(ListWorkspaceFilesRequest {
                working_copy_root: working_copy_text.clone(),
                svn_executable: Some(config.svn_executable.clone()),
                max_files: Some(FILE_TREE_LIMIT),
            })
            .map_err(|error| error.to_string())
        },
        |tree| {
            format!(
                "总文件 {}，返回 {}，截断 {}",
                tree.total_files, tree.returned_files, tree.truncated
            )
        },
    )?;
    if file_tree.total_files != config.file_count
        || file_tree.returned_files != config.file_count.min(FILE_TREE_LIMIT)
        || file_tree.truncated != (config.file_count > FILE_TREE_LIMIT)
    {
        return Err("文件树数量或截断状态不符合数据集。".to_string());
    }

    let diff = measure_step(
        &mut results,
        "diff",
        "单文件 Diff",
        10_000,
        || {
            get_file_diff(GetFileDiffRequest {
                working_copy_root: working_copy_text.clone(),
                file_path: first_file.clone(),
                svn_executable: Some(config.svn_executable.clone()),
            })
            .map_err(|error| error.to_string())
        },
        |diff| format!("输出 {} 字节，二进制 {}", diff.text.len(), diff.binary),
    )?;
    if diff.empty || diff.binary {
        return Err("性能基准 Diff 应为非空文本。".to_string());
    }

    let blame = measure_step(
        &mut results,
        "blame",
        "5000 行 Blame",
        15_000,
        || {
            get_svn_blame(GetSvnBlameRequest {
                working_copy_root: working_copy_text.clone(),
                file_path: blame_file.clone(),
                svn_executable: Some(config.svn_executable.clone()),
                max_lines: Some(BLAME_LINE_COUNT),
            })
            .map_err(|error| error.to_string())
        },
        |blame| {
            format!(
                "总行数 {}，返回 {}，截断 {}",
                blame.total_lines,
                blame.lines.len(),
                blame.truncated
            )
        },
    )?;
    if blame.total_lines != BLAME_LINE_COUNT || blame.lines.len() != BLAME_LINE_COUNT {
        return Err("Blame 没有返回预期的 5000 行基线内容。".to_string());
    }

    let timeline = measure_step(
        &mut results,
        "timeline",
        "Timeline 历史分页",
        15_000,
        || {
            get_svn_log(GetSvnLogRequest {
                working_copy_root: working_copy_text.clone(),
                file_path: Some(timeline_file.clone()),
                svn_executable: Some(config.svn_executable.clone()),
                limit: Some(config.history_count.min(200)),
                start_revision: None,
            })
            .map_err(|error| error.to_string())
        },
        |log| {
            format!(
                "返回 {} 条历史，还有更多 {}",
                log.entries.len(),
                log.has_more
            )
        },
    )?;
    if timeline.entries.len() != config.history_count.min(200) {
        return Err("Timeline 没有返回预期的历史数量。".to_string());
    }

    let total_elapsed_ms = results.iter().map(|step| step.elapsed_ms).sum();
    let passed = results.iter().all(|step| step.passed);
    let svn_version = tool_version(&config.svn_executable)?;
    let report = BenchmarkReport {
        created_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("系统时间无效：{error}"))?
            .as_millis(),
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        svn_version,
        file_count: config.file_count,
        changed_count: config.changed_count,
        history_count: config.history_count,
        working_copy: working_copy_text,
        ui_guard:
            "MainWorkspace 组件测试验证 5000 文件树和 Blame 仅渲染视口窗口，并可滚动到最后一行。"
                .to_string(),
        total_elapsed_ms,
        passed,
        results,
    };
    write_report(&root, &report)?;
    if !passed {
        return Err("性能基准存在超时步骤；报告已写入，请检查回归。".to_string());
    }
    println!("性能基准通过，总测量耗时 {total_elapsed_ms} ms");
    Ok(())
}

fn measure_step<T>(
    results: &mut Vec<BenchmarkStep>,
    id: &str,
    label: &str,
    threshold_ms: u64,
    operation: impl FnOnce() -> Result<T, String>,
    detail: impl FnOnce(&T) -> String,
) -> Result<T, String> {
    let started_at = Instant::now();
    let value = operation().map_err(|error| format!("{label}失败：{error}"))?;
    let elapsed_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let passed = elapsed_ms <= threshold_ms;
    let result = BenchmarkStep {
        id: id.to_string(),
        label: label.to_string(),
        elapsed_ms,
        threshold_ms,
        passed,
        detail: detail(&value),
    };
    println!(
        "{}：{} ms / {} ms（{}）",
        result.label,
        result.elapsed_ms,
        result.threshold_ms,
        if result.passed { "通过" } else { "超时" }
    );
    results.push(result);
    Ok(value)
}

fn prepare_dataset(
    config: &BenchmarkConfig,
    repository: &Path,
    working_copy: &Path,
    metadata_path: &Path,
) -> Result<(), String> {
    if metadata_path.exists() {
        let metadata: DatasetMetadata = serde_json::from_slice(
            &fs::read(metadata_path).map_err(|error| format!("无法读取性能基准元数据：{error}"))?,
        )
        .map_err(|error| format!("无法解析性能基准元数据：{error}"))?;
        if metadata.schema_version != DATASET_SCHEMA_VERSION
            || metadata.file_count != config.file_count
            || metadata.history_count != config.history_count
        {
            return Err("现有性能数据集参数不同，请使用 --reset 重新生成。".to_string());
        }
        if !repository.is_dir() || !working_copy.is_dir() {
            return Err("性能数据集不完整，请使用 --reset 重新生成。".to_string());
        }
        return Ok(());
    }
    if repository.exists() || working_copy.exists() {
        return Err("检测到未完成的性能数据集，请使用 --reset 重新生成。".to_string());
    }

    println!("创建本地 SVN 性能仓库");
    run_checked(
        Command::new(&config.svnadmin_executable)
            .arg("create")
            .arg(repository),
        "svnadmin create",
    )?;
    let repository_url = file_repository_url(repository)?;
    run_checked(
        svn_command(config)
            .arg("checkout")
            .arg(&repository_url)
            .arg(working_copy)
            .arg("--quiet"),
        "svn checkout",
    )?;
    let data_directory = working_copy.join("benchmark");
    fs::create_dir_all(&data_directory)
        .map_err(|error| format!("无法创建性能数据目录：{error}"))?;
    for index in 0..config.file_count {
        let path = data_directory.join(format!("file-{index:05}.txt"));
        if index == config.file_count - 2 {
            let mut writer = BufWriter::new(
                File::create(&path).map_err(|error| format!("无法创建 Blame 基准文件：{error}"))?,
            );
            for line in 1..=BLAME_LINE_COUNT {
                writeln!(writer, "baseline line {line:05}")
                    .map_err(|error| format!("无法写入 Blame 基准文件：{error}"))?;
            }
        } else {
            fs::write(&path, format!("baseline {index}\n"))
                .map_err(|error| format!("无法写入性能基准文件 {}：{error}", path.display()))?;
        }
        if (index + 1) % 5_000 == 0 || index + 1 == config.file_count {
            println!("已生成 {}/{} 个文件", index + 1, config.file_count);
        }
    }
    run_checked(
        svn_command(config)
            .arg("add")
            .arg(&data_directory)
            .args(["--force", "--quiet"]),
        "svn add",
    )?;
    run_checked(
        svn_command(config).arg("commit").arg(working_copy).args([
            "-m",
            "初始化性能基准数据",
            "--quiet",
        ]),
        "svn commit",
    )?;

    let timeline_file = working_copy.join(benchmark_file_path(config.file_count - 1));
    for revision in 2..=config.history_count {
        append_line(&timeline_file, &format!("history {revision}"))?;
        run_checked(
            svn_command(config).arg("commit").arg(&timeline_file).args([
                "-m",
                &format!("性能基准历史 {revision}"),
                "--quiet",
            ]),
            "svn commit timeline",
        )?;
        if revision % 50 == 0 || revision == config.history_count {
            println!("已生成 {revision}/{} 条历史", config.history_count);
        }
    }
    let metadata = DatasetMetadata {
        schema_version: DATASET_SCHEMA_VERSION,
        file_count: config.file_count,
        history_count: config.history_count,
    };
    fs::write(
        metadata_path,
        serde_json::to_vec_pretty(&metadata)
            .map_err(|error| format!("无法序列化性能基准元数据：{error}"))?,
    )
    .map_err(|error| format!("无法写入性能基准元数据：{error}"))?;
    Ok(())
}

fn prepare_changes(config: &BenchmarkConfig, working_copy: &Path) -> Result<(), String> {
    println!("还原工作副本并生成 {} 个改动", config.changed_count);
    run_checked(
        svn_command(config)
            .arg("revert")
            .arg("-R")
            .arg(working_copy)
            .arg("--quiet"),
        "svn revert -R",
    )?;
    for index in 0..config.changed_count {
        append_line(
            &working_copy.join(benchmark_file_path(index)),
            "benchmark local change",
        )?;
    }
    Ok(())
}

fn append_line(path: &Path, line: &str) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|error| format!("无法打开性能基准文件 {}：{error}", path.display()))?;
    writeln!(file, "{line}")
        .map_err(|error| format!("无法修改性能基准文件 {}：{error}", path.display()))
}

fn benchmark_file_path(index: usize) -> String {
    format!("benchmark/file-{index:05}.txt")
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    std::env::current_dir()
        .map(|directory| directory.join(path))
        .map_err(|error| format!("无法读取当前目录：{error}"))
}

fn file_repository_url(repository: &Path) -> Result<String, String> {
    let canonical = fs::canonicalize(repository)
        .map_err(|error| format!("无法确认性能仓库路径 {}：{error}", repository.display()))?;
    let path = canonical.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    {
        Ok(format!("file:///{}", path.trim_start_matches('/')))
    }
    #[cfg(not(windows))]
    {
        Ok(format!("file://{path}"))
    }
}

fn svn_command(config: &BenchmarkConfig) -> Command {
    let mut command = Command::new(&config.svn_executable);
    command.arg("--non-interactive");
    command
}

fn ensure_tool(executable: &str, label: &str) -> Result<(), String> {
    tool_version(executable)
        .map(|version| println!("{label}：{version}"))
        .map_err(|error| format!("{label} 不可用：{error}"))
}

fn tool_version(executable: &str) -> Result<String, String> {
    let output = Command::new(executable)
        .args(["--version", "--quiet"])
        .output()
        .map_err(|error| format!("无法启动 {executable}：{error}"))?;
    if !output.status.success() {
        return Err(command_failure(executable, &output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_checked(command: &mut Command, label: &str) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|error| format!("无法执行 {label}：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "{label} 执行失败：{}",
        command_failure(label, &output)
    ))
}

fn command_failure(label: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    format!("{label} 返回 {}：{detail}", output.status)
}

fn write_report(root: &Path, report: &BenchmarkReport) -> Result<(), String> {
    let json_path = root.join("benchmark-results.json");
    let markdown_path = root.join("benchmark-results.md");
    fs::write(
        &json_path,
        serde_json::to_vec_pretty(report)
            .map_err(|error| format!("无法生成 JSON 报告：{error}"))?,
    )
    .map_err(|error| format!("无法写入 {}：{error}", json_path.display()))?;

    let mut markdown = format!(
        "# NovaSVN 性能基准结果\n\n- 平台：{} / {}\n- SVN：{}\n- 文件：{}\n- 改动：{}\n- 历史：{}\n- 工作副本：`{}`\n- 总测量耗时：{} ms\n- 结果：{}\n\n| 路径 | 耗时 | 阈值 | 结果 | 详情 |\n| --- | ---: | ---: | --- | --- |\n",
        report.platform,
        report.architecture,
        report.svn_version,
        report.file_count,
        report.changed_count,
        report.history_count,
        report.working_copy,
        report.total_elapsed_ms,
        if report.passed { "通过" } else { "失败" },
    );
    for step in &report.results {
        markdown.push_str(&format!(
            "| {} | {} ms | {} ms | {} | {} |\n",
            step.label,
            step.elapsed_ms,
            step.threshold_ms,
            if step.passed { "通过" } else { "超时" },
            step.detail.replace('|', "\\|"),
        ));
    }
    markdown.push_str(&format!("\n## UI 非冻结门禁\n\n{}\n", report.ui_guard));
    fs::write(&markdown_path, markdown)
        .map_err(|error| format!("无法写入 {}：{error}", markdown_path.display()))?;
    println!("JSON 报告：{}", json_path.display());
    println!("Markdown 报告：{}", markdown_path.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quick_benchmark_arguments() {
        let config = parse_arguments([
            "--quick".to_string(),
            "--reset".to_string(),
            "--root".to_string(),
            "target/benchmark".to_string(),
        ])
        .expect("快速性能参数应有效");
        assert_eq!(config.file_count, 2_000);
        assert_eq!(config.changed_count, 600);
        assert_eq!(config.history_count, 20);
        assert!(config.reset);
        assert_eq!(config.root, PathBuf::from("target/benchmark"));
    }

    #[test]
    fn rejects_changed_count_beyond_file_count() {
        let error = parse_arguments([
            "--file-count".to_string(),
            "10".to_string(),
            "--changed-count".to_string(),
            "11".to_string(),
        ])
        .expect_err("过多改动应被拒绝");
        assert!(error.contains("各保留一个干净文件"));
    }
}
