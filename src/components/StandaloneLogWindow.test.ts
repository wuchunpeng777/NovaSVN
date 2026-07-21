import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  createRevisionDiffTask: vi.fn(),
  getPathSvnLog: vi.fn(),
  getTask: vi.fn(),
}));

import { createRevisionDiffTask, getPathSvnLog, getTask } from "../lib/api";
import type { SvnLog, Task, TaskStatus } from "../types/api";
import StandaloneLogWindow from "./StandaloneLogWindow.svelte";

const getPathSvnLogMock = vi.mocked(getPathSvnLog);
const createRevisionDiffTaskMock = vi.mocked(createRevisionDiffTask);
const getTaskMock = vi.mocked(getTask);

beforeEach(() => {
  localStorage.clear();
  getPathSvnLogMock.mockReset();
  createRevisionDiffTaskMock.mockReset();
  getTaskMock.mockReset();
});

describe("StandaloneLogWindow", () => {
  it("自动读取右键选中的绝对路径", async () => {
    getPathSvnLogMock.mockResolvedValue(makeLog());

    render(StandaloneLogWindow, {
      props: {
        targetPath: "C:\\repo\\src\\main.ts",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });

    await waitFor(() => {
      expect(getPathSvnLogMock).toHaveBeenCalledWith({
        path: "C:\\repo\\src\\main.ts",
        svn_executable: "C:\\Tools\\svn.exe",
        limit: 50,
        start_revision: undefined,
      });
    });
    expect(screen.getByText("Add log window")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "获取历史日志" })).not.toBeInTheDocument();
    expect(screen.queryByText("/trunk/src/main.ts")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "展开 r20 日志" }));
    expect(screen.getByText("/trunk/src/main.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起 r20 日志" })).toBeInTheDocument();
  });

  it("按关键字、作者和日期过滤日志", async () => {
    getPathSvnLogMock.mockResolvedValue(
      makeLog({
        entries: [
          makeEntry("20", "alice", "2026-07-10T10:00:00Z", "Add log window"),
          makeEntry("19", "bob", "2026-07-12T10:00:00Z", "Fix menu"),
        ],
      }),
    );
    render(StandaloneLogWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("Add log window");

    await fireEvent.input(screen.getByLabelText("Log 关键字"), {
      target: { value: "menu" },
    });
    expect(screen.queryByText("Add log window")).not.toBeInTheDocument();
    expect(screen.getByText("Fix menu")).toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText("Log 作者"), {
      target: { value: "alice" },
    });
    expect(screen.getByText("0 / 2 revisions")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "清除" }));
    await fireEvent.input(screen.getByLabelText("Log 开始日期"), {
      target: { value: "2026-07-12" },
    });
    expect(screen.queryByText("Add log window")).not.toBeInTheDocument();
    expect(screen.getByText("Fix menu")).toBeInTheDocument();
  });

  it("使用下一页 revision 追加并去重", async () => {
    getPathSvnLogMock
      .mockResolvedValueOnce(
        makeLog({ has_more: true, next_start_revision: "19" }),
      )
      .mockResolvedValueOnce(
        makeLog({
          entries: [
            makeEntry("20", "alice", "2026-07-10T10:00:00Z", "duplicate"),
            makeEntry("19", "bob", "2026-07-09T10:00:00Z", "Older change"),
          ],
        }),
      );
    render(StandaloneLogWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("Add log window");

    await fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    await waitFor(() => {
      expect(getPathSvnLogMock).toHaveBeenLastCalledWith({
        path: "C:\\repo",
        svn_executable: undefined,
        limit: 50,
        start_revision: "19",
      });
    });
    expect(screen.getByText("Older change")).toBeInTheDocument();
    expect(screen.getAllByText("r20")).toHaveLength(1);
  });

  it("显示每条日志的 A/M/D 数量和状态标记", async () => {
    getPathSvnLogMock.mockResolvedValue(
      makeLog({
        entries: [
          {
            ...makeEntry("20", "alice", "2026-07-10T10:00:00Z", "Mixed change"),
            changed_paths: [
              makeChangedPath("/trunk/added.txt", "A"),
              makeChangedPath("/trunk/modified-1.txt", "M"),
              makeChangedPath("/trunk/modified-2.txt", "M"),
              makeChangedPath("/trunk/deleted.txt", "D"),
            ],
          },
        ],
      }),
    );
    render(StandaloneLogWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("Mixed change");

    expect(screen.getByLabelText("A 1")).toBeInTheDocument();
    expect(screen.getByLabelText("M 2")).toBeInTheDocument();
    expect(screen.getByLabelText("D 1")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "查看路径" }));
    const changedPaths = screen.getByLabelText("r20 改变路径");
    expect(changedPaths.querySelector('[data-action="A"]')).toHaveTextContent("A");
    expect(changedPaths.querySelector('[data-action="M"]')).toHaveTextContent("M");
    expect(changedPaths.querySelector('[data-action="D"]')).toHaveTextContent("D");
  });

  it("点击文件后读取并显示该 revision 的 Diff", async () => {
    getPathSvnLogMock.mockResolvedValue(makeLog());
    createRevisionDiffTaskMock.mockResolvedValue(makeRevisionDiffTask("running"));
    getTaskMock.mockResolvedValue(makeRevisionDiffTask("success"));
    render(StandaloneLogWindow, {
      props: {
        targetPath: "C:\\repo\\src\\main.ts",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });
    await screen.findByText("Add log window");
    await fireEvent.click(screen.getByRole("button", { name: "查看路径" }));
    await fireEvent.click(
      screen.getByRole("button", {
        name: "查看 r20 的 /trunk/src/main.ts diff",
      }),
    );

    expect(createRevisionDiffTaskMock).toHaveBeenCalledWith({
      mode: "revisions",
      working_copy_root: "C:\\repo",
      target_url: "https://svn.example.test/repo/trunk/src/main.ts@20",
      left_revision: "19",
      right_revision: "20",
      svn_executable: "C:\\Tools\\svn.exe",
    });
    expect(getTaskMock).toHaveBeenCalledWith("task-diff");
    const diffPanel = await screen.findByLabelText("文件 Diff");
    expect(within(diffPanel).getByText("r20 文件 Diff")).toBeInTheDocument();
    expect(within(diffPanel).getByText("-before +after")).toBeInTheDocument();
  });

  it("显示可重试的 SVN 错误", async () => {
    getPathSvnLogMock.mockRejectedValue({
      code: "SVN_LOG_COMMAND_FAILED",
      message: "SVN 日志读取失败",
      detail: "目标不是工作副本中的版本化路径",
      recoverable: true,
    });
    render(StandaloneLogWindow, { props: { targetPath: "C:\\repo\\missing.txt" } });

    const alert = await screen.findByRole("alert", { name: "命令错误" });
    expect(within(alert).getByText("SVN 日志读取失败")).toBeInTheDocument();
    expect(within(alert).getByText("目标不是工作副本中的版本化路径")).toBeInTheDocument();
  });
});

