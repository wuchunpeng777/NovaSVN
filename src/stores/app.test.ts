import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  createApplyPatchTask: vi.fn(),
  createMergeTask: vi.fn(),
  createRepositoryFileTask: vi.fn(),
  createRepositoryListTask: vi.fn(),
  createRevertRevisionTask: vi.fn(),
  createRevisionDiffTask: vi.fn(),
  createSvnBatchOperationTask: vi.fn(),
  createSvnOperationTask: vi.fn(),
  detectSvn: vi.fn(),
  getFileContentDiff: vi.fn(),
  getFileDiff: vi.fn(),
  getRepositoryFileBlame: vi.fn(),
  getRepositoryFileLog: vi.fn(),
  getRepositoryFileProperties: vi.fn(),
  getSvnBlame: vi.fn(),
  getSvnLog: vi.fn(),
  getSvnProperties: vi.fn(),
  ignoreWorkspacePath: vi.fn(),
  getTaskWorkspaces: vi.fn(),
  listWorkspaceFiles: vi.fn(),
  openGeneratedFileLocation: vi.fn(),
  openWorkspace: vi.fn(),
  parseUnifiedDiff: vi.fn(),
  removeTaskWorkspace: vi.fn(),
  scanWorkspaceStatus: vi.fn(),
  saveTaskWorkspace: vi.fn(),
  setSvnProperty: vi.fn(),
}));

import { get } from "svelte/store";

import {
  createApplyPatchTask,
  createMergeTask,
  createRepositoryFileTask,
  createRepositoryListTask,
  createRevertRevisionTask,
  createRevisionDiffTask,
  createSvnBatchOperationTask,
  createSvnOperationTask,
  detectSvn,
  getFileContentDiff,
  getFileDiff,
  getRepositoryFileBlame,
  getRepositoryFileLog,
  getRepositoryFileProperties,
  getSvnBlame,
  getSvnLog,
  getSvnProperties,
  ignoreWorkspacePath,
  getTaskWorkspaces,
  listWorkspaceFiles,
  openGeneratedFileLocation,
  openWorkspace,
  parseUnifiedDiff,
  removeTaskWorkspace,
  scanWorkspaceStatus,
  saveTaskWorkspace,
  setSvnProperty,
} from "../lib/api";
import type {
  BranchPoolEntry,
  ChangedFile,
  RevisionDiffResult,
  SvnBlame,
  SvnProperties,
  SvnLog,
  SvnLogEntry,
  Task,
  TaskWorkspaceEntry,
  TaskWorkspaceList,
  WorkingCopyStatus,
  WorkspaceFileTree,
  WorkspaceSummary,
} from "../types/api";
import {
  appSettingsStore,
  isSameRepositoryUrl,
  repositoryPathUrl,
  revisionDiffPatchFileName,
  svnStore,
  taskStore,
  taskWorkspaceStore,
  workspaceStore,
} from "./app";

const createApplyPatchTaskMock = vi.mocked(createApplyPatchTask);
const createMergeTaskMock = vi.mocked(createMergeTask);
const createRepositoryFileTaskMock = vi.mocked(createRepositoryFileTask);
const createRepositoryListTaskMock = vi.mocked(createRepositoryListTask);
const createRevertRevisionTaskMock = vi.mocked(createRevertRevisionTask);
const createRevisionDiffTaskMock = vi.mocked(createRevisionDiffTask);
const createSvnBatchOperationTaskMock = vi.mocked(createSvnBatchOperationTask);
const createSvnOperationTaskMock = vi.mocked(createSvnOperationTask);
const detectSvnMock = vi.mocked(detectSvn);
const getFileContentDiffMock = vi.mocked(getFileContentDiff);
const getFileDiffMock = vi.mocked(getFileDiff);
const getRepositoryFileBlameMock = vi.mocked(getRepositoryFileBlame);
const getRepositoryFileLogMock = vi.mocked(getRepositoryFileLog);
const getRepositoryFilePropertiesMock = vi.mocked(getRepositoryFileProperties);
const getSvnBlameMock = vi.mocked(getSvnBlame);
const getSvnLogMock = vi.mocked(getSvnLog);
const getSvnPropertiesMock = vi.mocked(getSvnProperties);
const ignoreWorkspacePathMock = vi.mocked(ignoreWorkspacePath);
const getTaskWorkspacesMock = vi.mocked(getTaskWorkspaces);
const listWorkspaceFilesMock = vi.mocked(listWorkspaceFiles);
const openGeneratedFileLocationMock = vi.mocked(openGeneratedFileLocation);
const openWorkspaceMock = vi.mocked(openWorkspace);
const parseUnifiedDiffMock = vi.mocked(parseUnifiedDiff);
const removeTaskWorkspaceMock = vi.mocked(removeTaskWorkspace);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);
const saveTaskWorkspaceMock = vi.mocked(saveTaskWorkspace);
const setSvnPropertyMock = vi.mocked(setSvnProperty);

