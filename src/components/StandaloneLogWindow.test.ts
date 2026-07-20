import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getPathSvnLog: vi.fn(),
}));

import { getPathSvnLog } from "../lib/api";
import type { SvnLog } from "../types/api";
import StandaloneLogWindow from "./StandaloneLogWindow.svelte";

const getPathSvnLogMock = vi.mocked(getPathSvnLog);

beforeEach(() => {
  localStorage.clear();
  getPathSvnLogMock.mockReset();
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
    expect(screen.queryByText("/trunk/src/main.ts")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "查看路径" }));
    expect(screen.getByText("/trunk/src/main.ts")).toBeInTheDocument();
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

  it("选择历史日志并缓存为待填充的提交日志", async () => {
    getPathSvnLogMock.mockResolvedValue(
      makeLog({
        entries: [
          makeEntry("20", "alice", "2026-07-10T10:00:00Z", "Add log window"),
          makeEntry("19", "bob", "2026-07-09T10:00:00Z", "Fix context menu"),
        ],
      }),
    );
    render(StandaloneLogWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("Fix context menu");

    await fireEvent.click(screen.getByRole("button", { name: "获取历史日志" }));
    const dialog = screen.getByRole("dialog", { name: "选择历史提交日志" });
    const history = within(dialog).getByRole("listbox", { name: "历史提交日志" });
    await fireEvent.change(history, { target: { value: "Fix context menu" } });
    await fireEvent.click(within(dialog).getByRole("button", { name: "填充提交日志" }));

    expect(localStorage.getItem("novasvn:pending-commit-message")).toBe("Fix context menu");
    expect(screen.getByRole("status")).toHaveTextContent("已填充到提交日志");
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
    changed_paths: [
      {
        path: "/trunk/src/main.ts",
        action: "M",
        kind: "file",
        copy_from_path: null,
        copy_from_revision: null,
      },
    ],
  };
}
