import { invoke } from "@tauri-apps/api/core";
import type {
  CommandError,
  CommandResponse,
  CreateMockTaskRequest,
  DetectSvnRequest,
  SvnDetection,
  Task,
  TaskSnapshot,
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
