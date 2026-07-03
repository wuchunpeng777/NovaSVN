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
  result: TaskResult | null;
}

export interface TaskSnapshot {
  tasks: TaskSummary[];
  running_task_id: string | null;
}

export interface CreateMockTaskRequest {
  title?: string;
  outcome: MockTaskOutcome;
}

export interface CreateCommitTaskRequest {
  working_copy_root: string;
  message: string;
  files: string[];
  svn_executable?: string;
}

export type SvnOperationKind =
  | "update"
  | "cleanup"
  | "revert_file"
  | "lock_file"
  | "unlock_file"
  | "resolve_working"
  | "resolve_mine_full"
  | "resolve_theirs_full";

export interface CreateSvnOperationTaskRequest {
  working_copy_root: string;
  kind: SvnOperationKind;
  file_path?: string;
  svn_executable?: string;
}

export type ShadowWorkspaceOperationKind = "create_or_update" | "rebuild";

export interface CreateShadowWorkspaceTaskRequest {
  working_copy_root: string;
  repository_url: string;
  revision?: string;
  svn_executable?: string;
  kind: ShadowWorkspaceOperationKind;
}

export interface CreatePartialCommitTaskRequest {
  working_copy_root: string;
  repository_url: string;
  revision?: string;
  message: string;
  selected_patch: string;
  files: string[];
  svn_executable?: string;
}

export interface CreateRepositoryListTaskRequest {
  url: string;
  svn_executable?: string;
}

export type RepositoryCopyKind = "branch" | "tag";

export interface CreateRepositoryCopyTaskRequest {
  kind: RepositoryCopyKind;
  source_url: string;
  target_url: string;
  revision?: string;
  message: string;
  svn_executable?: string;
}

export interface CreateBranchCheckoutTaskRequest {
  branch_url: string;
  local_path: string;
  revision?: string;
  svn_executable?: string;
}

export interface CreateSvnSwitchTaskRequest {
  working_copy_root: string;
  target_url: string;
  svn_executable?: string;
}

export type RevisionDiffMode = "revisions" | "working_copy_to_revision" | "urls";

export interface CreateRevisionDiffTaskRequest {
  mode: RevisionDiffMode;
  working_copy_root?: string;
  left_revision?: string;
  right_revision?: string;
  left_url?: string;
  right_url?: string;
  svn_executable?: string;
}

export interface CreateMergeTaskRequest {
  working_copy_root: string;
  source_url: string;
  start_revision?: string;
  end_revision?: string;
  dry_run: boolean;
  svn_executable?: string;
}

export interface BranchPoolEntry {
  id: string;
  branch_url: string;
  local_path: string;
  revision: string;
  local_changes: number;
  created_at: number;
  updated_at: number;
}

export interface BranchPool {
  entries: BranchPoolEntry[];
}

export interface SaveBranchPoolEntryRequest {
  branch_url: string;
  local_path: string;
  revision?: string;
  local_changes?: number;
}

export interface RemoveBranchPoolEntryRequest {
  id: string;
}

export interface TaskWorkspaceEntry {
  id: string;
  name: string;
  branch_pool_entry_id: string | null;
  branch_url: string;
  local_path: string;
  draft_key: string;
  created_at: number;
  updated_at: number;
}

export interface TaskWorkspaceList {
  entries: TaskWorkspaceEntry[];
}

export interface SaveTaskWorkspaceRequest {
  id?: string;
  name: string;
  branch_pool_entry_id?: string;
  branch_url: string;
  local_path: string;
  draft_key: string;
}

export interface RemoveTaskWorkspaceRequest {
  id: string;
}

export interface TaskResult {
  repository_list: RepositoryListResult | null;
  revision_diff: RevisionDiffResult | null;
}

export interface RepositoryListResult {
  url: string;
  entries: RepositoryListEntry[];
}

export interface RepositoryListEntry {
  name: string;
  kind: "dir" | "file" | string;
  revision: string;
  author: string;
  date: string;
}

export interface RevisionDiffResult {
  mode: RevisionDiffMode | string;
  target: string;
  diff_text: string;
  file_count: number;
  line_count: number;
}

export interface ShadowWorkspaceRequest {
  working_copy_root: string;
  repository_url: string;
  revision?: string;
  svn_executable?: string;
}

export interface ShadowWorkspaceStatus {
  shadow_path: string;
  exists: boolean;
  valid: boolean;
  revision: string | null;
  message: string;
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
  lock_state: string;
  lock_owner: string | null;
  lock_comment: string | null;
  conflict_kind: string | null;
  content_digest: string;
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

export interface GetFileContentDiffRequest {
  working_copy_root: string;
  file_path: string;
  svn_executable?: string;
  max_bytes?: number;
}

export interface GetSvnLogRequest {
  working_copy_root: string;
  file_path?: string;
  svn_executable?: string;
  limit?: number;
}

export interface GetSvnPropertiesRequest {
  working_copy_root: string;
  file_path?: string;
  svn_executable?: string;
}

export interface SetSvnPropertyRequest {
  working_copy_root: string;
  file_path?: string;
  name: string;
  value: string;
  svn_executable?: string;
}

export interface FileDiff {
  path: string;
  text: string;
  binary: boolean;
  empty: boolean;
}

export interface FileContentDiff {
  path: string;
  original_text: string;
  modified_text: string;
  language: string;
  binary: boolean;
  too_large: boolean;
  max_bytes: number;
}

export interface SvnLog {
  target: string;
  entries: SvnLogEntry[];
}

export interface SvnLogEntry {
  revision: string;
  author: string;
  date: string;
  message: string;
  changed_paths: SvnChangedPath[];
}

export interface SvnChangedPath {
  path: string;
  action: string;
  kind: string;
  copy_from_path: string | null;
  copy_from_revision: string | null;
}

export interface SvnProperties {
  target: string;
  properties: SvnProperty[];
  externals: string | null;
}

export interface SvnProperty {
  name: string;
  value: string;
}

export type DiffLineKind = "context" | "added" | "removed" | "no_newline";

export interface ParsedDiffLine {
  kind: DiffLineKind;
  old_line: number | null;
  new_line: number | null;
  content: string;
}

export interface ParsedHunk {
  id: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  header: string;
  lines: ParsedDiffLine[];
}

export interface ParsedFileDiff {
  path: string;
  old_path: string | null;
  new_path: string | null;
  hunks: ParsedHunk[];
  partial_commit_supported: boolean;
  unsupported_reason: string | null;
  binary: boolean;
  property_only: boolean;
}

export interface ParsedDiff {
  files: ParsedFileDiff[];
}

export interface GenerateSelectedPatchRequest {
  parsed_diff: ParsedDiff;
  selected_hunk_ids: string[];
}

export interface SelectedPatch {
  text: string;
  file_count: number;
  hunk_count: number;
}
