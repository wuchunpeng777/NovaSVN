import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./workbench/MonacoDiffViewer.svelte", () => ({
  default: vi.fn().mockImplementation((internals) => ({
    c: vi.fn(),
    m: vi.fn(),
    p: vi.fn(),
    d: vi.fn(),
    ...internals,
  })),
}));

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  chooseWorkspaceDirectory: vi.fn(),
  createMergeTask: vi.fn(),
  createSvnOperationTask: vi.fn(),
  getFileContentDiff: vi.fn(),
  getFileDiff: vi.fn(),
  getTask: vi.fn(),
  inspectUpdateTarget: vi.fn(),
  launchConflictWindow: vi.fn(),
  launchMergePreviewWindow: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
}));

import {
  cancelTask,
  createMergeTask,
  createSvnOperationTask,
  getFileContentDiff,
  getFileDiff,
  getTask,
  inspectUpdateTarget,
  launchConflictWindow,
  launchMergePreviewWindow,
  scanWorkspaceStatus,
} from "../lib/api";
import type {
  MergeResult,
  Task,
  UpdateTargetSummary,
  WorkingCopyStatus,
} from "../types/api";
import LogMergeDialog from "./LogMergeDialog.svelte";

const createMergeTaskMock = vi.mocked(createMergeTask);
const createSvnOperationTaskMock = vi.mocked(createSvnOperationTask);
const getFileContentDiffMock = vi.mocked(getFileContentDiff);
const getFileDiffMock = vi.mocked(getFileDiff);
const cancelTaskMock = vi.mocked(cancelTask);
const getTaskMock = vi.mocked(getTask);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);
const launchConflictWindowMock = vi.mocked(launchConflictWindow);
const launchMergePreviewWindowMock = vi.mocked(launchMergePreviewWindow);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);

