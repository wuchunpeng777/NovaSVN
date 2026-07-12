import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("./MonacoDiffViewer.svelte", () => ({
  default: vi.fn().mockImplementation((internals) => ({
    c: vi.fn(),
    m: vi.fn(),
    p: vi.fn(),
    d: vi.fn(),
    ...internals,
  })),
}));

import { workbenchViews } from "../../lib/workbench";
import type { AppSettingsState } from "../../types/app";
import type {
  ChangedFile,
  Task,
  WorkingCopyStatus,
  WorkspaceFileTree,
  WorkspaceSummary,
} from "../../types/api";
import MainWorkspace from "./MainWorkspace.svelte";

describe("MainWorkspace", () => {
  it("renders accessible toolbar icons and exposes operation running states", async () => {
    const onRefreshStatus = vi.fn();
    const onUpdateWorkspace = vi.fn();
    const onChooseApplyPatch = vi.fn();
    const onCleanupWorkspace = vi.fn();
    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        onRefreshStatus,
        onUpdateWorkspace,
        onChooseApplyPatch,
        onCleanupWorkspace,
      },
    });

    const toolbar = screen.getByLabelText("工作副本工具栏");
    const refreshButton = within(toolbar).getByRole("button", { name: "刷新工作副本状态" });
    const updateButton = within(toolbar).getByRole("button", { name: "更新工作副本" });
    const patchButton = within(toolbar).getByRole("button", { name: "应用 Patch" });
    const cleanupButton = within(toolbar).getByRole("button", { name: "清理工作副本" });

    expect(toolbar.querySelectorAll("svg")).toHaveLength(6);
    expect(
      within(toolbar).getByRole("button", { name: "隐藏项目侧栏" }),
    ).toHaveAttribute("title", "隐藏项目侧栏");
    expect(
      within(toolbar).getByRole("button", { name: "隐藏检查器" }),
    ).toHaveAttribute("title", "隐藏检查器");
    expect(refreshButton).toHaveAttribute("title", "刷新工作副本状态");
    expect(updateButton).toHaveAttribute("title", "更新工作副本");
    expect(patchButton).toHaveAttribute("title", "应用 Patch");
    expect(cleanupButton).toHaveAttribute("title", "清理工作副本");

    await fireEvent.click(refreshButton);
    await fireEvent.click(updateButton);
    await fireEvent.click(patchButton);
    await fireEvent.click(cleanupButton);
    expect(onRefreshStatus).toHaveBeenCalledOnce();
    expect(onUpdateWorkspace).toHaveBeenCalledOnce();
    expect(onChooseApplyPatch).toHaveBeenCalledOnce();
    expect(onCleanupWorkspace).toHaveBeenCalledOnce();

    await rerender({ statusLoading: true });
    expect(
      within(toolbar).getByRole("button", { name: "正在刷新工作副本状态" }),
    ).toBeDisabled();
    expect(within(toolbar).getByRole("button", { name: "隐藏项目侧栏" })).toBeEnabled();
    expect(within(toolbar).getByRole("button", { name: "隐藏检查器" })).toBeEnabled();
    for (const name of ["更新工作副本", "应用 Patch", "清理工作副本"]) {
      expect(within(toolbar).getByRole("button", { name })).toBeDisabled();
    }

    await rerender({ statusLoading: false, pendingSvnOperationKind: "update" });
    expect(
      within(toolbar).getByRole("button", { name: "正在更新工作副本" }),
    ).toHaveAttribute("aria-busy", "true");

    await rerender({ pendingSvnOperationKind: "cleanup" });
    expect(
      within(toolbar).getByRole("button", { name: "正在清理工作副本" }),
    ).toHaveAttribute("aria-busy", "true");

    await rerender({ pendingSvnOperationKind: null, applyPatchRunning: true });
    expect(
      within(toolbar).getByRole("button", { name: "正在应用 Patch" }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the inspector within the 960px window layout budget", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 960 });

    try {
      render(MainWorkspace, {
        props: {
          view: workbenchViews.changes,
          workspace: makeWorkspace(),
        },
      });

      const resizer = screen.getByRole("slider", { name: "调整右侧面板宽度" });
      expect(resizer).toHaveAttribute("aria-valuemin", "300");
      expect(resizer).toHaveAttribute("aria-valuemax", "374");
      expect(resizer).toHaveAttribute("aria-valuenow", "374");
      expect(resizer).toHaveAttribute("aria-orientation", "horizontal");

      await fireEvent.keyDown(resizer, { key: "ArrowLeft" });
      expect(resizer).toHaveAttribute("aria-valuenow", "350");

      await fireEvent.keyDown(resizer, { key: "ArrowRight" });
      expect(resizer).toHaveAttribute("aria-valuenow", "374");

      await fireEvent.keyDown(resizer, { key: "Home" });
      expect(resizer).toHaveAttribute("aria-valuenow", "300");

      await fireEvent.keyDown(resizer, { key: "End" });
      expect(resizer).toHaveAttribute("aria-valuenow", "374");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
      window.dispatchEvent(new Event("resize"));
    }
  });

  it("organizes inspector content into keyboard-accessible tabs", async () => {
    const file = makeFile("src/main.ts", "modified", "main-digest");
    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([file]),
        workspaceFileTree: makeFileTree(),
        selectedFilePath: file.path,
        selectedFile: file,
        commitFiles: [{ path: file.path, status: file.status }],
        selectedFileDiff: {
          path: file.path,
          text: "-before\n+after",
          binary: false,
          empty: false,
        },
        svnProperties: {
          target: file.path,
          properties: [{ name: "svn:mime-type", value: "text/plain" }],
          externals: null,
        },
        svnBlame: {
          target: file.path,
          total_lines: 1,
          truncated: false,
          lines: [
            {
              line_number: 1,
              revision: "11",
              author: "alice",
              date: "2026-07-11T01:02:03Z",
              content: "const ready = true;",
            },
          ],
        },
        backendMessage: "后台任务就绪",
      },
    });

    const tablist = screen.getByRole("tablist", { name: "检查器面板" });
    const informationTab = within(tablist).getByRole("tab", { name: "Information" });
    expect(informationTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Information" })).toHaveTextContent("main.ts");
    expect(screen.queryByText("svn:mime-type")).not.toBeInTheDocument();

    informationTab.focus();
    await fireEvent.keyDown(informationTab, { key: "ArrowRight" });
    const propertiesTab = within(tablist).getByRole("tab", { name: "Properties" });
    expect(propertiesTab).toHaveFocus();
    expect(propertiesTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Properties" })).toHaveTextContent(
      "svn:mime-type",
    );

    await fireEvent.click(within(tablist).getByRole("tab", { name: "Diff" }));
    expect(screen.getByRole("tabpanel", { name: "Diff" })).toHaveTextContent("-before +after");

    await fireEvent.click(within(tablist).getByRole("tab", { name: "Blame" }));
    expect(screen.getByRole("tabpanel", { name: "Blame" })).toHaveTextContent(
      "const ready = true;",
    );

    await fireEvent.click(within(tablist).getByRole("tab", { name: "Commit" }));
    expect(screen.getByRole("tabpanel", { name: "Commit" })).toHaveTextContent(
      "本次将提交 1 个文件",
    );

    const commitTab = within(tablist).getByRole("tab", { name: "Commit" });
    await fireEvent.keyDown(commitTab, { key: "End" });
    expect(within(tablist).getByRole("tab", { name: "Tasks" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Tasks" })).toHaveTextContent("后台任务就绪");
  });

  it("persists sidebar and inspector visibility through app settings", async () => {
    const onAppSettingInput = vi.fn();
    const { container, rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        appSettings: makeAppSettings(),
        onAppSettingInput,
      },
    });

    expect(screen.getByLabelText("项目列表")).toBeInTheDocument();
    expect(screen.getByLabelText("详情和提交")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "调整右侧面板宽度" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "隐藏项目侧栏" }));
    expect(onAppSettingInput).toHaveBeenLastCalledWith("showSourceList", false);
    await rerender({ appSettings: makeAppSettings({ showSourceList: false }) });
    expect(screen.queryByLabelText("项目列表")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示项目侧栏" })).toBeInTheDocument();
    expect(container.querySelector(".versions-layout")).toHaveClass("source-list-hidden");
    expect(screen.getByRole("slider", { name: "调整右侧面板宽度" })).toHaveAttribute(
      "aria-valuemax",
      "658",
    );

    await fireEvent.click(screen.getByRole("button", { name: "隐藏检查器" }));
    expect(onAppSettingInput).toHaveBeenLastCalledWith("showInspector", false);
    await rerender({
      appSettings: makeAppSettings({ showSourceList: false, showInspector: false }),
    });
    expect(screen.queryByLabelText("详情和提交")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("slider", { name: "调整右侧面板宽度" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".work-copy-grid")).toHaveClass("inspector-hidden");
    expect(screen.getByLabelText("工作副本文件树")).toBeInTheDocument();

    await rerender({
      view: workbenchViews.history,
      appSettings: makeAppSettings({ showInspector: true }),
    });
    expect(screen.getByRole("button", { name: "隐藏检查器" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "隐藏检查器" })).toHaveAttribute(
      "title",
      "检查器仅用于工作副本视图",
    );
  });

  it("resolves the system theme and exposes persistent theme controls", async () => {
    const originalMatchMedia = window.matchMedia;
    let themeListener: (event: MediaQueryListEvent) => void = () => {};
    const mediaQuery = {
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(
        (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          themeListener = listener;
        },
      ),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => mediaQuery),
    });
    const onAppSettingInput = vi.fn();

    try {
      const { container, rerender } = render(MainWorkspace, {
        props: {
          view: workbenchViews.changes,
          workspace: makeWorkspace(),
          appSettings: makeAppSettings({ themeMode: "system" }),
          onAppSettingInput,
        },
      });
      const workbench = container.querySelector(".versions-workbench");
      expect(workbench).toHaveAttribute("data-theme-mode", "system");
      expect(workbench).toHaveAttribute("data-theme", "dark");

      themeListener({ matches: false } as MediaQueryListEvent);
      await vi.waitFor(() => expect(workbench).toHaveAttribute("data-theme", "light"));

      await rerender({
        view: workbenchViews.settings,
        appSettings: makeAppSettings({ themeMode: "light" }),
      });
      const themeControl = screen.getByLabelText("主题模式");
      expect(within(themeControl).getByRole("button", { name: "浅色" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await fireEvent.click(within(themeControl).getByRole("button", { name: "深色" }));
      expect(onAppSettingInput).toHaveBeenLastCalledWith("themeMode", "dark");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("groups filtered Timeline revisions by local calendar date", async () => {
    const onPrepareRevisionDiffFromLog = vi.fn(() => true);
    const onRunRevisionDiff = vi.fn();
    render(MainWorkspace, {
      props: {
        view: workbenchViews.history,
        workspace: makeWorkspace(),
        svnLog: {
          target: "https://svn.example.test/repo/trunk",
          has_more: false,
          next_start_revision: null,
          entries: [
            makeLogEntry("12", "2026-07-11T15:20:00", "alice", "完成菜单", 5),
            makeLogEntry("11", "2026-07-11T09:10:00", "bob", "补充测试"),
            makeLogEntry("10", "2026-07-10T18:30:00", "alice", "更新文档"),
            makeLogEntry("9", "invalid-date", "carol", "旧数据"),
          ],
        },
        onPrepareRevisionDiffFromLog,
        onRunRevisionDiff,
      },
    });

    const timeline = screen.getByLabelText("Revision 列表");
    const newestDay = within(timeline).getByRole("group", { name: "2026年7月11日" });
    expect(newestDay).toHaveTextContent("2 revisions");
    expect(within(newestDay).getByText("r12")).toBeInTheDocument();
    expect(within(newestDay).getByText("r11")).toBeInTheDocument();
    const newestEntry = within(newestDay).getByText("r12").closest(".timeline-entry") as HTMLElement;
    expect(newestEntry).toHaveTextContent("alice");
    expect(newestEntry).toHaveTextContent("15:20:00");
    expect(newestEntry).toHaveTextContent("完成菜单");
    expect(newestEntry).toHaveTextContent("5 paths");
    expect(newestEntry).toHaveTextContent("/trunk/file-12-1.txt");
    expect(newestEntry).toHaveTextContent("/trunk/file-12-3.txt");
    expect(newestEntry).not.toHaveTextContent("/trunk/file-12-4.txt");
    await fireEvent.click(
      within(newestEntry).getByRole("button", { name: "展开其余 2 条路径" }),
    );
    expect(newestEntry).toHaveTextContent("/trunk/file-12-4.txt");
    expect(newestEntry).toHaveTextContent("/trunk/file-12-5.txt");
    await fireEvent.click(
      within(newestEntry).getByRole("button", {
        name: "比较 r12 的 /trunk/file-12-4.txt",
      }),
    );
    expect(onPrepareRevisionDiffFromLog).toHaveBeenLastCalledWith(
      "12",
      "/trunk/file-12-4.txt",
    );
    expect(onRunRevisionDiff).toHaveBeenCalledOnce();

    const priorDay = within(timeline).getByRole("group", { name: "2026年7月10日" });
    expect(priorDay).toHaveTextContent("1 revision");
    expect(within(priorDay).getByText("r10")).toBeInTheDocument();
    expect(within(timeline).getByRole("group", { name: "日期未知" })).toHaveTextContent("r9");

    await fireEvent.click(within(priorDay).getByText("r10").closest("button") as HTMLElement);
    expect(within(screen.getByLabelText("Revision 比较")).getByText("r10")).toBeInTheDocument();
  });

  it("selects, orders, preserves, and compares two Timeline revisions", async () => {
    const onPrepareRevisionDiffRange = vi.fn(() => true);
    const onRunRevisionDiff = vi.fn();
    const initialLog = {
      target: "https://svn.example.test/repo/trunk",
      has_more: true,
      next_start_revision: "9",
      entries: [
        makeLogEntry("12", "2026-07-11T12:00:00", "alice", "newest"),
        makeLogEntry("11", "2026-07-11T11:00:00", "alice", "middle"),
        makeLogEntry("10", "2026-07-11T10:00:00", "alice", "oldest"),
      ],
    };
    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.history,
        workspace: makeWorkspace(),
        svnLog: initialLog,
        onPrepareRevisionDiffRange,
        onRunRevisionDiff,
      },
    });

    const revision12 = screen.getByRole("checkbox", { name: "选择 r12 进行比较" });
    const revision11 = screen.getByRole("checkbox", { name: "选择 r11 进行比较" });
    const revision10 = screen.getByRole("checkbox", { name: "选择 r10 进行比较" });
    await fireEvent.click(revision12);
    expect(screen.getByRole("toolbar", { name: "Revision 比较选择" })).toHaveTextContent(
      "已选择 r12",
    );
    await fireEvent.click(revision10);

    const selectionToolbar = screen.getByRole("toolbar", { name: "Revision 比较选择" });
    expect(selectionToolbar).toHaveTextContent("r10 → r12");
    expect(revision11).toBeDisabled();
    expect(onPrepareRevisionDiffRange).toHaveBeenLastCalledWith("10", "12");

    await fireEvent.click(revision12);
    expect(revision11).toBeEnabled();
    await fireEvent.click(revision11);
    expect(selectionToolbar).toHaveTextContent("r10 → r11");
    await fireEvent.click(
      within(selectionToolbar).getByRole("button", { name: "比较选中 Revision" }),
    );
    expect(onPrepareRevisionDiffRange).toHaveBeenLastCalledWith("10", "11");
    expect(onRunRevisionDiff).toHaveBeenCalledOnce();

    await rerender({
      svnLog: {
        ...initialLog,
        has_more: false,
        next_start_revision: null,
        entries: [...initialLog.entries, makeLogEntry("9", "2026-07-10T09:00:00", "bob", "more")],
      },
    });
    expect(screen.getByRole("checkbox", { name: "选择 r10 进行比较" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 r11 进行比较" })).toBeChecked();

    await rerender({
      svnLog: {
        ...initialLog,
        has_more: false,
        next_start_revision: null,
        entries: initialLog.entries.filter((entry) => entry.revision !== "10"),
      },
    });
    await waitFor(() => expect(selectionToolbar).toHaveTextContent("已选择 r11"));
    expect(
      within(selectionToolbar).getByRole("button", { name: "比较选中 Revision" }),
    ).toBeDisabled();

    await fireEvent.click(
      within(selectionToolbar).getByRole("button", { name: "清除 Revision 比较选择" }),
    );
    expect(screen.queryByRole("toolbar", { name: "Revision 比较选择" })).not.toBeInTheDocument();
  });

  it("compares the selected versioned file with any Timeline revision", async () => {
    const onPrepareWorkingCopyFileRevisionDiff = vi.fn(() => true);
    const onRunRevisionDiff = vi.fn();
    const onRevisionDiffFormInput = vi.fn();
    const onRevertToRevision = vi.fn();
    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.history,
        workspace: makeWorkspace(),
        workspaceFileTree: makeFileTree(),
        selectedFilePath: "src/main.ts",
        svnLog: {
          target: "https://svn.example.test/repo/trunk",
          has_more: false,
          next_start_revision: null,
          entries: [makeLogEntry("12", "2026-07-11T12:00:00", "alice", "latest")],
        },
        onPrepareWorkingCopyFileRevisionDiff,
        onRunRevisionDiff,
        onRevisionDiffFormInput,
        onRevertToRevision,
      },
    });

    const compareFile = screen.getByRole("button", {
      name: "比较 src/main.ts 的工作副本与 r12",
    });
    expect(compareFile).toHaveAttribute("title", "比较 src/main.ts 的工作副本与 r12");
    await fireEvent.click(compareFile);
    expect(onPrepareWorkingCopyFileRevisionDiff).toHaveBeenCalledWith("src/main.ts", "12");
    expect(onRunRevisionDiff).toHaveBeenCalledOnce();

    const revertRevision = screen.getByRole("button", {
      name: "Revert 工作副本到 r12",
    });
    expect(revertRevision).toHaveAttribute("title", "Revert 工作副本到 r12");
    await fireEvent.click(revertRevision);
    expect(onRevertToRevision).toHaveBeenCalledWith("12");

    await fireEvent.click(
      within(screen.getByLabelText("Revision 比较")).getByRole("button", {
        name: "工作副本",
      }),
    );
    expect(onRevisionDiffFormInput).toHaveBeenCalledWith("mode", "working_copy_to_revision");
    expect(onRevisionDiffFormInput).toHaveBeenCalledWith("filePath", "src/main.ts");

    await rerender({ selectedFilePath: "notes/new.txt" });
    expect(
      screen.getByRole("button", { name: "比较工作副本文件与 r12" }),
    ).toBeDisabled();
    await rerender({ selectedFilePath: "src" });
    expect(
      screen.getByRole("button", { name: "比较工作副本文件与 r12" }),
    ).toBeDisabled();
  });

  it("shows the complete Patch location when Revision Diff preview is truncated", async () => {
    const onExportRevisionDiffPatch = vi.fn();
    const truncatedResult = {
      mode: "revisions",
      target: "C:/repo/wc r10:r12",
      diff_text: "Index: src/large.ts\n...",
      file_count: 1,
      line_count: 50000,
      truncated: true,
      max_bytes: 2 * 1024 * 1024,
      patch_file_path: "C:/Users/TU/AppData/Roaming/NovaSVN/revision-diff-patches/full.patch",
      patch_file_dir: "C:/Users/TU/AppData/Roaming/NovaSVN/revision-diff-patches",
      patch_file_name: "full.patch",
    };
    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.history,
        workspace: makeWorkspace(),
        revisionDiffResult: truncatedResult,
        onExportRevisionDiffPatch,
      },
    });

    const location = screen.getByRole("status");
    expect(location).toHaveTextContent("界面仅显示截断预览");
    expect(location).toHaveTextContent("完整 Patch 已保存为 full.patch");
    expect(location).toHaveTextContent(truncatedResult.patch_file_path);
    await fireEvent.click(screen.getByRole("button", { name: "显示完整 Patch 位置" }));
    expect(onExportRevisionDiffPatch).toHaveBeenCalledOnce();

    await rerender({
      revisionDiffResult: {
        ...truncatedResult,
        patch_file_path: null,
        patch_file_dir: null,
        patch_file_name: null,
      },
    });
    expect(screen.getByRole("status")).toHaveTextContent("完整 Patch 文件位置不可用");
    expect(screen.getByRole("button", { name: "显示完整 Patch 位置" })).toBeDisabled();
  });

  it("browses repository URLs at an explicit revision and keeps it while navigating", async () => {
    const onRepositoryRevisionInput = vi.fn();
    const onLoadRepositoryUrl = vi.fn();
    const onOpenRepositoryFile = vi.fn();
    const onLoadRepositoryFileLog = vi.fn();
    const onLoadMoreRepositoryFileLog = vi.fn();
    const onCloseRepositoryFileLog = vi.fn();
    const onLoadRepositoryFileBlame = vi.fn();
    const onCloseRepositoryFileBlame = vi.fn();
    const onLoadRepositoryFileProperties = vi.fn();
    const onCloseRepositoryFileProperties = vi.fn();
    const onPrepareRepositoryCheckout = vi.fn();
    const onChooseRepositoryCheckoutParent = vi.fn();
    const onCreateRepositoryCheckout = vi.fn();
    const onRepositoryCheckoutFormInput = vi.fn();
    const onPrepareRepositoryExport = vi.fn();
    const onChooseRepositoryExportParent = vi.fn();
    const onCreateRepositoryExport = vi.fn();
    const onRepositoryExportFormInput = vi.fn();
    const onPrepareRepositoryMkdir = vi.fn();
    const onCreateRepositoryMkdir = vi.fn();
    const onRepositoryMkdirFormInput = vi.fn();
    const onPrepareRepositoryImport = vi.fn();
    const onChooseRepositoryImportSource = vi.fn();
    const onCreateRepositoryImport = vi.fn();
    const onRepositoryImportFormInput = vi.fn();
    const onPrepareRepositoryCopyTarget = vi.fn();
    const onCreateRepositoryCopy = vi.fn();
    const onRepositoryCopyFormInput = vi.fn();
    const onPrepareRepositoryMove = vi.fn();
    const onCreateRepositoryMove = vi.fn();
    const onRepositoryMoveFormInput = vi.fn();
    const onPrepareRepositoryRename = vi.fn();
    const onCreateRepositoryRename = vi.fn();
    const onRepositoryRenameFormInput = vi.fn();
    const onPrepareRepositoryDelete = vi.fn();
    const onCreateRepositoryDelete = vi.fn();
    const onRepositoryDeleteFormInput = vi.fn();
    const onDragRepositoryEntry = vi.fn();
    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.repository,
        workspace: makeWorkspace(),
        repositoryUrlInput: "https://example.com/svn/trunk",
        repositoryRevisionInput: "10",
        repositoryList: {
          url: "https://example.com/svn/trunk",
          revision: "10",
          entries: [
            {
              name: "src",
              kind: "dir",
              revision: "9",
              author: "alice",
              date: "2026-07-10T10:00:00Z",
            },
            {
              name: "README.md",
              kind: "file",
              revision: "8",
              author: "bob",
              date: "2026-07-09T09:00:00Z",
            },
          ],
        },
        repositoryCheckoutForm: {
          url: "https://example.com/svn/trunk",
          localPath: "/Users/me/checkouts/trunk",
          revision: "10",
        },
        repositoryExportForm: {
          url: "https://example.com/svn/trunk",
          localPath: "/Users/me/exports/trunk",
          revision: "10",
        },
        repositoryMkdirForm: {
          targetUrl: "https://example.com/svn/trunk/assets",
          message: "创建 assets",
        },
        repositoryImportForm: {
          sourcePath: "/Users/me/assets",
          targetUrl: "https://example.com/svn/trunk/assets",
          message: "导入 assets",
        },
        repositoryCopyForm: {
          kind: "entry",
          sourceUrl: "https://example.com/svn/trunk/assets",
          targetUrl: "https://example.com/svn/trunk/assets-copy",
          revision: "10",
          message: "复制 assets",
        },
        repositoryMoveForm: {
          sourceUrl: "https://example.com/svn/trunk/assets",
          targetUrl: "https://example.com/svn/archive/assets",
          message: "移动 assets",
        },
        repositoryRenameForm: {
          sourceUrl: "https://example.com/svn/trunk/assets",
          targetUrl: "https://example.com/svn/trunk/assets-renamed",
          message: "重命名 assets",
        },
        repositoryDeleteForm: {
          url: "https://example.com/svn/trunk/obsolete",
          message: "删除 obsolete",
        },
        onRepositoryRevisionInput,
        onLoadRepositoryUrl,
        onOpenRepositoryFile,
        onLoadRepositoryFileLog,
        onLoadMoreRepositoryFileLog,
        onCloseRepositoryFileLog,
        onLoadRepositoryFileBlame,
        onCloseRepositoryFileBlame,
        onLoadRepositoryFileProperties,
        onCloseRepositoryFileProperties,
        onPrepareRepositoryCheckout,
        onChooseRepositoryCheckoutParent,
        onCreateRepositoryCheckout,
        onRepositoryCheckoutFormInput,
        onPrepareRepositoryExport,
        onChooseRepositoryExportParent,
        onCreateRepositoryExport,
        onRepositoryExportFormInput,
        onPrepareRepositoryMkdir,
        onCreateRepositoryMkdir,
        onRepositoryMkdirFormInput,
        onPrepareRepositoryImport,
        onChooseRepositoryImportSource,
        onCreateRepositoryImport,
        onRepositoryImportFormInput,
        onPrepareRepositoryCopyTarget,
        onCreateRepositoryCopy,
        onRepositoryCopyFormInput,
        onPrepareRepositoryMove,
        onCreateRepositoryMove,
        onRepositoryMoveFormInput,
        onPrepareRepositoryRename,
        onCreateRepositoryRename,
        onRepositoryRenameFormInput,
        onPrepareRepositoryDelete,
        onCreateRepositoryDelete,
        onRepositoryDeleteFormInput,
        onDragRepositoryEntry,
      },
    });

    const revisionInput = screen.getByLabelText("仓库 Revision");
    expect(revisionInput).toHaveValue(10);
    expect(screen.getByText("@r10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备 Checkout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备 Export" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备创建目录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备 Import" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备 Move" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备 Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备 Delete" })).toBeInTheDocument();
    expect(screen.getByLabelText("仓库 Checkout")).toBeInTheDocument();
    expect(screen.getByLabelText("仓库 Export")).toBeInTheDocument();
    expect(screen.getByLabelText("创建仓库目录")).toBeInTheDocument();
    expect(screen.getByLabelText("新仓库目录 URL")).toHaveValue(
      "https://example.com/svn/trunk/assets",
    );
    expect(screen.getByLabelText("创建仓库目录提交信息")).toHaveValue("创建 assets");
    expect(screen.getByLabelText("Repository Import")).toBeInTheDocument();
    expect(screen.getByLabelText("Import 本地源路径")).toHaveValue("/Users/me/assets");
    expect(screen.getByLabelText("Import 目标 URL")).toHaveValue(
      "https://example.com/svn/trunk/assets",
    );
    expect(screen.getByLabelText("Repository Import 提交信息")).toHaveValue("导入 assets");
    expect(screen.getByLabelText("Repository Copy 源 URL")).toHaveValue(
      "https://example.com/svn/trunk/assets",
    );
    expect(screen.getByLabelText("Repository Copy 目标 URL")).toHaveValue(
      "https://example.com/svn/trunk/assets-copy",
    );
    expect(screen.getByLabelText("Repository Move 源 URL")).toHaveValue(
      "https://example.com/svn/trunk/assets",
    );
    expect(screen.getByLabelText("Repository Move 目标 URL")).toHaveValue(
      "https://example.com/svn/archive/assets",
    );
    expect(screen.getByLabelText("Repository Rename 源 URL")).toHaveValue(
      "https://example.com/svn/trunk/assets",
    );
    expect(screen.getByLabelText("Repository Rename 目标 URL")).toHaveValue(
      "https://example.com/svn/trunk/assets-renamed",
    );
    expect(screen.getByLabelText("Repository Delete 目标 URL")).toHaveValue(
      "https://example.com/svn/trunk/obsolete",
    );
    expect(screen.getByLabelText("Checkout 仓库 URL")).toHaveValue(
      "https://example.com/svn/trunk",
    );
    expect(screen.getByLabelText("Checkout 本地路径")).toHaveValue(
      "/Users/me/checkouts/trunk",
    );
    expect(screen.getByLabelText("Checkout Revision")).toHaveValue("10");
    expect(screen.getByLabelText("Export 仓库 URL")).toHaveValue(
      "https://example.com/svn/trunk",
    );
    expect(screen.getByLabelText("Export 本地路径")).toHaveValue(
      "/Users/me/exports/trunk",
    );
    expect(screen.getByLabelText("Export Revision")).toHaveValue("10");

    await fireEvent.click(screen.getByRole("button", { name: "准备 Checkout" }));
    expect(onPrepareRepositoryCheckout).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "准备 Export" }));
    expect(onPrepareRepositoryExport).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "准备创建目录" }));
    expect(onPrepareRepositoryMkdir).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "准备 Import" }));
    expect(onPrepareRepositoryImport).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "准备 Move" }));
    expect(onPrepareRepositoryMove).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "准备 Rename" }));
    expect(onPrepareRepositoryRename).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "准备 Delete" }));
    expect(onPrepareRepositoryDelete).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(onCreateRepositoryCheckout).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onCreateRepositoryExport).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "创建目录" }));
    expect(onCreateRepositoryMkdir).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "选择 Import 文件" }));
    expect(onChooseRepositoryImportSource).toHaveBeenCalledWith(false);
    await fireEvent.click(screen.getByRole("button", { name: "选择 Import 目录" }));
    expect(onChooseRepositoryImportSource).toHaveBeenCalledWith(true);
    await fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onCreateRepositoryImport).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "复制当前条目" }));
    expect(onPrepareRepositoryCopyTarget).toHaveBeenCalledWith(
      "entry",
      "https://example.com/svn/trunk",
    );
    await fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(onCreateRepositoryCopy).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onCreateRepositoryMove).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(onCreateRepositoryRename).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onCreateRepositoryDelete).toHaveBeenCalled();

    const repositoryTable = screen.getByLabelText("仓库目录");
    await rerender({ repositoryImportDropActive: true });
    expect(repositoryTable).toHaveClass("repository-drop-active");
    expect(repositoryTable).toHaveAttribute("aria-dropeffect", "copy");
    const directoryDragHandle = screen.getByRole("button", {
      name: "拖出仓库条目 src 执行 Export",
    });
    expect(directoryDragHandle).toHaveAttribute("title", "按住并拖出 src 到文件管理器");
    await fireEvent.pointerDown(directoryDragHandle, { button: 0 });
    expect(onDragRepositoryEntry).toHaveBeenCalledWith("src");
    const fileDragHandle = screen.getByRole("button", {
      name: "拖出仓库条目 README.md 执行 Export",
    });
    await fireEvent.pointerDown(fileDragHandle, { button: 0 });
    expect(onDragRepositoryEntry).toHaveBeenCalledWith("README.md");
    await rerender({
      repositoryDragExportRunning: true,
      repositoryDragExportRunningName: "README.md",
    });
    expect(fileDragHandle).toBeDisabled();
    expect(fileDragHandle).toHaveAttribute("title", "正在准备 README.md");
    expect(within(repositoryTable).getByText("Last Revision")).toBeInTheDocument();
    const directoryRow = within(repositoryTable).getByText("src", { exact: true }).closest("button")!;
    const directoryMetadata = directoryRow.querySelectorAll("span");
    expect(directoryMetadata[0]).toHaveTextContent("目录");
    expect(directoryMetadata[1]).toHaveTextContent("9");
    expect(directoryMetadata[2]).toHaveTextContent("alice");
    expect(directoryMetadata[3]).toHaveAttribute("title", "2026-07-10T10:00:00Z");
    const fileRow = within(repositoryTable).getByText("README.md", { exact: true }).closest("button")!;
    expect(fileRow).toHaveTextContent("文件");
    expect(fileRow).toHaveTextContent("8");
    expect(fileRow).toHaveTextContent("bob");
    expect(fileRow).toBeEnabled();
    expect(fileRow).toHaveAttribute(
      "title",
      "下载并打开 README.md @r10",
    );
    await fireEvent.click(fileRow);
    expect(onOpenRepositoryFile).toHaveBeenCalledWith("README.md");
    const logButton = screen.getByRole("button", {
      name: "查看仓库文件 README.md 的 Log",
    });
    expect(logButton).toHaveAttribute("title", "查看 README.md 的 Log");
    await fireEvent.click(logButton);
    expect(onLoadRepositoryFileLog).toHaveBeenCalledWith("README.md");
    const blameButton = screen.getByRole("button", {
      name: "查看仓库文件 README.md 的 Blame",
    });
    expect(blameButton).toHaveAttribute("title", "查看 README.md 的 Blame");
    await fireEvent.click(blameButton);
    expect(onLoadRepositoryFileBlame).toHaveBeenCalledWith("README.md");
    const propertiesButton = screen.getByRole("button", {
      name: "查看仓库文件 README.md 的 Properties",
    });
    expect(propertiesButton).toHaveAttribute("title", "查看 README.md 的 Properties");
    await fireEvent.click(propertiesButton);
    expect(onLoadRepositoryFileProperties).toHaveBeenCalledWith("README.md");
    await fireEvent.input(revisionInput, { target: { value: "8" } });
    expect(onRepositoryRevisionInput).toHaveBeenCalledWith("8");
    await fireEvent.keyDown(revisionInput, { key: "Enter" });
    expect(onLoadRepositoryUrl).toHaveBeenCalledWith();

    await fireEvent.click(screen.getByText("src", { exact: true }).closest("button") as HTMLElement);
    expect(onLoadRepositoryUrl).toHaveBeenLastCalledWith("https://example.com/svn/trunk/src");

    await rerender({ repositoryFileLoading: true, repositoryFileError: "文件下载失败" });
    expect(
      screen.getByRole("button", { name: "打开仓库文件 README.md 的临时副本" }),
    ).toBeDisabled();
    expect(screen.getByText("文件下载失败")).toBeInTheDocument();

    await rerender({
      repositoryFileLoading: false,
      repositoryFileError: null,
      repositoryFileLogRevision: "10",
      repositoryFileLog: {
        target: "https://example.com/svn/trunk/README.md",
        has_more: true,
        next_start_revision: "7",
        entries: [
          {
            revision: "8",
            author: "bob",
            date: "2026-07-09T09:00:00Z",
            message: "Update README",
            changed_paths: [],
          },
        ],
      },
    });
    const logPanel = screen.getByLabelText("仓库文件日志");
    expect(within(logPanel).getByText("r8")).toBeInTheDocument();
    expect(within(logPanel).getByText("Update README")).toBeInTheDocument();
    await fireEvent.click(within(logPanel).getByRole("button", { name: "更多" }));
    expect(onLoadMoreRepositoryFileLog).toHaveBeenCalledOnce();
    await fireEvent.click(
      within(logPanel).getByRole("button", { name: "关闭仓库文件 Log" }),
    );
    expect(onCloseRepositoryFileLog).toHaveBeenCalledOnce();

    await rerender({
      repositoryFileLog: null,
      repositoryFileLogRevision: null,
      repositoryFileBlameRevision: "10",
      repositoryFileBlame: {
        target: "https://example.com/svn/trunk/README.md",
        total_lines: 2,
        truncated: true,
        lines: [
          {
            line_number: 1,
            revision: "8",
            author: "bob",
            date: "2026-07-09T09:00:00Z",
            content: "README title",
          },
        ],
      },
    });
    const blamePanel = screen.getByLabelText("仓库文件 Blame");
    expect(within(blamePanel).getByRole("columnheader", { name: "Revision" })).toBeInTheDocument();
    expect(within(blamePanel).getByText("README title")).toBeInTheDocument();
    expect(within(blamePanel).getByText("2 行 · 仅显示前 1 行")).toBeInTheDocument();
    await fireEvent.click(
      within(blamePanel).getByRole("button", { name: "关闭仓库文件 Blame" }),
    );
    expect(onCloseRepositoryFileBlame).toHaveBeenCalledOnce();

    await rerender({
      repositoryFileBlame: null,
      repositoryFileBlameRevision: null,
      repositoryFilePropertiesRevision: "10",
      repositoryFileProperties: {
        target: "https://example.com/svn/trunk/README.md",
        properties: [
          { name: "custom:note", value: "line one\nline two" },
          { name: "svn:mime-type", value: "text/plain" },
        ],
        externals: null,
      },
    });
    const propertiesPanel = screen.getByLabelText("仓库文件 Properties");
    expect(within(propertiesPanel).getByText("custom:note")).toBeInTheDocument();
    expect(within(propertiesPanel).getByText("line one line two")).toBeInTheDocument();
    expect(within(propertiesPanel).getByText("text/plain")).toBeInTheDocument();
    await fireEvent.click(
      within(propertiesPanel).getByRole("button", { name: "关闭仓库文件 Properties" }),
    );
    expect(onCloseRepositoryFileProperties).toHaveBeenCalledOnce();

    await rerender({
      repositoryRevisionInput: "",
      repositoryList: {
        url: "https://example.com/svn/trunk",
        revision: null,
        entries: [],
      },
    });
    expect(screen.getByText("@HEAD")).toBeInTheDocument();
  });

  it("filters Timeline revisions with inclusive local date controls", async () => {
    const onSvnLogFilterInput = vi.fn();
    const onSvnLogFileOnlyInput = vi.fn();
    const svnLog = {
      target: "https://svn.example.test/repo/trunk",
      has_more: false,
      next_start_revision: null,
      entries: [
        makeLogEntry("3", "2026-07-11T23:59:59.900", "alice", "当天末尾"),
        makeLogEntry("2", "2026-07-10T12:00:00", "bob", "前一天"),
        makeLogEntry("1", "invalid-date", "carol", "未知日期"),
      ],
    };
    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.history,
        workspace: makeWorkspace(),
        svnLog,
        onSvnLogFilterInput,
        onSvnLogFileOnlyInput,
      },
    });

    const startInput = screen.getByLabelText("Timeline 开始日期");
    await fireEvent.input(startInput, { target: { value: "2026-07-11" } });
    expect(onSvnLogFilterInput).toHaveBeenLastCalledWith(
      "svnLogDateFromFilter",
      "2026-07-11",
    );
    await rerender({ svnLogDateFromFilter: "2026-07-11" });
    const timeline = screen.getByLabelText("Revision 列表");
    expect(within(timeline).getByText("r3")).toBeInTheDocument();
    expect(within(timeline).queryByText("r2")).not.toBeInTheDocument();
    expect(within(timeline).queryByText("r1")).not.toBeInTheDocument();

    const endInput = screen.getByLabelText("Timeline 结束日期");
    await fireEvent.input(endInput, { target: { value: "2026-07-11" } });
    await rerender({ svnLogDateFromFilter: "2026-07-11", svnLogDateToFilter: "2026-07-11" });
    expect(within(timeline).getByText("r3")).toBeInTheDocument();

    await rerender({ svnLogDateFromFilter: "2026-07-12", svnLogDateToFilter: "2026-07-11" });
    expect(screen.getByRole("status")).toHaveTextContent("开始日期不能晚于结束日期");
    expect(within(timeline).getByText("没有符合当前过滤条件的 revision")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "清除过滤" }));
    expect(onSvnLogFilterInput).toHaveBeenCalledWith("svnLogKeywordFilter", "");
    expect(onSvnLogFilterInput).toHaveBeenCalledWith("svnLogAuthorFilter", "");
    expect(onSvnLogFilterInput).toHaveBeenCalledWith("svnLogDateFromFilter", "");
    expect(onSvnLogFilterInput).toHaveBeenCalledWith("svnLogDateToFilter", "");
    expect(onSvnLogFileOnlyInput).toHaveBeenCalledWith(false);
  });

  it("combines Timeline text, author, date, file, quantity, and paging controls", async () => {
    const onSvnLogFilterInput = vi.fn();
    const onSvnLogFileOnlyInput = vi.fn();
    const onSvnLogLimitInput = vi.fn();
    const onLoadMoreSvnLog = vi.fn();
    render(MainWorkspace, {
      props: {
        view: workbenchViews.history,
        workspace: makeWorkspace(),
        selectedFilePath: "src/main.ts",
        svnLogAuthorFilter: "alice",
        svnLogKeywordFilter: "menu",
        svnLogDateFromFilter: "2026-07-11",
        svnLogDateToFilter: "2026-07-11",
        svnLogFileOnly: true,
        svnLogLimit: 25,
        svnLog: {
          target: "src/main.ts",
          has_more: true,
          next_start_revision: "9",
          entries: [
            makeLogEntry("12", "2026-07-11T10:00:00", "alice", "menu feature"),
            makeLogEntry("11", "2026-07-11T09:00:00", "alice", "other feature"),
            makeLogEntry("10", "2026-07-11T08:00:00", "bob", "menu fix"),
            makeLogEntry("9", "2026-07-10T08:00:00", "alice", "menu older"),
          ],
        },
        onSvnLogFilterInput,
        onSvnLogFileOnlyInput,
        onSvnLogLimitInput,
        onLoadMoreSvnLog,
      },
    });

    const timeline = screen.getByLabelText("Revision 列表");
    expect(within(timeline).getByText("r12")).toBeInTheDocument();
    expect(within(timeline).queryByText("r11")).not.toBeInTheDocument();
    expect(within(timeline).queryByText("r10")).not.toBeInTheDocument();
    expect(within(timeline).queryByText("r9")).not.toBeInTheDocument();
    expect(screen.getByText("1 / 4 revisions · 还有更多")).toBeInTheDocument();

    const fileOnly = screen.getByRole("checkbox", { name: "main.ts" });
    expect(fileOnly).toBeChecked();
    expect(fileOnly).toBeEnabled();
    await fireEvent.click(fileOnly);
    expect(onSvnLogFileOnlyInput).toHaveBeenCalledWith(false);

    await fireEvent.input(screen.getByLabelText("Timeline 作者"), {
      target: { value: "bob" },
    });
    expect(onSvnLogFilterInput).toHaveBeenCalledWith("svnLogAuthorFilter", "bob");
    await fireEvent.input(screen.getByLabelText("Timeline 日志数量"), {
      target: { value: "50" },
    });
    expect(onSvnLogLimitInput).toHaveBeenCalledWith(50);
    await fireEvent.click(screen.getByRole("button", { name: "加载更多 Revision" }));
    expect(onLoadMoreSvnLog).toHaveBeenCalledOnce();
  });

  it("uses current commit targets and excludes unversioned files", async () => {
    const onUnselectCommitFile = vi.fn();
    const onSelectAllCommitFiles = vi.fn();
    const onClearCommitFiles = vi.fn();
    const onAddFile = vi.fn();
    const onIgnorePath = vi.fn();
    const modified = makeFile("src/main.ts", "modified", "main-digest");
    const unversioned = makeFile("notes/new.txt", "unversioned", "new-digest");

    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([modified, unversioned]),
        workspaceFileTree: makeFileTree(),
        commitFiles: [
          {
            path: modified.path,
            status: modified.status,
          },
        ],
        onUnselectCommitFile,
        onSelectAllCommitFiles,
        onClearCommitFiles,
        onAddFile,
        onIgnorePath,
        svnProperties: {
          target: "notes",
          properties: [{ name: "svn:ignore", value: "new.txt" }],
          externals: null,
        },
      },
    });

    expect(screen.getByText("提交目标", { exact: true })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "取消 Commit src/main.ts" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("暂存", { exact: false })).not.toBeInTheDocument();
    for (const heading of ["Name", "Base", "Last", "Date", "Author", "Status", "Size"]) {
      expect(screen.getByText(heading, { exact: true })).toBeInTheDocument();
    }
    const mainFileRow = screen.getByText("main.ts", { exact: true }).closest(".file-row");
    expect(mainFileRow).toHaveTextContent("12");
    expect(mainFileRow).toHaveTextContent("11");
    expect(mainFileRow).toHaveTextContent("2026-07-11 01:02");
    expect(mainFileRow).toHaveTextContent("alice");

    await fireEvent.click(screen.getByRole("button", { name: "取消 Commit src/main.ts" }));
    await fireEvent.click(screen.getByRole("tab", { name: "Commit" }));
    await fireEvent.click(screen.getByRole("button", { name: "全选改动" }));
    await fireEvent.click(screen.getByRole("button", { name: "清除选择" }));

    expect(onUnselectCommitFile).toHaveBeenCalledWith("src/main.ts");
    expect(onSelectAllCommitFiles).toHaveBeenCalledOnce();
    expect(onClearCommitFiles).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole("button", { name: "未管理文件" }));

    await fireEvent.click(screen.getByRole("button", { name: "Add notes/new.txt" }));
    await fireEvent.click(screen.getByRole("button", { name: "更多操作 文件 notes/new.txt" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Ignore 文件 notes/new.txt" }));
    expect(onAddFile).toHaveBeenCalledWith("notes/new.txt");
    expect(onIgnorePath).toHaveBeenCalledWith("notes/new.txt");
    await fireEvent.click(screen.getByRole("tab", { name: "Properties" }));
    expect(screen.getByText("作用目录：notes", { exact: true })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除文件 notes/new.txt" }),
    ).not.toBeInTheDocument();
  });

  it("does not retain commit target visuals across task or workspace switches", async () => {
    const originalFile = makeFile("src/main.ts", "modified", "main-digest");
    const nextFile = makeFile("src/next.ts", "modified", "next-digest");
    const originalTask = makeComponentTask("task-a");
    const nextTask = makeComponentTask("task-b");
    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([originalFile]),
        workspaceFileTree: {
          working_copy_root: "C:/repo/wc",
          total_files: 1,
          returned_files: 1,
          truncated: false,
          nodes: [makeScopedNode(originalFile.path, "modified", "local")],
        },
        commitFiles: [{ path: originalFile.path, status: originalFile.status }],
        selectedTask: originalTask,
      },
    });

    expect(screen.getByRole("button", { name: "取消 Commit src/main.ts" })).toHaveClass(
      "active",
    );

    await rerender({
      commitFiles: [],
      selectedTask: nextTask,
    });
    expect(screen.getByRole("button", { name: "Commit src/main.ts" })).not.toHaveClass("active");
    await fireEvent.click(screen.getByRole("tab", { name: "Commit" }));
    expect(screen.getByText("本次将提交 0 个文件")).toBeInTheDocument();

    await rerender({
      workspace: {
        ...makeWorkspace(),
        local_path: "C:/repo/next",
        working_copy_root: "C:/repo/next",
      },
      workingCopyStatus: {
        ...makeStatus([nextFile]),
        working_copy_root: "C:/repo/next",
      },
      workspaceFileTree: {
        working_copy_root: "C:/repo/next",
        total_files: 1,
        returned_files: 1,
        truncated: false,
        nodes: [makeScopedNode(nextFile.path, "modified", "local")],
      },
      selectedTask: originalTask,
      commitFiles: [],
    });
    expect(screen.queryByText("main.ts", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit src/next.ts" })).not.toHaveClass("active");
    expect(screen.getByText("本次将提交 0 个文件")).toBeInTheDocument();
  });

  it("separates local, remote, and combined working-copy changes", async () => {
    const local = makeFile("local.txt", "modified", "local-digest");
    const remote = {
      ...makeFile("remote.txt", "normal", "remote-digest"),
      remote_status: "modified",
      change_scope: "remote" as const,
    };
    const both = {
      ...makeFile("both.txt", "modified", "both-digest"),
      remote_status: "modified",
      change_scope: "both" as const,
    };
    const remoteProps = {
      ...makeFile("remote-props.txt", "normal", "remote-props-digest"),
      remote_property_status: "modified",
      change_scope: "remote" as const,
    };
    const conflict = makeFile("conflict.txt", "conflicted", "conflict-digest");
    const workingCopyStatus = makeStatus([local, remote, both, remoteProps, conflict]);
    const onSelectCommitFile = vi.fn();
    const onUpdatePath = vi.fn();
    const onSelectFile = vi.fn();

    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus,
        workspaceFileTree: {
          working_copy_root: "C:/repo/wc",
          total_files: 5,
          returned_files: 5,
          truncated: false,
          nodes: [
            makeScopedNode("local.txt", "modified", "local"),
            makeScopedNode("remote.txt", "normal", "remote", "modified"),
            makeScopedNode("both.txt", "modified", "both", "modified"),
            makeScopedNode("remote-props.txt", "normal", "remote"),
            makeScopedNode("conflict.txt", "conflicted", "local"),
          ],
        },
        onSelectCommitFile,
        onUpdatePath,
        onSelectFile,
      },
    });

    const summary = screen.getByRole("region", { name: "工作副本摘要" });
    expect(summary).toHaveTextContent("3 本地改动");
    expect(summary).toHaveTextContent("3 远端更新");
    expect(summary).toHaveTextContent("1 同时变化");
    const localRow = screen.getByText("local.txt", { exact: true }).closest(".file-row");
    const remoteRow = screen.getByText("remote.txt", { exact: true }).closest(".file-row");
    const bothRow = screen.getByText("both.txt", { exact: true }).closest(".file-row");
    const remotePropsRow = screen
      .getByText("remote-props.txt", { exact: true })
      .closest(".file-row");
    expect(localRow).toHaveTextContent("本地 modify");
    expect(remoteRow).toHaveTextContent("远端 modify");
    expect(remoteRow).not.toHaveTextContent("选择提交");
    expect(remoteRow).not.toHaveTextContent("撤销");
    expect(bothRow).toHaveTextContent("本地 modify");
    expect(bothRow).toHaveTextContent("远端 modify");
    expect(remotePropsRow).toHaveTextContent("远端 属性");
    expect(
      within(remoteRow as HTMLElement).queryByRole("button", { name: /^Commit / }),
    ).not.toBeInTheDocument();
    expect(within(bothRow as HTMLElement).getByRole("button", { name: "Commit both.txt" })).toBeInTheDocument();
    expect(within(bothRow as HTMLElement).getByRole("button", { name: "Update both.txt" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Commit local.txt" }));
    await fireEvent.click(screen.getByRole("button", { name: "Update remote.txt" }));
    await fireEvent.click(screen.getByRole("button", { name: "Resolve conflict.txt" }));
    expect(onSelectCommitFile).toHaveBeenCalledWith("local.txt");
    expect(onUpdatePath).toHaveBeenCalledWith("remote.txt");
    expect(onSelectFile).toHaveBeenCalledWith("conflict.txt");

    const filters = screen.getByRole("region", { name: "改动过滤" });
    await fireEvent.click(within(filters).getByRole("button", { name: "远端更新" }));
    expect(screen.queryByText("local.txt", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("remote.txt", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("both.txt", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("remote-props.txt", { exact: true })).toBeInTheDocument();

    await fireEvent.click(within(filters).getByRole("button", { name: "本地改动" }));
    expect(screen.getByText("local.txt", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("remote.txt", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("both.txt", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("remote-props.txt", { exact: true })).not.toBeInTheDocument();

    await rerender({
      workingCopyStatus: {
        ...workingCopyStatus,
        remote_updates_checked: false,
        repository_revision: null,
      },
    });
    expect(summary).toHaveTextContent("远端未检查");
  });

  it("selects multiple visible paths and exposes real batch actions", async () => {
    const alpha = makeFile("alpha.txt", "modified", "alpha-digest");
    const beta = makeFile("beta.txt", "modified", "beta-digest");
    const tree: WorkspaceFileTree = {
      working_copy_root: "C:/repo/wc",
      total_files: 2,
      returned_files: 2,
      truncated: false,
      nodes: [
        makeScopedNode("alpha.txt", "modified", "local"),
        makeScopedNode("beta.txt", "modified", "local"),
      ],
    };
    const onSelectCommitFiles = vi.fn();
    const onUnselectCommitFiles = vi.fn();
    const onRevertPaths = vi.fn();
    const onMovePaths = vi.fn();
    const onDeletePaths = vi.fn();
    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([alpha, beta]),
        workspaceFileTree: tree,
        onSelectCommitFiles,
        onUnselectCommitFiles,
        onRevertPaths,
        onMovePaths,
        onDeletePaths,
      },
    });

    const selectVisible = screen.getByRole("checkbox", { name: "选择当前可见路径" });
    await fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 alpha.txt" }));
    expect(selectVisible).toHaveProperty("indeterminate", true);
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择文件 beta.txt" }),
      { shiftKey: true },
    );

    const batchToolbar = screen.getByRole("toolbar", { name: "所选路径批量操作" });
    expect(batchToolbar).toHaveTextContent("2 个已选");
    expect(selectVisible).toBeChecked();
    await fireEvent.click(within(batchToolbar).getByRole("button", { name: "加入 Commit" }));
    await fireEvent.click(within(batchToolbar).getByRole("button", { name: "Revert" }));
    await fireEvent.click(within(batchToolbar).getByRole("button", { name: "Move" }));
    await fireEvent.click(within(batchToolbar).getByRole("button", { name: "Delete" }));

    expect(onSelectCommitFiles).toHaveBeenCalledWith(["alpha.txt", "beta.txt"]);
    expect(onRevertPaths).toHaveBeenCalledWith(["alpha.txt", "beta.txt"]);
    expect(onMovePaths).toHaveBeenCalledWith(["alpha.txt", "beta.txt"]);
    expect(onDeletePaths).toHaveBeenCalledWith(["alpha.txt", "beta.txt"]);

    await rerender({
      commitFiles: [
        { path: "alpha.txt", status: "modified" },
        { path: "beta.txt", status: "modified" },
      ],
    });
    await fireEvent.click(screen.getByRole("button", { name: "移出 Commit" }));
    expect(onUnselectCommitFiles).toHaveBeenCalledWith(["alpha.txt", "beta.txt"]);

    await rerender({
      workspace: {
        ...makeWorkspace(),
        local_path: "C:/repo/other",
        working_copy_root: "C:/repo/other",
      },
    });
    expect(screen.queryByRole("toolbar", { name: "所选路径批量操作" })).not.toBeInTheDocument();
  });

  it("navigates the working-copy treegrid with desktop keyboard semantics", async () => {
    const alpha = makeFile("src/alpha.txt", "modified", "alpha-digest");
    const beta = makeFile("src/beta.txt", "modified", "beta-digest");
    const omega = makeFile("omega.txt", "modified", "omega-digest");
    const alphaNode = {
      ...makeScopedNode("src/alpha.txt", "modified", "local"),
      name: "alpha.txt",
    };
    const betaNode = {
      ...makeScopedNode("src/beta.txt", "modified", "local"),
      name: "beta.txt",
    };
    const tree: WorkspaceFileTree = {
      working_copy_root: "C:/repo/wc",
      total_files: 4,
      returned_files: 4,
      truncated: false,
      nodes: [
        {
          ...makeScopedNode("src", "normal", "none"),
          name: "src",
          kind: "dir",
          file_size: null,
          children: [alphaNode, betaNode],
        },
        makeScopedNode("omega.txt", "modified", "local"),
      ],
    };
    const onSelectFile = vi.fn();
    const onActiveWorkspacePathChange = vi.fn();
    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([alpha, beta, omega]),
        workspaceFileTree: tree,
        onSelectFile,
        onActiveWorkspacePathChange,
      },
    });

    const treegrid = screen.getByRole("treegrid", { name: "工作副本文件树" });
    expect(treegrid).toHaveAttribute("aria-activedescendant", "workspace-row-src");
    expect(onActiveWorkspacePathChange).toHaveBeenLastCalledWith("src");
    treegrid.focus();

    await fireEvent.keyDown(treegrid, { key: "ArrowRight" });
    expect(treegrid).toHaveAttribute(
      "aria-activedescendant",
      "workspace-row-src%2Falpha.txt",
    );
    expect(onSelectFile).toHaveBeenLastCalledWith("src/alpha.txt");
    expect(onActiveWorkspacePathChange).toHaveBeenLastCalledWith("src/alpha.txt");

    await fireEvent.keyDown(treegrid, { key: "ArrowDown", shiftKey: true });
    expect(treegrid).toHaveAttribute(
      "aria-activedescendant",
      "workspace-row-src%2Fbeta.txt",
    );
    expect(screen.getByRole("toolbar", { name: "所选路径批量操作" })).toHaveTextContent(
      "2 个已选",
    );

    await fireEvent.keyDown(treegrid, { key: "ArrowUp", shiftKey: true });
    expect(screen.getByRole("toolbar", { name: "所选路径批量操作" })).toHaveTextContent(
      "1 个已选",
    );
    await fireEvent.keyDown(treegrid, { key: "ArrowDown", shiftKey: true });
    expect(screen.getByRole("toolbar", { name: "所选路径批量操作" })).toHaveTextContent(
      "2 个已选",
    );

    await fireEvent.keyDown(treegrid, { key: "Home" });
    expect(treegrid).toHaveAttribute("aria-activedescendant", "workspace-row-src");
    await fireEvent.keyDown(treegrid, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(document.getElementById("workspace-row-src")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
    await fireEvent.keyDown(treegrid, { key: "ArrowRight" });
    await waitFor(() => {
      expect(document.getElementById("workspace-row-src")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    });
    await fireEvent.keyDown(treegrid, { key: "ArrowRight" });
    expect(treegrid).toHaveAttribute(
      "aria-activedescendant",
      "workspace-row-src%2Falpha.txt",
    );
    await fireEvent.keyDown(treegrid, { key: "ArrowLeft" });
    expect(treegrid).toHaveAttribute("aria-activedescendant", "workspace-row-src");
    await fireEvent.keyDown(treegrid, { key: "Enter" });
    expect(document.getElementById("workspace-row-src")).toHaveAttribute("aria-expanded", "false");
    await fireEvent.keyDown(treegrid, { key: "Enter" });
    expect(document.getElementById("workspace-row-src")).toHaveAttribute("aria-expanded", "true");

    await fireEvent.keyDown(treegrid, { key: "End" });
    expect(treegrid).toHaveAttribute("aria-activedescendant", "workspace-row-omega.txt");
    expect(onActiveWorkspacePathChange).toHaveBeenLastCalledWith("omega.txt");
    await fireEvent.keyDown(treegrid, { key: " " });
    expect(screen.getByRole("checkbox", { name: "选择文件 omega.txt" })).toBeChecked();
    await fireEvent.keyDown(treegrid, { key: "a", ctrlKey: true });
    expect(screen.getByRole("checkbox", { name: "选择当前可见路径" })).toBeChecked();
    expect(screen.getByRole("toolbar", { name: "所选路径批量操作" })).toHaveTextContent(
      "4 个已选",
    );
  });

  it("opens existing files on double click and keeps directories in the tree", async () => {
    const openFile = makeFile("open.txt", "modified", "open-digest");
    const missingFile = makeFile("missing.txt", "missing", "missing-digest");
    const tree: WorkspaceFileTree = {
      working_copy_root: "C:/repo/wc",
      total_files: 3,
      returned_files: 3,
      truncated: false,
      nodes: [
        makeScopedNode("open.txt", "modified", "local"),
        makeScopedNode("missing.txt", "missing", "local"),
        {
          ...makeScopedNode("folder", "normal", "none"),
          kind: "dir",
          file_size: null,
        },
      ],
    };
    const onOpenWorkspaceFile = vi.fn();
    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([openFile, missingFile]),
        workspaceFileTree: tree,
        onOpenWorkspaceFile,
      },
    });

    await fireEvent.dblClick(screen.getByRole("button", { name: "选择文件 open.txt" }));
    expect(onOpenWorkspaceFile).toHaveBeenCalledWith("open.txt");
    expect(screen.getByRole("treegrid", { name: "工作副本文件树" })).toHaveAttribute(
      "aria-activedescendant",
      "workspace-row-open.txt",
    );

    await fireEvent.dblClick(screen.getByRole("button", { name: "选择文件 missing.txt" }));
    expect(onOpenWorkspaceFile).toHaveBeenCalledOnce();

    await fireEvent.dblClick(screen.getByRole("button", { name: "切换目录 folder" }));
    expect(document.getElementById("workspace-row-folder")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens a state-aware context menu for pointer and keyboard workflows", async () => {
    const alpha = makeFile("alpha.txt", "modified", "alpha-digest");
    const beta = makeFile("beta.txt", "modified", "beta-digest");
    const remote = {
      ...makeFile("remote.txt", "normal", "remote-digest"),
      remote_status: "modified",
      change_scope: "remote" as const,
    };
    const draft = makeFile("draft.txt", "unversioned", "draft-digest");
    const tree: WorkspaceFileTree = {
      working_copy_root: "C:/repo/wc",
      total_files: 4,
      returned_files: 4,
      truncated: false,
      nodes: [
        makeScopedNode("alpha.txt", "modified", "local"),
        makeScopedNode("beta.txt", "modified", "local"),
        makeScopedNode("remote.txt", "normal", "remote", "modified"),
        {
          ...makeScopedNode("draft.txt", "unversioned", "local"),
          versioned: false,
        },
      ],
    };
    const onRevertPaths = vi.fn();
    const onUpdatePath = vi.fn();
    const onIgnorePath = vi.fn();
    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([alpha, beta, remote, draft]),
        workspaceFileTree: tree,
        onRevertPaths,
        onUpdatePath,
        onIgnorePath,
      },
    });

    await fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 alpha.txt" }));
    await fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 beta.txt" }));
    await fireEvent.contextMenu(document.getElementById("workspace-row-alpha.txt") as HTMLElement, {
      clientX: 140,
      clientY: 120,
    });

    const batchMenu = screen.getByRole("menu", { name: "路径菜单 alpha.txt" });
    expect(screen.getByRole("checkbox", { name: "选择文件 beta.txt" })).toBeChecked();
    expect(within(batchMenu).getByRole("menuitem", { name: "Revert 2 项" })).toBeInTheDocument();
    expect(within(batchMenu).getByRole("menuitem", { name: "Move 2 项" })).toBeInTheDocument();
    expect(within(batchMenu).getByRole("menuitem", { name: "Delete 2 项" })).toBeInTheDocument();
    await fireEvent.click(within(batchMenu).getByRole("menuitem", { name: "Revert 2 项" }));
    expect(onRevertPaths).toHaveBeenCalledWith(["alpha.txt", "beta.txt"]);
    expect(screen.queryByRole("menu", { name: "路径菜单 alpha.txt" })).not.toBeInTheDocument();

    await fireEvent.contextMenu(document.getElementById("workspace-row-beta.txt") as HTMLElement, {
      clientX: 5000,
      clientY: 5000,
    });
    const boundedMenu = screen.getByRole("menu", { name: "路径菜单 beta.txt" });
    await waitFor(() => {
      expect(Number.parseFloat(boundedMenu.style.left)).toBeLessThanOrEqual(window.innerWidth - 8);
      expect(Number.parseFloat(boundedMenu.style.top)).toBeLessThanOrEqual(window.innerHeight - 8);
    });
    await fireEvent.keyDown(boundedMenu, { key: "Escape" });

    await fireEvent.contextMenu(document.getElementById("workspace-row-remote.txt") as HTMLElement);
    const remoteMenu = screen.getByRole("menu", { name: "路径菜单 remote.txt" });
    expect(screen.getByRole("checkbox", { name: "选择文件 remote.txt" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择文件 alpha.txt" })).not.toBeChecked();
    expect(within(remoteMenu).queryByRole("menuitem", { name: /Commit/ })).not.toBeInTheDocument();
    expect(within(remoteMenu).queryByRole("menuitem", { name: /Revert/ })).not.toBeInTheDocument();
    await fireEvent.click(within(remoteMenu).getByRole("menuitem", { name: "Update" }));
    expect(onUpdatePath).toHaveBeenCalledWith("remote.txt");

    await fireEvent.contextMenu(document.getElementById("workspace-row-draft.txt") as HTMLElement);
    const draftMenu = screen.getByRole("menu", { name: "路径菜单 draft.txt" });
    expect(within(draftMenu).getByRole("menuitem", { name: "Add" })).toBeInTheDocument();
    await fireEvent.click(within(draftMenu).getByRole("menuitem", { name: "Ignore" }));
    expect(onIgnorePath).toHaveBeenCalledWith("draft.txt");

    const treegrid = screen.getByRole("treegrid", { name: "工作副本文件树" });
    treegrid.focus();
    await fireEvent.keyDown(treegrid, { key: "F10", shiftKey: true });
    const keyboardMenu = screen.getByRole("menu", { name: "路径菜单 draft.txt" });
    await waitFor(() => {
      expect(within(keyboardMenu).getByRole("menuitem", { name: "打开" })).toHaveFocus();
    });
    await fireEvent.keyDown(keyboardMenu, { key: "ArrowDown" });
    expect(within(keyboardMenu).getByRole("menuitem", { name: "显示位置" })).toHaveFocus();
    await fireEvent.keyDown(keyboardMenu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "路径菜单 draft.txt" })).not.toBeInTheDocument();
    await waitFor(() => expect(treegrid).toHaveFocus());
  });

  it("moves and deletes versioned files and directories from the working copy", async () => {
    const onDeletePath = vi.fn();
    const onMovePath = vi.fn();
    const onCopyPath = vi.fn();
    const modified = makeFile("src/main.ts", "modified", "main-digest");

    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([modified]),
        workspaceFileTree: makeFileTree(),
        selectedFilePath: modified.path,
        selectedFile: modified,
        onDeletePath,
        onMovePath,
        onCopyPath,
      },
    });

    await clickRowMenuAction("更多操作 目录 src", "移动目录 src");
    await clickRowMenuAction("更多操作 文件 src/main.ts", "移动文件 src/main.ts");
    await fireEvent.click(
      screen.getByRole("button", { name: "在工作副本中移动 src/main.ts" }),
    );

    expect(onMovePath).toHaveBeenNthCalledWith(1, "src");
    expect(onMovePath).toHaveBeenNthCalledWith(2, "src/main.ts");
    expect(onMovePath).toHaveBeenNthCalledWith(3, "src/main.ts");

    await clickRowMenuAction("更多操作 目录 src", "复制目录 src");
    await clickRowMenuAction("更多操作 文件 src/main.ts", "复制文件 src/main.ts");
    await fireEvent.click(
      screen.getByRole("button", { name: "在工作副本中复制 src/main.ts" }),
    );

    expect(onCopyPath).toHaveBeenNthCalledWith(1, "src");
    expect(onCopyPath).toHaveBeenNthCalledWith(2, "src/main.ts");
    expect(onCopyPath).toHaveBeenNthCalledWith(3, "src/main.ts");

    await clickRowMenuAction("更多操作 目录 src", "删除目录 src");
    await clickRowMenuAction("更多操作 文件 src/main.ts", "删除文件 src/main.ts");
    await fireEvent.click(
      screen.getByRole("button", { name: "从工作副本删除 src/main.ts" }),
    );

    expect(onDeletePath).toHaveBeenNthCalledWith(1, "src");
    expect(onDeletePath).toHaveBeenNthCalledWith(2, "src/main.ts");
    expect(onDeletePath).toHaveBeenNthCalledWith(3, "src/main.ts");

    await fireEvent.click(screen.getByRole("button", { name: "全部文件" }));
    expect(screen.getByText("ignored.log", { exact: true })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除文件 ignored.log" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "移动文件 ignored.log" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "复制文件 ignored.log" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ignore 文件 ignored.log" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ignore 目录 external" }),
    ).not.toBeInTheDocument();
    await clickRowMenuAction("更多操作 目录 empty", "删除目录 empty");
    expect(onDeletePath).toHaveBeenNthCalledWith(4, "empty");
    await clickRowMenuAction(
      "更多操作 文件 literal\\name.txt",
      "删除文件 literal\\name.txt",
    );
    await clickRowMenuAction(
      "更多操作 文件 literal/name.txt",
      "删除文件 literal/name.txt",
    );
    expect(onDeletePath).toHaveBeenNthCalledWith(5, "literal\\name.txt");
    expect(onDeletePath).toHaveBeenNthCalledWith(6, "literal/name.txt");
  });

  it("offers Ignore for an unversioned directory", async () => {
    const onIgnorePath = vi.fn();
    const directory = makeFile("drafts", "unversioned", "drafts-digest");
    const tree = makeFileTree();
    tree.total_files = 1;
    tree.returned_files = 1;
    tree.nodes = [
      {
        path: "drafts",
        name: "drafts",
        kind: "dir",
        status: "unversioned",
        revision: null,
        ...makeNodeMetadata(null, null, "dev", "local"),
        file_size: null,
        changed: true,
        versioned: false,
        children: [],
      },
    ];

    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([directory]),
        workspaceFileTree: tree,
        onIgnorePath,
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: "未管理文件" }));
    await fireEvent.click(screen.getByRole("button", { name: "更多操作 目录 drafts" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Ignore 目录 drafts" }));

    expect(onIgnorePath).toHaveBeenCalledWith("drafts");
  });

  it("keeps a Unix backslash filename intact in the inspector", () => {
    const file = makeFile("literal\\name.txt", "modified", "literal-digest");

    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([file]),
        workspaceFileTree: makeFileTree(),
        selectedFilePath: file.path,
        selectedFile: file,
      },
    });

    expect(
      within(screen.getByLabelText("详情和提交")).getByText("literal\\name.txt", {
        exact: true,
      }),
    ).toBeInTheDocument();
  });

  it("shows patch preflight output and confirms a safe patch", async () => {
    const onRunApplyPatch = vi.fn();
    const onCloseApplyPatch = vi.fn();

    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        applyPatchDialogOpen: true,
        applyPatchFilePath: "C:/patches/change.patch",
        applyPatchResult: {
          dry_run: true,
          patch_file_path: "C:/patches/change.patch",
          patch_digest: "a".repeat(64),
          output_text: "U         C:/repo/wc/src/main.ts",
          output_truncated: true,
          max_output_bytes: 256 * 1024,
          applied: 1,
          offset_hunks: 1,
          rejected: 0,
          skipped: 0,
          conflicted: 0,
        },
        onRunApplyPatch,
        onCloseApplyPatch,
      },
    });

    const dialog = screen.getByRole("dialog", { name: "应用 Patch" });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText("预检通过")).toBeInTheDocument();
    expect(dialog.querySelector(".patch-output")).toHaveTextContent(
      "U C:/repo/wc/src/main.ts",
    );
    const patchSummary = within(dialog).getByLabelText("Patch 结果统计");
    expect(patchSummary.children[0]).toHaveTextContent("1应用");
    expect(patchSummary.children[1]).toHaveTextContent("1偏移");
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "输出预览已截断（上限 256 KiB）",
    );

    await fireEvent.click(within(dialog).getByRole("button", { name: "应用 Patch" }));
    expect(onRunApplyPatch).toHaveBeenCalledWith(false);

    await fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCloseApplyPatch).toHaveBeenCalledOnce();
  });

  it("blocks patch confirmation when preflight skips a target", () => {
    render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        applyPatchDialogOpen: true,
        applyPatchFilePath: "C:/patches/change.patch",
        applyPatchResult: {
          dry_run: true,
          patch_file_path: "C:/patches/change.patch",
          patch_digest: "b".repeat(64),
          output_text: "Skipped missing target: '../outside.txt'",
          output_truncated: false,
          max_output_bytes: 256 * 1024,
          applied: 0,
          offset_hunks: 0,
          rejected: 0,
          skipped: 1,
          conflicted: 0,
        },
      },
    });

    const dialog = screen.getByRole("dialog", { name: "应用 Patch" });
    expect(within(dialog).getByText("预检发现问题")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "应用 Patch" })).toBeDisabled();
  });

  it("forwards merge tracking options and previews structured results", async () => {
    const onMergeFormInput = vi.fn();
    const onRunMerge = vi.fn();
    render(MainWorkspace, {
      props: {
        view: workbenchViews.branches,
        workspace: makeWorkspace(),
        mergeForm: {
          sourceUrl: "https://example.com/svn/branches/feature",
          startRevision: "10",
          endRevision: "12",
          dryRun: true,
          recordOnly: false,
          ignoreAncestry: false,
          force: false,
        },
        mergeResult: {
          dry_run: true,
          source_url: "https://example.com/svn/branches/feature",
          revision_range: "10:12",
          record_only: true,
          ignore_ancestry: false,
          force: true,
          output_text: "U    src/main.ts",
          file_count: 1,
          line_count: 1,
          added: 0,
          deleted: 0,
          updated: 1,
          conflicted: 0,
        },
        onMergeFormInput,
        onRunMerge,
      },
    });

    await fireEvent.click(screen.getByLabelText("Record only"));
    await fireEvent.click(screen.getByLabelText("Ignore ancestry"));
    await fireEvent.click(screen.getByLabelText("Force"));
    expect(onMergeFormInput).toHaveBeenNthCalledWith(1, "recordOnly", true);
    expect(onMergeFormInput).toHaveBeenNthCalledWith(2, "ignoreAncestry", true);
    expect(onMergeFormInput).toHaveBeenNthCalledWith(3, "force", true);

    await fireEvent.click(screen.getByRole("button", { name: "Dry-run" }));
    expect(onRunMerge).toHaveBeenCalledOnce();
    expect(screen.getByText("Dry-run 预览")).toBeInTheDocument();
    expect(screen.getByText("r10:12")).toBeInTheDocument();
    expect(screen.getByText("Record only", { selector: ".merge-result-meta span" }))
      .toBeInTheDocument();
    const summary = screen.getByLabelText("Merge 结果统计");
    expect(summary.children[0]).toHaveTextContent("1条目");
    expect(summary.children[1]).toHaveTextContent("1更新");
    expect(screen.getByText("U src/main.ts")).toBeInTheDocument();
  });

  it("opens Resolve actions when a selected path becomes conflicted", async () => {
    const modified = makeFile("src/main.ts", "modified", "before-merge");
    const conflicted: ChangedFile = {
      ...modified,
      status: "conflicted",
      abnormal: true,
      conflict_kind: "text",
      content_digest: "after-merge-conflict",
    };
    const { rerender } = render(MainWorkspace, {
      props: {
        view: workbenchViews.changes,
        workspace: makeWorkspace(),
        workingCopyStatus: makeStatus([modified]),
        workspaceFileTree: makeFileTree(),
        selectedFilePath: modified.path,
        selectedFile: modified,
      },
    });
    await fireEvent.click(screen.getByRole("tab", { name: "Diff" }));
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("aria-selected", "true");

    await rerender({
      workingCopyStatus: makeStatus([conflicted]),
      selectedFile: conflicted,
    });

    expect(screen.getByRole("tab", { name: "Information" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "使用工作副本" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mine Full" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Theirs Full" })).toBeInTheDocument();
  });
});

