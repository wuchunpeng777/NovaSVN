import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/workbench/MonacoDiffViewer.svelte", () => ({
  default: vi.fn().mockImplementation((internals) => ({
    c: vi.fn(),
    m: vi.fn(),
    p: vi.fn(),
    d: vi.fn(),
    ...internals,
  })),
}));

vi.mock("@crabnebula/tauri-plugin-drag", () => ({
  startDrag: vi.fn(),
}));

vi.mock("./lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/api")>();
  return {
    ...actual,
    chooseExportDirectory: vi.fn(),
    chooseWorkspaceDirectory: vi.fn(),
    clearSvnCertificateTrust: vi.fn(),
    configureSvnAuthentication: vi.fn(),
    configureSvnCertificateTrust: vi.fn(),
    createMergeTask: vi.fn(),
    createRepositoryCheckoutTask: vi.fn(),
    createRepositoryCopyTask: vi.fn(),
    createRepositoryDeleteTask: vi.fn(),
    createRepositoryDragExportTask: vi.fn(),
    createRepositoryExportTask: vi.fn(),
    createRepositoryFileTask: vi.fn(),
    createRepositoryListTask: vi.fn(),
    createRepositoryImportTask: vi.fn(),
    createRepositoryMkdirTask: vi.fn(),
    createRepositoryMoveTask: vi.fn(),
    createRevertRevisionTask: vi.fn(),
    createSvnBatchOperationTask: vi.fn(),
    createSvnOperationTask: vi.fn(),
    detectSvn: vi.fn(),
    ignoreWorkspacePath: vi.fn(),
    getTask: vi.fn(),
    getWorkspacePathSizes: vi.fn(),
    getSvnLog: vi.fn(),
    inspectUpdateTarget: vi.fn(),
    getRepositoryFileBlame: vi.fn(),
    getRepositoryFileLog: vi.fn(),
    getRepositoryFileProperties: vi.fn(),
    getStartupIntent: vi.fn(),
    getBranchPool: vi.fn(),
    renameBranchPoolEntry: vi.fn(),
    reorderBranchPoolEntries: vi.fn(),
    listTasks: vi.fn(),
    listWorkspaceFiles: vi.fn(),
    openLocalPathLocation: vi.fn(),
    openRepositoryTempFile: vi.fn(),
    openWorkspaceFile: vi.fn(),
    openWorkspace: vi.fn(),
    scanWorkspaceStatus: vi.fn(),
    saveBranchPoolEntries: vi.fn(),
    saveBranchPoolEntry: vi.fn(),
    removeBranchPoolEntry: vi.fn(),
    setWorkspaceChangelist: vi.fn(),
  };
});

import { get } from "svelte/store";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import {
  chooseExportDirectory,
  chooseWorkspaceDirectory,
  clearSvnCertificateTrust,
  configureSvnAuthentication,
  configureSvnCertificateTrust,
  createMergeTask,
  createRepositoryCheckoutTask,
  createRepositoryCopyTask,
  createRepositoryDeleteTask,
  createRepositoryDragExportTask,
  createRepositoryExportTask,
  createRepositoryFileTask,
  createRepositoryListTask,
  createRepositoryImportTask,
  createRepositoryMkdirTask,
  createRepositoryMoveTask,
  createRevertRevisionTask,
  createSvnOperationTask,
  createSvnBatchOperationTask,
  detectSvn,
  ignoreWorkspacePath,
  getTask,
  getWorkspacePathSizes,
  getSvnLog,
  inspectUpdateTarget,
  getRepositoryFileBlame,
  getRepositoryFileLog,
  getRepositoryFileProperties,
  getStartupIntent,
  getBranchPool,
  renameBranchPoolEntry,
  reorderBranchPoolEntries,
  listTasks,
  listWorkspaceFiles,
  openLocalPathLocation,
  openRepositoryTempFile,
  openWorkspaceFile,
  openWorkspace,
  scanWorkspaceStatus,
  saveBranchPoolEntries,
  saveBranchPoolEntry,
  removeBranchPoolEntry,
  setWorkspaceChangelist,
} from "./lib/api";
import {
  appSettingsStore,
  branchPoolStore,
  currentView,
  setCurrentView,
  svnStore,
  taskStore,
  workspaceStore,
} from "./stores/app";
import type {
  Task,
  TaskSnapshot,
  TaskSummary,
  SvnLog,
  WorkingCopyStatus,
  WorkspaceFileTree,
  WorkspaceSummary,
} from "./types/api";
import App from "./App.svelte";

const createSvnOperationTaskMock = vi.mocked(createSvnOperationTask);
const chooseExportDirectoryMock = vi.mocked(chooseExportDirectory);
const chooseWorkspaceDirectoryMock = vi.mocked(chooseWorkspaceDirectory);
const clearSvnCertificateTrustMock = vi.mocked(clearSvnCertificateTrust);
const configureSvnAuthenticationMock = vi.mocked(configureSvnAuthentication);
const configureSvnCertificateTrustMock = vi.mocked(configureSvnCertificateTrust);
const createMergeTaskMock = vi.mocked(createMergeTask);
const createRepositoryCheckoutTaskMock = vi.mocked(createRepositoryCheckoutTask);
const createRepositoryCopyTaskMock = vi.mocked(createRepositoryCopyTask);
const createRepositoryDeleteTaskMock = vi.mocked(createRepositoryDeleteTask);
const createRepositoryDragExportTaskMock = vi.mocked(createRepositoryDragExportTask);
const createRepositoryExportTaskMock = vi.mocked(createRepositoryExportTask);
const createRepositoryFileTaskMock = vi.mocked(createRepositoryFileTask);
const createRepositoryListTaskMock = vi.mocked(createRepositoryListTask);
const createRepositoryImportTaskMock = vi.mocked(createRepositoryImportTask);
const createRepositoryMkdirTaskMock = vi.mocked(createRepositoryMkdirTask);
const createRepositoryMoveTaskMock = vi.mocked(createRepositoryMoveTask);
const createRevertRevisionTaskMock = vi.mocked(createRevertRevisionTask);
const createSvnBatchOperationTaskMock = vi.mocked(createSvnBatchOperationTask);
const detectSvnMock = vi.mocked(detectSvn);
const ignoreWorkspacePathMock = vi.mocked(ignoreWorkspacePath);
const getTaskMock = vi.mocked(getTask);
const getWorkspacePathSizesMock = vi.mocked(getWorkspacePathSizes);
const getSvnLogMock = vi.mocked(getSvnLog);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);
const getRepositoryFileBlameMock = vi.mocked(getRepositoryFileBlame);
const getRepositoryFileLogMock = vi.mocked(getRepositoryFileLog);
const getRepositoryFilePropertiesMock = vi.mocked(getRepositoryFileProperties);
const getStartupIntentMock = vi.mocked(getStartupIntent);
const getBranchPoolMock = vi.mocked(getBranchPool);
const renameBranchPoolEntryMock = vi.mocked(renameBranchPoolEntry);
const reorderBranchPoolEntriesMock = vi.mocked(reorderBranchPoolEntries);
const listTasksMock = vi.mocked(listTasks);
const listWorkspaceFilesMock = vi.mocked(listWorkspaceFiles);
const openLocalPathLocationMock = vi.mocked(openLocalPathLocation);
const openRepositoryTempFileMock = vi.mocked(openRepositoryTempFile);
const openWorkspaceFileMock = vi.mocked(openWorkspaceFile);
const openWorkspaceMock = vi.mocked(openWorkspace);
const scanWorkspaceStatusMock = vi.mocked(scanWorkspaceStatus);
const saveBranchPoolEntriesMock = vi.mocked(saveBranchPoolEntries);
const saveBranchPoolEntryMock = vi.mocked(saveBranchPoolEntry);
const removeBranchPoolEntryMock = vi.mocked(removeBranchPoolEntry);
const setWorkspaceChangelistMock = vi.mocked(setWorkspaceChangelist);
const startDragMock = vi.mocked(startDrag);

beforeEach(async () => {
  chooseExportDirectoryMock.mockReset();
  chooseWorkspaceDirectoryMock.mockReset();
  clearSvnCertificateTrustMock.mockReset();
  configureSvnAuthenticationMock.mockReset();
  configureSvnCertificateTrustMock.mockReset();
  createMergeTaskMock.mockReset();
  createSvnOperationTaskMock.mockReset();
  createRepositoryCheckoutTaskMock.mockReset();
  createRepositoryCopyTaskMock.mockReset();
  createRepositoryDeleteTaskMock.mockReset();
  createRepositoryDragExportTaskMock.mockReset();
  createRepositoryExportTaskMock.mockReset();
  createRepositoryFileTaskMock.mockReset();
  createRepositoryListTaskMock.mockReset();
  createRepositoryImportTaskMock.mockReset();
  createRepositoryMkdirTaskMock.mockReset();
  createRepositoryMoveTaskMock.mockReset();
  createRevertRevisionTaskMock.mockReset();
  createSvnBatchOperationTaskMock.mockReset();
  detectSvnMock.mockReset();
  ignoreWorkspacePathMock.mockReset();
  getTaskMock.mockReset();
  getWorkspacePathSizesMock.mockReset();
  getSvnLogMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  getRepositoryFileBlameMock.mockReset();
  getRepositoryFileLogMock.mockReset();
  getRepositoryFilePropertiesMock.mockReset();
  getStartupIntentMock.mockReset();
  getBranchPoolMock.mockReset();
  renameBranchPoolEntryMock.mockReset();
  reorderBranchPoolEntriesMock.mockReset();
  listTasksMock.mockReset();
  listWorkspaceFilesMock.mockReset();
  openLocalPathLocationMock.mockReset();
  openRepositoryTempFileMock.mockReset();
  openWorkspaceFileMock.mockReset();
  openWorkspaceMock.mockReset();
  scanWorkspaceStatusMock.mockReset();
  saveBranchPoolEntriesMock.mockReset();
  saveBranchPoolEntryMock.mockReset();
  saveBranchPoolEntryMock.mockImplementation(async () => get(branchPoolStore).pool);
  removeBranchPoolEntryMock.mockReset();
  removeBranchPoolEntryMock.mockImplementation(async () => get(branchPoolStore).pool);
  setWorkspaceChangelistMock.mockReset();
  startDragMock.mockReset();
  startDragMock.mockResolvedValue(undefined);
  getWorkspacePathSizesMock.mockResolvedValue([]);

  listTasksMock.mockResolvedValue(makeTaskSnapshot([]));
  chooseWorkspaceDirectoryMock.mockResolvedValue(null);
  getBranchPoolMock.mockResolvedValue({ entries: [] });
  await branchPoolStore.load();
  await taskStore.refresh();
  workspaceStore.markSvnOperationTask(null, null, null);
  workspaceStore.markMergeTask(null);
  workspaceStore.setMergeForm("sourceUrl", "");
  workspaceStore.setMergeForm("startRevision", "");
  workspaceStore.setMergeForm("endRevision", "");
  workspaceStore.setMergeForm("dryRun", true);
  workspaceStore.setMergeForm("recordOnly", false);
  workspaceStore.setMergeForm("ignoreAncestry", false);
  workspaceStore.setMergeForm("force", false);
  setCurrentView("changes");
  workspaceStore.clearTabStateCache();

  openWorkspaceMock.mockResolvedValue(makeWorkspace());
  scanWorkspaceStatusMock.mockResolvedValue(makeStatus());
  listWorkspaceFilesMock.mockResolvedValue(makeFileTree());
  await workspaceStore.openPath(undefined, "C:/repo/wc");
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  svnStore.setExecutableInput("");
});

