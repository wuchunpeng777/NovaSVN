import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CommandError,
  CommandResponse,
  BranchPool,
  CreateCommitTaskRequest,
  CreateBranchCheckoutTaskRequest,
  CreateMockTaskRequest,
  CreatePartialCommitTaskRequest,
  CreateRepositoryCopyTaskRequest,
  CreateRepositoryListTaskRequest,
  CreateShadowWorkspaceTaskRequest,
  CreateSvnOperationTaskRequest,
  CreateSvnSwitchTaskRequest,
  DetectSvnRequest,
  FileDiff,
  FileContentDiff,
  GenerateSelectedPatchRequest,
  GetFileContentDiffRequest,
  GetFileDiffRequest,
  OpenWorkspaceRequest,
  ParsedDiff,
  RecentWorkspace,
  RemoveBranchPoolEntryRequest,
  RemoveTaskWorkspaceRequest,
  ScanWorkspaceStatusRequest,
  SaveBranchPoolEntryRequest,
  SaveTaskWorkspaceRequest,
  SvnDetection,
  SelectedPatch,
  ShadowWorkspaceRequest,
  ShadowWorkspaceStatus,
  Task,
  TaskSnapshot,
  TaskWorkspaceList,
  WorkingCopyStatus,
  WorkspaceSummary,
} from "../types/api";

function normalizeError(error: unknown): CommandError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<CommandError>;
    return {
      kind: candidate.kind,
      code: candidate.code ?? "UNKNOWN_ERROR",
      message: candidate.message ?? "命令执行失败",
      detail: candidate.detail ?? null,
      recoverable: candidate.recoverable ?? false,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(error || "命令执行失败"),
    detail: null,
    recoverable: false,
  };
}

export async function callBackend<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    const response = await invoke<CommandResponse<T>>(command, args);
    return response.data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export function createMockTask(request: CreateMockTaskRequest): Promise<Task> {
  return callBackend<Task>("create_mock_task", { request });
}

export function createCommitTask(request: CreateCommitTaskRequest): Promise<Task> {
  return callBackend<Task>("create_commit_task", { request });
}

export function createSvnOperationTask(
  request: CreateSvnOperationTaskRequest,
): Promise<Task> {
  return callBackend<Task>("create_svn_operation_task", { request });
}

export function createShadowWorkspaceTask(
  request: CreateShadowWorkspaceTaskRequest,
): Promise<Task> {
  return callBackend<Task>("create_shadow_workspace_task", { request });
}

export function createPartialCommitTask(
  request: CreatePartialCommitTaskRequest,
): Promise<Task> {
  return callBackend<Task>("create_partial_commit_task", { request });
}

export function createRepositoryListTask(
  request: CreateRepositoryListTaskRequest,
): Promise<Task> {
  return callBackend<Task>("create_repository_list_task", { request });
}

export function createRepositoryCopyTask(
  request: CreateRepositoryCopyTaskRequest,
): Promise<Task> {
  return callBackend<Task>("create_repository_copy_task", { request });
}

export function createBranchCheckoutTask(
  request: CreateBranchCheckoutTaskRequest,
): Promise<Task> {
  return callBackend<Task>("create_branch_checkout_task", { request });
}

export function createSvnSwitchTask(request: CreateSvnSwitchTaskRequest): Promise<Task> {
  return callBackend<Task>("create_svn_switch_task", { request });
}

export function getBranchPool(): Promise<BranchPool> {
  return callBackend<BranchPool>("get_branch_pool");
}

export function saveBranchPoolEntry(
  request: SaveBranchPoolEntryRequest,
): Promise<BranchPool> {
  return callBackend<BranchPool>("save_branch_pool_entry", { request });
}

export function removeBranchPoolEntry(
  request: RemoveBranchPoolEntryRequest,
): Promise<BranchPool> {
  return callBackend<BranchPool>("remove_branch_pool_entry", { request });
}

export function getTaskWorkspaces(): Promise<TaskWorkspaceList> {
  return callBackend<TaskWorkspaceList>("get_task_workspaces");
}

export function saveTaskWorkspace(
  request: SaveTaskWorkspaceRequest,
): Promise<TaskWorkspaceList> {
  return callBackend<TaskWorkspaceList>("save_task_workspace", { request });
}

export function removeTaskWorkspace(
  request: RemoveTaskWorkspaceRequest,
): Promise<TaskWorkspaceList> {
  return callBackend<TaskWorkspaceList>("remove_task_workspace", { request });
}

export function listTasks(): Promise<TaskSnapshot> {
  return callBackend<TaskSnapshot>("list_tasks");
}

export function getTask(taskId: string): Promise<Task> {
  return callBackend<Task>("get_task", { taskId });
}

export function cancelTask(taskId: string): Promise<Task> {
  return callBackend<Task>("cancel_task", { taskId });
}

export function detectSvn(request: DetectSvnRequest = {}): Promise<SvnDetection> {
  return callBackend<SvnDetection>("detect_svn", { request });
}

export function openWorkspace(
  request: OpenWorkspaceRequest,
): Promise<WorkspaceSummary> {
  return callBackend<WorkspaceSummary>("open_workspace", { request });
}

export function getRecentWorkspace(): Promise<RecentWorkspace> {
  return callBackend<RecentWorkspace>("get_recent_workspace");
}

export function scanWorkspaceStatus(
  request: ScanWorkspaceStatusRequest,
): Promise<WorkingCopyStatus> {
  return callBackend<WorkingCopyStatus>("scan_workspace_status", { request });
}

export function getFileDiff(request: GetFileDiffRequest): Promise<FileDiff> {
  return callBackend<FileDiff>("get_file_diff", { request });
}

export function getFileContentDiff(
  request: GetFileContentDiffRequest,
): Promise<FileContentDiff> {
  return callBackend<FileContentDiff>("get_file_content_diff", { request });
}

export function parseUnifiedDiff(diffText: string): Promise<ParsedDiff> {
  return callBackend<ParsedDiff>("parse_unified_diff", { diffText });
}

export function getShadowWorkspaceStatus(
  request: ShadowWorkspaceRequest,
): Promise<ShadowWorkspaceStatus> {
  return callBackend<ShadowWorkspaceStatus>("get_shadow_workspace_status", { request });
}

export function generateSelectedPatch(
  request: GenerateSelectedPatchRequest,
): Promise<SelectedPatch> {
  return callBackend<SelectedPatch>("generate_selected_patch", { request });
}

export async function chooseWorkspaceDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择 SVN 工作副本",
  });

  return typeof selected === "string" ? selected : null;
}
