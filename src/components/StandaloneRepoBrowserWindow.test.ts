import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const windowApiMocks = vi.hoisted(() => ({
  close: vi.fn(),
  setMinSize: vi.fn(),
  setSize: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApiMocks,
}));

vi.mock("../lib/api", () => ({
  chooseCheckoutTargetDirectory: vi.fn(),
  chooseExportDirectory: vi.fn(),
  chooseImportSource: vi.fn(),
  createRepositoryCheckoutTask: vi.fn(),
  createRepositoryCopyTask: vi.fn(),
  createRepositoryDeleteTask: vi.fn(),
  createRepositoryExportTask: vi.fn(),
  createRepositoryFileTask: vi.fn(),
  createRepositoryImportTask: vi.fn(),
  createRepositoryListTask: vi.fn(),
  createRepositoryMkdirTask: vi.fn(),
  createRepositoryMoveTask: vi.fn(),
  getRepositoryFileLog: vi.fn(),
  getRepositoryFileProperties: vi.fn(),
  getSvnInfo: vi.fn(),
  getTask: vi.fn(),
  launchBlameWindow: vi.fn(),
  launchLogWindow: vi.fn(),
  openLocalPathLocation: vi.fn(),
  openRepositoryTempFile: vi.fn(),
}));

import {
  createRepositoryListTask,
  createRepositoryMkdirTask,
  getSvnInfo,
  getTask,
  launchBlameWindow,
  launchLogWindow,
} from "../lib/api";
import type { Task, TaskStatus } from "../types/api";
import StandaloneRepoBrowserWindow from "./StandaloneRepoBrowserWindow.svelte";

const createRepositoryListTaskMock = vi.mocked(createRepositoryListTask);
const createRepositoryMkdirTaskMock = vi.mocked(createRepositoryMkdirTask);
const getSvnInfoMock = vi.mocked(getSvnInfo);
const getTaskMock = vi.mocked(getTask);
const launchBlameWindowMock = vi.mocked(launchBlameWindow);
const launchLogWindowMock = vi.mocked(launchLogWindow);

beforeEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  windowApiMocks.close.mockReset();
  windowApiMocks.setMinSize.mockReset();
  windowApiMocks.setMinSize.mockResolvedValue(undefined);
  windowApiMocks.setSize.mockReset();
  windowApiMocks.setSize.mockResolvedValue(undefined);
  createRepositoryListTaskMock.mockReset();
  createRepositoryMkdirTaskMock.mockReset();
  getSvnInfoMock.mockReset();
  getTaskMock.mockReset();
  launchBlameWindowMock.mockReset();
  launchBlameWindowMock.mockResolvedValue({
    repository_url: "https://example.com/svn/trunk/README.md",
    revision: "42",
  });
  launchLogWindowMock.mockReset();
  launchLogWindowMock.mockResolvedValue({
    repository_url: "https://example.com/svn/trunk/README.md",
    repository_root: "https://example.com/svn",
    revision: "42",
  });
  createRepositoryListTaskMock.mockResolvedValue(makeTask("pending", "list-task"));
  getTaskMock.mockResolvedValue(
    makeTask("success", "list-task", {
      repository_list: {
        url: "https://example.com/svn/trunk",
        revision: "42",
        entries: [
          {
            name: "src",
            kind: "dir",
            revision: "42",
            author: "alice",
            date: "2026-07-01T00:00:00.000Z",
          },
          {
            name: "README.md",
            kind: "file",
            revision: "41",
            author: "bob",
            date: "2026-07-02T00:00:00.000Z",
          },
        ],
      },
    }),
  );
});