describe("App SVN operation completion", () => {
  it("blocks the browser find shortcut without consuming plain typing", () => {
    render(App);
    const findShortcut = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(findShortcut);
    expect(findShortcut.defaultPrevented).toBe(true);

    const plainTyping = new KeyboardEvent("keydown", {
      key: "f",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(plainTyping);
    expect(plainTyping.defaultPrevented).toBe(false);
  });

  it("applies password authentication and clears the frontend password", async () => {
    configureSvnAuthenticationMock.mockResolvedValue({
      mode: "password",
      username: "alice",
      password_configured: true,
      uses_system_credentials: false,
      remember_password: false,
    });
    appSettingsStore.setField("svnAuthenticationMode", "password");
    appSettingsStore.setField("svnUsername", "alice");
    appSettingsStore.setField("svnRememberPassword", false);
    setCurrentView("settings");
    render(App);

    const passwordInput = screen.getByLabelText("密码");
    await fireEvent.input(passwordInput, { target: { value: "temporary-secret" } });
    await fireEvent.click(screen.getByRole("button", { name: "应用认证" }));

    await waitFor(() =>
      expect(configureSvnAuthenticationMock).toHaveBeenCalledWith({
        mode: "password",
        username: "alice",
        password: "temporary-secret",
        remember_password: false,
      }),
    );
    await waitFor(() => expect(passwordInput).toHaveValue(""));
    expect(screen.getByText("密码仅用于当前会话")).toBeInTheDocument();
  });

  it("restores a system-saved password during Tauri startup", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    appSettingsStore.setField("svnAuthenticationMode", "password");
    appSettingsStore.setField("svnUsername", "alice");
    appSettingsStore.setField("svnRememberPassword", true);
    appSettingsStore.setField("svnExecutable", "");
    configureSvnAuthenticationMock.mockResolvedValue({
      mode: "password",
      username: "alice",
      password_configured: true,
      uses_system_credentials: true,
      remember_password: true,
    });
    const detection = deferred<{
      available: boolean;
      version: string;
      executable: string;
      resolved_path: string | null;
    }>();
    detectSvnMock.mockReturnValue(detection.promise);
    getStartupIntentMock.mockResolvedValue({
      action: "info",
      path: null,
      repository_root: null,
      revision: null,
      return_action: null,
      preview_id: null,
    });

    render(App);

    await waitFor(() => expect(detectSvnMock).toHaveBeenCalledWith({ executable: "" }));
    expect(getStartupIntentMock).not.toHaveBeenCalled();
    detection.resolve({
      available: true,
      version: "1.14.5",
      executable: "svn",
      resolved_path: "/opt/homebrew/bin/svn",
    });
    await waitFor(() =>
      expect(configureSvnAuthenticationMock).toHaveBeenCalledWith({
        mode: "password",
        username: "alice",
        remember_password: true,
      }),
    );
    await waitFor(() => expect(getStartupIntentMock).toHaveBeenCalledOnce());
  });

  it("opens authentication on E215004 and retries status after login", async () => {
    configureSvnAuthenticationMock.mockResolvedValue({
      mode: "password",
      username: "alice@example.com",
      password_configured: true,
      uses_system_credentials: false,
      remember_password: false,
    });
    scanWorkspaceStatusMock
      .mockRejectedValueOnce({
        code: "SVN_STATUS_COMMAND_FAILED",
        message: "SVN 状态读取失败",
        detail:
          "svn: E170013: Unable to connect to a repository at URL 'https://alice%40example.com@svn.example.test/repo' svn: E215004: No more credentials or we tried too many times. Authentication failed",
        recoverable: true,
      })
      .mockResolvedValue(makeStatus());
    appSettingsStore.setField("svnAuthenticationMode", "system");
    appSettingsStore.setField("svnUsername", "");
    appSettingsStore.setField("svnRememberPassword", false);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "刷新工作副本状态" }));
    const dialog = await screen.findByRole("dialog", { name: "登录 SVN" });
    expect(within(dialog).getByLabelText("用户名")).toHaveValue("alice@example.com");
    // 打开主界面时展示目标仓库，避免用户不知道该输入哪套凭据
    expect(within(dialog).getByLabelText("认证目标仓库")).toHaveTextContent(
      "https://alice%40example.com@svn.example.test/repo",
    );
    await fireEvent.input(within(dialog).getByLabelText("密码"), {
      target: { value: "current-secret" },
    });
    await fireEvent.click(within(dialog).getByRole("button", { name: "登录并重试" }));

    await waitFor(() =>
      expect(configureSvnAuthenticationMock).toHaveBeenCalledWith({
        mode: "password",
        username: "alice@example.com",
        password: "current-secret",
        remember_password: false,
      }),
    );
    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "登录 SVN" })).not.toBeInTheDocument(),
    );
  });

  it("confirms exact certificate failures and can clear the session trust", async () => {
    configureSvnCertificateTrustMock.mockResolvedValue({
      active: true,
      failures: ["unknown-ca", "cn-mismatch"],
    });
    clearSvnCertificateTrustMock.mockResolvedValue({
      active: false,
      failures: [],
    });
    scanWorkspaceStatusMock.mockRejectedValueOnce({
      code: "SVN_COMMAND_FAILED",
      message: "服务器证书验证失败",
      detail: `svn: E230001: Error validating server certificate for 'https://svn.example.test/repo':
 - The certificate is not issued by a trusted authority.
 - The certificate hostname does not match.
Certificate information:
 - Hostname: svn.example.test
 - Fingerprint: AA:BB:CC`,
      recoverable: true,
    });
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "刷新工作副本状态" }));
    const riskConfirmation = await screen.findByRole("checkbox", {
      name: "我已核对服务器身份，并同意仅在当前会话中允许以上证书失败类型",
    });
    await fireEvent.click(riskConfirmation);
    await fireEvent.click(screen.getByRole("button", { name: "仅本次会话允许" }));

    await waitFor(() =>
      expect(configureSvnCertificateTrustMock).toHaveBeenCalledWith({
        failures: ["unknown-ca", "cn-mismatch"],
        confirmed: true,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "确认服务器证书风险" })).not.toBeInTheDocument(),
    );

    setCurrentView("settings");
    const clearButton = await screen.findByRole("button", { name: "清除会话证书例外" });
    expect(screen.getByText("当前会话已启用")).toBeInTheDocument();
    await fireEvent.click(clearButton);

    await waitFor(() => expect(clearSvnCertificateTrustMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByText("未启用")).toBeInTheDocument());
  });

  it("创建带 revision 范围和 tracking 参数的 Merge 任务", async () => {
    createMergeTaskMock.mockResolvedValue(makeTask({ task_id: "merge-create" }));
    workspaceStore.setMergeForm("sourceUrl", "https://example.com/svn/branches/feature");
    workspaceStore.setMergeForm("startRevision", "10");
    workspaceStore.setMergeForm("endRevision", "12");
    workspaceStore.setMergeForm("dryRun", false);
    workspaceStore.setMergeForm("recordOnly", true);
    workspaceStore.setMergeForm("force", true);
    setCurrentView("branches");
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() => expect(createMergeTaskMock).toHaveBeenCalledOnce());
    expect(createMergeTaskMock).toHaveBeenCalledWith({
      working_copy_root: "C:/repo/wc",
      source_url: "https://example.com/svn/branches/feature",
      start_revision: "10",
      end_revision: "12",
      dry_run: false,
      record_only: true,
      ignore_ancestry: false,
      force: true,
      svn_executable: undefined,
    });
    expect(get(workspaceStore).pendingMergeTaskId).toBe("merge-create");
  });

  it("从左侧添加本地工作副本并保留原副本", async () => {
    const secondWorkspace: WorkspaceSummary = {
      local_path: "D:\\work\\feature",
      working_copy_root: "D:\\work\\feature",
      repository_url: "https://example.com/svn/branches/feature",
      repository_root: "https://example.com/svn",
      revision: "18",
    };
    const previousEntry = {
      id: "previous",
      branch_url: "https://example.com/svn/trunk",
      local_path: "C:/repo/wc",
      revision: "12",
      local_changes: 0,
      created_at: 1,
      updated_at: 1,
    };
    const secondEntry = {
      id: "second",
      branch_url: secondWorkspace.repository_url,
      local_path: secondWorkspace.working_copy_root,
      revision: "18",
      local_changes: 2,
      created_at: 2,
      updated_at: 2,
    };
    chooseWorkspaceDirectoryMock.mockResolvedValue("D:\\work\\feature");
    openWorkspaceMock.mockResolvedValueOnce(secondWorkspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce({
      ...makeStatus(),
      working_copy_root: secondWorkspace.working_copy_root,
      total: 2,
      returned: 2,
      local_changes: 2,
      revision_range: "18",
    });
    saveBranchPoolEntriesMock.mockResolvedValueOnce({ entries: [previousEntry, secondEntry] });
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "添加工作副本" }));

    await waitFor(() => expect(openWorkspaceMock).toHaveBeenLastCalledWith({
      path: "D:\\work\\feature",
      svn_executable: undefined,
    }));
    await waitFor(() => expect(saveBranchPoolEntriesMock).toHaveBeenCalledOnce());
    expect(saveBranchPoolEntriesMock).toHaveBeenCalledWith({
      entries: [
        {
          branch_url: "https://example.com/svn/trunk",
          local_path: "C:/repo/wc",
          revision: "12",
          local_changes: 0,
        },
        {
          branch_url: "https://example.com/svn/branches/feature",
          local_path: "D:\\work\\feature",
          revision: "18",
          local_changes: 2,
        },
      ],
    });
    const projects = screen.getByLabelText("项目标签");
    expect(within(projects).getByText("feature")).toBeInTheDocument();
    expect(within(projects).getByText("wc")).toBeInTheDocument();
  });

  it("同一 SVN 工作副本根下添加和切换项目时保留两个项目", async () => {
    const previousWorkspace: WorkspaceSummary = {
      ...makeWorkspace(),
      local_path: "C:/repo/wc/game/project-a",
      working_copy_root: "C:/repo/wc",
      repository_url: "https://example.com/svn/trunk/game/project-a",
    };
    const nextWorkspace: WorkspaceSummary = {
      ...makeWorkspace(),
      local_path: "C:/repo/wc/game/project-b",
      working_copy_root: "C:/repo/wc",
      repository_url: "https://example.com/svn/trunk/game/project-b",
      revision: "18",
    };
    const previousEntry = {
      id: "project-a",
      branch_url: previousWorkspace.repository_url,
      local_path: previousWorkspace.local_path,
      revision: "12",
      local_changes: 0,
      created_at: 1,
      updated_at: 1,
    };
    const nextEntry = {
      id: "project-b",
      branch_url: nextWorkspace.repository_url,
      local_path: nextWorkspace.local_path,
      revision: "18",
      local_changes: 2,
      created_at: 2,
      updated_at: 2,
    };

    openWorkspaceMock.mockResolvedValueOnce(previousWorkspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce(makeStatus());
    await workspaceStore.openPath(undefined, previousWorkspace.local_path);
    chooseWorkspaceDirectoryMock.mockResolvedValueOnce(nextWorkspace.local_path);
    openWorkspaceMock
      .mockResolvedValueOnce(nextWorkspace)
      .mockResolvedValueOnce(previousWorkspace);
    scanWorkspaceStatusMock
      .mockResolvedValueOnce({
        ...makeStatus(),
        total: 2,
        returned: 2,
        local_changes: 2,
        revision_range: "18",
      })
      .mockResolvedValueOnce(makeStatus());
    getBranchPoolMock.mockResolvedValue({ entries: [previousEntry] });
    await branchPoolStore.load();
    let resolveProjectSave!: (pool: { entries: typeof previousEntry[] }) => void;
    saveBranchPoolEntriesMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveProjectSave = resolve;
      }),
    );
    render(App);

    screen.getByRole("button", { name: "添加工作副本" }).click();
    const projects = screen.getByLabelText("项目标签");
    await waitFor(() => {
      expect(within(projects).getByText("project-a")).toBeInTheDocument();
      expect(within(projects).getByText("project-b")).toBeInTheDocument();
    });

    const previousProjectButton = within(projects).getByText("project-a").closest("button")!;
    expect(previousProjectButton).toBeEnabled();
    await waitFor(() => expect(saveBranchPoolEntriesMock).toHaveBeenCalledOnce());

    await fireEvent.click(previousProjectButton);
    await waitFor(() => expect(openWorkspaceMock).toHaveBeenLastCalledWith({
      path: previousWorkspace.local_path,
      svn_executable: undefined,
    }));
    resolveProjectSave({ entries: [previousEntry, nextEntry] });

    expect(within(projects).getByText("project-a")).toBeInTheDocument();
    await waitFor(() => expect(within(projects).getByText("project-b")).toBeInTheDocument());
    await waitFor(() =>
      expect(get(workspaceStore).current?.local_path).toBe(previousWorkspace.local_path),
    );
  });

  it("切换已保存项目时先持久化当前未入池项目", async () => {
    const savedWorkspace = makeWorkspace();
    const transientWorkspace: WorkspaceSummary = {
      ...makeWorkspace(),
      local_path: "D:/repo/transient",
      working_copy_root: "D:/repo/transient",
      repository_url: "https://example.com/svn/branches/transient",
      revision: "18",
    };
    const savedEntry = {
      id: "saved",
      branch_url: savedWorkspace.repository_url,
      local_path: savedWorkspace.local_path,
      revision: "12",
      local_changes: 0,
      created_at: 1,
      updated_at: 1,
    };
    const transientEntry = {
      id: "transient",
      branch_url: transientWorkspace.repository_url,
      local_path: transientWorkspace.local_path,
      revision: "18",
      local_changes: 2,
      created_at: 2,
      updated_at: 2,
    };

    openWorkspaceMock.mockResolvedValueOnce(transientWorkspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce({
      ...makeStatus(),
      working_copy_root: transientWorkspace.working_copy_root,
      total: 2,
      returned: 2,
      local_changes: 2,
      revision_range: "18",
    });
    await workspaceStore.openPath(undefined, transientWorkspace.local_path);
    getBranchPoolMock.mockResolvedValueOnce({ entries: [savedEntry] });
    await branchPoolStore.load();
    saveBranchPoolEntryMock.mockResolvedValueOnce({
      entries: [savedEntry, transientEntry],
    });
    render(App);

    const projects = screen.getByLabelText("项目标签");
    expect(within(projects).getByText("transient")).toBeInTheDocument();
    await fireEvent.click(within(projects).getByText("wc").closest("button")!);

    await waitFor(() => expect(saveBranchPoolEntryMock).toHaveBeenCalledWith({
      branch_url: transientWorkspace.repository_url,
      local_path: transientWorkspace.local_path,
      revision: "18",
      local_changes: 2,
    }));
    await waitFor(() => expect(get(workspaceStore).current?.local_path).toBe(savedWorkspace.local_path));
    expect(within(projects).getByText("transient")).toBeInTheDocument();
    expect(within(projects).getByText("wc")).toBeInTheDocument();
  });

  it("切换项目时保留旧界面直到新项目就绪", async () => {
    const nextWorkspace: WorkspaceSummary = {
      ...makeWorkspace(),
      local_path: "D:/repo/other",
      working_copy_root: "D:/repo/other",
      repository_url: "https://example.com/svn/branches/other",
      revision: "18",
    };
    getBranchPoolMock.mockResolvedValueOnce({
      entries: [{
        id: "other",
        branch_url: nextWorkspace.repository_url,
        local_path: nextWorkspace.local_path,
        revision: "18",
        local_changes: 0,
        created_at: 1,
        updated_at: 1,
      }],
    });
    await branchPoolStore.load();

    const pendingWorkspace = deferred<WorkspaceSummary>();
    openWorkspaceMock.mockReturnValueOnce(pendingWorkspace.promise);
    scanWorkspaceStatusMock.mockClear();
    scanWorkspaceStatusMock.mockResolvedValueOnce({
      ...makeStatus(),
      working_copy_root: nextWorkspace.working_copy_root,
      revision_range: "18",
    });
    listWorkspaceFilesMock.mockResolvedValueOnce({
      ...makeFileTree(),
      working_copy_root: nextWorkspace.working_copy_root,
    });
    getSvnLogMock.mockClear();
    render(App);

    const projects = screen.getByLabelText("项目标签");
    await fireEvent.click(within(projects).getByText("other").closest("button")!);

    expect(get(workspaceStore).status).not.toBeNull();
    expect(get(workspaceStore).fileTree).not.toBeNull();
    expect(get(workspaceStore).svnLog).toBeNull();
    pendingWorkspace.resolve(nextWorkspace);

    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledOnce());
    expect(scanWorkspaceStatusMock).toHaveBeenLastCalledWith(expect.objectContaining({
      working_copy_root: nextWorkspace.working_copy_root,
    }));
    expect(getSvnLogMock).not.toHaveBeenCalled();
    expect(get(currentView)).toBe("changes");
  });

  it("切换回已访问项目时立即显示缓存界面", async () => {
    const previousStatus = get(workspaceStore).status;
    const previousTree = get(workspaceStore).fileTree;
    const nextWorkspace: WorkspaceSummary = {
      ...makeWorkspace(),
      local_path: "D:/repo/other",
      working_copy_root: "D:/repo/other",
      repository_url: "https://example.com/svn/branches/other",
      revision: "18",
    };
    getBranchPoolMock.mockResolvedValueOnce({
      entries: [
        {
          id: "current",
          branch_url: "https://example.com/svn/trunk",
          local_path: "C:/repo/wc",
          revision: "12",
          local_changes: 0,
          created_at: 1,
          updated_at: 1,
        },
        {
          id: "other",
          branch_url: nextWorkspace.repository_url,
          local_path: nextWorkspace.local_path,
          revision: "18",
          local_changes: 0,
          created_at: 1,
          updated_at: 1,
        },
      ],
    });
    await branchPoolStore.load();
    openWorkspaceMock.mockResolvedValueOnce(nextWorkspace);
    scanWorkspaceStatusMock.mockResolvedValueOnce({
      ...makeStatus(),
      working_copy_root: nextWorkspace.working_copy_root,
      revision_range: "18",
    });
    listWorkspaceFilesMock.mockResolvedValueOnce({
      ...makeFileTree(),
      working_copy_root: nextWorkspace.working_copy_root,
    });
    render(App);

    const projects = screen.getByLabelText("项目标签");
    await fireEvent.click(within(projects).getByText("other").closest("button")!);
    await waitFor(() => expect(get(workspaceStore).current?.local_path).toBe(nextWorkspace.local_path));

    const pendingWorkspace = deferred<WorkspaceSummary>();
    openWorkspaceMock.mockReturnValueOnce(pendingWorkspace.promise);
    await fireEvent.click(within(projects).getByText("wc").closest("button")!);

    expect(get(workspaceStore).current?.local_path).toBe("C:/repo/wc");
    expect(get(workspaceStore).status).toBe(previousStatus);
    expect(get(workspaceStore).fileTree).toBe(previousTree);
    expect(get(workspaceStore).loading).toBe(false);

    pendingWorkspace.resolve(makeWorkspace());
    await waitFor(() => expect(openWorkspaceMock).toHaveBeenCalled());
  });

  it("首次打开的项目使用默认工作副本视图", async () => {
    getSvnLogMock.mockResolvedValueOnce(makeSvnLog("C:/repo/wc"));
    await workspaceStore.refreshSvnLog();

    const nextWorkspace: WorkspaceSummary = {
      ...makeWorkspace(),
      local_path: "D:/repo/other",
      working_copy_root: "D:/repo/other",
      repository_url: "https://example.com/svn/branches/other",
      revision: "18",
    };
    getBranchPoolMock.mockResolvedValueOnce({
      entries: [{
        id: "other",
        branch_url: nextWorkspace.repository_url,
        local_path: nextWorkspace.local_path,
        revision: "18",
        local_changes: 1,
        created_at: 1,
        updated_at: 1,
      }],
    });
    await branchPoolStore.load();

    const pendingWorkspace = deferred<WorkspaceSummary>();
    openWorkspaceMock.mockReturnValueOnce(pendingWorkspace.promise);
    scanWorkspaceStatusMock.mockClear();
    getSvnLogMock.mockClear();
    getSvnLogMock.mockResolvedValueOnce(makeSvnLog(nextWorkspace.working_copy_root));
    setCurrentView("history");
    render(App);

    const projects = screen.getByLabelText("项目标签");
    await fireEvent.click(within(projects).getByText("other").closest("button")!);

    expect(get(workspaceStore).status).not.toBeNull();
    expect(get(workspaceStore).svnLog).not.toBeNull();
    pendingWorkspace.resolve(nextWorkspace);

    await waitFor(() => expect(scanWorkspaceStatusMock).toHaveBeenCalledOnce());
    expect(scanWorkspaceStatusMock).toHaveBeenLastCalledWith(expect.objectContaining({
      working_copy_root: nextWorkspace.working_copy_root,
    }));
    expect(getSvnLogMock).not.toHaveBeenCalled();
    expect(get(currentView)).toBe("changes");
  });

  it("为每个项目Tab恢复独立的内容视图", async () => {
    const workspaceA = makeWorkspace();
    const workspaceB: WorkspaceSummary = {
      ...makeWorkspace(),
      local_path: "D:/repo/other",
      working_copy_root: "D:/repo/other",
      repository_url: "https://example.com/svn/branches/other",
      revision: "18",
    };
    getBranchPoolMock.mockResolvedValueOnce({
      entries: [
        {
          id: "current",
          branch_url: workspaceA.repository_url,
          local_path: workspaceA.local_path,
          revision: "12",
          local_changes: 0,
          created_at: 1,
          updated_at: 1,
        },
        {
          id: "other",
          branch_url: workspaceB.repository_url,
          local_path: workspaceB.local_path,
          revision: "18",
          local_changes: 0,
          created_at: 1,
          updated_at: 1,
        },
      ],
    });
    await branchPoolStore.load();
    openWorkspaceMock
      .mockResolvedValueOnce(workspaceB)
      .mockResolvedValueOnce(workspaceA);
    scanWorkspaceStatusMock.mockResolvedValueOnce({
      ...makeStatus(),
      working_copy_root: workspaceB.working_copy_root,
      revision_range: "18",
    });
    listWorkspaceFilesMock.mockResolvedValueOnce({
      ...makeFileTree(),
      working_copy_root: workspaceB.working_copy_root,
    });
    getSvnLogMock.mockResolvedValue(makeSvnLog(workspaceA.working_copy_root));
    render(App);

    const contentTabs = screen.getByRole("tablist", { name: "工作副本内容" });
    await fireEvent.click(within(contentTabs).getByRole("tab", { name: "时间线" }));
    await waitFor(() => expect(get(currentView)).toBe("history"));

    const projects = screen.getByLabelText("项目标签");
    await fireEvent.click(within(projects).getByText("other").closest("button")!);
    await waitFor(() => expect(get(workspaceStore).current?.local_path).toBe(workspaceB.local_path));
    expect(get(currentView)).toBe("changes");

    await fireEvent.click(within(projects).getByText("wc").closest("button")!);
    await waitFor(() => expect(get(workspaceStore).current?.local_path).toBe(workspaceA.local_path));
    expect(get(currentView)).toBe("history");
    expect(getSvnLogMock).toHaveBeenCalledTimes(2);
  });

  it("移除当前项目后不会再显示为未入池标签", async () => {
    const currentEntry = {
      id: "current",
      branch_url: "https://example.com/svn/trunk",
      local_path: "C:/repo/wc",
      revision: "12",
      local_changes: 0,
      created_at: 1,
      updated_at: 1,
    };
    getBranchPoolMock.mockResolvedValueOnce({ entries: [currentEntry] });
    await branchPoolStore.load();
    removeBranchPoolEntryMock.mockResolvedValueOnce({ entries: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(App);

    const projects = screen.getByLabelText("项目标签");
    const currentRow = within(projects).getByRole("group", { name: "项目 wc" });
    await fireEvent.contextMenu(currentRow, { clientX: 140, clientY: 80 });
    await fireEvent.click(screen.getByRole("menuitem", { name: "从项目列表移除" }));

    await waitFor(() => expect(removeBranchPoolEntryMock).toHaveBeenCalledWith({
      id: "current",
      delete_local_copy: false,
    }));
    expect(saveBranchPoolEntryMock).not.toHaveBeenCalled();
    expect(get(workspaceStore).current).toBeNull();
    expect(within(projects).queryByText("wc")).not.toBeInTheDocument();
    expect(within(projects).getByRole("button", { name: /打开工作副本/ })).toBeInTheDocument();
  });

  it("移除当前项目后切换到剩余项目且不会重新保存已移除项", async () => {
    const workspaceB: WorkspaceSummary = {
      ...makeWorkspace(),
      local_path: "D:/repo/other",
      working_copy_root: "D:/repo/other",
      repository_url: "https://example.com/svn/branches/other",
      revision: "18",
    };
    const currentEntry = {
      id: "current",
      branch_url: "https://example.com/svn/trunk",
      local_path: "C:/repo/wc",
      revision: "12",
      local_changes: 0,
      created_at: 1,
      updated_at: 1,
    };
    const otherEntry = {
      id: "other",
      branch_url: workspaceB.repository_url,
      local_path: workspaceB.local_path,
      revision: "18",
      local_changes: 0,
      created_at: 2,
      updated_at: 2,
    };
    getBranchPoolMock.mockResolvedValueOnce({ entries: [currentEntry, otherEntry] });
    await branchPoolStore.load();
    removeBranchPoolEntryMock.mockResolvedValueOnce({ entries: [otherEntry] });
    openWorkspaceMock.mockResolvedValueOnce(workspaceB);
    scanWorkspaceStatusMock.mockResolvedValueOnce({
      ...makeStatus(),
      working_copy_root: workspaceB.working_copy_root,
      revision_range: "18",
    });
    listWorkspaceFilesMock.mockResolvedValueOnce({
      ...makeFileTree(),
      working_copy_root: workspaceB.working_copy_root,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(App);

    const projects = screen.getByLabelText("项目标签");
    const currentRow = within(projects).getByRole("group", { name: "项目 wc" });
    await fireEvent.contextMenu(currentRow, { clientX: 140, clientY: 80 });
    await fireEvent.click(screen.getByRole("menuitem", { name: "从项目列表移除" }));

    await waitFor(() => expect(get(workspaceStore).current?.local_path).toBe(workspaceB.local_path));
    expect(removeBranchPoolEntryMock).toHaveBeenCalledWith({
      id: "current",
      delete_local_copy: false,
    });
    expect(saveBranchPoolEntryMock).not.toHaveBeenCalledWith(expect.objectContaining({
      local_path: currentEntry.local_path,
    }));
    expect(within(projects).queryByText("wc")).not.toBeInTheDocument();
    expect(within(projects).getByText("other")).toBeInTheDocument();
  });

  it("进入时间线时自动获取日志且当前界面不重复请求", async () => {
    getSvnLogMock.mockResolvedValue({
      target: "https://example.com/svn/trunk",
      working_copy_root: "C:/repo/wc",
      repository_root: "https://example.com/svn",
      repository_url: "https://example.com/svn/trunk",
      entries: [],
      has_more: false,
      next_start_revision: null,
    });
    render(App);

    const navigation = screen.getByRole("tablist", { name: "工作副本内容" });
    const timelineButton = within(navigation).getByRole("tab", { name: "时间线" });
    await fireEvent.click(timelineButton);

    await waitFor(() => expect(getSvnLogMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "读取日志" })).not.toBeInTheDocument();
    expect(getSvnLogMock).toHaveBeenLastCalledWith({
      working_copy_root: "C:/repo/wc",
      file_path: undefined,
      svn_executable: undefined,
      limit: 50,
      start_revision: undefined,
    });

    await fireEvent.click(timelineButton);
    expect(getSvnLogMock).toHaveBeenCalledTimes(1);

    await fireEvent.click(within(navigation).getByRole("tab", { name: "工作副本" }));
    await fireEvent.click(timelineButton);
    await waitFor(() => expect(getSvnLogMock).toHaveBeenCalledTimes(2));
  });

  it("点击主界面更新后在工作台内显示可最小化的流式 Update", async () => {
    createSvnOperationTaskMock.mockResolvedValue(
      makeTask({ task_id: "svn-update", status: "pending" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask({
        task_id: "svn-update",
        status: "running",
        logs: [
          { message: "U    src/main.ts", created_at: 1 },
        ],
      }),
    );
    getWorkspacePathSizesMock.mockResolvedValue([
      { path: "src/main.ts", bytes: 2048 },
    ]);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更新工作副本" }));

    const updatePanel = await screen.findByLabelText("主界面 Update");
    expect(updatePanel).toBeInTheDocument();
    expect(screen.getByLabelText("NovaSVN 工作台")).toBeInTheDocument();
    expect(screen.queryByLabelText("NovaSVN Update")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "update",
        file_path: undefined,
        svn_executable: undefined,
      });
    });
    expect(inspectUpdateTargetMock).not.toHaveBeenCalled();
    expect((await within(updatePanel).findAllByText("src/main.ts")).length).toBeGreaterThan(0);
    await waitFor(() => expect(within(updatePanel).getByText("2.00 KB")).toBeInTheDocument());
    expect(within(updatePanel).getByRole("button", { name: "关闭 Update" })).toBeDisabled();

    await fireEvent.click(within(updatePanel).getByRole("button", { name: "最小化 Update" }));
    expect(within(updatePanel).getByLabelText("Update 简要信息")).toBeInTheDocument();
    expect(within(updatePanel).queryByRole("listitem")).not.toBeInTheDocument();
    expect(within(updatePanel).getByRole("button", { name: "展开 Update 详情" })).toBeInTheDocument();

    openWorkspaceMock.mockResolvedValueOnce({
      ...makeWorkspace(),
      local_path: "D:/repo/other",
      working_copy_root: "D:/repo/other",
    });
    scanWorkspaceStatusMock.mockResolvedValueOnce({
      ...makeStatus(),
      working_copy_root: "D:/repo/other",
    });
    listWorkspaceFilesMock.mockResolvedValueOnce({
      ...makeFileTree(),
      working_copy_root: "D:/repo/other",
    });
    await workspaceStore.openPath(undefined, "D:/repo/other");
    await waitFor(() => expect(screen.queryByLabelText("主界面 Update")).not.toBeInTheDocument());

    openWorkspaceMock.mockResolvedValueOnce(makeWorkspace());
    scanWorkspaceStatusMock.mockResolvedValueOnce(makeStatus());
    listWorkspaceFilesMock.mockResolvedValueOnce(makeFileTree());
    await workspaceStore.openPath(undefined, "C:/repo/wc");
    const expandUpdate = await screen.findByRole("button", { name: "展开 Update 详情" });
    expect(expandUpdate).toBeInTheDocument();
    await fireEvent.click(expandUpdate);
    const restoredUpdatePanel = screen.getByLabelText("主界面 Update");
    // 主界面内嵌 Update 不展示「完成后关闭」选项
    expect(
      within(restoredUpdatePanel).queryByRole("checkbox", {
        name: "更新完成且所有冲突解决后自动关闭",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("主界面 Update")).toBeInTheDocument();
  });

  it("主界面更新完成后自动关闭内嵌 Update", async () => {
    createSvnOperationTaskMock.mockResolvedValue(
      makeTask({ task_id: "svn-update", status: "pending" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask({
        task_id: "svn-update",
        status: "success",
        logs: [
          { message: "U    src/main.ts", created_at: 1 },
          { message: "Updated to revision 21.", created_at: 2 },
        ],
      }),
    );
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更新工作副本" }));

    expect(await screen.findByLabelText("主界面 Update")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText("主界面 Update")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("NovaSVN 工作台")).toBeInTheDocument();
  });

  it("主界面更新失败后可手动关闭内嵌 Update", async () => {
    createSvnOperationTaskMock.mockResolvedValue(
      makeTask({ task_id: "svn-update", status: "pending" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask({
        task_id: "svn-update",
        status: "failed",
        error: "svn: E155004: working copy locked",
        logs: [{ message: "svn: E155004: working copy locked", created_at: 1 }],
      }),
    );
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更新工作副本" }));

    const updatePanel = await screen.findByLabelText("主界面 Update");
    const closeButton = within(updatePanel).getByRole("button", { name: "关闭 Update" });
    await waitFor(() => expect(closeButton).toBeEnabled());
    await fireEvent.click(closeButton);
    await waitFor(() => {
      expect(screen.queryByLabelText("主界面 Update")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("NovaSVN 工作台")).toBeInTheDocument();
  });

  it("远端变化文件使用真实文件级 Update 任务", async () => {
    await showRemoteUpdateSource();
    const updateTask = makeTask({ task_id: "update-path", status: "pending" });
    createSvnOperationTaskMock.mockResolvedValue(updateTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([makeTaskSummary({ task_id: "update-path", status: "pending" })]),
    );
    getTaskMock.mockResolvedValue(updateTask);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Update remote.txt" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "update_path",
        file_path: "remote.txt",
        svn_executable: undefined,
      });
    });
  });

  it("本地与远端同时变化时确认后才执行文件级 Update", async () => {
    await showRemoteUpdateSource("both");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Update remote.txt" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("可能产生合并或冲突"));
    expect(createSvnOperationTaskMock).not.toHaveBeenCalled();
  });

  it("确认后创建 Revert-to-Revision 任务并绑定普通 SVN 完成刷新", async () => {
    getSvnLogMock.mockResolvedValue({
      target: "https://example.com/svn/trunk",
      entries: [
        {
          revision: "10",
          author: "alice",
          date: "2026-07-11T10:00:00Z",
          message: "target",
          changed_paths: [],
        },
      ],
      has_more: false,
      next_start_revision: null,
    });
    await workspaceStore.refreshSvnLog(undefined);
    setCurrentView("history");
    const task = makeTask({ task_id: "revert-revision-10", status: "pending" });
    createRevertRevisionTaskMock.mockResolvedValue(task);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    const revertButton = screen.getByRole("button", { name: "撤销提交 r10" });
    await fireEvent.click(revertButton);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("反向应用该次提交"));
    expect(createRevertRevisionTaskMock).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await fireEvent.click(revertButton);
    await waitFor(() => {
      expect(createRevertRevisionTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        target_revision: "10",
        svn_executable: undefined,
      });
    });
    expect(get(workspaceStore)).toMatchObject({
      pendingSvnOperationTaskId: "revert-revision-10",
      pendingSvnOperationKind: "revert_to_revision",
      pendingSvnOperationWorkingCopyRoot: "C:/repo/wc",
    });
  });

  it("从 Timeline Export 指定 Revision 到本地", async () => {
    getSvnLogMock.mockResolvedValue({
      target: "C:/repo/wc",
      working_copy_root: "C:/repo/wc",
      repository_url: "https://example.com/svn/trunk",
      entries: [
        {
          revision: "10",
          author: "alice",
          date: "2026-07-11T10:00:00Z",
          message: "export target",
          changed_paths: [],
        },
      ],
      has_more: false,
      next_start_revision: null,
    });
    await workspaceStore.refreshSvnLog(undefined);
    setCurrentView("history");
    chooseExportDirectoryMock.mockResolvedValue("C:/exports");
    createRepositoryExportTaskMock.mockResolvedValue(
      makeTask({ task_id: "log-export-10", status: "pending" }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Export r10" }));

    expect(chooseExportDirectoryMock).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Export r10"));
    await waitFor(() => {
      expect(createRepositoryExportTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        local_path: "C:/exports/trunk-r10",
        revision: "10",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryExportTaskId).toBe("log-export-10");
      expect(get(workspaceStore).pendingRepositoryExportLocalPath).toBe(
        "C:/exports/trunk-r10",
      );
    });
  });

  it("确认后创建单个多 Revision 批量撤销任务", async () => {
    getSvnLogMock.mockResolvedValue({
      target: "C:/repo/wc",
      working_copy_root: "C:/repo/wc",
      repository_url: "https://example.com/svn/trunk",
      entries: [
        {
          revision: "12",
          author: "alice",
          date: "2026-07-12T10:00:00Z",
          message: "newer",
          changed_paths: [],
        },
        {
          revision: "10",
          author: "bob",
          date: "2026-07-10T10:00:00Z",
          message: "older",
          changed_paths: [],
        },
      ],
      has_more: false,
      next_start_revision: null,
    });
    await workspaceStore.refreshSvnLog(undefined);
    setCurrentView("history");
    createRevertRevisionTaskMock.mockResolvedValue(
      makeTask({ task_id: "batch-revert-revisions", status: "pending" }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(App);

    await fireEvent.click(screen.getByRole("checkbox", { name: "选择 r12" }));
    await fireEvent.click(screen.getByRole("checkbox", { name: "选择 r10" }));
    await fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Revision 批量操作" })).getByRole(
        "button",
        { name: "撤销选中 Revision" },
      ),
    );

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("选中：r10、r12"));
    await waitFor(() => {
      expect(createRevertRevisionTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        source_url: "https://example.com/svn/trunk",
        target_revisions: ["10", "12"],
        svn_executable: undefined,
      });
    });
    expect(get(workspaceStore)).toMatchObject({
      pendingSvnOperationTaskId: "batch-revert-revisions",
      pendingSvnOperationKind: "revert_to_revision",
      pendingSvnOperationWorkingCopyRoot: "C:/repo/wc",
    });
  });

  it("多选路径确认后创建单个批量 Revert 任务", async () => {
    await showBatchOperationSource();
    const task = makeTask({ task_id: "batch-revert", status: "pending" });
    createSvnBatchOperationTaskMock.mockResolvedValue(task);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(App);

    await selectBatchOperationFiles();
    await fireEvent.click(screen.getByRole("button", { name: "Revert" }));

    await waitFor(() => {
      expect(createSvnBatchOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "revert_paths",
        file_paths: ["alpha.txt", "beta.txt"],
        svn_executable: undefined,
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("alpha.txt"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("beta.txt"));
  });

  it("取消批量 Delete 确认时不创建任务", async () => {
    await showBatchOperationSource();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    await selectBatchOperationFiles();
    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(createSvnBatchOperationTaskMock).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("删除 2 个路径"));
  });

  it("取消单路径 Delete 确认时不创建任务", async () => {
    await showMoveableSource();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更多操作 文件 source.txt" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "删除文件 source.txt" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("source.txt"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("未版本控制内容可能丢失"));
    expect(createSvnOperationTaskMock).not.toHaveBeenCalled();
    expect(get(workspaceStore).pendingSvnOperationTaskId).toBeNull();
  });

  it("删除未版本控制文件时创建 delete_unversioned_file 任务", async () => {
    await showIgnorableSource();
    const task = makeTask({ task_id: "delete-unversioned", status: "pending" });
    createSvnOperationTaskMock.mockResolvedValue(task);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "未管理文件" }));
    await fireEvent.click(
      screen.getByRole("button", { name: "更多操作 文件 assets/cache.tmp" }),
    );
    await fireEvent.click(
      screen.getByRole("menuitem", { name: "删除文件 assets/cache.tmp" }),
    );

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("永久删除未版本控制文件"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("assets/cache.tmp"));
    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "delete_unversioned_file",
        file_path: "assets/cache.tmp",
        svn_executable: undefined,
      });
    });
    expect(get(workspaceStore)).toMatchObject({
      pendingSvnOperationTaskId: "delete-unversioned",
      pendingSvnOperationKind: "delete_unversioned_file",
    });
  });

  it("多选 Move 使用目标目录创建单个批量任务", async () => {
    await showBatchOperationSource();
    const task = makeTask({ task_id: "batch-move", status: "pending" });
    createSvnBatchOperationTaskMock.mockResolvedValue(task);
    vi.spyOn(window, "prompt").mockReturnValue("archive");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(App);

    await selectBatchOperationFiles();
    await fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(createSvnBatchOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "move_paths",
        file_paths: ["alpha.txt", "beta.txt"],
        target_path: "archive",
        svn_executable: undefined,
      });
    });
  });

  it("把所选版本文件加入 Changelist 并刷新状态", async () => {
    await showBatchOperationSource();
    setWorkspaceChangelistMock.mockResolvedValue({
      changelist: "release",
      file_paths: ["alpha.txt", "beta.txt"],
    });
    vi.spyOn(window, "prompt").mockReturnValue("release");
    scanWorkspaceStatusMock.mockClear();
    listWorkspaceFilesMock.mockClear();
    render(App);

    await selectBatchOperationFiles();
    await fireEvent.click(screen.getByRole("button", { name: "加入 Changelist" }));

    await waitFor(() => {
      expect(setWorkspaceChangelistMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        file_paths: ["alpha.txt", "beta.txt"],
        changelist: "release",
        svn_executable: undefined,
      });
    });
    await waitFor(() => {
      expect(scanWorkspaceStatusMock).toHaveBeenCalledOnce();
      expect(listWorkspaceFilesMock).toHaveBeenCalledOnce();
    });
  });

  it("双击文件时通过安全后端入口打开系统默认应用", async () => {
    await showMoveableSource();
    openWorkspaceFileMock.mockResolvedValue({
      target_path: "C:/repo/wc/source.txt",
    });
    render(App);

    await fireEvent.dblClick(screen.getByRole("button", { name: "选择文件 source.txt" }));

    await waitFor(() => {
      expect(openWorkspaceFileMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        file_path: "source.txt",
      });
    });
    expect(document.querySelector(".source-sidebar-meta")).not.toBeInTheDocument();
  });

  it("选中其他任务时仍按 pending id 消费成功操作", async () => {
    const pendingTask = makeTaskSummary({ task_id: "svn-update", status: "success" });
    const selectedTask = makeTask({ task_id: "other-task", status: "running" });
    listTasksMock.mockResolvedValue(makeTaskSnapshot([selectedTask, pendingTask], "other-task"));
    getTaskMock.mockResolvedValue(selectedTask);
    await taskStore.select("other-task");
    scanWorkspaceStatusMock.mockClear();
    render(App);

    workspaceStore.markSvnOperationTask("svn-update", "update", "C:\\repo\\wc\\");

    await waitFor(() => {
      expect(get(workspaceStore).pendingSvnOperationTaskId).toBeNull();
    });
    expect(screen.queryByText("操作已完成，工作副本状态正在刷新")).not.toBeInTheDocument();
    expect(get(taskStore).selectedTask?.task_id).toBe("other-task");
    await waitFor(() => {
      expect(openWorkspaceMock).toHaveBeenLastCalledWith({
        path: "C:\\repo\\wc\\",
        svn_executable: undefined,
      });
    });
  });

  it("后端确认 pending 任务消失后解除操作锁定并提示刷新", async () => {
    getTaskMock.mockRejectedValueOnce({ code: "TASK_NOT_FOUND" });
    render(App);

    workspaceStore.markSvnOperationTask("missing-task", "cleanup", "C:/repo/wc");

    await waitFor(() => {
      expect(get(workspaceStore).pendingSvnOperationTaskId).toBeNull();
    });
    expect(get(workspaceStore).statusError).toMatchObject({
      code: "SVN_OPERATION_TASK_MISSING",
      recoverable: true,
    });
    expect(screen.getByText(/运行中的 SVN 操作已从任务队列中消失/)).toBeInTheDocument();
  });

  it("pending 任务查询瞬时失败时保持操作锁定", async () => {
    getTaskMock.mockRejectedValueOnce({ code: "IPC_ERROR" });
    render(App);

    workspaceStore.markSvnOperationTask("temporarily-unavailable", "cleanup", "C:/repo/wc");

    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledWith("temporarily-unavailable");
    });
    expect(get(workspaceStore).pendingSvnOperationTaskId).toBe(
      "temporarily-unavailable",
    );
    expect(get(workspaceStore).statusError?.code).not.toBe(
      "SVN_OPERATION_TASK_MISSING",
    );
  });

  it("选中其他任务时仍按 pending id 完成 Commit", async () => {
    const pendingSummary = makeTaskSummary({
      task_id: "pending-commit",
      status: "success",
    });
    const pendingTask = makeTask({ task_id: "pending-commit", status: "success" });
    const selectedTask = makeTask({ task_id: "other-task", status: "running" });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([selectedTask, pendingSummary], "other-task"),
    );
    getTaskMock.mockImplementation(async (taskId) =>
      taskId === "pending-commit" ? pendingTask : selectedTask,
    );
    await taskStore.select("other-task");
    render(App);

    workspaceStore.markCommitTask("pending-commit");

    await waitFor(() => {
      expect(get(workspaceStore).pendingCommitTaskId).toBeNull();
    });
    expect(get(taskStore).selectedTask?.task_id).toBe("other-task");
    expect(getTaskMock).toHaveBeenCalledWith("pending-commit");
  });

  it("Commit 成功时只清理任务创建时的目标并刷新绑定的工作副本", async () => {
    await showBatchOperationSource();
    workspaceStore.setCommitMessage("提交 alpha");
    workspaceStore.markCommitTask("pending-commit", ["alpha.txt"], "C:/repo/wc");

    const refreshedStatus = {
      ...get(workspaceStore).status!,
      total: 1,
      returned: 1,
      local_changes: 1,
      files: get(workspaceStore).status!.files.filter((file) => file.path === "beta.txt"),
    };
    scanWorkspaceStatusMock.mockResolvedValue(refreshedStatus);
    const pendingTask = makeTask({
      task_id: "pending-commit",
      status: "success",
    });
    listTasksMock.mockResolvedValue(makeTaskSnapshot([pendingTask]));
    getTaskMock.mockResolvedValue(pendingTask);
    await taskStore.refresh();

    render(App);

    await waitFor(() => {
      expect(get(workspaceStore).pendingCommitTaskId).toBeNull();
      expect(scanWorkspaceStatusMock).toHaveBeenLastCalledWith({
        working_copy_root: "C:/repo/wc",
        svn_executable: undefined,
        offset: 0,
        limit: 500,
        check_remote_updates: true,
      });
    });
    expect(get(workspaceStore).pendingCommitFiles).toEqual([]);
    expect(get(workspaceStore).pendingCommitWorkingCopyRoot).toBeNull();
    expect(get(workspaceStore).commitFiles.map((file) => file.path)).toEqual(["beta.txt"]);
    expect(get(workspaceStore).commitMessage).toBe("");
  });

  it.each([
    ["failed", "服务端拒绝提交", "服务端拒绝提交"],
    ["cancelled", null, "提交任务已取消"],
    ["interrupted", null, "提交任务已中断，请检查工作副本状态后重试"],
  ] as const)("Commit 进入 %s 后清理 pending 并保留提交表单", async (status, error, expected) => {
    await showBatchOperationSource();
    workspaceStore.setCommitMessage("保留提交信息");
    workspaceStore.markCommitTask("pending-commit", ["alpha.txt"], "C:/repo/wc");

    const pendingTask = makeTask({
      task_id: "pending-commit",
      status,
      error,
    });
    listTasksMock.mockResolvedValue(makeTaskSnapshot([pendingTask]));
    getTaskMock.mockResolvedValue(pendingTask);
    await taskStore.refresh();

    render(App);

    await waitFor(() => {
      expect(get(workspaceStore).pendingCommitTaskId).toBeNull();
    });
    const state = get(workspaceStore);
    expect(state.pendingCommitFiles).toEqual([]);
    expect(state.pendingCommitWorkingCopyRoot).toBeNull();
    expect(state.commitFiles.map((file) => file.path)).toEqual(["alpha.txt", "beta.txt"]);
    expect(state.commitMessage).toBe("保留提交信息");
    expect(state.commitError).toBe(expected);
  });

  it("旧 Commit 保留在原项目实例且不影响新项目", async () => {
    workspaceStore.markCommitTask("pending-commit", ["alpha.txt"], "C:/repo/wc");
    openWorkspaceMock.mockResolvedValue({
      ...makeWorkspace(),
      local_path: "D:/repo/other",
      working_copy_root: "D:/repo/other",
    });
    await workspaceStore.openPath(undefined, "D:/repo/other");
    expect(get(workspaceStore).pendingCommitTaskId).toBeNull();

    scanWorkspaceStatusMock.mockClear();
    const pendingTask = makeTask({
      task_id: "pending-commit",
      status: "success",
    });
    listTasksMock.mockResolvedValue(makeTaskSnapshot([pendingTask]));
    getTaskMock.mockResolvedValue(pendingTask);
    await taskStore.refresh();

    render(App);

    await waitFor(() => {
      expect(get(workspaceStore).pendingCommitTaskId).toBeNull();
    });
    expect(get(workspaceStore).current?.working_copy_root).toBe("D:/repo/other");
    expect(get(workspaceStore).commitFiles).toEqual([]);
    expect(scanWorkspaceStatusMock).not.toHaveBeenCalled();
  });

  it("选中其他任务时仍应用 Repository List 完整结果", async () => {
    const pendingSummary = makeTaskSummary({
      task_id: "repository-list",
      status: "success",
    });
    const pendingTask = makeTask({
      task_id: "repository-list",
      status: "success",
      result: {
        repository_list: {
          url: "https://example.com/svn/trunk/src",
          revision: null,
          entries: [],
        },
        repository_file: null,
        repository_export: null,
        revision_diff: null,
        merge_result: null,
        apply_patch_result: null,
      },
    });
    const selectedTask = makeTask({ task_id: "other-task", status: "running" });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([selectedTask, pendingSummary], "other-task"),
    );
    getTaskMock.mockImplementation(async (taskId) =>
      taskId === "repository-list" ? pendingTask : selectedTask,
    );
    await taskStore.select("other-task");
    render(App);

    workspaceStore.markRepositoryListTask(
      "repository-list",
      "https://example.com/svn/trunk/src",
    );

    await waitFor(() => {
      expect(get(workspaceStore).pendingRepositoryListTaskId).toBeNull();
    });
    expect(get(workspaceStore).repositoryList?.url).toBe(
      "https://example.com/svn/trunk/src",
    );
  });

  it("仓库文件任务完成后按 pending id 打开临时副本", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [
        {
          name: "README space.md",
          kind: "file",
          revision: "9",
          author: "dev",
          date: "2026-07-11T01:02:03Z",
        },
      ],
    });
    const pendingTask = makeTask({ task_id: "repository-file", status: "pending" });
    createRepositoryFileTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-file", status: "pending" }),
      ]),
    );
    openRepositoryTempFileMock.mockResolvedValue({ target_path: "C:/data/README space.md" });
    render(App);

    await fireEvent.click(
      screen.getByRole("button", {
        name: "打开仓库文件 README space.md 的临时副本",
      }),
    );

    await waitFor(() => {
      expect(createRepositoryFileTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/README%20space.md",
        revision: "10",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryFileTaskId).toBe("repository-file");
    });

    const completedTask = makeTask({
      task_id: "repository-file",
      status: "success",
      result: {
        repository_list: null,
        repository_file: {
          url: "https://example.com/svn/trunk/README%20space.md",
          revision: "10",
          file_path: "C:/data/README space.md",
          file_name: "README space.md",
          bytes: 12,
        },
        repository_export: null,
        revision_diff: null,
        merge_result: null,
        apply_patch_result: null,
      },
    });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-file", status: "success" }),
      ]),
    );
    getTaskMock.mockResolvedValue(completedTask);
    await taskStore.refresh();

    await waitFor(() => {
      expect(openRepositoryTempFileMock).toHaveBeenCalledWith({
        path: "C:/data/README space.md",
      });
      expect(get(workspaceStore).pendingRepositoryFileTaskId).toBeNull();
      expect(get(workspaceStore).repositoryFileError).toBeNull();
    });
  });

  it("仓库临时副本打开失败时解除 pending 并显示错误", async () => {
    const failedTask = makeTask({
      task_id: "repository-open-failed",
      status: "success",
      result: {
        repository_list: null,
        repository_file: {
          url: "https://example.com/svn/trunk/file.txt",
          revision: null,
          file_path: "C:/data/file.txt",
          file_name: "file.txt",
          bytes: 4,
        },
        repository_export: null,
        revision_diff: null,
        merge_result: null,
        apply_patch_result: null,
      },
    });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-open-failed", status: "success" }),
      ]),
    );
    getTaskMock.mockResolvedValue(failedTask);
    openRepositoryTempFileMock.mockRejectedValue({ message: "没有可用的默认应用" });
    render(App);

    workspaceStore.markRepositoryFileTask("repository-open-failed");
    await taskStore.refresh();

    await waitFor(() => {
      expect(get(workspaceStore).pendingRepositoryFileTaskId).toBeNull();
      expect(get(workspaceStore).repositoryFileError).toBe("没有可用的默认应用");
    });
  });

  it("仓库 Checkout 完成后按 pending 本地路径打开工作副本", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryCheckoutForm("url", "https://example.com/svn/trunk");
    workspaceStore.setRepositoryCheckoutForm("localPath", "C:/checkouts/trunk");
    workspaceStore.setRepositoryCheckoutForm("revision", "10");

    const pendingTask = makeTask({ task_id: "repository-checkout", status: "pending" });
    createRepositoryCheckoutTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-checkout", status: "pending" }),
      ]),
    );
    openWorkspaceMock.mockResolvedValue({
      local_path: "C:/checkouts/trunk",
      working_copy_root: "C:/checkouts/trunk",
      repository_url: "https://example.com/svn/trunk",
      repository_root: "https://example.com/svn",
      revision: "10",
    });
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(createRepositoryCheckoutTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        local_path: "C:/checkouts/trunk",
        revision: "10",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryCheckoutTaskId).toBe("repository-checkout");
      expect(get(workspaceStore).pendingRepositoryCheckoutLocalPath).toBe("C:/checkouts/trunk");
    });

    const completedTask = makeTask({
      task_id: "repository-checkout",
      status: "success",
    });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-checkout", status: "success" }),
      ]),
    );
    getTaskMock.mockResolvedValue(completedTask);
    openWorkspaceMock.mockClear();
    await taskStore.refresh();

    await waitFor(() => {
      expect(openWorkspaceMock).toHaveBeenCalledWith({
        path: "C:/checkouts/trunk",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryCheckoutTaskId).toBeNull();
      expect(get(workspaceStore).repositoryCheckoutError).toBeNull();
    });
  });

  it("仓库 Export 完成后按 pending 本地路径打开位置且不打开工作副本", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryExportForm("url", "https://example.com/svn/trunk");
    workspaceStore.setRepositoryExportForm("localPath", "C:/exports/trunk");
    workspaceStore.setRepositoryExportForm("revision", "10");

    const pendingTask = makeTask({ task_id: "repository-export", status: "pending" });
    createRepositoryExportTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-export", status: "pending" }),
      ]),
    );
    openLocalPathLocationMock.mockResolvedValue({ target_path: "C:/exports/trunk" });
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => {
      expect(createRepositoryExportTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        local_path: "C:/exports/trunk",
        revision: "10",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryExportTaskId).toBe("repository-export");
      expect(get(workspaceStore).pendingRepositoryExportLocalPath).toBe("C:/exports/trunk");
    });

    const completedTask = makeTask({
      task_id: "repository-export",
      status: "success",
    });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-export", status: "success" }),
      ]),
    );
    getTaskMock.mockResolvedValue(completedTask);
    openWorkspaceMock.mockClear();
    await taskStore.refresh();

    await waitFor(() => {
      expect(openLocalPathLocationMock).toHaveBeenCalledWith({
        path: "C:/exports/trunk",
      });
      expect(openWorkspaceMock).not.toHaveBeenCalled();
      expect(get(workspaceStore).pendingRepositoryExportTaskId).toBeNull();
      expect(get(workspaceStore).repositoryExportError).toBeNull();
    });
  });

  it("拖出仓库条目先执行真实 Export，再通过原生插件复用本地产物", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [
        {
          name: "assets",
          kind: "dir",
          revision: "9",
          author: "dev",
          date: "2026-07-11T01:02:03Z",
        },
      ],
    });
    const pendingTask = makeTask({ task_id: "repository-drag-export", status: "pending" });
    createRepositoryDragExportTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-drag-export", status: "pending" }),
      ]),
    );
    render(App);

    const dragHandle = screen.getByRole("button", {
      name: "拖出仓库条目 assets 执行 Export",
    });
    await fireEvent.pointerDown(dragHandle, { button: 0 });

    await waitFor(() => {
      expect(createRepositoryDragExportTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/assets",
        name: "assets",
        revision: "10",
        svn_executable: undefined,
      });
      expect(dragHandle).toBeDisabled();
    });

    const completedTask = makeTask({
      task_id: "repository-drag-export",
      status: "success",
      result: {
        repository_list: null,
        repository_file: null,
        repository_export: {
          url: "https://example.com/svn/trunk/assets",
          revision: "10",
          local_path: "C:/data/repository-drag-exports/task-1/assets",
          file_name: "assets",
        },
        revision_diff: null,
        merge_result: null,
        apply_patch_result: null,
      },
    });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-drag-export", status: "success" }),
      ]),
    );
    getTaskMock.mockResolvedValue(completedTask);
    await taskStore.refresh();

    await waitFor(() => {
      expect(startDragMock).toHaveBeenCalledWith({
        item: ["C:/data/repository-drag-exports/task-1/assets"],
        icon: expect.stringContaining("data:image/png;base64,"),
        mode: "copy",
      });
      expect(dragHandle).toBeEnabled();
    });

    await fireEvent.pointerDown(dragHandle, { button: 0 });
    await waitFor(() => expect(startDragMock).toHaveBeenCalledTimes(2));
    expect(createRepositoryDragExportTaskMock).toHaveBeenCalledOnce();
  });

  it("创建仓库目录要求确认并在成功后刷新原父目录", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryMkdirForm(
      "targetUrl",
      "https://example.com/svn/trunk/assets",
    );
    workspaceStore.setRepositoryMkdirForm("message", "创建 assets");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const pendingTask = makeTask({ task_id: "repository-mkdir", status: "pending" });
    createRepositoryMkdirTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-mkdir", status: "pending" }),
      ]),
    );
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "创建目录" }));
    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining("https://example.com/svn/trunk/assets"),
      );
      expect(createRepositoryMkdirTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/assets",
        message: "创建 assets",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryMkdirTaskId).toBe("repository-mkdir");
      expect(get(workspaceStore).pendingRepositoryMkdirParentUrl).toBe(
        "https://example.com/svn/trunk",
      );
    });

    createRepositoryListTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-refresh", status: "pending" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-mkdir", status: "success" }),
    );
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-mkdir", status: "success" }),
      ]),
    );
    await taskStore.refresh();

    await waitFor(() => {
      expect(createRepositoryListTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        revision: undefined,
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryMkdirTaskId).toBeNull();
      expect(get(workspaceStore).repositoryMkdirError).toBeNull();
      expect(get(workspaceStore).repositoryRevisionInput).toBe("");
    });
  });

  it("Repository Import 要求确认并在成功后刷新目标父目录", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryImportForm("sourcePath", "/Users/me/assets");
    workspaceStore.setRepositoryImportForm(
      "targetUrl",
      "https://example.com/svn/trunk/assets",
    );
    workspaceStore.setRepositoryImportForm("message", "导入 assets");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const pendingTask = makeTask({ task_id: "repository-import", status: "pending" });
    createRepositoryImportTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-import", status: "pending" }),
      ]),
    );
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("/Users/me/assets"));
      expect(createRepositoryImportTaskMock).toHaveBeenCalledWith({
        source_path: "/Users/me/assets",
        target_url: "https://example.com/svn/trunk/assets",
        message: "导入 assets",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryImportTaskId).toBe("repository-import");
      expect(get(workspaceStore).pendingRepositoryImportParentUrl).toBe(
        "https://example.com/svn/trunk",
      );
    });

    createRepositoryListTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-refresh", status: "pending" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-import", status: "success" }),
    );
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-import", status: "success" }),
      ]),
    );
    await taskStore.refresh();

    await waitFor(() => {
      expect(createRepositoryListTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        revision: undefined,
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryImportTaskId).toBeNull();
      expect(get(workspaceStore).repositoryImportError).toBeNull();
      expect(get(workspaceStore).repositoryRevisionInput).toBe("");
    });
  });

  it("Repository 通用 Copy 要求确认并在成功后刷新目标父目录", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk/assets",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryCopyForm("kind", "entry");
    workspaceStore.setRepositoryCopyForm(
      "sourceUrl",
      "https://example.com/svn/trunk/assets",
    );
    workspaceStore.setRepositoryCopyForm(
      "targetUrl",
      "https://example.com/svn/trunk/assets-copy",
    );
    workspaceStore.setRepositoryCopyForm("revision", "10");
    workspaceStore.setRepositoryCopyForm("message", "复制 assets");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const pendingTask = makeTask({ task_id: "repository-copy", status: "pending" });
    createRepositoryCopyTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-copy", status: "pending" }),
      ]),
    );
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("复制仓库条目"));
      expect(createRepositoryCopyTaskMock).toHaveBeenCalledWith({
        kind: "entry",
        source_url: "https://example.com/svn/trunk/assets",
        target_url: "https://example.com/svn/trunk/assets-copy",
        revision: "10",
        message: "复制 assets",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryCopyTaskId).toBe("repository-copy");
      expect(get(workspaceStore).pendingRepositoryCopyParentUrl).toBe(
        "https://example.com/svn/trunk",
      );
    });

    createRepositoryListTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-refresh", status: "pending" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-copy", status: "success" }),
    );
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-copy", status: "success" }),
      ]),
    );
    await taskStore.refresh();

    await waitFor(() => {
      expect(createRepositoryListTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        revision: undefined,
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryCopyTaskId).toBeNull();
      expect(get(workspaceStore).repositoryCopyError).toBeNull();
      expect(get(workspaceStore).repositoryRevisionInput).toBe("");
    });
  });

  it("Repository Move 要求确认并优先刷新当前源父目录", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryMoveForm(
      "sourceUrl",
      "https://example.com/svn/trunk/assets",
    );
    workspaceStore.setRepositoryMoveForm(
      "targetUrl",
      "https://example.com/svn/archive/assets",
    );
    workspaceStore.setRepositoryMoveForm("message", "移动 assets");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const pendingTask = makeTask({ task_id: "repository-move", status: "pending" });
    createRepositoryMoveTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-move", status: "pending" }),
      ]),
    );
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("移动仓库条目"));
      expect(createRepositoryMoveTaskMock).toHaveBeenCalledWith({
        kind: undefined,
        source_url: "https://example.com/svn/trunk/assets",
        target_url: "https://example.com/svn/archive/assets",
        message: "移动 assets",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryMoveTaskId).toBe("repository-move");
      expect(get(workspaceStore).pendingRepositoryMoveSourceParentUrl).toBe(
        "https://example.com/svn/trunk",
      );
      expect(get(workspaceStore).pendingRepositoryMoveTargetParentUrl).toBe(
        "https://example.com/svn/archive",
      );
    });

    createRepositoryListTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-refresh", status: "pending" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-move", status: "success" }),
    );
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-move", status: "success" }),
      ]),
    );
    await taskStore.refresh();

    await waitFor(() => {
      expect(createRepositoryListTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        revision: undefined,
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryMoveTaskId).toBeNull();
      expect(get(workspaceStore).repositoryMoveError).toBeNull();
    });
  });

  it("Repository Rename 使用同目录目标并清理独立表单", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryRenameForm(
      "sourceUrl",
      "https://example.com/svn/trunk/assets",
    );
    workspaceStore.setRepositoryRenameForm(
      "targetUrl",
      "https://example.com/svn/trunk/assets-renamed",
    );
    workspaceStore.setRepositoryRenameForm("message", "重命名 assets");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const pendingTask = makeTask({ task_id: "repository-rename", status: "pending" });
    createRepositoryMoveTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-rename", status: "pending" }),
      ]),
    );
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("重命名仓库条目"));
      expect(createRepositoryMoveTaskMock).toHaveBeenCalledWith({
        kind: "rename",
        source_url: "https://example.com/svn/trunk/assets",
        target_url: "https://example.com/svn/trunk/assets-renamed",
        message: "重命名 assets",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryMoveKind).toBe("rename");
    });

    createRepositoryListTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-refresh", status: "pending" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-rename", status: "success" }),
    );
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-rename", status: "success" }),
      ]),
    );
    await taskStore.refresh();

    await waitFor(() => {
      expect(createRepositoryListTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        revision: undefined,
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryMoveTaskId).toBeNull();
      expect(get(workspaceStore).repositoryRenameForm).toEqual({
        sourceUrl: "",
        targetUrl: "",
        message: "",
      });
      expect(get(workspaceStore).repositoryRenameError).toBeNull();
    });
  });

  it("Repository Delete 要求破坏性确认并刷新目标父目录", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryDeleteForm(
      "url",
      "https://example.com/svn/trunk/obsolete",
    );
    workspaceStore.setRepositoryDeleteForm("message", "删除 obsolete");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const pendingTask = makeTask({ task_id: "repository-delete", status: "pending" });
    createRepositoryDeleteTaskMock.mockResolvedValue(pendingTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-delete", status: "pending" }),
      ]),
    );
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("永久删除仓库条目"));
      expect(createRepositoryDeleteTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/obsolete",
        message: "删除 obsolete",
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryDeleteTaskId).toBe("repository-delete");
      expect(get(workspaceStore).pendingRepositoryDeleteParentUrl).toBe(
        "https://example.com/svn/trunk",
      );
    });

    createRepositoryListTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-refresh", status: "pending" }),
    );
    getTaskMock.mockResolvedValue(
      makeTask({ task_id: "repository-delete", status: "success" }),
    );
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([
        makeTaskSummary({ task_id: "repository-delete", status: "success" }),
      ]),
    );
    await taskStore.refresh();

    await waitFor(() => {
      expect(createRepositoryListTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        revision: undefined,
        svn_executable: undefined,
      });
      expect(get(workspaceStore).pendingRepositoryDeleteTaskId).toBeNull();
      expect(get(workspaceStore).repositoryDeleteError).toBeNull();
    });
  });

  it("用户取消确认时所有 Repository 写操作都不会创建任务", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [],
    });
    workspaceStore.setRepositoryCopyForm("kind", "entry");
    workspaceStore.setRepositoryCopyForm("sourceUrl", "https://example.com/svn/trunk/source");
    workspaceStore.setRepositoryCopyForm("targetUrl", "https://example.com/svn/trunk/copy");
    workspaceStore.setRepositoryCopyForm("message", "复制条目");
    workspaceStore.setRepositoryMkdirForm("targetUrl", "https://example.com/svn/trunk/new-dir");
    workspaceStore.setRepositoryMkdirForm("message", "创建目录");
    workspaceStore.setRepositoryImportForm("sourcePath", "/Users/me/import-source");
    workspaceStore.setRepositoryImportForm("targetUrl", "https://example.com/svn/trunk/import");
    workspaceStore.setRepositoryImportForm("message", "导入条目");
    workspaceStore.setRepositoryMoveForm("sourceUrl", "https://example.com/svn/trunk/move");
    workspaceStore.setRepositoryMoveForm("targetUrl", "https://example.com/svn/archive/move");
    workspaceStore.setRepositoryMoveForm("message", "移动条目");
    workspaceStore.setRepositoryRenameForm("sourceUrl", "https://example.com/svn/trunk/old");
    workspaceStore.setRepositoryRenameForm("targetUrl", "https://example.com/svn/trunk/new");
    workspaceStore.setRepositoryRenameForm("message", "重命名条目");
    workspaceStore.setRepositoryDeleteForm("url", "https://example.com/svn/trunk/delete");
    workspaceStore.setRepositoryDeleteForm("message", "删除条目");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    for (const name of ["创建", "创建目录", "Import", "Move", "Rename", "Delete"]) {
      await fireEvent.click(screen.getByRole("button", { name }));
    }

    expect(confirm).toHaveBeenCalledTimes(6);
    expect(createRepositoryCopyTaskMock).not.toHaveBeenCalled();
    expect(createRepositoryMkdirTaskMock).not.toHaveBeenCalled();
    expect(createRepositoryImportTaskMock).not.toHaveBeenCalled();
    expect(createRepositoryMoveTaskMock).not.toHaveBeenCalled();
    expect(createRepositoryDeleteTaskMock).not.toHaveBeenCalled();
  });

  it("仓库文件 Log、Blame 和 Properties 使用当前 Revision 与编码后的文件 URL", async () => {
    setCurrentView("repository");
    workspaceStore.applyRepositoryListResult({
      url: "https://example.com/svn/trunk",
      revision: "10",
      entries: [
        {
          name: "README space.md",
          kind: "file",
          revision: "9",
          author: "dev",
          date: "2026-07-11T01:02:03Z",
        },
      ],
    });
    getRepositoryFileLogMock.mockResolvedValue({
      target: "https://example.com/svn/trunk/README%20space.md",
      entries: [
        {
          revision: "9",
          author: "dev",
          date: "2026-07-11T01:02:03Z",
          message: "Update README",
          changed_paths: [],
        },
      ],
      has_more: false,
      next_start_revision: null,
    });
    getRepositoryFileBlameMock.mockResolvedValue({
      target: "https://example.com/svn/trunk/README%20space.md",
      total_lines: 1,
      truncated: false,
      lines: [
        {
          line_number: 1,
          revision: "9",
          author: "dev",
          date: "2026-07-11T01:02:03Z",
          content: "README title",
        },
      ],
    });
    getRepositoryFilePropertiesMock.mockResolvedValue({
      target: "https://example.com/svn/trunk/README%20space.md",
      properties: [{ name: "svn:mime-type", value: "text/plain" }],
      externals: null,
    });
    render(App);

    await fireEvent.click(
      screen.getByRole("button", {
        name: "查看仓库文件 README space.md 的 Log",
      }),
    );

    await waitFor(() => {
      expect(getRepositoryFileLogMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/README%20space.md",
        revision: "10",
        svn_executable: undefined,
        limit: 50,
      });
      expect(screen.getByLabelText("仓库文件日志")).toHaveTextContent("Update README");
    });

    await fireEvent.click(
      screen.getByRole("button", {
        name: "查看仓库文件 README space.md 的 Blame",
      }),
    );

    await waitFor(() => {
      expect(getRepositoryFileBlameMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/README%20space.md",
        revision: "10",
        svn_executable: undefined,
        max_lines: 5000,
      });
      expect(screen.queryByLabelText("仓库文件日志")).not.toBeInTheDocument();
      expect(screen.getByLabelText("仓库文件 Blame")).toHaveTextContent("README title");
    });

    await fireEvent.click(
      screen.getByRole("button", {
        name: "查看仓库文件 README space.md 的 Properties",
      }),
    );

    await waitFor(() => {
      expect(getRepositoryFilePropertiesMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/README%20space.md",
        revision: "10",
        svn_executable: undefined,
      });
      expect(screen.queryByLabelText("仓库文件 Blame")).not.toBeInTheDocument();
      expect(screen.getByLabelText("仓库文件 Properties")).toHaveTextContent("text/plain");
    });
  });

  it.each([
    ["cancelled", "用户取消 Merge"],
    ["interrupted", "应用重启前 Merge 未完成"],
  ] as const)("按 pending id 处理 %s 的 Merge", async (status, error) => {
    const pendingSummary = makeTaskSummary({
      task_id: "merge-task",
      status,
    });
    const pendingTask = makeTask({
      task_id: "merge-task",
      status,
      error,
    });
    const selectedTask = makeTask({ task_id: "other-task", status: "running" });
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([selectedTask, pendingSummary], "other-task"),
    );
    getTaskMock.mockImplementation(async (taskId) =>
      taskId === "merge-task" ? pendingTask : selectedTask,
    );
    await taskStore.select("other-task");
    render(App);

    workspaceStore.markMergeTask("merge-task");

    await waitFor(() => {
      expect(get(workspaceStore).pendingMergeTaskId).toBeNull();
    });
    expect(get(workspaceStore).mergeError).toBe(error);
  });

  it("Merge 完成后选中首个冲突并进入 Resolve 操作", async () => {
    const pendingSummary = makeTaskSummary({
      task_id: "merge-conflict",
      status: "success",
    });
    const completedTask = makeTask({
      task_id: "merge-conflict",
      status: "success",
      result: {
        repository_list: null,
        repository_file: null,
        repository_export: null,
        revision_diff: null,
        merge_result: {
          dry_run: false,
          source_url: "https://example.com/svn/branches/feature",
          revision_range: "10:12",
          record_only: false,
          ignore_ancestry: false,
          force: false,
          output_text: "C    src/conflict.ts",
          output_truncated: false,
          max_output_bytes: 256 * 1024,
          file_count: 1,
          line_count: 1,
          added: 0,
          deleted: 0,
          updated: 0,
          conflicted: 1,
        },
        apply_patch_result: null,
      },
    });
    const conflictedStatus = makeStatus();
    conflictedStatus.total = 1;
    conflictedStatus.returned = 1;
    conflictedStatus.local_changes = 1;
    conflictedStatus.conflicted = 1;
    conflictedStatus.files = [
      {
        path: "src/conflict.ts",
        status: "conflicted",
        revision: "12",
        property_status: null,
        property_changed: false,
        remote_status: null,
        remote_property_status: null,
        change_scope: "local",
        abnormal: true,
        lock_state: "none",
        lock_owner: null,
        lock_comment: null,
        conflict_kind: "text",
        file_size: 10,
        content_digest: "merge-conflict-digest",
      },
    ];
    listTasksMock.mockResolvedValue(makeTaskSnapshot([pendingSummary]));
    getTaskMock.mockResolvedValue(completedTask);
    scanWorkspaceStatusMock.mockResolvedValueOnce(conflictedStatus);
    await taskStore.refresh();
    setCurrentView("branches");
    render(App);

    workspaceStore.markMergeTask("merge-conflict");

    await waitFor(() => {
      expect(get(currentView)).toBe("changes");
      expect(get(workspaceStore).selectedFilePath).toBe("src/conflict.ts");
      expect(get(workspaceStore).statusFilters).toEqual(["conflicted"]);
    });
  });

  it("确认源和目标后创建工作副本 Move 任务", async () => {
    await showMoveableSource();
    vi.spyOn(window, "prompt").mockReturnValue("renamed.txt");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const moveTask = makeTask({ task_id: "move-task", status: "pending" });
    createSvnOperationTaskMock.mockResolvedValue(moveTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([makeTaskSummary({ task_id: "move-task", status: "pending" })]),
    );
    getTaskMock.mockResolvedValue(moveTask);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更多操作 文件 source.txt" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "移动文件 source.txt" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "move_path",
        file_path: "source.txt",
        target_path: "renamed.txt",
        svn_executable: undefined,
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("源：source.txt\n目标：renamed.txt"),
    );
  });

  it("取消 Move 影响确认时不创建任务", async () => {
    await showMoveableSource();
    vi.spyOn(window, "prompt").mockReturnValue("renamed.txt");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更多操作 文件 source.txt" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "移动文件 source.txt" }));

    expect(createSvnOperationTaskMock).not.toHaveBeenCalled();
  });

  it("确认源和目标后创建工作副本 Copy 任务", async () => {
    await showMoveableSource();
    vi.spyOn(window, "prompt").mockReturnValue("copied.txt");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const copyTask = makeTask({ task_id: "copy-task", status: "pending" });
    createSvnOperationTaskMock.mockResolvedValue(copyTask);
    listTasksMock.mockResolvedValue(
      makeTaskSnapshot([makeTaskSummary({ task_id: "copy-task", status: "pending" })]),
    );
    getTaskMock.mockResolvedValue(copyTask);
    render(App);

    await fireEvent.click(screen.getByRole("button", { name: "更多操作 文件 source.txt" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "复制文件 source.txt" }));

    await waitFor(() => {
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        kind: "copy_path",
        file_path: "source.txt",
        target_path: "copied.txt",
        svn_executable: undefined,
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("源：source.txt\n目标：copied.txt"),
    );
  });

  it("确认目标和作用目录后写入 Ignore 并刷新工作副本", async () => {
    await showIgnorableSource();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    ignoreWorkspacePathMock.mockResolvedValueOnce({
      target: "assets",
      properties: [{ name: "svn:ignore", value: "cache.tmp" }],
      externals: null,
    });
    scanWorkspaceStatusMock.mockClear();
    listWorkspaceFilesMock.mockClear();
    render(App);

    await fireEvent.click(
      screen.getByRole("button", { name: "更多操作 文件 assets/cache.tmp" }),
    );
    await fireEvent.click(
      screen.getByRole("menuitem", { name: "Ignore 文件 assets/cache.tmp" }),
    );

    await waitFor(() => {
      expect(ignoreWorkspacePathMock).toHaveBeenCalledWith({
        working_copy_root: "C:/repo/wc",
        file_path: "assets/cache.tmp",
        svn_executable: undefined,
      });
    });
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("目标：assets/cache.tmp\n规则作用目录：assets"),
    );
    await waitFor(() => {
      expect(scanWorkspaceStatusMock).toHaveBeenCalledOnce();
      expect(listWorkspaceFilesMock).toHaveBeenCalledOnce();
    });
    expect(get(workspaceStore)).toMatchObject({
      svnProperties: { target: "assets" },
      propertyEditForm: { name: "svn:ignore", value: "cache.tmp" },
    });
  });
});