function makeWorkspace(): WorkspaceSummary {
  return {
    local_path: "C:/repo/wc",
    working_copy_root: "C:/repo/wc",
    repository_url: "https://example.com/svn/trunk",
    repository_root: "https://example.com/svn",
    revision: "12",
  };
}

function makeComponentTask(taskId: string): Task {
  return {
    task_id: taskId,
    title: taskId,
    status: "success",
    logs: [],
    error: null,
    result: null,
    created_at: 1,
    updated_at: 1,
  };
}

function makeAppSettings(settings: Partial<AppSettingsState> = {}): AppSettingsState {
  return {
    svnExecutable: "",
    diffMode: "side_by_side",
    showWhitespace: false,
    themeMode: "system",
    showSourceList: true,
    showInspector: true,
    commitTemplate: "",
    branchPoolBasePath: "",
    largeFileThresholdMb: 20,
    externalDiffTool: "",
    externalMergeTool: "",
    diagnosticExportPath: "",
    diagnosticExportError: null,
    validationErrors: {
      svnExecutable: null,
      branchPoolBasePath: null,
      externalDiffTool: null,
      externalMergeTool: null,
    },
    loading: false,
    ...settings,
  };
}

function makeFile(path: string, status: string, contentDigest: string): ChangedFile {
  return {
    path,
    status,
    revision: "12",
    property_status: null,
    property_changed: false,
    remote_status: null,
    remote_property_status: null,
    change_scope: status === "normal" ? "none" : "local",
    abnormal: false,
    lock_state: "none",
    lock_owner: null,
    lock_comment: null,
    conflict_kind: null,
    file_size: 128,
    content_digest: contentDigest,
  };
}

