import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { closeWindowMock } = vi.hoisted(() => ({
  closeWindowMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: closeWindowMock }),
}));

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  chooseWorkspaceDirectory: vi.fn(),
  createMergeTask: vi.fn(),
  createRevertRevisionTask: vi.fn(),
  getPathSvnLog: vi.fn(),
  getRepositoryFileLog: vi.fn(),
  getRevisionFileContentDiff: vi.fn(),
  getTask: vi.fn(),
  inspectUpdateTarget: vi.fn(),
  launchLogWindow: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
}));

vi.mock("./workbench/MonacoDiffViewer.svelte", () => ({
  default: vi.fn().mockImplementation((internals) => ({
    c: vi.fn(),
    m: vi.fn(),
    p: vi.fn(),
    d: vi.fn(),
    ...internals,
  })),
}));

import {
  createRevertRevisionTask,
  getPathSvnLog,
  getRepositoryFileLog,
  getRevisionFileContentDiff,
  launchLogWindow,
} from "../lib/api";
import type { SvnLog, Task } from "../types/api";
import StandaloneLogWindow from "./StandaloneLogWindow.svelte";

const getPathSvnLogMock = vi.mocked(getPathSvnLog);
const createRevertRevisionTaskMock = vi.mocked(createRevertRevisionTask);
const getRepositoryFileLogMock = vi.mocked(getRepositoryFileLog);
const getRevisionFileContentDiffMock = vi.mocked(getRevisionFileContentDiff);
const launchLogWindowMock = vi.mocked(launchLogWindow);

beforeEach(() => {
  localStorage.clear();
  closeWindowMock.mockReset();
  closeWindowMock.mockResolvedValue(undefined);
  getPathSvnLogMock.mockReset();
  createRevertRevisionTaskMock.mockReset();
  getRepositoryFileLogMock.mockReset();
  getRevisionFileContentDiffMock.mockReset();
  launchLogWindowMock.mockReset();
});