async function showMoveableSource() {
  const tree = makeFileTree();
  tree.total_files = 1;
  tree.returned_files = 1;
  tree.nodes = [
    {
      path: "source.txt",
      name: "source.txt",
      kind: "file",
      status: "modified",
      revision: "12",
      ...makeNodeMetadata("12", "local"),
      file_size: 10,
      changed: true,
      versioned: true,
      children: [],
    },
  ];
  listWorkspaceFilesMock.mockResolvedValueOnce(tree);
  await workspaceStore.refreshFileTree();
}

async function showBatchOperationSource() {
  const status = makeStatus();
  status.total = 2;
  status.returned = 2;
  status.local_changes = 2;
  status.files = ["alpha.txt", "beta.txt"].map((path) => ({
    path,
    status: "modified",
    revision: "12",
    property_status: null,
    property_changed: false,
    remote_status: null,
    remote_property_status: null,
    change_scope: "local" as const,
    abnormal: false,
    lock_state: "none" as const,
    lock_owner: null,
    lock_comment: null,
    conflict_kind: null,
    file_size: 10,
    content_digest: `${path}-digest`,
  }));
  const tree = makeFileTree();
  tree.total_files = 2;
  tree.returned_files = 2;
  tree.nodes = ["alpha.txt", "beta.txt"].map((path) => ({
    path,
    name: path,
    kind: "file" as const,
    status: "modified",
    revision: "12",
    ...makeNodeMetadata("12", "local"),
    file_size: 10,
    changed: true,
    versioned: true,
    children: [],
  }));
  scanWorkspaceStatusMock.mockResolvedValueOnce(status);
  listWorkspaceFilesMock.mockResolvedValueOnce(tree);
  await workspaceStore.refreshStatus();
}