describe("StandaloneRepoBrowserWindow", () => {
  it("加载、选择和进入目录时不调整窗口大小，也不显示底部状态栏", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const { container } = render(StandaloneRepoBrowserWindow, {
      props: { targetPath: "https://example.com/svn/trunk" },
    });

    await screen.findByRole("button", { name: "打开仓库文件 README.md" });
    await fireEvent.click(screen.getByRole("button", { name: "打开仓库文件 README.md" }));
    expect(windowApiMocks.setMinSize).not.toHaveBeenCalled();
    expect(windowApiMocks.setSize).not.toHaveBeenCalled();
    expect(container.querySelector(".browser-statusbar")).not.toBeInTheDocument();
    expect(screen.queryByText("已连接")).not.toBeInTheDocument();

    createRepositoryListTaskMock.mockResolvedValue(makeTask("pending", "list-task-2"));
    getTaskMock.mockResolvedValue(
      makeTask("success", "list-task-2", {
        repository_list: {
          url: "https://example.com/svn/trunk/src",
          revision: "42",
          entries: [
            {
              name: "main.ts",
              kind: "file",
              revision: "42",
              author: "alice",
              date: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    await fireEvent.doubleClick(screen.getByRole("button", { name: "打开仓库目录 src" }));
    await screen.findByRole("button", { name: "打开仓库文件 main.ts" });
    expect(windowApiMocks.setMinSize).not.toHaveBeenCalled();
    expect(windowApiMocks.setSize).not.toHaveBeenCalled();
  });

  it("从工作副本路径解析仓库 URL 并加载目录", async () => {
    getSvnInfoMock.mockResolvedValue({
      target_path: "C:\\wc",
      working_copy_root: "C:\\wc",
      relative_path: "",
      kind: "dir",
      repository_url: "https://example.com/svn/trunk",
      repository_root: "https://example.com/svn",
      repository_uuid: "uuid",
      revision: "42",
      last_changed_revision: "42",
      last_changed_author: "alice",
      last_changed_date: "2026-07-01T00:00:00.000Z",
    });

    render(StandaloneRepoBrowserWindow, {
      props: {
        targetPath: "C:\\wc",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });

    await waitFor(() => {
      expect(getSvnInfoMock).toHaveBeenCalledWith({
        path: "C:\\wc",
        svn_executable: "C:\\Tools\\svn.exe",
      });
    });
    await waitFor(() => {
      expect(createRepositoryListTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        revision: undefined,
        svn_executable: "C:\\Tools\\svn.exe",
      });
    });
    expect(await screen.findByRole("button", { name: "打开仓库目录 src" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开仓库文件 README.md" })).toBeInTheDocument();
    expect(screen.getByLabelText("仓库 URL")).toHaveValue("https://example.com/svn/trunk");
  });

  it("可直接使用仓库 URL 启动并进入子目录", async () => {
    render(StandaloneRepoBrowserWindow, {
      props: {
        targetPath: "https://example.com/svn/trunk",
      },
    });

    const srcButton = await screen.findByRole("button", { name: "打开仓库目录 src" });

    createRepositoryListTaskMock.mockResolvedValue(makeTask("pending", "list-task-2"));
    getTaskMock.mockResolvedValue(
      makeTask("success", "list-task-2", {
        repository_list: {
          url: "https://example.com/svn/trunk/src",
          revision: "42",
          entries: [
            {
              name: "main.ts",
              kind: "file",
              revision: "42",
              author: "alice",
              date: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    await fireEvent.doubleClick(srcButton);

    await waitFor(() => {
      expect(createRepositoryListTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/src",
        revision: undefined,
        svn_executable: undefined,
      });
    });
    expect(await screen.findByRole("button", { name: "打开仓库文件 main.ts" })).toBeInTheDocument();
  });

  it("从右键菜单查看日志时保留仓库条目 URL", async () => {
    render(StandaloneRepoBrowserWindow, {
      props: { targetPath: "https://example.com/svn/trunk" },
    });

    const readme = await screen.findByRole("button", { name: "打开仓库文件 README.md" });
    await fireEvent.contextMenu(readme, { clientX: 120, clientY: 160 });
    await fireEvent.click(screen.getByRole("menuitem", { name: "查看日志" }));

    await waitFor(() => {
      expect(launchLogWindowMock).toHaveBeenCalledWith({
        repository_url: "https://example.com/svn/trunk/README.md",
        repository_root: "https://example.com/svn",
        revision: "42",
      });
    });
  });

  it("从右键菜单在独立窗口中查看 Blame", async () => {
    render(StandaloneRepoBrowserWindow, {
      props: { targetPath: "https://example.com/svn/trunk" },
    });

    const readme = await screen.findByRole("button", { name: "打开仓库文件 README.md" });
    await fireEvent.contextMenu(readme, { clientX: 120, clientY: 160 });
    await fireEvent.click(screen.getByRole("menuitem", { name: "逐行追溯" }));

    await waitFor(() => {
      expect(launchBlameWindowMock).toHaveBeenCalledWith({
        repository_url: "https://example.com/svn/trunk/README.md",
        revision: "42",
      });
    });
    expect(screen.queryByText("正在读取 Blame")).not.toBeInTheDocument();
  });

  it("没有 peg revision 时仍在独立窗口中查看 HEAD 日志", async () => {
    getTaskMock.mockResolvedValue(
      makeTask("success", "list-task", {
        repository_list: {
          url: "https://example.com/svn/trunk",
          revision: null,
          entries: [
            {
              name: "README.md",
              kind: "file",
              revision: "",
              author: "",
              date: "",
            },
          ],
        },
      }),
    );
    launchLogWindowMock.mockResolvedValue({
      repository_url: "https://example.com/svn/trunk/README.md",
      repository_root: "https://example.com/svn",
      revision: null,
    });

    render(StandaloneRepoBrowserWindow, {
      props: { targetPath: "https://example.com/svn/trunk" },
    });

    const readme = await screen.findByRole("button", { name: "打开仓库文件 README.md" });
    await fireEvent.contextMenu(readme, { clientX: 120, clientY: 160 });
    await fireEvent.click(screen.getByRole("menuitem", { name: "查看日志" }));

    await waitFor(() => {
      expect(launchLogWindowMock).toHaveBeenCalledWith({
        repository_url: "https://example.com/svn/trunk/README.md",
        repository_root: "https://example.com/svn",
        revision: undefined,
      });
    });
    expect(screen.queryByText("文件日志")).not.toBeInTheDocument();
  });

  it("可通过创建目录表单执行 mkdir 并刷新", async () => {
    render(StandaloneRepoBrowserWindow, {
      props: {
        targetPath: "https://example.com/svn/trunk",
      },
    });
    await screen.findByRole("button", { name: "打开仓库目录 src" });

    await fireEvent.click(screen.getByRole("button", { name: "创建目录" }));
    await fireEvent.input(screen.getByLabelText("目录名"), {
      target: { value: "docs" },
    });
    await fireEvent.input(screen.getByLabelText("提交信息"), {
      target: { value: "add docs dir" },
    });

    createRepositoryMkdirTaskMock.mockResolvedValue(makeTask("pending", "mkdir-task"));
    getTaskMock
      .mockResolvedValueOnce(makeTask("success", "mkdir-task"))
      .mockResolvedValueOnce(
        makeTask("success", "list-after-mkdir", {
          repository_list: {
            url: "https://example.com/svn/trunk",
            revision: "43",
            entries: [
              {
                name: "docs",
                kind: "dir",
                revision: "43",
                author: "alice",
                date: "2026-07-03T00:00:00.000Z",
              },
            ],
          },
        }),
      );
    createRepositoryListTaskMock.mockResolvedValueOnce(makeTask("pending", "list-after-mkdir"));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await fireEvent.click(screen.getByRole("button", { name: "执行" }));

    await waitFor(() => {
      expect(createRepositoryMkdirTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/docs",
        message: "add docs dir",
        svn_executable: undefined,
      });
    });
    confirmSpy.mockRestore();
  });

  it("可筛选当前目录", async () => {
    render(StandaloneRepoBrowserWindow, {
      props: { targetPath: "https://example.com/svn/trunk" },
    });

    await screen.findByRole("button", { name: "打开仓库文件 README.md" });
    await fireEvent.input(screen.getByRole("searchbox", { name: "筛选当前目录" }), {
      target: { value: "readme" },
    });

    expect(screen.queryByRole("button", { name: "打开仓库目录 src" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开仓库文件 README.md" })).toBeInTheDocument();
  });

  it("展开目录树时不切换右侧当前目录", async () => {
    render(StandaloneRepoBrowserWindow, {
      props: { targetPath: "https://example.com/svn/trunk" },
    });

    await screen.findByRole("button", { name: "打开仓库文件 README.md" });
    createRepositoryListTaskMock.mockResolvedValue(makeTask("pending", "tree-task"));
    getTaskMock.mockResolvedValue(
      makeTask("success", "tree-task", {
        repository_list: {
          url: "https://example.com/svn/trunk/src",
          revision: "42",
          entries: [
            {
              name: "components",
              kind: "dir",
              revision: "42",
              author: "alice",
              date: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    await fireEvent.click(screen.getByRole("button", { name: "展开 src" }));

    await waitFor(() => {
      expect(createRepositoryListTaskMock).toHaveBeenLastCalledWith({
        url: "https://example.com/svn/trunk/src",
        revision: undefined,
        svn_executable: undefined,
      });
    });
    expect(screen.getByLabelText("仓库 URL")).toHaveValue("https://example.com/svn/trunk");
    expect(screen.getByRole("button", { name: "打开仓库文件 README.md" })).toBeInTheDocument();
  });
});

function makeTask(
  status: TaskStatus,
  taskId = "repo-browser-task",
  result: Partial<NonNullable<Task["result"]>> | null = null,
): Task {
  return {
    task_id: taskId,
    title: "Repository Browser",
    status,
    error: null,
    logs: [
      {
        message: "repository browser task",
        created_at: 1_725_000_000_000,
      },
    ],
    result: {
      repository_list: null,
      repository_file: null,
      repository_export: null,
      revision_diff: null,
      merge_result: null,
      apply_patch_result: null,
      ...(result ?? {}),
    },
    created_at: 1_725_000_000_000,
    updated_at: 1_725_000_000_000,
  };
}
