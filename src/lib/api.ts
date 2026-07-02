import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CommandError,
  CommandResponse,
  CreateCommitTaskRequest,
  CreateMockTaskRequest,
  CreateSvnOperationTaskRequest,
  DetectSvnRequest,
  FileDiff,
  FileContentDiff,
  GetFileContentDiffRequest,
  GetFileDiffRequest,
  OpenWorkspaceRequest,
  ParsedDiff,
  RecentWorkspace,
  ScanWorkspaceStatusRequest,
  SvnDetection,
  Task,
  TaskSnapshot,
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

export async function chooseWorkspaceDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择 SVN 工作副本",
  });

  return typeof selected === "string" ? selected : null;
}
