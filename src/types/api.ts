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

export interface StartupIntent {
  action: string | null;
  path: string | null;
}

export interface DiagnosticExport {
  path: string;
  file_name: string;
  bytes: number;
}

export type TaskStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "interrupted";

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
  | "update_path"
  | "cleanup"
  | "add_file"
  | "delete_path"
  | "move_path"
  | "copy_path"
  | "revert_file"
  | "lock_file"
  | "unlock_file"
  | "force_unlock_file"
  | "resolve_working"
  | "resolve_mine_full"
  | "resolve_theirs_full";

export interface CreateSvnOperationTaskRequest {
  working_copy_root: string;
  kind: SvnOperationKind;
  file_path?: string;
  target_path?: string;
  svn_executable?: string;
}

export type SvnBatchOperationKind =
  | "revert_paths"
  | "delete_paths"
  | "move_paths";

export type PendingSvnOperationKind =
  | SvnOperationKind
  | SvnBatchOperationKind
  | "revert_to_revision";

export interface CreateSvnBatchOperationTaskRequest {
  working_copy_root: string;
  kind: SvnBatchOperationKind;
  file_paths: string[];
  target_path?: string;
  svn_executable?: string;
}

export type ExternalToolKind = "diff" | "merge";

export interface LaunchExternalToolRequest {
  kind: ExternalToolKind;
  tool_path: string;
  working_copy_root: string;
  file_path: string;
}

export interface OpenFileLocationRequest {
  working_copy_root: string;
  file_path: string;
}

export interface OpenWorkspaceFileRequest {
  working_copy_root: string;
  file_path: string;
}

export interface OpenGeneratedFileLocationRequest {
  path: string;
}

export interface OpenLocalPathLocationRequest {
  path: string;
}

export interface OpenRepositoryTempFileRequest {
  path: string;
}

export interface ExternalToolLaunch {
  kind: ExternalToolKind | string;
  tool_path: string;
  target_path: string;
}

export interface OpenFileLocation {
  target_path: string;
}

export interface OpenWorkspaceFile {
  target_path: string;
}

export interface OpenGeneratedFileLocation {
  target_path: string;
}

export interface OpenLocalPathLocation {
  target_path: string;
}

export interface OpenRepositoryTempFile {
  target_path: string;
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
  revision?: string;
  svn_executable?: string;
}

export interface CreateRepositoryFileTaskRequest {
  url: string;
  revision?: string;
  svn_executable?: string;
}

export type RepositoryCopyKind = "branch" | "tag" | "entry";

export interface CreateRepositoryCopyTaskRequest {
  kind: RepositoryCopyKind;
  source_url: string;
  target_url: string;
  revision?: string;
  message: string;
  svn_executable?: string;
}

export interface CreateRepositoryMkdirTaskRequest {
  url: string;
  message: string;
  svn_executable?: string;
}

export interface CreateRepositoryImportTaskRequest {
  source_path: string;
  target_url: string;
  message: string;
  svn_executable?: string;
}

export interface CreateRepositoryMoveTaskRequest {
  kind?: RepositoryMoveKind;
  source_url: string;
  target_url: string;
  message: string;
  svn_executable?: string;
}

export type RepositoryMoveKind = "move" | "rename";

export interface CreateRepositoryDeleteTaskRequest {
  url: string;
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
  allow_local_changes?: boolean;
  svn_executable?: string;
}

export type RevisionDiffMode = "revisions" | "working_copy_to_revision" | "urls";

export interface CreateRevisionDiffTaskRequest {
  mode: RevisionDiffMode;
  working_copy_root?: string;
  file_path?: string;
  target_url?: string;
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
  record_only: boolean;
  ignore_ancestry: boolean;
  force: boolean;
  svn_executable?: string;
}

export interface CreateApplyPatchTaskRequest {
  working_copy_root: string;
  patch_file_path: string;
  dry_run: boolean;
  expected_patch_digest?: string;
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
  delete_local_copy?: boolean;
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
  repository_file: RepositoryFileResult | null;
  repository_export: RepositoryExportResult | null;
  revision_diff: RevisionDiffResult | null;
  merge_result: MergeResult | null;
  apply_patch_result: ApplyPatchResult | null;
}

export interface RepositoryExportResult {
  url: string;
  revision: string | null;
  local_path: string;
  file_name: string;
}

export interface RepositoryListResult {
  url: string;
  revision: string | null;
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
  truncated: boolean;
  max_bytes: number;
  patch_file_path?: string | null;
  patch_file_dir?: string | null;
  patch_file_name?: string | null;
}

export interface MergeResult {
  dry_run: boolean;
  source_url: string;
  revision_range: string;
  record_only: boolean;
  ignore_ancestry: boolean;
  force: boolean;
  output_text: string;
  file_count: number;
  line_count: number;
  added: number;
  deleted: number;
  updated: number;
  conflicted: number;
}