async function selectBatchOperationFiles() {
  await fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 alpha.txt" }));
  await fireEvent.click(screen.getByRole("checkbox", { name: "选择文件 beta.txt" }));
}

async function showRemoteUpdateSource(changeScope: "remote" | "both" = "remote") {
  const status = makeStatus();
  status.total = 1;
  status.returned = 1;
  status.local_changes = changeScope === "both" ? 1 : 0;
  status.remote_changes = 1;
  status.combined_changes = changeScope === "both" ? 1 : 0;
  status.files = [
    {
      path: "remote.txt",
      status: changeScope === "both" ? "modified" : "normal",
      revision: "12",
      property_status: null,
      property_changed: false,
      remote_status: "modified",
      remote_property_status: null,
      change_scope: changeScope,
      abnormal: false,
      lock_state: "none",
      lock_owner: null,
      lock_comment: null,
      conflict_kind: null,
      file_size: 10,
      content_digest: "remote-digest",
    },
  ];
  const tree = makeFileTree();
  tree.total_files = 1;
  tree.returned_files = 1;
  tree.nodes = [
    {
      path: "remote.txt",
      name: "remote.txt",
      kind: "file",
      status: changeScope === "both" ? "modified" : "normal",
      revision: "12",
      ...makeNodeMetadata("12", changeScope),
      remote_status: "modified",
      file_size: 10,
      changed: true,
      versioned: true,
      children: [],
    },
  ];
  scanWorkspaceStatusMock.mockResolvedValueOnce(status);
  listWorkspaceFilesMock.mockResolvedValueOnce(tree);
  await workspaceStore.refreshStatus();
}

