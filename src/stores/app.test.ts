import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  detectSvn: vi.fn(),
  getTaskWorkspaces: vi.fn(),
  openWorkspace: vi.fn(),
  removeTaskWorkspace: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
  saveTaskWorkspace: vi.fn(),
}));

import { get } from "svelte/store";

import {
  detectSvn,
  getTaskWorkspaces,
  openWorkspace,
  removeTaskWorkspace,
  scanWorkspaceStatus,
  saveTaskWorkspace,
} from "../lib/api";
import type {
  BranchPoolEntry,
  ChangedFile,
  TaskWorkspaceEntry,
  TaskWorkspaceList,
  WorkingCopyStatus,
  WorkspaceSummary,
} from "../types/api";
import type { AppSettingsState } from "../types/app";
import {
  appSettingsStore,
  isSameRepositoryUrl,
  revisionDiffPatchFileName,
  svnStore,
  taskWorkspaceStore,
  workspaceStore,
} from "./app";

const detectSvnMock = vi.mocked(detectSvn);
const getTaskWorkspacesMock = vi.mocked(getTaskWorkspaces);
const openWorkspaceMock = vi.mocked(openWorkspace);
const removeTaskWorkspaceMock = vi.mocked(removeTaskWorkspace);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);
const saveTaskWorkspaceMock = vi.mocked(saveTaskWorkspace);

beforeEach(() => {
  detectSvnMock.mockReset();
  getTaskWorkspacesMock.mockReset();
  openWorkspaceMock.mockReset();
  removeTaskWorkspaceMock.mockReset();
  scanWorkspaceStatusMock.mockReset();
  saveTaskWorkspaceMock.mockReset();
  window.localStorage.clear();
  appSettingsStore.load();
  svnStore.setExecutableInput("");
  workspaceStore.clearWorkspaceDraft();
  workspaceStore.setCommitMessage("");
});