export interface ApplyPatchResult {
  dry_run: boolean;
  patch_file_path: string;
  patch_digest: string;
  output_text: string;
  output_truncated: boolean;
  max_output_bytes: number;
  applied: number;
  offset_hunks: number;
  rejected: number;
  skipped: number;
  conflicted: number;
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

export type SvnAuthenticationMode = "system" | "password" | "ssh";

export interface ConfigureSvnAuthenticationRequest {
  mode: SvnAuthenticationMode;
  username?: string;
  password?: string;
  remember_password?: boolean;
}

export interface SvnAuthenticationStatus {
  mode: SvnAuthenticationMode;
  username: string | null;
  password_configured: boolean;
  uses_system_credentials: boolean;
  remember_password: boolean;
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

export interface ListWorkspaceFilesRequest {
  working_copy_root: string;
  svn_executable?: string;
  max_files?: number;
}

export interface ChangedFile {
  path: string;
  status: string;
  revision: string | null;
  property_status: string | null;
  property_changed: boolean;
  remote_status: string | null;
  remote_property_status: string | null;
  change_scope: ChangeScope;
  abnormal: boolean;
  lock_state: string;
  lock_owner: string | null;
  lock_comment: string | null;
  conflict_kind: string | null;
  file_size: number | null;
  content_digest: string;
}

export interface WorkingCopyStatus {
  working_copy_root: string;
  total: number;
  returned: number;
  offset: number;
  limit: number;
  revision_range: string | null;
  mixed_revision: boolean;
  remote_updates_checked: boolean;
  repository_revision: string | null;
  local_changes: number;
  remote_changes: number;
  combined_changes: number;
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

export interface WorkspaceFileTree {
  working_copy_root: string;
  total_files: number;
  returned_files: number;
  truncated: boolean;
  nodes: WorkspaceFileNode[];
}

export interface WorkspaceFileNode {
  path: string;
  name: string;
  kind: "dir" | "file" | string;
  status: string;
  remote_status: string | null;
  remote_property_status: string | null;
  change_scope: ChangeScope;
  revision: string | null;
  base_revision: string | null;
  last_revision: string | null;
  last_changed_date: string | null;
  last_changed_author: string | null;
  file_size: number | null;
  changed: boolean;
  versioned: boolean;
  children: WorkspaceFileNode[];
}

export interface CreateRepositoryCheckoutTaskRequest {
  url: string;
  local_path: string;
  revision?: string;
  svn_executable?: string;
}

export interface CreateRepositoryExportTaskRequest {
  url: string;
  local_path: string;
  revision?: string;
  svn_executable?: string;
}

export interface CreateRepositoryDragExportTaskRequest {
  url: string;
  name: string;
  revision?: string;
  svn_executable?: string;
}

export interface RepositoryFileResult {
  url: string;
  revision: string | null;
  file_path: string;
  file_name: string;
  bytes: number;
}

export interface AppMenuState {
  workspace_open: boolean;
  workspace_busy: boolean;
  active_path: string | null;
  active_label: string | null;
  commit_selected: boolean;
  can_open: boolean;
  can_show: boolean;
  can_commit: boolean;
  can_update: boolean;
  can_add: boolean;
  can_resolve: boolean;
  can_revert: boolean;
  can_move: boolean;
  can_copy: boolean;
  can_ignore: boolean;
  can_delete: boolean;
}

export type ChangeScope = "none" | "local" | "remote" | "both";

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
  start_revision?: string;
}

export interface GetSvnBlameRequest {
  working_copy_root: string;
  file_path: string;
  svn_executable?: string;
  max_lines?: number;
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

export interface GetRepositoryFilePropertiesRequest {
  url: string;
  revision?: string;
  svn_executable?: string;
}

export interface GetRepositoryFileBlameRequest {
  url: string;
  revision?: string;
  svn_executable?: string;
  max_lines?: number;
}

export interface GetRepositoryFileLogRequest {
  url: string;
  revision?: string;
  svn_executable?: string;
  limit?: number;
  start_revision?: string;
}

export interface CreateRevertRevisionTaskRequest {
  working_copy_root: string;
  target_revision: string;
  svn_executable?: string;
}

export interface IgnoreWorkspacePathRequest {
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
  has_more: boolean;
  next_start_revision: string | null;
}

export interface SvnLogEntry {
  revision: string;
  author: string;
  date: string;
  message: string;
  changed_paths: SvnChangedPath[];
}

export interface SvnBlame {
  target: string;
  lines: SvnBlameLine[];
  total_lines: number;
  truncated: boolean;
}

export interface SvnBlameLine {
  line_number: number;
  revision: string;
  author: string;
  date: string;
  content: string;
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