async function showIgnorableSource() {
  const status = makeStatus();
  status.total = 1;
  status.returned = 1;
  status.unversioned = 1;
  status.files = [
    {
      path: "assets/cache.tmp",
      status: "unversioned",
      revision: null,
      property_status: null,
      property_changed: false,
      remote_status: null,
      remote_property_status: null,
      change_scope: "local",
      abnormal: false,
      lock_state: "none",
      lock_owner: null,
      lock_comment: null,
      conflict_kind: null,
      file_size: 10,
      content_digest: "cache-digest",
    },
  ];
  const tree = makeFileTree();
  tree.total_files = 1;
  tree.returned_files = 1;
  tree.nodes = [
    {
      path: "assets/cache.tmp",
      name: "cache.tmp",
      kind: "file",
      status: "unversioned",
      revision: null,
      ...makeNodeMetadata(null, "local"),
      file_size: 10,
      changed: true,
      versioned: false,
      children: [],
    },
  ];
  scanWorkspaceStatusMock.mockResolvedValueOnce(status);
  listWorkspaceFilesMock.mockResolvedValueOnce(tree);
  await workspaceStore.refreshStatus();
}

function makeWorkspace(): WorkspaceSummary {
  return {
    local_path: "C:/repo/wc",
    working_copy_root: "C:/repo/wc",
    repository_url: "https://example.com/svn/trunk",
    repository_root: "https://example.com/svn",
    revision: "12",
  };
}