beforeEach(() => {
  createApplyPatchTaskMock.mockReset();
  createMergeTaskMock.mockReset();
  createRepositoryFileTaskMock.mockReset();
  createRepositoryListTaskMock.mockReset();
  createRevertRevisionTaskMock.mockReset();
  createRevisionDiffTaskMock.mockReset();
  createSvnBatchOperationTaskMock.mockReset();
  createSvnOperationTaskMock.mockReset();
  detectSvnMock.mockReset();
  getFileContentDiffMock.mockReset();
  getFileDiffMock.mockReset();
  getRepositoryFileBlameMock.mockReset();
  getRepositoryFileLogMock.mockReset();
  getRepositoryFilePropertiesMock.mockReset();
  getSvnBlameMock.mockReset();
  getSvnLogMock.mockReset();
  getSvnPropertiesMock.mockReset();
  ignoreWorkspacePathMock.mockReset();
  getTaskWorkspacesMock.mockReset();
  listWorkspaceFilesMock.mockReset();
  openGeneratedFileLocationMock.mockReset();
  openWorkspaceMock.mockReset();
  parseUnifiedDiffMock.mockReset();
  removeTaskWorkspaceMock.mockReset();
  scanWorkspaceStatusMock.mockReset();
  saveTaskWorkspaceMock.mockReset();
  setSvnPropertyMock.mockReset();
  window.localStorage.clear();
  appSettingsStore.load();
  svnStore.setExecutableInput("");
  workspaceStore.clearWorkspaceDraft();
  workspaceStore.setCommitMessage("");
  workspaceStore.setSvnLogFileOnly(false);
  workspaceStore.clearRepositoryFileLog();
  workspaceStore.clearRepositoryFileBlame();
  workspaceStore.clearRepositoryFileProperties();
  workspaceStore.setSvnLogFilter("svnLogAuthorFilter", "");
  workspaceStore.setSvnLogFilter("svnLogKeywordFilter", "");
  workspaceStore.setSvnLogFilter("svnLogDateFromFilter", "");
  workspaceStore.setSvnLogFilter("svnLogDateToFilter", "");
  workspaceStore.setSvnLogLimit(50);
  workspaceStore.markSvnOperationTask(null, null, null);
  getFileDiffMock.mockResolvedValue({
    path: "src/main.ts",
    text: "",
    binary: false,
    empty: true,
  });
  getFileContentDiffMock.mockResolvedValue({
    path: "src/main.ts",
    original_text: "",
    modified_text: "",
    language: "text",
    binary: false,
    too_large: false,
    max_bytes: 1024,
  });
  parseUnifiedDiffMock.mockResolvedValue({ files: [] });
  listWorkspaceFilesMock.mockResolvedValue(makeFileTree("C:/repo/wc"));
  openGeneratedFileLocationMock.mockResolvedValue({ target_path: "C:/app/patches/diff.patch" });
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

  it("exports non-truncated revision diff patches and opens generated files for truncated results", async () => {
    const createObjectURL = vi
      .spyOn(window.URL, "createObjectURL")
      .mockReturnValue("blob:novasvn-diff");
    const revokeObjectURL = vi.spyOn(window.URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.fn();
    const createElement = vi.spyOn(window.document, "createElement");
    createElement.mockImplementation(((tagName: string) => {
      const element = document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
      if (tagName.toLowerCase() === "a") {
        Object.defineProperty(element, "click", {
          configurable: true,
          value: click,
        });
      }
      return element;
    }) as typeof document.createElement);

    workspaceStore.applyRevisionDiffResult(
      makeRevisionDiffResult({
        diff_text: "Index: src/main.ts\n",
        target: "branches/feature",
      }),
    );

    await workspaceStore.exportRevisionDiffPatch();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:novasvn-diff");

    createObjectURL.mockClear();
    click.mockClear();
    workspaceStore.applyRevisionDiffResult(makeRevisionDiffResult({ diff_text: "" }));
    await workspaceStore.exportRevisionDiffPatch();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    workspaceStore.applyRevisionDiffResult(
      makeRevisionDiffResult({
        diff_text: "Index: src/large.ts\n",
        truncated: true,
        patch_file_path: "C:/app/patches/large.patch",
      }),
    );
    await workspaceStore.exportRevisionDiffPatch();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(openGeneratedFileLocationMock).toHaveBeenCalledWith({
      path: "C:/app/patches/large.patch",
    });

    workspaceStore.applyRevisionDiffResult(
      makeRevisionDiffResult({
        diff_text: "Index: src/missing-output.ts\n",
        truncated: true,
        patch_file_path: null,
      }),
    );
    await workspaceStore.exportRevisionDiffPatch();
    expect(get(workspaceStore).revisionDiffError).toBe(
      "Revision diff 预览已截断，但完整 Patch 文件位置不可用",
    );

    createElement.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
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
  it("saves external tool and branch pool settings and validates invalid paths", () => {
    appSettingsStore.setField("externalDiffTool", "code");
    appSettingsStore.setField("externalMergeTool", "C:\\Tools\\merge.exe");
    appSettingsStore.setField("branchPoolBasePath", "~/NovaSVN/branches");

    appSettingsStore.load();

    expect(get(appSettingsStore)).toMatchObject({
      externalDiffTool: "code",
      externalMergeTool: "C:\\Tools\\merge.exe",
      branchPoolBasePath: "~/NovaSVN/branches",
      validationErrors: {
        externalDiffTool: null,
        externalMergeTool: null,
        branchPoolBasePath: null,
      },
    });

    appSettingsStore.setField("externalDiffTool", "tools\\diff.exe");
    appSettingsStore.setField("externalMergeTool", "merge\n.exe");
    appSettingsStore.setField("branchPoolBasePath", "relative\\branches");

    expect(get(appSettingsStore).validationErrors).toMatchObject({
      externalDiffTool: "外部 Diff 工具需要是命令名、绝对路径或 ~/ 开头路径",
      externalMergeTool: "外部 Merge 工具不能包含控制字符",
      branchPoolBasePath: "工作副本池路径需要是绝对路径或 ~/ 开头路径",
    });
  });
});

describe("workspaceStore svn properties", () => {
  it("reports a workspace error when saving properties without an open workspace", async () => {
    workspaceStore.setPropertyEditForm("name", "svn:ignore");
    workspaceStore.setPropertyEditForm("value", "dist");

    await workspaceStore.saveSvnProperty();

    expect(setSvnPropertyMock).not.toHaveBeenCalled();
    expect(get(workspaceStore).svnPropertiesError).toMatchObject({
      code: "WORKSPACE_REQUIRED",
      message: "请先打开 SVN 工作副本",
      recoverable: true,
    });
  });

  it("stores the parent ignore scope and edit value after Ignore succeeds", async () => {
    openWorkspaceMock.mockResolvedValueOnce(makeWorkspace());
    scanWorkspaceStatusMock.mockResolvedValue(makeStatus([]));
    ignoreWorkspacePathMock.mockResolvedValueOnce(
      makeSvnProperties({
        target: "notes",
        properties: [{ name: "svn:ignore", value: "existing.tmp\nnew.tmp" }],
      }),
    );

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    const result = await workspaceStore.ignorePath("notes/new.tmp", "C:/svn/svn.exe");

    expect(ignoreWorkspacePathMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      file_path: "notes/new.tmp",
      svn_executable: "C:/svn/svn.exe",
    });
    expect(result?.target).toBe("notes");
    expect(get(workspaceStore)).toMatchObject({
      svnProperties: { target: "notes" },
      propertyEditForm: {
        name: "svn:ignore",
        value: "existing.tmp\nnew.tmp",
      },
      svnPropertiesLoading: false,
      svnPropertiesError: null,
    });
  });

  it("clears loaded properties when the selected file changes", async () => {
    const workspace = makeWorkspace();
    const status = makeStatus([
      makeFile({ path: "src/main.ts", content_digest: "main-digest" }),
      makeFile({ path: "src/other.ts", content_digest: "other-digest" }),
    ]);
    openWorkspaceMock.mockResolvedValueOnce(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(status);
    getSvnPropertiesMock.mockResolvedValueOnce(
      makeSvnProperties({
        target: "src/main.ts",
        properties: [{ name: "svn:ignore", value: "dist" }],
      }),
    );

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    await workspaceStore.refreshSvnProperties();
    workspaceStore.setPropertyEditForm("name", "svn:ignore");
    workspaceStore.setPropertyEditForm("value", "build");

    expect(get(workspaceStore).svnProperties?.target).toBe("src/main.ts");

    await workspaceStore.selectFile("src/other.ts");

    expect(get(workspaceStore).selectedFilePath).toBe("src/other.ts");
    expect(get(workspaceStore).svnProperties).toBeNull();
    expect(get(workspaceStore).propertyEditForm).toEqual({ name: "", value: "" });
  });
});

describe("workspaceStore safety warnings", () => {
  it("selects versioned changes without persisting commit targets", async () => {
    const workspace = makeWorkspace();
    const status = makeStatus([
      makeFile({
        path: "src/main.ts",
        status: "modified",
        content_digest: "main-digest",
      }),
      makeFile({
        path: "notes/new.txt",
        status: "unversioned",
        content_digest: "new-digest",
      }),
      makeFile({
        path: "src/conflict.ts",
        status: "conflicted",
        content_digest: "conflict-digest",
      }),
    ]);

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(status);

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();

    expect(get(workspaceStore).commitFiles.map((file) => file.path)).toEqual(["src/main.ts"]);

    workspaceStore.clearCommitFiles();
    workspaceStore.selectCommitFile("notes/new.txt");
    expect(get(workspaceStore).commitFiles).toEqual([]);

    workspaceStore.selectCommitFiles([
      "src/main.ts",
      "notes/new.txt",
      "src/conflict.ts",
    ]);
    expect(get(workspaceStore).commitFiles.map((file) => file.path)).toEqual(["src/main.ts"]);
    workspaceStore.unselectCommitFiles(["src/main.ts", "notes/new.txt"]);
    expect(get(workspaceStore).commitFiles).toEqual([]);

    workspaceStore.selectAllCommitFiles();
    expect(get(workspaceStore).commitFiles.map((file) => file.path)).toEqual(["src/main.ts"]);
    expect(workspaceStore.exportTaskWorkspaceDraft()).not.toHaveProperty("commitFiles");
  });

  it("returns the refreshed status for callers that need the latest counts", async () => {
    const workspace = makeWorkspace();
    const initialStatus = makeStatus([
      makeFile({
        path: "src/main.ts",
        content_digest: "main-digest",
      }),
    ]);
    const conflictedStatus = makeStatus([
      makeFile({
        path: "src/main.ts",
        status: "conflicted",
        abnormal: true,
        conflict_kind: "text",
        content_digest: "conflict-digest",
      }),
    ]);

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce(conflictedStatus);

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();

    const refreshedStatus = await workspaceStore.refreshStatus();

    expect(refreshedStatus).toBe(conflictedStatus);
    expect(refreshedStatus?.conflicted).toBe(1);
    expect(get(workspaceStore).status).toBe(conflictedStatus);
  });

  it("drops confirmed warnings when selected commit content changes", async () => {
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
    workspaceStore.selectCommitFile("build/output.tmp");
    workspaceStore.confirmSafetyWarnings();

    expect(get(workspaceStore).safetyCheck.confirmedWarningIds).toHaveLength(1);

    await workspaceStore.refreshStatus();

    const state = get(workspaceStore);
    expect(state.commitFiles).toEqual([
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

  it("keeps a partial-status safety info until all status pages are loaded", async () => {
    const workspace = makeWorkspace();
    const firstPage = makeStatus(
      [
        makeFile({
          path: "src/a.ts",
          content_digest: "digest-a",
        }),
      ],
      { total: 3, returned: 1, limit: 1 },
    );
    const secondPage = makeStatus(
      [
        makeFile({
          path: "src/b.ts",
          content_digest: "digest-b",
        }),
        makeFile({
          path: "src/c.ts",
          content_digest: "digest-c",
        }),
      ],
      { total: 3, returned: 2, offset: 1, limit: 2 },
    );

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();

    expect(get(workspaceStore).safetyCheck.infos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "info:status-partial:1:3",
          title: "状态列表尚未全部加载",
        }),
      ]),
    );

    await workspaceStore.loadMoreStatus();

    const state = get(workspaceStore);
    expect(state.status?.files.map((file) => file.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    expect(state.safetyCheck.infos.map((item) => item.id)).not.toContain(
      "info:status-partial:1:3",
    );
  });

  it("warns about large binary files and generated project directories", async () => {
    const workspace = makeWorkspace();
    const status = makeStatus([
      makeFile({
        path: "media/intro.mov",
        file_size: 30 * 1024 * 1024,
        content_digest: "movie-digest",
      }),
      makeFile({
        path: "dist/app.js",
        content_digest: "dist-digest",
      }),
      makeFile({
        path: "Temp/build.tmp",
        content_digest: "temp-digest",
      }),
      makeFile({
        path: "Logs/Editor.log",
        content_digest: "log-digest",
      }),
      makeFile({
        path: "obj/Debug/generated.cs",
        content_digest: "obj-digest",
      }),
    ]);

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(status);

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();

    const warnings = get(workspaceStore).safetyCheck.warnings;
    expect(warnings.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "大文件变更",
        "疑似大型二进制文件",
        "疑似临时或生成文件",
      ]),
    );
    const generatedWarningPaths = warnings
      .filter((item) => item.title === "疑似临时或生成文件")
      .map((item) => item.filePath);
    expect(generatedWarningPaths).toEqual(
      expect.arrayContaining([
        "dist/app.js",
        "Temp/build.tmp",
        "Logs/Editor.log",
        "obj/Debug/generated.cs",
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

describe("workspaceStore svn blame", () => {
  it("loads blame for the selected file and clears it after selection changes", async () => {
    const workspace = makeWorkspace();
    const file = makeFile({ path: "src/main.ts", content_digest: "digest-main" });

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(makeStatus([file]));
    getSvnBlameMock.mockResolvedValue({
      target: "src/main.ts",
      total_lines: 2,
      truncated: false,
      lines: [
        {
          line_number: 1,
          revision: "7",
          author: "alice",
          date: "2026-07-03T00:00:00Z",
          content: "const value = 1;",
        },
        {
          line_number: 2,
          revision: "8",
          author: "bob",
          date: "2026-07-04T00:00:00Z",
          content: "export default value;",
        },
      ],
    });

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    await workspaceStore.selectFile("src/main.ts");
    await workspaceStore.refreshSvnBlame("C:/svn/svn.exe");

    expect(getSvnBlameMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      file_path: "src/main.ts",
      svn_executable: "C:/svn/svn.exe",
      max_lines: 5000,
    });
    expect(get(workspaceStore).svnBlame?.lines[0]).toMatchObject({
      revision: "7",
      author: "alice",
      content: "const value = 1;",
    });

    workspaceStore.selectPathOnly("src/other.ts");

    expect(get(workspaceStore).svnBlame).toBeNull();
    expect(get(workspaceStore).svnBlameError).toBeNull();
  });

  it("requires a selected file before loading blame", async () => {
    const workspace = makeWorkspace();

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(makeStatus([]));

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    await workspaceStore.refreshSvnBlame();

    expect(getSvnBlameMock).not.toHaveBeenCalled();
    expect(get(workspaceStore).svnBlameError).toMatchObject({
      code: "SVN_BLAME_FILE_REQUIRED",
      message: "请先选择要查看 Blame 的文件",
      recoverable: true,
    });
  });
});

describe("workspaceStore svn log", () => {
  it("selects startup target files inside the workspace even when status has no change entry", async () => {
    const workspace = makeWorkspace();

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(makeStatus([]));

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();

    const selected = await workspaceStore.selectStartupTargetFile("C:/repo/wc/src/main.ts");

    expect(selected).toBe(true);
    expect(get(workspaceStore).selectedFilePath).toBe("src/main.ts");
    expect(getFileDiffMock).not.toHaveBeenCalled();
    expect(getFileContentDiffMock).not.toHaveBeenCalled();
    expect(parseUnifiedDiffMock).not.toHaveBeenCalled();
  });

  it("keeps Unix backslashes distinct when resolving a startup target", async () => {
    const workspace = {
      ...makeWorkspace(),
      local_path: "/repo/wc",
      working_copy_root: "/repo/wc",
    };
    const status = makeStatus([
      makeFile({ path: "literal\\name.txt", content_digest: "flat-digest" }),
      makeFile({ path: "literal/name.txt", content_digest: "nested-digest" }),
    ]);

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(status);
    workspaceStore.setPathInput("/repo/wc");
    await workspaceStore.openPath();

    const selected = await workspaceStore.selectStartupTargetFile(
      "/repo/wc/literal\\name.txt",
    );

    expect(selected).toBe(true);
    expect(get(workspaceStore).selectedFilePath).toBe("literal\\name.txt");
  });

  it("requires a selected file before loading file-only history", async () => {
    const workspace = makeWorkspace();

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(makeStatus([]));

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    workspaceStore.setSvnLogFileOnly(true);

    await workspaceStore.refreshSvnLog();

    expect(getSvnLogMock).not.toHaveBeenCalled();
    expect(get(workspaceStore).svnLogError).toMatchObject({
      code: "SVN_LOG_FILE_REQUIRED",
      message: "请先选择要查看历史的文件",
      recoverable: true,
    });
  });

  it("clears the previous log snapshot when file history scope changes", async () => {
    openWorkspaceMock.mockResolvedValue(makeWorkspace());
    scanWorkspaceStatusMock.mockResolvedValue(makeStatus([]));
    getSvnLogMock.mockResolvedValue(makeSvnLog([makeSvnLogEntry({ revision: "12" })]));

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    await workspaceStore.refreshSvnLog();
    expect(get(workspaceStore).svnLog?.entries).toHaveLength(1);

    workspaceStore.setSvnLogFileOnly(true);
    expect(get(workspaceStore).svnLog).toBeNull();
    expect(get(workspaceStore).svnLogError).toBeNull();
  });

  it("merges additional log pages without duplicating revisions", async () => {
    const workspace = makeWorkspace();

    openWorkspaceMock.mockResolvedValue(workspace);
    scanWorkspaceStatusMock.mockResolvedValue(makeStatus([]));
    getSvnLogMock
      .mockResolvedValueOnce(makeSvnLog([
        makeSvnLogEntry({ revision: "12", message: "first page" }),
        makeSvnLogEntry({ revision: "11", message: "already loaded" }),
      ], { has_more: true, next_start_revision: "11" }))
      .mockResolvedValueOnce(makeSvnLog([
        makeSvnLogEntry({ revision: "11", message: "duplicate" }),
        makeSvnLogEntry({ revision: "10", message: "next page" }),
      ], { has_more: false, next_start_revision: null }));

    workspaceStore.setPathInput("C:/repo/wc");
    await workspaceStore.openPath();
    workspaceStore.setSvnLogFilter("svnLogAuthorFilter", "alice");
    workspaceStore.setSvnLogFilter("svnLogKeywordFilter", "feature");
    await workspaceStore.refreshSvnLog();
    await workspaceStore.loadMoreSvnLog();

    expect(getSvnLogMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      start_revision: "11",
    }));
    expect(get(workspaceStore).svnLog?.entries.map((entry) => entry.revision)).toEqual([
      "12",
      "11",
      "10",
    ]);
    expect(get(workspaceStore).svnLog?.has_more).toBe(false);
    expect(get(workspaceStore)).toMatchObject({
      svnLogAuthorFilter: "alice",
      svnLogKeywordFilter: "feature",
    });
  });
});

describe("taskStore repository list tasks", () => {
  it("forwards an explicit repository revision", async () => {
    createRepositoryListTaskMock.mockResolvedValue(makeTask({ task_id: "repository-r10" }));

    const task = await taskStore.createRepositoryList({
      url: "https://example.com/svn/trunk/src",
      revision: "10",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("repository-r10");
    expect(createRepositoryListTaskMock).toHaveBeenCalledWith({
      url: "https://example.com/svn/trunk/src",
      revision: "10",
      svn_executable: "C:/svn/svn.exe",
    });
  });

  it("creates repository file tasks and clears their workspace state", async () => {
    createRepositoryFileTaskMock.mockResolvedValue(makeTask({ task_id: "repository-file-r8" }));

    const task = await taskStore.createRepositoryFile({
      url: "https://example.com/svn/trunk/README.md",
      revision: "8",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("repository-file-r8");
    expect(createRepositoryFileTaskMock).toHaveBeenCalledWith({
      url: "https://example.com/svn/trunk/README.md",
      revision: "8",
      svn_executable: "C:/svn/svn.exe",
    });

    workspaceStore.markRepositoryFileTask("repository-file-r8");
    expect(get(workspaceStore)).toMatchObject({
      pendingRepositoryFileTaskId: "repository-file-r8",
      repositoryFileLoading: true,
      repositoryFileError: null,
    });
    workspaceStore.completeRepositoryFile({
      url: "https://example.com/svn/trunk/README.md",
      revision: "8",
      file_path: "C:/data/README.md",
      file_name: "README.md",
      bytes: 7,
    });
    expect(get(workspaceStore)).toMatchObject({
      pendingRepositoryFileTaskId: null,
      repositoryFileLoading: false,
      repositoryFileError: null,
    });

    workspaceStore.markRepositoryFileTask("repository-file-failed");
    workspaceStore.failRepositoryFile("下载失败");
    expect(get(workspaceStore)).toMatchObject({
      pendingRepositoryFileTaskId: null,
      repositoryFileLoading: false,
      repositoryFileError: "下载失败",
    });
  });

  it("keeps the applied repository revision in navigation state", () => {
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk/src",
      revision: "8",
      entries: [],
    });

    expect(get(workspaceStore)).toMatchObject({
      repositoryUrlInput: "https://example.com/svn/trunk/src",
      repositoryRevisionInput: "8",
      repositoryCurrentUrl: "https://example.com/svn/trunk/src",
    });
    workspaceStore.setRepositoryRevisionInput("");
    expect(get(workspaceStore).repositoryRevisionInput).toBe("");
  });
});

describe("workspaceStore repository file log", () => {
  it("loads the selected historical file and merges later pages without duplicates", async () => {
    const target = "https://example.com/svn/trunk/README.md";
    getRepositoryFileLogMock
      .mockResolvedValueOnce(
        makeSvnLog(
          [
            makeSvnLogEntry({ revision: "10", message: "latest" }),
            makeSvnLogEntry({ revision: "9", message: "already loaded" }),
          ],
          { target, has_more: true, next_start_revision: "9" },
        ),
      )
      .mockResolvedValueOnce(
        makeSvnLog(
          [
            makeSvnLogEntry({ revision: "9", message: "duplicate" }),
            makeSvnLogEntry({ revision: "8", message: "older" }),
          ],
          { target, has_more: false, next_start_revision: null },
        ),
      );

    await workspaceStore.loadRepositoryFileLog({
      url: target,
      revision: "10",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(getRepositoryFileLogMock).toHaveBeenNthCalledWith(1, {
      url: target,
      revision: "10",
      svn_executable: "C:/svn/svn.exe",
      limit: 50,
    });
    expect(get(workspaceStore)).toMatchObject({
      repositoryFileLogRevision: "10",
      repositoryFileLogLoading: false,
      repositoryFileLogError: null,
    });

    await workspaceStore.loadMoreRepositoryFileLog("C:/svn/svn.exe");

    expect(getRepositoryFileLogMock).toHaveBeenNthCalledWith(2, {
      url: target,
      revision: "10",
      svn_executable: "C:/svn/svn.exe",
      limit: 50,
      start_revision: "9",
    });
    expect(
      get(workspaceStore).repositoryFileLog?.entries.map((entry) => entry.revision),
    ).toEqual(["10", "9", "8"]);
    expect(get(workspaceStore).repositoryFileLog?.has_more).toBe(false);
  });

  it("ignores a file log response after the panel is closed", async () => {
    const pending = deferred<SvnLog>();
    getRepositoryFileLogMock.mockReturnValue(pending.promise);

    const loading = workspaceStore.loadRepositoryFileLog({
      url: "https://example.com/svn/trunk/slow.txt",
      revision: "7",
    });
    workspaceStore.clearRepositoryFileLog();
    pending.resolve(
      makeSvnLog([makeSvnLogEntry({ revision: "7" })], {
        target: "https://example.com/svn/trunk/slow.txt",
      }),
    );
    await loading;

    expect(get(workspaceStore)).toMatchObject({
      repositoryFileLogRevision: null,
      repositoryFileLog: null,
      repositoryFileLogLoading: false,
      repositoryFileLogError: null,
    });
  });
});

describe("workspaceStore repository file blame", () => {
  it("loads the selected file at the current repository revision", async () => {
    const target = "https://example.com/svn/trunk/README.md";
    getRepositoryFileBlameMock.mockResolvedValue({
      target,
      total_lines: 2,
      truncated: false,
      lines: [
        {
          line_number: 1,
          revision: "8",
          author: "alice",
          date: "2026-07-10T00:00:00Z",
          content: "first line",
        },
        {
          line_number: 2,
          revision: "10",
          author: "bob",
          date: "2026-07-11T00:00:00Z",
          content: "second line",
        },
      ],
    });

    await workspaceStore.loadRepositoryFileBlame({
      url: target,
      revision: "10",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(getRepositoryFileBlameMock).toHaveBeenCalledWith({
      url: target,
      revision: "10",
      svn_executable: "C:/svn/svn.exe",
      max_lines: 5000,
    });
    expect(get(workspaceStore)).toMatchObject({
      repositoryFileBlameRevision: "10",
      repositoryFileBlameLoading: false,
      repositoryFileBlameError: null,
    });
    expect(get(workspaceStore).repositoryFileBlame?.lines[1].content).toBe("second line");
    expect(get(workspaceStore).repositoryFileLog).toBeNull();
  });

  it("ignores a stale Blame response after switching to file Log", async () => {
    const blamePending = deferred<SvnBlame>();
    getRepositoryFileBlameMock.mockReturnValue(blamePending.promise);
    getRepositoryFileLogMock.mockResolvedValue(
      makeSvnLog([makeSvnLogEntry({ revision: "10", message: "log wins" })], {
        target: "https://example.com/svn/trunk/README.md",
      }),
    );

    const blameLoading = workspaceStore.loadRepositoryFileBlame({
      url: "https://example.com/svn/trunk/README.md",
      revision: "10",
    });
    await workspaceStore.loadRepositoryFileLog({
      url: "https://example.com/svn/trunk/README.md",
      revision: "10",
    });
    blamePending.resolve({
      target: "https://example.com/svn/trunk/README.md",
      total_lines: 1,
      truncated: false,
      lines: [
        {
          line_number: 1,
          revision: "10",
          author: "dev",
          date: "2026-07-11T00:00:00Z",
          content: "stale",
        },
      ],
    });
    await blameLoading;

    expect(get(workspaceStore).repositoryFileBlame).toBeNull();
    expect(get(workspaceStore).repositoryFileLog?.entries[0].message).toBe("log wins");
  });
});

describe("workspaceStore repository file properties", () => {
  it("loads read-only properties at the current repository revision", async () => {
    const target = "https://example.com/svn/trunk/README.md";
    getRepositoryFilePropertiesMock.mockResolvedValue({
      target,
      properties: [
        { name: "custom:note", value: "line one\nline two" },
        { name: "svn:mime-type", value: "text/plain" },
      ],
      externals: null,
    });

    await workspaceStore.loadRepositoryFileProperties({
      url: target,
      revision: "10",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(getRepositoryFilePropertiesMock).toHaveBeenCalledWith({
      url: target,
      revision: "10",
      svn_executable: "C:/svn/svn.exe",
    });
    expect(get(workspaceStore)).toMatchObject({
      repositoryFilePropertiesRevision: "10",
      repositoryFilePropertiesLoading: false,
      repositoryFilePropertiesError: null,
      repositoryFileLog: null,
      repositoryFileBlame: null,
    });
    expect(get(workspaceStore).repositoryFileProperties?.properties[0].value).toBe(
      "line one\nline two",
    );
  });

  it("ignores a stale Properties response after switching to Blame", async () => {
    const propertiesPending = deferred<SvnProperties>();
    getRepositoryFilePropertiesMock.mockReturnValue(propertiesPending.promise);
    getRepositoryFileBlameMock.mockResolvedValue({
      target: "https://example.com/svn/trunk/README.md",
      total_lines: 1,
      truncated: false,
      lines: [
        {
          line_number: 1,
          revision: "10",
          author: "dev",
          date: "2026-07-11T00:00:00Z",
          content: "blame wins",
        },
      ],
    });

    const propertiesLoading = workspaceStore.loadRepositoryFileProperties({
      url: "https://example.com/svn/trunk/README.md",
      revision: "10",
    });
    await workspaceStore.loadRepositoryFileBlame({
      url: "https://example.com/svn/trunk/README.md",
      revision: "10",
    });
    propertiesPending.resolve({
      target: "https://example.com/svn/trunk/README.md",
      properties: [{ name: "stale", value: "stale" }],
      externals: null,
    });
    await propertiesLoading;

    expect(get(workspaceStore).repositoryFileProperties).toBeNull();
    expect(get(workspaceStore).repositoryFileBlame?.lines[0].content).toBe("blame wins");
  });
});

describe("taskStore merge tasks", () => {
  it("creates merge tasks with revision range and dry-run options", async () => {
    createMergeTaskMock.mockResolvedValue(makeTask({ task_id: "merge-1" }));

    const task = await taskStore.createMerge({
      workingCopyRoot: "C:/repo/wc",
      sourceUrl: "https://example.com/svn/branches/feature",
      startRevision: "10",
      endRevision: "12",
      dryRun: true,
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("merge-1");
    expect(createMergeTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      source_url: "https://example.com/svn/branches/feature",
      start_revision: "10",
      end_revision: "12",
      dry_run: true,
      svn_executable: "C:/svn/svn.exe",
    });
  });
});

describe("taskStore revision diff tasks", () => {
  it("forwards a path-scoped repository URL target", async () => {
    createRevisionDiffTaskMock.mockResolvedValue(makeTask({ task_id: "revision-diff-1" }));

    const task = await taskStore.createRevisionDiff({
      mode: "revisions",
      workingCopyRoot: "C:/repo/wc",
      targetUrl: "https://example.com/svn/trunk/src/main.ts",
      leftRevision: "41",
      rightRevision: "42",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("revision-diff-1");
    expect(createRevisionDiffTaskMock).toHaveBeenCalledWith({
      mode: "revisions",
      working_copy_root: "C:/repo/wc",
      file_path: undefined,
      target_url: "https://example.com/svn/trunk/src/main.ts",
      left_revision: "41",
      right_revision: "42",
      left_url: undefined,
      right_url: undefined,
      svn_executable: "C:/svn/svn.exe",
    });
  });

  it("forwards a Revert-to-Revision task", async () => {
    createRevertRevisionTaskMock.mockResolvedValue(makeTask({ task_id: "revert-revision-1" }));

    const task = await taskStore.createRevertRevision({
      workingCopyRoot: "C:/repo/wc",
      targetRevision: "10",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("revert-revision-1");
    expect(createRevertRevisionTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      target_revision: "10",
      svn_executable: "C:/svn/svn.exe",
    });
  });

  it("forwards a working-copy file target", async () => {
    createRevisionDiffTaskMock.mockResolvedValue(makeTask({ task_id: "revision-diff-file-1" }));

    const task = await taskStore.createRevisionDiff({
      mode: "working_copy_to_revision",
      workingCopyRoot: "C:/repo/wc",
      filePath: "src/main.ts",
      rightRevision: "10",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("revision-diff-file-1");
    expect(createRevisionDiffTaskMock).toHaveBeenCalledWith({
      mode: "working_copy_to_revision",
      working_copy_root: "C:/repo/wc",
      file_path: "src/main.ts",
      target_url: undefined,
      left_revision: undefined,
      right_revision: "10",
      left_url: undefined,
      right_url: undefined,
      svn_executable: "C:/svn/svn.exe",
    });
  });
});

describe("taskStore SVN operation tasks", () => {
  it("maps a working-copy delete request to delete_path", async () => {
    createSvnOperationTaskMock.mockResolvedValue(makeTask({ task_id: "delete-1" }));

    const task = await taskStore.createSvnOperation({
      workingCopyRoot: "C:/repo/wc",
      kind: "delete_path",
      filePath: "src/legacy",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("delete-1");
    expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      kind: "delete_path",
      file_path: "src/legacy",
      svn_executable: "C:/svn/svn.exe",
    });
  });

  it("maps multiple working-copy paths to one batch operation task", async () => {
    createSvnBatchOperationTaskMock.mockResolvedValue(makeTask({ task_id: "batch-move-1" }));

    const task = await taskStore.createSvnBatchOperation({
      workingCopyRoot: "C:/repo/wc",
      kind: "move_paths",
      filePaths: ["src/a.ts", "src/b.ts"],
      targetPath: "archive",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("batch-move-1");
    expect(createSvnBatchOperationTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      kind: "move_paths",
      file_paths: ["src/a.ts", "src/b.ts"],
      target_path: "archive",
      svn_executable: "C:/svn/svn.exe",
    });
  });

  it("maps working-copy Move source and target paths", async () => {
    createSvnOperationTaskMock.mockResolvedValue(makeTask({ task_id: "move-1" }));

    const task = await taskStore.createSvnOperation({
      workingCopyRoot: "C:/repo/wc",
      kind: "move_path",
      filePath: "src/old.ts",
      targetPath: "src/new.ts",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("move-1");
    expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      kind: "move_path",
      file_path: "src/old.ts",
      target_path: "src/new.ts",
      svn_executable: "C:/svn/svn.exe",
    });
  });

  it("maps working-copy Copy source and target paths", async () => {
    createSvnOperationTaskMock.mockResolvedValue(makeTask({ task_id: "copy-1" }));

    const task = await taskStore.createSvnOperation({
      workingCopyRoot: "C:/repo/wc",
      kind: "copy_path",
      filePath: "src/original.ts",
      targetPath: "src/copied.ts",
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("copy-1");
    expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      kind: "copy_path",
      file_path: "src/original.ts",
      target_path: "src/copied.ts",
      svn_executable: "C:/svn/svn.exe",
    });
  });

  it("persists source list and inspector visibility", () => {
    appSettingsStore.setField("showSourceList", false);
    appSettingsStore.setField("showInspector", false);

    appSettingsStore.load();

    expect(get(appSettingsStore)).toMatchObject({
      showSourceList: false,
      showInspector: false,
    });
  });

  it("persists the selected theme mode", () => {
    appSettingsStore.setField("themeMode", "dark");

    appSettingsStore.load();

    expect(get(appSettingsStore).themeMode).toBe("dark");
  });
});

describe("revision path targets", () => {
  it("maps SVN changed paths to encoded repository URLs", () => {
    expect(repositoryPathUrl("https://example.com/svn/", "/trunk/中文 #1.txt")).toBe(
      "https://example.com/svn/trunk/%E4%B8%AD%E6%96%87%20%231.txt",
    );
    expect(repositoryPathUrl("https://example.com/svn", "/")).toBe(
      "https://example.com/svn",
    );
    expect(repositoryPathUrl("https://example.com/svn", "../secret.txt")).toBeNull();
    expect(repositoryPathUrl("https://example.com/svn", "/trunk/../secret.txt")).toBeNull();
  });

  it("prepares a path-scoped revision diff and clears it for revision selection", () => {
    expect(workspaceStore.prepareRevisionDiffFromLog("42", "/trunk/src/main.ts")).toBe(true);
    expect(get(workspaceStore).revisionDiffForm).toMatchObject({
      mode: "revisions",
      targetUrl: "https://example.com/svn/trunk/src/main.ts",
      leftRevision: "41",
      rightRevision: "42",
    });

    expect(workspaceStore.prepareRevisionDiffFromLog("40")).toBe(true);
    expect(get(workspaceStore).revisionDiffForm.targetUrl).toBe("");

    expect(workspaceStore.prepareRevisionDiffFromLog("1", "/trunk/first.txt")).toBe(true);
    expect(get(workspaceStore).revisionDiffForm).toMatchObject({
      leftRevision: "0",
      rightRevision: "1",
      targetUrl: "https://example.com/svn/trunk/first.txt",
    });
  });

  it("prepares and validates a two-revision comparison range", () => {
    expect(workspaceStore.prepareRevisionDiffRange("10", "12")).toBe(true);
    expect(get(workspaceStore)).toMatchObject({
      revisionDiffForm: {
        mode: "revisions",
        targetUrl: "",
        leftRevision: "10",
        rightRevision: "12",
      },
      revisionDiffError: null,
    });

    expect(workspaceStore.prepareRevisionDiffRange("10", "10")).toBe(false);
    expect(get(workspaceStore).revisionDiffError).toBe("请选择两个不同的 revision");

    expect(workspaceStore.prepareRevisionDiffRange("revision-10", "12")).toBe(false);
    expect(get(workspaceStore).revisionDiffError).toBe("请选择两个有效的数字 revision");
  });

  it("prepares and validates a working-copy file revision comparison", () => {
    expect(workspaceStore.prepareWorkingCopyFileRevisionDiff("src/main.ts", " 10 ")).toBe(true);
    expect(get(workspaceStore)).toMatchObject({
      revisionDiffForm: {
        mode: "working_copy_to_revision",
        filePath: "src/main.ts",
        targetUrl: "",
        leftRevision: "",
        rightRevision: "10",
      },
      revisionDiffError: null,
    });

    expect(workspaceStore.prepareWorkingCopyFileRevisionDiff("", "10")).toBe(false);
    expect(get(workspaceStore).revisionDiffError).toBe("请先选择一个有效的工作副本文件");
    expect(workspaceStore.prepareWorkingCopyFileRevisionDiff("src/main.ts", "HEAD")).toBe(false);
    expect(get(workspaceStore).revisionDiffError).toBe("请选择有效的数字 revision");
  });
});

describe("workspaceStore SVN operation state", () => {
  it("将 pending 任务与创建时工作副本根成对记录和清理", () => {
    workspaceStore.markSvnOperationTask("svn-1", "update", "C:/repo/original");

    expect(get(workspaceStore)).toMatchObject({
      pendingSvnOperationTaskId: "svn-1",
      pendingSvnOperationKind: "update",
      pendingSvnOperationWorkingCopyRoot: "C:/repo/original",
    });

    workspaceStore.markSvnOperationTask(null, "cleanup", "C:/repo/other");
    expect(get(workspaceStore)).toMatchObject({
      pendingSvnOperationTaskId: null,
      pendingSvnOperationKind: null,
      pendingSvnOperationWorkingCopyRoot: null,
    });
  });

  it("显式打开绑定根时不读取后来修改的路径输入", async () => {
    const workspace = makeWorkspace({ working_copy_root: "C:/repo/original" });
    openWorkspaceMock.mockResolvedValueOnce(workspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce(
      makeStatus([], { working_copy_root: "C:/repo/original" }),
    );
    workspaceStore.setPathInput("C:/repo/later-input");

    await workspaceStore.openPath("C:/svn/svn.exe", "C:/repo/original");

    expect(openWorkspaceMock).toHaveBeenCalledWith({
      path: "C:/repo/original",
      svn_executable: "C:/svn/svn.exe",
    });
    expect(get(workspaceStore).current?.working_copy_root).toBe("C:/repo/original");
    expect(get(workspaceStore).pathInput).toBe("C:/repo/original");
  });

  it("打开或切换工作副本时保留运行中的 pending 操作", async () => {
    workspaceStore.markSvnOperationTask("svn-1", "update", "C:/repo/original");
    openWorkspaceMock.mockResolvedValueOnce(
      makeWorkspace({ working_copy_root: "C:/repo/other" }),
    );
    scanWorkspaceStatusMock.mockResolvedValueOnce(
      makeStatus([], { working_copy_root: "C:/repo/other" }),
    );
    listWorkspaceFilesMock.mockResolvedValueOnce(makeFileTree("C:/repo/other"));

    await workspaceStore.openPath(undefined, "C:/repo/other");

    expect(get(workspaceStore)).toMatchObject({
      pendingSvnOperationTaskId: "svn-1",
      pendingSvnOperationKind: "update",
      pendingSvnOperationWorkingCopyRoot: "C:/repo/original",
    });
  });

  it("任务从后端队列消失时清理 pending 并给出可恢复错误", () => {
    workspaceStore.markSvnOperationTask("missing-task", "cleanup", "C:/repo/wc");

    workspaceStore.failSvnOperationTask("任务队列已重置");

    expect(get(workspaceStore)).toMatchObject({
      pendingSvnOperationTaskId: null,
      pendingSvnOperationKind: null,
      pendingSvnOperationWorkingCopyRoot: null,
      statusError: {
        code: "SVN_OPERATION_TASK_MISSING",
        message: "任务队列已重置",
        recoverable: true,
      },
    });
  });

  it("后发的打开请求优先，旧请求完成后不能覆盖当前工作副本", async () => {
    const firstOpen = deferred<WorkspaceSummary>();
    const secondOpen = deferred<WorkspaceSummary>();
    const secondWorkspace = makeWorkspace({
      working_copy_root: "C:/repo/second",
      local_path: "C:/repo/second",
    });
    const secondStatus = makeStatus([], { working_copy_root: "C:/repo/second" });
    openWorkspaceMock
      .mockReturnValueOnce(firstOpen.promise)
      .mockReturnValueOnce(secondOpen.promise);
    scanWorkspaceStatusMock.mockResolvedValueOnce(secondStatus);
    listWorkspaceFilesMock.mockResolvedValueOnce(makeFileTree("C:/repo/second"));

    const firstRequest = workspaceStore.openPath(undefined, "C:/repo/first");
    const secondRequest = workspaceStore.openPath(undefined, "C:/repo/second");
    secondOpen.resolve(secondWorkspace);

    expect(await secondRequest).toBe(secondWorkspace);

    firstOpen.resolve(
      makeWorkspace({
        working_copy_root: "C:/repo/first",
        local_path: "C:/repo/first",
      }),
    );

    expect(await firstRequest).toBeNull();
    expect(get(workspaceStore).current?.working_copy_root).toBe("C:/repo/second");
    expect(get(workspaceStore).status).toBe(secondStatus);
  });

  it("切换工作副本后丢弃旧状态扫描结果", async () => {
    const originalWorkspace = makeWorkspace({ working_copy_root: "C:/repo/original" });
    openWorkspaceMock.mockResolvedValueOnce(originalWorkspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce(
      makeStatus([], { working_copy_root: "C:/repo/original" }),
    );
    listWorkspaceFilesMock.mockResolvedValueOnce(makeFileTree("C:/repo/original"));
    await workspaceStore.openPath(undefined, "C:/repo/original");

    const staleScan = deferred<WorkingCopyStatus>();
    scanWorkspaceStatusMock.mockReturnValueOnce(staleScan.promise);
    const staleRefresh = workspaceStore.refreshStatus(undefined, "C:/repo/original");

    const nextWorkspace = makeWorkspace({ working_copy_root: "C:/repo/next" });
    const nextStatus = makeStatus([], { working_copy_root: "C:/repo/next" });
    openWorkspaceMock.mockResolvedValueOnce(nextWorkspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce(nextStatus);
    listWorkspaceFilesMock.mockResolvedValueOnce(makeFileTree("C:/repo/next"));
    await workspaceStore.openPath(undefined, "C:/repo/next");

    staleScan.resolve(
      makeStatus(
        [makeFile({ path: "stale.txt", content_digest: "stale" })],
        { working_copy_root: "C:/repo/original" },
      ),
    );

    expect(await staleRefresh).toBeNull();
    expect(get(workspaceStore).current?.working_copy_root).toBe("C:/repo/next");
    expect(get(workspaceStore).status).toBe(nextStatus);
  });

  it("切换工作副本后丢弃旧文件树结果", async () => {
    openWorkspaceMock.mockResolvedValueOnce(
      makeWorkspace({ working_copy_root: "C:/repo/original" }),
    );
    scanWorkspaceStatusMock.mockResolvedValueOnce(
      makeStatus([], { working_copy_root: "C:/repo/original" }),
    );
    listWorkspaceFilesMock.mockResolvedValueOnce(makeFileTree("C:/repo/original"));
    await workspaceStore.openPath(undefined, "C:/repo/original");

    const staleTree = deferred<WorkspaceFileTree>();
    listWorkspaceFilesMock.mockReturnValueOnce(staleTree.promise);
    const staleRefresh = workspaceStore.refreshFileTree(undefined, "C:/repo/original");

    openWorkspaceMock.mockResolvedValueOnce(
      makeWorkspace({ working_copy_root: "C:/repo/next" }),
    );
    scanWorkspaceStatusMock.mockResolvedValueOnce(
      makeStatus([], { working_copy_root: "C:/repo/next" }),
    );
    const nextTree = makeFileTree("C:/repo/next");
    listWorkspaceFilesMock.mockResolvedValueOnce(nextTree);
    await workspaceStore.openPath(undefined, "C:/repo/next");

    staleTree.resolve(makeFileTree("C:/repo/original", "stale.txt"));

    expect(await staleRefresh).toBeNull();
    expect(get(workspaceStore).fileTree).toBe(nextTree);
  });
});

describe("taskStore apply patch tasks", () => {
  it("binds a real patch task to the preflight digest", async () => {
    createApplyPatchTaskMock.mockResolvedValue(makeTask({ task_id: "patch-1" }));

    const task = await taskStore.createApplyPatch({
      workingCopyRoot: "C:/repo/wc",
      patchFilePath: "C:/patches/change.diff",
      dryRun: false,
      expectedPatchDigest: "a".repeat(64),
      svnExecutable: "C:/svn/svn.exe",
    });

    expect(task?.task_id).toBe("patch-1");
    expect(createApplyPatchTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      patch_file_path: "C:/patches/change.diff",
      dry_run: false,
      expected_patch_digest: "a".repeat(64),
      svn_executable: "C:/svn/svn.exe",
    });
  });
});

describe("workspaceStore apply patch state", () => {
  it("locks task creation synchronously to prevent duplicate apply requests", () => {
    workspaceStore.closeApplyPatchDialog();
    workspaceStore.openApplyPatchDialog("C:/patches/change.patch", "C:/repo/wc");

    expect(workspaceStore.beginApplyPatchTask(false)).toBe(true);
    expect(workspaceStore.beginApplyPatchTask(false)).toBe(false);
    expect(get(workspaceStore).applyPatchCreating).toBe(true);

    workspaceStore.failApplyPatchTask("test failure");
    expect(get(workspaceStore).applyPatchCreating).toBe(false);
    workspaceStore.closeApplyPatchDialog();
  });
});

describe("taskWorkspaceStore drafts", () => {
  it("restores task metadata without persisting commit target selection", async () => {
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
    workspaceStore.selectCommitFile("build/output.tmp");
    workspaceStore.setCommitMessage("提交任务 A");
    workspaceStore.markFileReviewed("src/main.ts");
    workspaceStore.confirmSafetyWarnings();
    taskWorkspaceStore.saveDraft(taskA, workspaceStore.exportTaskWorkspaceDraft());

    workspaceStore.unselectCommitFile("build/output.tmp");
    workspaceStore.selectCommitFile("src/main.ts");
    workspaceStore.setCommitMessage("提交任务 B");
    workspaceStore.markFileUnreviewed("src/main.ts");
    taskWorkspaceStore.saveDraft(taskB, workspaceStore.exportTaskWorkspaceDraft());

    workspaceStore.importTaskWorkspaceDraft(taskWorkspaceStore.loadDraft(taskA));
    expect(get(taskWorkspaceStore).activeTaskId).toBe("task-a");
    expect(get(workspaceStore)).toMatchObject({
      commitMessage: "提交任务 A",
      commitFiles: [],
      reviewedFiles: [
        {
          path: "src/main.ts",
          contentDigest: "main-digest",
        },
      ],
    });
    expect(get(workspaceStore).safetyCheck.confirmedWarningIds).toEqual([]);

    workspaceStore.importTaskWorkspaceDraft(taskWorkspaceStore.loadDraft(taskB));
    expect(get(taskWorkspaceStore).activeTaskId).toBe("task-b");
    expect(get(workspaceStore)).toMatchObject({
      commitMessage: "提交任务 B",
      commitFiles: [],
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
    workspaceStore.selectCommitFile("src/main.ts");
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
    ...workspace,
  };
}

function makeFileTree(
  workingCopyRoot: string,
  path = "src/main.ts",
): WorkspaceFileTree {
  return {
    working_copy_root: workingCopyRoot,
    total_files: 1,
    returned_files: 1,
    truncated: false,
    nodes: [
      {
        path,
        name: path,
        kind: "file",
        status: "normal",
        remote_status: null,
        remote_property_status: null,
        change_scope: "none",
        revision: "12",
        base_revision: "12",
        last_revision: "11",
        last_changed_date: "2026-07-11T01:02:03Z",
        last_changed_author: "dev",
        file_size: 128,
        changed: false,
        versioned: true,
        children: [],
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

function makeSvnLog(
  entries: SvnLogEntry[],
  log: Partial<SvnLog> = {},
): SvnLog {
  return {
    target: "C:/repo/wc",
    entries,
    has_more: false,
    next_start_revision: null,
    ...log,
  };
}

function makeSvnLogEntry(entry: Partial<SvnLogEntry> & Pick<SvnLogEntry, "revision">): SvnLogEntry {
  return {
    revision: entry.revision,
    author: entry.author ?? "dev",
    date: entry.date ?? "2026-07-03T00:00:00Z",
    message: entry.message ?? "",
    changed_paths: entry.changed_paths ?? [
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

function makeRevisionDiffResult(result: Partial<RevisionDiffResult> = {}): RevisionDiffResult {
  return {
    mode: "revisions",
    target: "C:/repo/wc r1:r2",
    diff_text: "Index: src/main.ts\n",
    file_count: 1,
    line_count: 1,
    truncated: false,
    max_bytes: 1024,
    patch_file_path: null,
    patch_file_dir: null,
    patch_file_name: null,
    ...result,
  };
}

function makeSvnProperties(properties: Partial<SvnProperties> = {}): SvnProperties {
  return {
    target: ".",
    properties: [],
    externals: null,
    ...properties,
  };
}

function makeTask(task: Partial<Task> = {}): Task {
  return {
    task_id: "task-1",
    title: "测试任务",
    status: "pending",
    error: null,
    created_at: 1,
    updated_at: 1,
    logs: [],
    result: null,
    ...task,
  };
}

function makeStatus(
  files: ChangedFile[],
  status: Partial<WorkingCopyStatus> = {},
): WorkingCopyStatus {
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
    modified: files.filter((file) => file.status === "modified").length,
    added: files.filter((file) => file.status === "added").length,
    deleted: files.filter((file) => file.status === "deleted").length,
    missing: files.filter((file) => file.status === "missing").length,
    unversioned: files.filter((file) => file.status === "unversioned").length,
    conflicted: files.filter((file) => file.status === "conflicted").length,
    obstructed: files.filter((file) => file.status === "obstructed").length,
    property_changed: files.filter((file) => file.property_changed).length,
    files,
    ...status,
  };
}

function makeFile(file: Partial<ChangedFile> & Pick<ChangedFile, "path" | "content_digest">): ChangedFile {
  return {
    path: file.path,
    status: file.status ?? "modified",
    revision: file.revision ?? "12",
    property_status: file.property_status ?? null,
    property_changed: file.property_changed ?? false,
    remote_status: file.remote_status ?? null,
    remote_property_status: file.remote_property_status ?? null,
    change_scope: file.change_scope ?? "local",
    abnormal: file.abnormal ?? false,
    lock_state: file.lock_state ?? "none",
    lock_owner: file.lock_owner ?? null,
    lock_comment: file.lock_comment ?? null,
    conflict_kind: file.conflict_kind ?? null,
    file_size: file.file_size ?? 128,
    content_digest: file.content_digest,
  };
}
