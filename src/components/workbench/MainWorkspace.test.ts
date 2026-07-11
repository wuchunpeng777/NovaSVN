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
import type {
  ChangedFile,
  WorkingCopyStatus,
  WorkspaceFileTree,
  WorkspaceSummary,
} from "../../types/api";
import MainWorkspace from "./MainWorkspace.svelte";

describe("MainWorkspace", () => {
  it("uses current commit targets and excludes unversioned files", async () => {
    const onUnselectCommitFile = vi.fn();
    const onSelectAllCommitFiles = vi.fn();
    const onClearCommitFiles = vi.fn();
    const onAddFile = vi.fn();
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
    expect(onAddFile).toHaveBeenCalledWith("notes/new.txt");
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
    total_files: 5,
    returned_files: 5,
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
