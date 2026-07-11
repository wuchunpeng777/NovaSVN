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
    expect(screen.getByText("已选提交", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("暂存", { exact: false })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByText("取消选择", { exact: true }));
    await fireEvent.click(screen.getByRole("button", { name: "全选改动" }));
    await fireEvent.click(screen.getByRole("button", { name: "清除选择" }));

    expect(onUnselectCommitFile).toHaveBeenCalledWith("src/main.ts");
    expect(onSelectAllCommitFiles).toHaveBeenCalledOnce();
    expect(onClearCommitFiles).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole("button", { name: "未管理文件" }));

    await fireEvent.click(screen.getByText("Add", { exact: true }));
    await fireEvent.click(screen.getByRole("button", { name: "Ignore 文件 notes/new.txt" }));
    expect(onAddFile).toHaveBeenCalledWith("notes/new.txt");
    expect(onIgnorePath).toHaveBeenCalledWith("notes/new.txt");
    expect(screen.getByText("作用目录：notes", { exact: true })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除文件 notes/new.txt" }),
    ).not.toBeInTheDocument();
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

    await fireEvent.click(screen.getByRole("button", { name: "移动目录 src" }));
    await fireEvent.click(screen.getByRole("button", { name: "移动文件 src/main.ts" }));
    await fireEvent.click(
      screen.getByRole("button", { name: "在工作副本中移动 src/main.ts" }),
    );

    expect(onMovePath).toHaveBeenNthCalledWith(1, "src");
    expect(onMovePath).toHaveBeenNthCalledWith(2, "src/main.ts");
    expect(onMovePath).toHaveBeenNthCalledWith(3, "src/main.ts");

    await fireEvent.click(screen.getByRole("button", { name: "复制目录 src" }));
    await fireEvent.click(screen.getByRole("button", { name: "复制文件 src/main.ts" }));
    await fireEvent.click(
      screen.getByRole("button", { name: "在工作副本中复制 src/main.ts" }),
    );

    expect(onCopyPath).toHaveBeenNthCalledWith(1, "src");
    expect(onCopyPath).toHaveBeenNthCalledWith(2, "src/main.ts");
    expect(onCopyPath).toHaveBeenNthCalledWith(3, "src/main.ts");

    await fireEvent.click(screen.getByRole("button", { name: "删除目录 src" }));
    await fireEvent.click(screen.getByRole("button", { name: "删除文件 src/main.ts" }));
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
    await fireEvent.click(screen.getByRole("button", { name: "删除目录 empty" }));
    expect(onDeletePath).toHaveBeenNthCalledWith(4, "empty");
    await fireEvent.click(
      screen.getByRole("button", { name: "删除文件 literal\\name.txt" }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "删除文件 literal/name.txt" }),
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
    await fireEvent.click(screen.getByRole("button", { name: "Ignore 目录 drafts" }));

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
