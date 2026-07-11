import { fireEvent, render, screen, within } from "@testing-library/svelte";
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
    expect(screen.getByText("作用目录：notes", { exact: true })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除文件 notes/new.txt" }),
    ).not.toBeInTheDocument();
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
      workspace: {
        ...makeWorkspace(),
        local_path: "C:/repo/other",
        working_copy_root: "C:/repo/other",
      },
    });
    expect(screen.queryByRole("toolbar", { name: "所选路径批量操作" })).not.toBeInTheDocument();
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
          applied: 1,
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
    expect(within(dialog).getByText("1").closest("span")).toHaveTextContent("1应用");

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
          applied: 0,
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
