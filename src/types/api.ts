export interface CommandResponse<T> {
  ok: boolean;
  data: T;
}

export interface CommandError {
  kind?: string;
  code: string;
  message: string;
  detail?: string | null;
  recoverable: boolean;
}

export interface HealthPayload {
  message: string;
  backend: string;
}

export type TaskStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export type MockTaskOutcome = "success" | "failed";

export interface TaskLog {
  message: string;
  created_at: number;
}

export interface TaskSummary {
  task_id: string;
  title: string;
  status: TaskStatus;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface Task extends TaskSummary {
  logs: TaskLog[];
}

export interface TaskSnapshot {
  tasks: TaskSummary[];
  running_task_id: string | null;
}

export interface CreateMockTaskRequest {
  title?: string;
  outcome: MockTaskOutcome;
}

export interface SvnDetection {
  available: boolean;
  version: string;
  executable: string;
  resolved_path: string | null;
}

export interface DetectSvnRequest {
  executable?: string;
}

export interface WorkspaceSummary {
  local_path: string;
  working_copy_root: string;
  repository_url: string;
  repository_root: string;
  revision: string;
}

export interface OpenWorkspaceRequest {
  path: string;
  svn_executable?: string;
}

export interface RecentWorkspace {
  workspace: WorkspaceSummary | null;
}

export interface ScanWorkspaceStatusRequest {
  working_copy_root: string;
  svn_executable?: string;
  offset?: number;
  limit?: number;
}

export interface ChangedFile {
  path: string;
  status: string;
  property_status: string | null;
  property_changed: boolean;
  abnormal: boolean;
}

export interface WorkingCopyStatus {
  working_copy_root: string;
  total: number;
  returned: number;
  offset: number;
  limit: number;
  modified: number;
  added: number;
  deleted: number;
  missing: number;
  unversioned: number;
  conflicted: number;
  obstructed: number;
  property_changed: number;
  files: ChangedFile[];
}

export interface GetFileDiffRequest {
  working_copy_root: string;
  file_path: string;
  svn_executable?: string;
}

export interface FileDiff {
  path: string;
  text: string;
  binary: boolean;
  empty: boolean;
}
