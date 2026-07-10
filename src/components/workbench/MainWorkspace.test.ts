import { fireEvent, render, screen } from "@testing-library/svelte";
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
    total_files: 2,
    returned_files: 2,
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
        children: [
          {
            path: "src/main.ts",
            name: "main.ts",
            kind: "file",
            status: "modified",
            revision: "12",
            file_size: 128,
            changed: true,
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
        children: [],
      },
    ],
  };
}