function makeStatus(files: ChangedFile[]): WorkingCopyStatus {
  return {
    working_copy_root: "C:/repo/wc",
    total: files.length,
    returned: files.length,
    offset: 0,
    limit: 500,
    revision_range: "12",
    mixed_revision: false,
    remote_updates_checked: true,
    repository_revision: "12",
    local_changes: files.filter((file) => ["local", "both"].includes(file.change_scope)).length,
    remote_changes: files.filter((file) => ["remote", "both"].includes(file.change_scope)).length,
    combined_changes: files.filter((file) => file.change_scope === "both").length,
    modified: 1,
    added: 0,
    deleted: 0,
    missing: 0,
    unversioned: 1,
    conflicted: 0,
    obstructed: 0,
    property_changed: 0,
    files,
  };
}

function makeScopedNode(
  path: string,
  status: string,
  changeScope: "none" | "local" | "remote" | "both",
  remoteStatus: string | null = null,
) {
  return {
    path,
    name: path,
    kind: "file",
    status,
    revision: "12",
    ...makeNodeMetadata("12", "11", "alice", changeScope),
    remote_status: remoteStatus,
    file_size: 128,
    changed: changeScope !== "none",
    versioned: true,
    children: [],
  } satisfies WorkspaceFileTree["nodes"][number];
}