function makeLog(overrides: Partial<SvnLog> = {}): SvnLog {
  return {
    target: "C:\\repo\\src\\main.ts",
    working_copy_root: "C:\\repo",
    repository_root: "https://svn.example.test/repo",
    entries: [makeEntry("20", "alice", "2026-07-10T10:00:00Z", "Add log window")],
    has_more: false,
    next_start_revision: null,
    ...overrides,
  };
}

function makeEntry(revision: string, author: string, date: string, message: string) {
  return {
    revision,
    author,
    date,
    message,
    changed_paths: [makeChangedPath("/trunk/src/main.ts", "M")],
  };
}

function makeChangedPath(path: string, action: string) {
  return {
    path,
    action,
    kind: "file",
    copy_from_path: null,
    copy_from_revision: null,
  };
}

function makeRevisionDiffTask(status: TaskStatus): Task {
  return {
    task_id: "task-diff",
    title: "比较两个 revision",
    status,
    error: null,
    created_at: 1,
    updated_at: 2,
    logs: [],
    result:
      status === "success"
        ? {
            repository_list: null,
            repository_file: null,
            repository_export: null,
            revision_diff: {
              mode: "revisions",
              target: "/trunk/src/main.ts r19:r20",
              diff_text: "-before\n+after",
              file_count: 1,
              line_count: 2,
              truncated: false,
              max_bytes: 1024,
            },
            merge_result: null,
            apply_patch_result: null,
          }
        : null,
  };
}