describe("StandaloneLogWindow", () => {
  it("空闲时按 Escape 关闭 Log 窗口", async () => {
    getPathSvnLogMock.mockResolvedValue(makeLog());
    render(StandaloneLogWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("Add log window");

    await fireEvent.keyDown(window, { key: "Escape" });

    expect(closeWindowMock).toHaveBeenCalledOnce();
  });

  it("按 Escape 先关闭文件菜单，再关闭 Log 窗口", async () => {
    getPathSvnLogMock.mockResolvedValue(makeLog());
    render(StandaloneLogWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("Add log window");
    await fireEvent.click(screen.getByRole("button", { name: "查看路径" }));
    await fireEvent.contextMenu(
      screen.getByRole("button", { name: "查看 r20 的 /trunk/src/main.ts diff" }),
      { clientX: 320, clientY: 240 },
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(closeWindowMock).not.toHaveBeenCalled();

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(closeWindowMock).toHaveBeenCalledOnce();
  });

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

  it("使用仓库 URL 和 peg revision 读取新窗口中的文件日志", async () => {
    getRepositoryFileLogMock.mockResolvedValue(
      makeLog({
        target: "https://svn.example.test/repo/trunk/src/main.ts",
        working_copy_root: null,
        repository_root: null,
      }),
    );

    render(StandaloneLogWindow, {
      props: {
        targetPath: "https://svn.example.test/repo/trunk/src/main.ts",
        repositoryRoot: "https://svn.example.test/repo",
        repositoryRevision: "20",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });

    await waitFor(() => {
      expect(getRepositoryFileLogMock).toHaveBeenCalledWith({
        url: "https://svn.example.test/repo/trunk/src/main.ts",
        revision: "20",
        svn_executable: "C:\\Tools\\svn.exe",
        limit: 50,
        start_revision: undefined,
      });
    });
    expect(getPathSvnLogMock).not.toHaveBeenCalled();
    expect(screen.getByText("Add log window")).toBeInTheDocument();
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

  it("连续加载所有剩余日志页", async () => {
    getPathSvnLogMock
      .mockResolvedValueOnce(makeLog({ has_more: true, next_start_revision: "19" }))
      .mockResolvedValueOnce(
        makeLog({
          entries: [
            makeEntry("20", "alice", "2026-07-10T10:00:00Z", "duplicate"),
            makeEntry("19", "bob", "2026-07-09T10:00:00Z", "Second page"),
          ],
          has_more: true,
          next_start_revision: "18",
        }),
      )
      .mockResolvedValueOnce(
        makeLog({
          entries: [makeEntry("18", "carol", "2026-07-08T10:00:00Z", "Final page")],
          has_more: false,
          next_start_revision: null,
        }),
      );
    render(StandaloneLogWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("Add log window");

    await fireEvent.click(screen.getByRole("button", { name: "加载全部" }));

    expect(await screen.findByText("Final page")).toBeInTheDocument();
    expect(getPathSvnLogMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      start_revision: "19",
    }));
    expect(getPathSvnLogMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      start_revision: "18",
    }));
    expect(screen.getAllByText("r20")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "加载全部" })).toBeDisabled();
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
    const revision = screen.getByText("r20").closest(".svn-log-revision");
    expect(screen.getByLabelText("本地 Revision r20")).toBeInTheDocument();
    expect(revision?.textContent?.replace(/\s/g, "")).toBe("r20本地RevisionA1M2D1");
    await fireEvent.click(screen.getByRole("button", { name: "查看路径" }));
    const changedPaths = screen.getByLabelText("r20 改变路径");
    expect(changedPaths.querySelector('[data-action="A"]')).toHaveTextContent("A");
    expect(changedPaths.querySelector('[data-action="M"]')).toHaveTextContent("M");
    expect(changedPaths.querySelector('[data-action="D"]')).toHaveTextContent("D");
  });

  it("点击文件后读取并显示该 revision 的 Diff", async () => {
    getPathSvnLogMock.mockResolvedValue(makeLog());
    getRevisionFileContentDiffMock.mockResolvedValue({
      path: "/trunk/src/main.ts",
      original_text: "before",
      modified_text: "after",
      language: "typescript",
      binary: false,
      too_large: false,
      max_bytes: 20 * 1024 * 1024,
    });
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

    expect(getRevisionFileContentDiffMock).toHaveBeenCalledWith({
      target_url: "https://svn.example.test/repo/trunk/src/main.ts@20",
      file_path: "/trunk/src/main.ts",
      left_revision: "19",
      right_revision: "20",
      action: "M",
      svn_executable: "C:\\Tools\\svn.exe",
      max_bytes: 20 * 1024 * 1024,
    });
    const diffPanel = await screen.findByLabelText("文件 Diff");
    expect(within(diffPanel).getByText("r20 文件 Diff")).toBeInTheDocument();
    expect(within(diffPanel).queryByText("-before +after")).not.toBeInTheDocument();
    const diffResizer = screen.getByRole("slider", { name: "调整文件 Diff 宽度" });
    expect(diffResizer).toHaveAttribute("aria-valuemax", "1600");
    await fireEvent.keyDown(diffResizer, { key: "Home" });
    expect(diffResizer).toHaveAttribute("aria-valuenow", "320");
  });

  it("从独立 Log 撤销指定的单次提交", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    getPathSvnLogMock.mockResolvedValue(makeLog());
    createRevertRevisionTaskMock.mockResolvedValue(
      makeTask({ status: "success", title: "撤销提交 r20" }),
    );
    render(StandaloneLogWindow, {
      props: {
        targetPath: "C:\\repo",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });
    await screen.findByText("Add log window");

    const revertButton = screen.getByRole("button", {
      name: "撤销提交 r20",
    });
    await fireEvent.click(revertButton);

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(createRevertRevisionTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\repo",
      target_revision: "20",
      svn_executable: "C:\\Tools\\svn.exe",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "已撤销提交 r20，本地修改已生成",
    );
    confirmMock.mockRestore();
  });

  it("多选离散 Revision 后按数字顺序打开 Merge 对话框", async () => {
    getPathSvnLogMock.mockResolvedValue(
      makeLog({
        entries: [
          makeEntry("20", "alice", "2026-07-10T10:00:00Z", "Newer change"),
          {
            ...makeEntry("18", "bob", "2026-07-08T10:00:00Z", "Older change"),
            changed_paths: [
              makeChangedPath("/branches/release/older.ts", "A"),
              makeChangedPath("/trunk/src/main.ts", "A"),
            ],
          },
        ],
      }),
    );
    render(StandaloneLogWindow, { props: { targetPath: "C:\\repo" } });
    await screen.findByText("Newer change");

    expect(screen.queryByLabelText("已选 Revision 文件变化")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("checkbox", { name: "选择 r20 用于 Merge" }));
    let changedPaths = screen.getByLabelText("已选 Revision 文件变化");
    expect(within(changedPaths).getByText("/trunk/src/main.ts")).toBeInTheDocument();
    expect(within(changedPaths).getByLabelText("所选 Revision 文件合集")).toBeInTheDocument();

    await fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Revision Merge 操作" })).getByRole(
        "button",
        { name: "清除" },
      ),
    );
    expect(screen.queryByLabelText("已选 Revision 文件变化")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("checkbox", { name: "选择 r20 用于 Merge" }));
    await fireEvent.click(screen.getByRole("checkbox", { name: "选择 r18 用于 Merge" }));
    changedPaths = screen.getByLabelText("已选 Revision 文件变化");
    expect(within(changedPaths).getByText("/branches/release/older.ts")).toBeInTheDocument();
    expect(within(changedPaths).getAllByText("/trunk/src/main.ts")).toHaveLength(1);
    const sharedPath = within(changedPaths).getByRole("button", {
      name: "查看 r20 的 /trunk/src/main.ts diff",
    });
    expect(within(sharedPath).getByLabelText("状态 A、M")).toBeInTheDocument();
    expect(within(changedPaths).getByText("2 个 Revision，2 个路径")).toBeInTheDocument();
    const toolbar = screen.getByRole("toolbar", { name: "Revision Merge 操作" });
    expect(within(toolbar).getByText("已选 2 个 Revision")).toBeInTheDocument();
    expect(within(toolbar).getByText("r18、r20")).toBeInTheDocument();

    await fireEvent.click(within(toolbar).getByRole("button", { name: "Merge 到..." }));
    const dialog = screen.getByRole("dialog", { name: "Merge 选中 Revision" });
    expect(within(dialog).getByText("r18、r20")).toBeInTheDocument();
    expect(within(dialog).getByText("https://svn.example.test/repo/trunk/src/main.ts"))
      .toBeInTheDocument();
  });

  it("右键修改文件后可在新的独立窗口中显示该文件 Log", async () => {
    getPathSvnLogMock.mockResolvedValue(makeLog());
    launchLogWindowMock.mockResolvedValue({
      repository_url: "https://svn.example.test/repo/trunk/src/main.ts",
      repository_root: "https://svn.example.test/repo",
      revision: "20",
    });
    render(StandaloneLogWindow, {
      props: { targetPath: "C:\\repo\\src\\main.ts" },
    });
    await screen.findByText("Add log window");
    await fireEvent.click(screen.getByRole("button", { name: "查看路径" }));
    const changedFile = screen.getByRole("button", {
      name: "查看 r20 的 /trunk/src/main.ts diff",
    });

    await fireEvent.contextMenu(changedFile, { clientX: 320, clientY: 240 });

    const menu = screen.getByRole("menu", {
      name: "文件菜单 /trunk/src/main.ts",
    });
    expect(within(menu).getByRole("menuitem", { name: "显示 Log" })).toHaveFocus();
    await fireEvent.click(within(menu).getByRole("menuitem", { name: "显示 Log" }));

    await waitFor(() => {
      expect(launchLogWindowMock).toHaveBeenCalledWith({
        repository_url: "https://svn.example.test/repo/trunk/src/main.ts",
        repository_root: "https://svn.example.test/repo",
        revision: "20",
      });
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(getRevisionFileContentDiffMock).not.toHaveBeenCalled();
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

  it("认证失败时弹出登录框并在登录后自动重试", async () => {
    const onSvnAuthenticationSubmit = vi.fn().mockResolvedValue(true);
    getPathSvnLogMock
      .mockRejectedValueOnce({
        code: "SVN_LOG_COMMAND_FAILED",
        message: "SVN 日志读取失败",
        detail:
          "svn: E215004: No more credentials for 'https://alice%40example.com@svn.example.test/repo'. Authentication failed",
        recoverable: true,
      })
      .mockResolvedValueOnce(makeLog());
    render(StandaloneLogWindow, {
      props: {
        targetPath: "C:\\repo\\src\\main.ts",
        svnAuthenticationUsername: "saved-user",
        svnRememberPassword: false,
        onSvnAuthenticationSubmit,
      },
    });

    const dialog = await screen.findByRole("dialog", { name: "登录 SVN" });
    expect(within(dialog).getByLabelText("用户名")).toHaveValue("alice@example.com");
    expect(within(dialog).getByRole("checkbox", { name: "保存到系统凭据存储" })).not.toBeChecked();
    await fireEvent.input(within(dialog).getByLabelText("密码"), {
      target: { value: "current-secret" },
    });
    await fireEvent.click(within(dialog).getByRole("button", { name: "登录并重试" }));

    await waitFor(() =>
      expect(onSvnAuthenticationSubmit).toHaveBeenCalledWith(
        "alice@example.com",
        "current-secret",
        false,
      ),
    );
    await waitFor(() => expect(getPathSvnLogMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Add log window")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "登录 SVN" })).not.toBeInTheDocument();
  });
});

function makeLog(overrides: Partial<SvnLog> = {}): SvnLog {
  return {
    target: "C:\\repo\\src\\main.ts",
    working_copy_root: "C:\\repo",
    repository_root: "https://svn.example.test/repo",
    repository_url: "https://svn.example.test/repo/trunk/src/main.ts",
    working_copy_revision: "20",
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

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: "revert-revision-1",
    title: "Revert Revision",
    status: "pending",
    logs: [],
    error: null,
    result: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}