async function clickRowMenuAction(triggerName: string, actionName: string) {
  await fireEvent.click(screen.getByRole("button", { name: triggerName }));
  await fireEvent.click(screen.getByRole("menuitem", { name: actionName }));
}

function makeFileTree(): WorkspaceFileTree {
  return {
    working_copy_root: "C:/repo/wc",
    total_files: 8,
    returned_files: 8,
    truncated: false,
    nodes: [
      {
        path: "src",
        name: "src",
        kind: "dir",
        status: "normal",
        revision: "12",
        ...makeNodeMetadata("12", "12", "dev", "local"),
        file_size: null,
        changed: true,
        versioned: true,
        children: [
          {
            path: "src/main.ts",
            name: "main.ts",
            kind: "file",
            status: "modified",
            revision: "12",
            ...makeNodeMetadata("12", "11", "alice", "local"),
            file_size: 128,
            changed: true,
            versioned: true,
            children: [],
          },
        ],
      },
      {
        path: "notes/new.txt",
        name: "new.txt",
        kind: "file",
        status: "unversioned",
        revision: null,
        ...makeNodeMetadata(null, null, "dev", "local"),
        file_size: 128,
        changed: true,
        versioned: false,
        children: [],
      },
      {
        path: "ignored.log",
        name: "ignored.log",
        kind: "file",
        status: "normal",
        revision: null,
        ...makeNodeMetadata(null),
        file_size: 64,
        changed: false,
        versioned: false,
        children: [],
      },
      {
        path: "external",
        name: "external",
        kind: "dir",
        status: "external",
        revision: null,
        ...makeNodeMetadata(null),
        file_size: null,
        changed: false,
        versioned: false,
        children: [
          {
            path: "external/file.txt",
            name: "file.txt",
            kind: "file",
            status: "normal",
            revision: null,
            ...makeNodeMetadata(null),
            file_size: 64,
            changed: false,
            versioned: false,
            children: [],
          },
        ],
      },
      {
        path: "empty",
        name: "empty",
        kind: "dir",
        status: "normal",
        revision: "12",
        ...makeNodeMetadata("12"),
        file_size: null,
        changed: false,
        versioned: true,
        children: [],
      },
      {
        path: "literal\\name.txt",
        name: "literal\\name.txt",
        kind: "file",
        status: "normal",
        revision: "12",
        ...makeNodeMetadata("12"),
        file_size: 64,
        changed: false,
        versioned: true,
        children: [],
      },
      {
        path: "literal",
        name: "literal",
        kind: "dir",
        status: "normal",
        revision: "12",
        ...makeNodeMetadata("12"),
        file_size: null,
        changed: false,
        versioned: true,
        children: [
          {
            path: "literal/name.txt",
            name: "name.txt",
            kind: "file",
            status: "normal",
            revision: "12",
            ...makeNodeMetadata("12"),
            file_size: 64,
            changed: false,
            versioned: true,
            children: [],
          },
        ],
      },
    ],
  };
}

function makeNodeMetadata(
  baseRevision: string | null,
  lastRevision = baseRevision,
  author = "dev",
  changeScope: "none" | "local" | "remote" | "both" = "none",
) {
  return {
    remote_status: null,
    remote_property_status: null,
    change_scope: changeScope,
    base_revision: baseRevision,
    last_revision: lastRevision,
    last_changed_date: baseRevision ? "2026-07-11T01:02:03Z" : null,
    last_changed_author: baseRevision ? author : null,
  };
}

function makeLogEntry(
  revision: string,
  date: string,
  author: string,
  message: string,
  pathCount = 1,
) {
  return {
    revision,
    author,
    date,
    message,
    changed_paths: Array.from({ length: pathCount }, (_, index) => ({
      path: `/trunk/file-${revision}-${index + 1}.txt`,
      action: "M",
      kind: "file",
      copy_from_path: null,
      copy_from_revision: null,
    })),
  };
}