function makeStatus(): WorkingCopyStatus {
  return {
    working_copy_root: "C:/repo/wc",
    total: 0,
    returned: 0,
    offset: 0,
    limit: 500,
    revision_range: "12",
    mixed_revision: false,
    remote_updates_checked: true,
    repository_revision: "12",
    local_changes: 0,
    remote_changes: 0,
    combined_changes: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    missing: 0,
    unversioned: 0,
    conflicted: 0,
    obstructed: 0,
    property_changed: 0,
    files: [],
  };
}

function makeFileTree(): WorkspaceFileTree {
  return {
    working_copy_root: "C:/repo/wc",
    total_files: 0,
    returned_files: 0,
    truncated: false,
    nodes: [],
  };
}

function makeSvnLog(workingCopyRoot: string): SvnLog {
  return {
    target: "https://example.com/svn/trunk",
    working_copy_root: workingCopyRoot,
    repository_root: "https://example.com/svn",
    repository_url: "https://example.com/svn/trunk",
    entries: [],
    has_more: false,
    next_start_revision: null,
  };
}

function makeNodeMetadata(
  revision: string | null,
  changeScope: "none" | "local" | "remote" | "both" = "none",
) {
  return {
    remote_status: null,
    remote_property_status: null,
    change_scope: changeScope,
    base_revision: revision,
    last_revision: revision,
    last_changed_date: revision ? "2026-07-11T01:02:03Z" : null,
    last_changed_author: revision ? "dev" : null,
  };
}

function makeTaskSummary(task: Partial<TaskSummary> = {}): TaskSummary {
  return {
    task_id: "task-1",
    title: "SVN 操作",
    status: "pending",
    error: null,
    created_at: 1,
    updated_at: 1,
    ...task,
  };
}

function makeTask(task: Partial<Task> = {}): Task {
  return {
    ...makeTaskSummary(task),
    logs: [],
    result: null,
    ...task,
  };
}

function makeTaskSnapshot(
  tasks: TaskSummary[],
  runningTaskId: string | null = null,
): TaskSnapshot {
  return {
    tasks,
    running_task_id: runningTaskId,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