describe("revisionDiffPatchFileName", () => {
  it("uses sanitized revision diff mode and target", () => {
    vi.setSystemTime(new Date("2026-07-03T00:00:00Z"));

    const name = revisionDiffPatchFileName({
      mode: "urls",
      target: "branches/feature to trunk?bad:name",
    });

    expect(name).toBe("novasvn-urls-branches-feature-to-trunk-bad-name-1783036800000.patch");
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe("svnStore", () => {
  it("falls back to default svn detection when saved executable fails", async () => {
    detectSvnMock
      .mockRejectedValueOnce({
        code: "SVN_NOT_FOUND",
        message: "自定义 SVN 不可用",
        recoverable: true,
      })
      .mockResolvedValueOnce({
        available: true,
        version: "1.14.3",
        executable: "svn",
        resolved_path: "C:\\Tools\\svn.exe",
      });

    svnStore.setExecutableInput("C:\\Missing\\svn.exe");
    const detection = await svnStore.detectWithInputFallback();

    expect(detectSvnMock).toHaveBeenNthCalledWith(1, {
      executable: "C:\\Missing\\svn.exe",
    });
    expect(detectSvnMock).toHaveBeenNthCalledWith(2);
    expect(detection?.resolved_path).toBe("C:\\Tools\\svn.exe");
  });
});

describe("isSameRepositoryUrl", () => {
  it("normalizes whitespace and trailing slashes", () => {
    expect(
      isSameRepositoryUrl(
        " https://example.com/svn/trunk/ ",
        "https://example.com/svn/trunk",
      ),
    ).toBe(true);
    expect(
      isSameRepositoryUrl(
        "https://example.com/svn/branches/feature",
        "https://example.com/svn/trunk",
      ),
    ).toBe(false);
    expect(isSameRepositoryUrl("", "https://example.com/svn/trunk")).toBe(false);
  });
});

describe("appSettingsStore", () => {
  it("normalizes partial Unity group rules before saving and loading", () => {
    appSettingsStore.setField("unityGroupRules", {
      addressables: false,
    } as AppSettingsState["unityGroupRules"]);

    expect(get(appSettingsStore).unityGroupRules).toEqual({
      addressables: false,
      projectSettings: true,
      packages: true,
      scenes: true,
      prefabs: true,
      assets: true,
    });

    appSettingsStore.load();

    expect(get(appSettingsStore).unityGroupRules).toEqual({
      addressables: false,
      projectSettings: true,
      packages: true,
      scenes: true,
      prefabs: true,
      assets: true,
    });
  });
});

describe("workspaceStore safety warnings", () => {
  it("drops confirmed warnings when staged file content changes", async () => {
    const workspace = makeWorkspace();
    const firstStatus = makeStatus([
      makeFile({
        path: "build/output.tmp",
        content_digest: "digest-a",
      }),
    ]);
    const changedStatus = makeStatus([
      makeFile({
        path: "build/output.tmp",
        content_digest: "digest-b",
      }),
    ]);

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce(firstStatus).mockResolvedValueOnce(changedStatus);

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    workspaceStore.stageFile("build/output.tmp");
    workspaceStore.confirmSafetyWarnings();

    expect(get(workspaceStore).safetyCheck.confirmedWarningIds).toHaveLength(1);

    await workspaceStore.refreshStatus();

    const state = get(workspaceStore);
    expect(state.stagedFiles).toEqual([
      {
        path: "build/output.tmp",
        status: "modified",
        contentDigest: "digest-b",
      },
    ]);
    expect(state.safetyCheck.warnings.map((item) => item.id)).toEqual([
      "warning:generated:build/output.tmp:digest-b",
    ]);
    expect(state.safetyCheck.confirmedWarningIds).toEqual([]);
  });

  it("warns about Unity meta pairing issues and preserves confirmations in drafts", async () => {
    const workspace = makeWorkspace({
      unity: {
        detected: true,
        has_assets: true,
        has_project_settings: true,
        has_packages_manifest: true,
      },
    });
    const status = makeStatus([
      makeFile({
        path: "Assets/Textures/stone.png",
        status: "added",
        content_digest: "asset-digest",
      }),
      makeFile({
        path: "Assets/Textures/orphan.png.meta",
        status: "added",
        content_digest: "meta-digest",
      }),
    ]);

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(status);

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();

    expect(get(workspaceStore).safetyCheck.warnings.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Unity 资源缺少 meta",
        "Unity meta 缺少资源",
      ]),
    );

    workspaceStore.confirmSafetyWarnings();
    const confirmedWarningIds = get(workspaceStore).safetyCheck.confirmedWarningIds;

    expect(confirmedWarningIds).toEqual(
      expect.arrayContaining([
        "warning:unity-meta-missing:Assets/Textures/stone.png:asset-digest",
        "warning:unity-meta-orphan:Assets/Textures/orphan.png.meta:meta-digest",
      ]),
    );

    await workspaceStore.refreshStatus();

    expect(get(workspaceStore).safetyCheck.confirmedWarningIds).toEqual(confirmedWarningIds);
  });

  it("warns when Unity resource and meta statuses are not synchronized", async () => {
    const workspace = makeWorkspace({
      unity: {
        detected: true,
        has_assets: true,
        has_project_settings: true,
        has_packages_manifest: true,
      },
    });
    const status = makeStatus([
      makeFile({
        path: "Assets/Textures/new.png",
        status: "added",
        content_digest: "new-asset",
      }),
      makeFile({
        path: "Assets/Textures/new.png.meta",
        status: "modified",
        content_digest: "new-meta",
      }),
      makeFile({
        path: "Assets/Textures/old.png",
        status: "deleted",
        content_digest: "old-asset",
      }),
      makeFile({
        path: "Assets/Textures/old.png.meta",
        status: "modified",
        content_digest: "old-meta",
      }),
    ]);

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(status);

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();

    expect(get(workspaceStore).safetyCheck.warnings.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Unity 新增资源 meta 未同步新增",
        "Unity 删除资源 meta 未同步删除",
      ]),
    );
  });
});