beforeEach(() => {
  cancelTaskMock.mockReset();
  createMergeTaskMock.mockReset();
  createSvnOperationTaskMock.mockReset();
  getFileContentDiffMock.mockReset();
  getFileDiffMock.mockReset();
  getTaskMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  launchConflictWindowMock.mockReset();
  launchMergePreviewWindowMock.mockReset();
  scanWorkspaceStatusMock.mockReset();
  inspectUpdateTargetMock.mockResolvedValue(makeTarget());
  scanWorkspaceStatusMock.mockResolvedValue(makeStatus());
  createMergeTaskMock.mockResolvedValue(makeTask("pending"));
  createSvnOperationTaskMock.mockResolvedValue(makeTask("pending", null, "resolve-1"));
  getFileContentDiffMock.mockResolvedValue({
    path: "src/main.ts",
    node_kind: "file",
    original_text: "before",
    modified_text: "after",
    language: "typescript",
    binary: false,
    too_large: false,
    max_bytes: 20 * 1024 * 1024,
  });
  getFileDiffMock.mockResolvedValue({
    path: "src/main.ts",
    node_kind: "file",
    text: "Index: src/main.ts\n+merged",
    binary: false,
    empty: false,
  });
  cancelTaskMock.mockResolvedValue(makeTask("cancelled"));
  getTaskMock.mockResolvedValue(makeTask("success", makeMergeResult(true)));
  launchMergePreviewWindowMock.mockResolvedValue({ preview_id: "a".repeat(64) });
  launchConflictWindowMock.mockResolvedValue({ target_path: "C:\\target\\src\\main.ts" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LogMergeDialog", () => {
  it("验证目标后预览离散 Revision，并在独立窗口打开结果", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });

    await inspectPath("C:\\target");
    expect(inspectUpdateTargetMock).toHaveBeenCalledWith({
      path: "C:\\target",
      svn_executable: "C:\\Tools\\svn.exe",
    });
    expect(scanWorkspaceStatusMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\target",
      scope_path: undefined,
      svn_executable: "C:\\Tools\\svn.exe",
      offset: 0,
      limit: 1,
      check_remote_updates: false,
    });
    expect(screen.getByText("工作副本干净")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "预览 Merge" }));
    await waitFor(() => expect(createMergeTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\target",
      source_url: "https://example.com/svn/branches/feature",
      revisions: ["101", "105"],
      dry_run: true,
      allow_local_changes: false,
      record_only: false,
      ignore_ancestry: false,
      force: false,
      svn_executable: "C:\\Tools\\svn.exe",
    }));
    await waitFor(() => expect(launchMergePreviewWindowMock).toHaveBeenCalledWith({
      preview_id: "a".repeat(64),
    }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("允许将工作副本子目录作为 Merge 目标", async () => {
    inspectUpdateTargetMock.mockResolvedValueOnce(makeTarget({
      target_path: "C:\\target\\game\\client",
      working_copy_root: "C:\\target",
      relative_path: "game/client",
      repository_url: "https://example.com/svn/trunk/game/client",
    }));
    renderDialog();

    await inspectPath("C:\\target\\game\\client");

    expect(scanWorkspaceStatusMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\target",
      scope_path: "game/client",
      svn_executable: "C:\\Tools\\svn.exe",
      offset: 0,
      limit: 1,
      check_remote_updates: false,
    });
    await fireEvent.click(screen.getByRole("button", { name: "预览 Merge" }));
    await waitFor(() => expect(createMergeTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ working_copy_root: "C:\\target\\game\\client" }),
    ));
  });

  it("dry-run 运行时可关闭窗口并取消后台任务", async () => {
    const onClose = vi.fn();
    getTaskMock.mockImplementation(() => new Promise(() => undefined));
    renderDialog({ onClose });
    await inspectPath("C:\\target");
    await fireEvent.click(screen.getByRole("button", { name: "预览 Merge" }));
    await waitFor(() => expect(createMergeTaskMock).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByRole("button", { name: "关闭 Merge 窗口" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(cancelTaskMock).toHaveBeenCalledWith("merge-preview");
  });

  it("取消 dry-run 后保持取消状态直到后端任务终止", async () => {
    let pollCount = 0;
    getTaskMock.mockImplementation(() => {
      pollCount += 1;
      return pollCount === 1
        ? new Promise(() => undefined)
        : Promise.resolve(makeTask("cancelled"));
    });
    cancelTaskMock.mockResolvedValue(makeTask("running"));
    renderDialog();
    await inspectPath("C:\\target");
    await fireEvent.click(screen.getByRole("button", { name: "预览 Merge" }));
    await waitFor(() => expect(createMergeTaskMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(getTaskMock).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByRole("button", { name: "取消任务" }));

    expect(cancelTaskMock).toHaveBeenCalledWith("merge-preview");
    expect(screen.getByRole("button", { name: "正在取消" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled());
    expect(screen.getByText("cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "命令错误" })).not.toBeInTheDocument();
  });

  it("拒绝不同仓库和来源工作副本本身", async () => {
    inspectUpdateTargetMock.mockResolvedValueOnce(
      makeTarget({ repository_root: "https://other.example.com/svn" }),
    );
    renderDialog();
    await inspectPath("C:\\other");

    expect(await screen.findByRole("alert", { name: "命令错误" })).toHaveTextContent(
      "目标工作副本不属于当前 SVN 仓库",
    );
    expect(scanWorkspaceStatusMock).not.toHaveBeenCalled();

    inspectUpdateTargetMock.mockResolvedValueOnce(
      makeTarget({ working_copy_root: "C:\\source", target_path: "C:\\source" }),
    );
    await inspectPath("C:\\source");
    expect(await screen.findByRole("alert", { name: "命令错误" })).toHaveTextContent(
      "请选择另一个本地工作副本",
    );
  });

  it("允许脏工作副本生成独立预览", async () => {
    scanWorkspaceStatusMock.mockResolvedValueOnce(
      makeStatus({ total: 2, local_changes: 2, modified: 2 }),
    );
    renderDialog();
    await inspectPath("C:\\target");

    expect(screen.getByText("2 项本地改动")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "预览 Merge" }));
    await waitFor(() => expect(launchMergePreviewWindowMock).toHaveBeenCalledOnce());
  });

  it("允许脏工作副本直接 Merge，并展示合并后的状态和 Diff", async () => {
    const onMerged = vi.fn();
    const onClose = vi.fn();
    const initialStatus = makeStatus({ total: 2, local_changes: 2, modified: 2 });
    const postMergeStatus = makeStatus({
      total: 3,
      returned: 1,
      limit: 500,
      local_changes: 3,
      modified: 3,
      files: [makeChangedFile("src/main.ts")],
    });
    scanWorkspaceStatusMock
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce(postMergeStatus);
    createMergeTaskMock.mockResolvedValueOnce(makeTask("pending", null, "merge-apply"));
    getTaskMock.mockResolvedValueOnce(makeTask("success", makeMergeResult(false), "merge-apply"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog({ onMerged, onClose });
    await inspectPath("C:\\target");

    await fireEvent.click(screen.getByRole("button", { name: "直接应用" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("目标当前已有 2 项本地改动"));
    await waitFor(() => expect(createMergeTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\target",
      source_url: "https://example.com/svn/branches/feature",
      revisions: ["101", "105"],
      dry_run: false,
      allow_local_changes: true,
      record_only: false,
      ignore_ancestry: false,
      force: false,
      svn_executable: "C:\\Tools\\svn.exe",
    }));
    const review = await screen.findByLabelText("Merge 后检查");
    expect(within(review).getByText("包含 Merge 前已有的本地改动")).toBeInTheDocument();
    expect(within(review).getByRole("button", { name: /src\/main\.ts/ })).toBeInTheDocument();
    await waitFor(() => expect(getFileDiffMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\target",
      file_path: "src/main.ts",
      svn_executable: "C:\\Tools\\svn.exe",
    }));
    expect(onMerged).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "关闭 Merge 窗口" }));
    expect(onMerged).toHaveBeenCalledWith("C:\\target");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("可筛选冲突文件并从结果页标记为已解决", async () => {
    const conflictFile = makeChangedFile("src/conflict.ts", {
      status: "conflicted",
      abnormal: true,
      conflict_kind: "text",
    });
    const postMergeStatus = makeStatus({
      total: 2,
      returned: 2,
      limit: 500,
      local_changes: 2,
      modified: 1,
      conflicted: 1,
      files: [makeChangedFile("src/main.ts"), conflictFile],
    });
    scanWorkspaceStatusMock
      .mockResolvedValueOnce(makeStatus())
      .mockResolvedValueOnce(postMergeStatus)
      .mockResolvedValueOnce(makeStatus());
    createMergeTaskMock.mockResolvedValueOnce(makeTask("pending", null, "merge-apply"));
    getTaskMock
      .mockResolvedValueOnce(makeTask("success", makeMergeResult(false), "merge-apply"))
      .mockResolvedValueOnce(makeTask("success", null, "resolve-1"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog();
    await inspectPath("C:\\target");
    await fireEvent.click(screen.getByRole("button", { name: "直接应用" }));

    const review = await screen.findByLabelText("Merge 后检查");
    await fireEvent.click(within(review).getByRole("tab", { name: "冲突 1" }));
    await fireEvent.click(within(review).getByRole("button", { name: "冲突 src/conflict.ts" }));
    await fireEvent.click(within(review).getByRole("button", { name: "标记已解决" }));

    expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\target",
      kind: "resolve_working",
      file_path: "src/conflict.ts",
      svn_executable: "C:\\Tools\\svn.exe",
    });
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(3));
  });

  it("显示 dry-run 发现的冲突和 SVN 输出", async () => {
    getTaskMock.mockResolvedValueOnce(
      makeTask("success", {
        ...makeMergeResult(true),
        conflicted: 1,
        output_text: "C    src/main.ts",
      }),
    );
    renderDialog();
    await inspectPath("C:\\target");
    await fireEvent.click(screen.getByRole("button", { name: "预览 Merge" }));

    const result = await screen.findByLabelText("Merge 结果");
    expect(within(result).getByText("预览发现冲突")).toBeInTheDocument();
    expect(within(result).getByText("C src/main.ts")).toBeInTheDocument();
    expect(within(result).getByText("1", { selector: ".conflicted strong" })).toBeInTheDocument();
  });

  it("显示任务失败的后端错误", async () => {
    getTaskMock.mockResolvedValueOnce({
      ...makeTask("failed"),
      error: "svn: E195016: Reintegrate merge not allowed",
    });
    renderDialog();
    await inspectPath("C:\\target");
    await fireEvent.click(screen.getByRole("button", { name: "预览 Merge" }));

    const alert = await screen.findByRole("alert", { name: "命令错误" });
    expect(alert).toHaveTextContent("Merge 预览失败");
    expect(alert).toHaveTextContent("svn: E195016");
  });
});

function renderDialog(overrides: Record<string, unknown> = {}) {
  return render(LogMergeDialog, {
    props: {
      sourceUrl: "https://example.com/svn/branches/feature",
      sourceRepositoryRoot: "https://example.com/svn",
      sourceWorkingCopyRoot: "C:\\source",
      revisions: ["101", "105"],
      svnExecutable: "C:\\Tools\\svn.exe",
      ...overrides,
    },
  });
}

async function inspectPath(path: string) {
  await fireEvent.input(screen.getByLabelText("目标工作副本"), {
    target: { value: path },
  });
  await fireEvent.click(screen.getByRole("button", { name: "检查" }));
  await waitFor(() => expect(inspectUpdateTargetMock).toHaveBeenCalled());
}

function makeTarget(
  overrides: Partial<UpdateTargetSummary> = {},
): UpdateTargetSummary {
  return {
    target_path: "C:\\target",
    working_copy_root: "C:\\target",
    relative_path: null,
    repository_url: "https://example.com/svn/trunk",
    repository_root: "https://example.com/svn",
    revision: "100",
    kind: "dir",
    ...overrides,
  };
}

function makeStatus(overrides: Partial<WorkingCopyStatus> = {}): WorkingCopyStatus {
  return {
    working_copy_root: "C:\\target",
    total: 0,
    returned: 0,
    offset: 0,
    limit: 1,
    revision_range: "100",
    mixed_revision: false,
    remote_updates_checked: false,
    repository_revision: null,
    local_changes: 0,
    remote_changes: 0,
    combined_changes: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    missing: 0,
    unversioned: 0,
    conflicted: 0,
    obstructed: 0,
    property_changed: 0,
    files: [],
    ...overrides,
  };
}

function makeChangedFile(
  path: string,
  overrides: Partial<WorkingCopyStatus["files"][number]> = {},
): WorkingCopyStatus["files"][number] {
  return {
    path,
    status: "modified",
    changelist: null,
    revision: "100",
    property_status: "none",
    property_changed: false,
    remote_status: null,
    remote_property_status: null,
    change_scope: "local",
    abnormal: false,
    lock_state: "none",
    lock_owner: null,
    lock_comment: null,
    conflict_kind: null,
    file_size: 10,
    content_digest: "digest",
    ...overrides,
  };
}

function makeTask(
  status: Task["status"],
  mergeResult: MergeResult | null = null,
  taskId = "merge-preview",
): Task {
  return {
    task_id: taskId,
    title: mergeResult?.dry_run === false ? "Merge feature" : "Merge dry-run feature",
    status,
    error: null,
    logs: [],
    result: mergeResult
      ? {
          repository_list: null,
          repository_file: null,
          repository_export: null,
          revision_diff: null,
          merge_result: mergeResult,
          apply_patch_result: null,
        }
      : null,
    created_at: 1,
    updated_at: 2,
  };
}

function makeMergeResult(dryRun: boolean): MergeResult {
  return {
    dry_run: dryRun,
    source_url: "https://example.com/svn/branches/feature",
    revision_range: "101,105",
    record_only: false,
    ignore_ancestry: false,
    force: false,
    output_text: "U    src/main.ts",
    output_truncated: false,
    max_output_bytes: 1024,
    file_count: 1,
    line_count: 1,
    added: 0,
    deleted: 0,
    updated: 1,
    conflicted: 0,
    preview_id: dryRun ? "a".repeat(64) : null,
  };
}
