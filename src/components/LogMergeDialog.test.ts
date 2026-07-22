import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  chooseWorkspaceDirectory: vi.fn(),
  createMergeTask: vi.fn(),
  getTask: vi.fn(),
  inspectUpdateTarget: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
}));

import {
  createMergeTask,
  getTask,
  inspectUpdateTarget,
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
const getTaskMock = vi.mocked(getTask);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);

beforeEach(() => {
  createMergeTaskMock.mockReset();
  getTaskMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  scanWorkspaceStatusMock.mockReset();
  inspectUpdateTargetMock.mockResolvedValue(makeTarget());
  scanWorkspaceStatusMock.mockResolvedValue(makeStatus());
  createMergeTaskMock.mockResolvedValue(makeTask("pending"));
  getTaskMock.mockResolvedValue(makeTask("success", makeMergeResult(true)));
});

describe("LogMergeDialog", () => {
  it("验证目标后预览离散 Revision，并在预览成功后执行真实 Merge", async () => {
    const onMerged = vi.fn();
    renderDialog({ onMerged });

    await inspectPath("C:\\target");
    expect(inspectUpdateTargetMock).toHaveBeenCalledWith({
      path: "C:\\target",
      svn_executable: "C:\\Tools\\svn.exe",
    });
    expect(scanWorkspaceStatusMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\target",
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
      record_only: false,
      ignore_ancestry: false,
      force: false,
      svn_executable: "C:\\Tools\\svn.exe",
    }));
    expect(await screen.findByRole("button", { name: "应用 Merge" })).toBeEnabled();
    expect(screen.getByText("Dry-run 完成")).toBeInTheDocument();

    createMergeTaskMock.mockResolvedValueOnce(makeTask("pending", null, "merge-apply"));
    getTaskMock.mockResolvedValueOnce(
      makeTask("success", makeMergeResult(false), "merge-apply"),
    );
    await fireEvent.click(screen.getByRole("button", { name: "应用 Merge" }));

    await waitFor(() => expect(createMergeTaskMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        working_copy_root: "C:\\target",
        revisions: ["101", "105"],
        dry_run: false,
      }),
    ));
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith("C:\\target"));
    expect(screen.getByText("Merge 完成")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "应用 Merge" })).not.toBeInTheDocument();
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

  it("允许脏工作副本做预览，但禁止应用真实 Merge", async () => {
    scanWorkspaceStatusMock.mockResolvedValueOnce(
      makeStatus({ total: 2, local_changes: 2, modified: 2 }),
    );
    renderDialog();
    await inspectPath("C:\\target");

    expect(screen.getByText("2 项本地改动")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "预览 Merge" }));
    const applyButton = await screen.findByRole("button", { name: "应用 Merge" });
    expect(applyButton).toBeDisabled();
    expect(createMergeTaskMock).toHaveBeenCalledTimes(1);
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
  };
}