describe("workspaceStore review state", () => {
  it("invalidates reviewed files when content digest changes", async () => {
    const workspace = makeWorkspace();
    const firstStatus = makeStatus([
      makeFile({
        path: "src/main.ts",
        content_digest: "digest-a",
      }),
    ]);
    const changedStatus = makeStatus([
      makeFile({
        path: "src/main.ts",
        content_digest: "digest-b",
      }),
    ]);

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce(firstStatus).mockResolvedValueOnce(changedStatus);

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    workspaceStore.markFileReviewed("src/main.ts");

    expect(get(workspaceStore).reviewedFiles).toEqual([
      expect.objectContaining({
        path: "src/main.ts",
        contentDigest: "digest-a",
      }),
    ]);

    await workspaceStore.refreshStatus();

    expect(get(workspaceStore).reviewedFiles).toEqual([]);
  });
});

describe("taskWorkspaceStore drafts", () => {
  it("restores staged files, commit message, review state, and warning confirmations per task", async () => {
    const workspace = makeWorkspace();
    const status = makeStatus([
      makeFile({
        path: "build/output.tmp",
        content_digest: "tmp-digest",
      }),
      makeFile({
        path: "src/main.ts",
        content_digest: "main-digest",
      }),
    ]);
    const taskA = makeTaskWorkspace({
      id: "task-a",
      name: "任务 A",
      draft_key: "novasvn:test-task-a",
    });
    const taskB = makeTaskWorkspace({
      id: "task-b",
      name: "任务 B",
      draft_key: "novasvn:test-task-b",
    });

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(status);

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    workspaceStore.stageFile("build/output.tmp");
    workspaceStore.setCommitMessage("提交任务 A");
    workspaceStore.markFileReviewed("src/main.ts");
    workspaceStore.confirmSafetyWarnings();
    taskWorkspaceStore.saveDraft(taskA, workspaceStore.exportTaskWorkspaceDraft());

    workspaceStore.unstageFile("build/output.tmp");
    workspaceStore.stageFile("src/main.ts");
    workspaceStore.setCommitMessage("提交任务 B");
    workspaceStore.markFileUnreviewed("src/main.ts");
    taskWorkspaceStore.saveDraft(taskB, workspaceStore.exportTaskWorkspaceDraft());

    workspaceStore.importTaskWorkspaceDraft(taskWorkspaceStore.loadDraft(taskA));
    expect(get(taskWorkspaceStore).activeTaskId).toBe("task-a");
    expect(get(workspaceStore)).toMatchObject({
      commitMessage: "提交任务 A",
      stagedFiles: [
        {
          path: "build/output.tmp",
          status: "modified",
          contentDigest: "tmp-digest",
        },
      ],
      reviewedFiles: [
        {
          path: "src/main.ts",
          contentDigest: "main-digest",
        },
      ],
    });
    expect(get(workspaceStore).safetyCheck.confirmedWarningIds).toEqual([
      "warning:generated:build/output.tmp:tmp-digest",
    ]);

    workspaceStore.importTaskWorkspaceDraft(taskWorkspaceStore.loadDraft(taskB));
    expect(get(taskWorkspaceStore).activeTaskId).toBe("task-b");
    expect(get(workspaceStore)).toMatchObject({
      commitMessage: "提交任务 B",
      stagedFiles: [
        {
          path: "src/main.ts",
          status: "modified",
          contentDigest: "main-digest",
        },
      ],
      reviewedFiles: [],
    });
    expect(get(workspaceStore).safetyCheck.confirmedWarningIds).toEqual([]);
  });

  it("removes only the deleted task draft and keeps the workspace draft untouched", async () => {
    const workspace = makeWorkspace();
    const taskA = makeTaskWorkspace({
      id: "task-a",
      draft_key: "novasvn:test-task-a",
    });
    const taskB = makeTaskWorkspace({
      id: "task-b",
      draft_key: "novasvn:test-task-b",
    });

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(makeStatus([
      makeFile({
        path: "src/main.ts",
        content_digest: "main-digest",
      }),
    ]));
    removeTaskWorkspaceMock.mockResolvedValue(makeTaskWorkspaceList([taskB]));

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    workspaceStore.stageFile("src/main.ts");
    workspaceStore.setCommitMessage("工作副本草稿");
    taskWorkspaceStore.saveDraft(taskA, workspaceStore.exportTaskWorkspaceDraft());
    taskWorkspaceStore.saveDraft(taskB, workspaceStore.exportTaskWorkspaceDraft());

    expect(window.localStorage.getItem(taskA.draft_key)).not.toBeNull();
    expect(window.localStorage.getItem(taskB.draft_key)).not.toBeNull();
    const workspaceDraftKey = `novasvn:workspace-draft:${workspace.working_copy_root}:${workspace.repository_url}`;
    expect(window.localStorage.getItem(workspaceDraftKey)).not.toBeNull();

    await taskWorkspaceStore.remove(taskA);

    expect(removeTaskWorkspaceMock).toHaveBeenCalledWith({ id: "task-a" });
    expect(window.localStorage.getItem(taskA.draft_key)).toBeNull();
    expect(window.localStorage.getItem(taskB.draft_key)).not.toBeNull();
    expect(window.localStorage.getItem(workspaceDraftKey)).not.toBeNull();
  });
});

function makeWorkspace(workspace: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    local_path: "C:/repo/wc",
    working_copy_root: "C:/repo/wc",
    repository_url: "https://example.com/svn/trunk",
    repository_root: "https://example.com/svn",
    revision: "12",
    unity: {
      detected: false,
      has_assets: false,
      has_project_settings: false,
      has_packages_manifest: false,
    },
    ...workspace,
  };
}

function makeBranchPoolEntry(entry: Partial<BranchPoolEntry> = {}): BranchPoolEntry {
  return {
    id: "branch-1",
    branch_url: "https://example.com/svn/branches/feature",
    local_path: "C:/repo/wc",
    revision: "12",
    local_changes: 0,
    created_at: 1,
    updated_at: 1,
    ...entry,
  };
}

function makeTaskWorkspace(entry: Partial<TaskWorkspaceEntry> = {}): TaskWorkspaceEntry {
  const branch = makeBranchPoolEntry();
  return {
    id: "task-1",
    name: "任务",
    branch_pool_entry_id: branch.id,
    branch_url: branch.branch_url,
    local_path: branch.local_path,
    draft_key: "novasvn:test-task",
    created_at: 1,
    updated_at: 1,
    ...entry,
  };
}

function makeTaskWorkspaceList(entries: TaskWorkspaceEntry[]): TaskWorkspaceList {
  return {
    entries,
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
    modified: files.filter((file) => file.status === "modified").length,
    added: files.filter((file) => file.status === "added").length,
    deleted: files.filter((file) => file.status === "deleted").length,
    missing: files.filter((file) => file.status === "missing").length,
    unversioned: files.filter((file) => file.status === "unversioned").length,
    conflicted: files.filter((file) => file.status === "conflicted").length,
    obstructed: files.filter((file) => file.status === "obstructed").length,
    property_changed: files.filter((file) => file.property_changed).length,
    files,
  };
}

function makeFile(file: Partial<ChangedFile> & Pick<ChangedFile, "path" | "content_digest">): ChangedFile {
  return {
    path: file.path,
    status: file.status ?? "modified",
    revision: file.revision ?? "12",
    property_status: file.property_status ?? null,
    property_changed: file.property_changed ?? false,
    abnormal: file.abnormal ?? false,
    lock_state: file.lock_state ?? "none",
    lock_owner: file.lock_owner ?? null,
    lock_comment: file.lock_comment ?? null,
    conflict_kind: file.conflict_kind ?? null,
    file_size: file.file_size ?? 128,
    content_digest: file.content_digest,
  };
}
