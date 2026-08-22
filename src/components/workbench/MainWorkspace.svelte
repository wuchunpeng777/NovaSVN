<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    CircleCheck,
    CircleX,
    Copy,
    Download,
    Ellipsis,
    ExternalLink,
    EyeOff,
    FileUp,
    GitMerge,
    GitBranch,
    FolderOpen,
    GitCommitHorizontal,
    GripVertical,
    History,
    ListChecks,
    ListMinus,
    ListPlus,
    LoaderCircle,
    MoveRight,
    Pencil,
    Plus,
    RefreshCw,
    Trash2,
    Undo2,
    Wrench,
    X,
  } from "@lucide/svelte";
  import ErrorNotice from "../ErrorNotice.svelte";
  import StandaloneCommitWindow from "../StandaloneCommitWindow.svelte";
  import StandaloneUpdateWindow from "../StandaloneUpdateWindow.svelte";
  import LogMergeDialog from "../LogMergeDialog.svelte";
  import SvnLogRevisionList from "../SvnLogRevisionList.svelte";
  import SvnLogSelectionDetails from "../SvnLogSelectionDetails.svelte";
  import SvnRevisionLogDialog from "../SvnRevisionLogDialog.svelte";
  import ConflictResolver from "./ConflictResolver.svelte";
  import ImageDiffViewer from "./ImageDiffViewer.svelte";
  import MonacoDiffViewer from "./MonacoDiffViewer.svelte";
  import SyntaxHighlightedCode from "../SyntaxHighlightedCode.svelte";
  import { getRevisionFileContentDiff, listWorkspaceFiles } from "../../lib/api";
  import { shouldShowTextDiffViewer } from "../../lib/file-content-diff";
  import { detectSvnAuthenticationFailure } from "../../lib/svn-authentication";
  import { extractSvnFileChangesFromText } from "../../lib/svn-operation-output";
  import {
    findSvnCertificateFailure,
    svnCertificateFailureLabel,
  } from "../../lib/svn-certificate";
  import {
    LOG_FILE_DIFF_MAX_BYTES,
    repositoryPathUrlAtRevision,
    resolveWorkingCopyLogRevision,
    revisionBefore,
  } from "../../lib/svn-log";
  import type {
    ApplyPatchResult,
    BranchPool,
    BranchPoolEntry,
    ChangedFile,
    CommandError,
    ExternalToolKind,
    FileContentDiff,
    FileDiff,
    MergeResult,
    ParsedFileDiff,
    RepositoryCopyKind,
    RepositoryListResult,
    SvnBlame,
    SvnDetection,
    SvnAuthenticationStatus,
    SvnCertificateFailure,
    SvnCertificateTrustStatus,
    SvnChangedPath,
    SvnLog,
    SvnLogEntry,
    SvnProperties,
    PendingSvnOperationKind,
    Task,
    TaskStatus,
    TaskSummary,
    TaskWorkspaceList,
    WorkspaceFileNode,
    WorkspaceFileTree,
    WorkingCopyStatus,
    WorkspaceSummary,
    UpdateTargetSummary,
  } from "../../types/api";
  import type {
    AppSettingsState,
    AppView,
    ReviewedFileState,
    SafetyCheckSummary,
    SvnOperationFeedback,
    WorkbenchView,
  } from "../../types/app";

  export let view: WorkbenchView;
  export let workspace: WorkspaceSummary | null = null;
  export let workspacePathInput = "";
  export let workspaceLoading = false;
  export let workspaceError: CommandError | null = null;
  export let workingCopyStatus: WorkingCopyStatus | null = null;
  export let workspaceFileTree: WorkspaceFileTree | null = null;
  export let svnExecutable: string | undefined = undefined;
  export let searchText = "";
  export let selectedFilePath: string | null = null;
  export let selectedFile: ChangedFile | null = null;
  export let selectedFileReviewed = false;
  export let reviewedFiles: ReviewedFileState[] = [];
  export let statusLoading = false;
  export let statusError: CommandError | null = null;
  export let changelistRunning = false;

  export let repositoryUrlInput = "";
  export let repositoryRevisionInput = "";
  export let repositoryList: RepositoryListResult | null = null;
  export let repositoryLoading = false;
  export let repositoryError: string | null = null;
  export let repositoryFileLoading = false;
  export let repositoryFileError: string | null = null;
  export let repositoryFileLog: SvnLog | null = null;
  export let repositoryFileLogRevision: string | null = null;
  export let repositoryFileLogLoading = false;
  export let repositoryFileLogError: CommandError | null = null;
  export let repositoryFileBlame: SvnBlame | null = null;
  export let repositoryFileBlameRevision: string | null = null;
  export let repositoryFileBlameLoading = false;
  export let repositoryFileBlameError: CommandError | null = null;
  export let repositoryFileProperties: SvnProperties | null = null;
  export let repositoryFilePropertiesRevision: string | null = null;
  export let repositoryFilePropertiesLoading = false;
  export let repositoryFilePropertiesError: CommandError | null = null;
  export let repositoryLayout = {
    trunkPath: "trunk",
    branchesPath: "branches",
    tagsPath: "tags",
  };
  export let repositoryLayoutResults: {
    trunk: RepositoryListResult | null;
    branches: RepositoryListResult | null;
    tags: RepositoryListResult | null;
  } = {
    trunk: null,
    branches: null,
    tags: null,
  };
  export let repositoryLayoutErrors: {
    trunk: string | null;
    branches: string | null;
    tags: string | null;
  } = {
    trunk: null,
    branches: null,
    tags: null,
  };
  export let repositoryLayoutLoading = false;
  export let repositoryCopyForm: {
    kind: RepositoryCopyKind;
    sourceUrl: string;
    targetUrl: string;
    revision: string;
    message: string;
  } = {
    kind: "branch",
    sourceUrl: "",
    targetUrl: "",
    revision: "",
    message: "",
  };
  export let repositoryCopyError: string | null = null;
  export let repositoryCopyRunning = false;
  export let repositoryMkdirForm: {
    targetUrl: string;
    message: string;
  } = {
    targetUrl: "",
    message: "",
  };
  export let repositoryMkdirError: string | null = null;
  export let repositoryMkdirRunning = false;
  export let repositoryImportForm: {
    sourcePath: string;
    targetUrl: string;
    message: string;
  } = {
    sourcePath: "",
    targetUrl: "",
    message: "",
  };
  export let repositoryImportError: string | null = null;
  export let repositoryImportRunning = false;
  export let repositoryImportDropActive = false;
  export let repositoryDragExportRunning = false;
  export let repositoryDragExportRunningName: string | null = null;
  export let repositoryDragExportError: string | null = null;
  export let repositoryMoveForm: {
    sourceUrl: string;
    targetUrl: string;
    message: string;
  } = {
    sourceUrl: "",
    targetUrl: "",
    message: "",
  };
  export let repositoryMoveError: string | null = null;
  export let repositoryMoveRunning = false;
  export let repositoryRenameForm: {
    sourceUrl: string;
    targetUrl: string;
    message: string;
  } = {
    sourceUrl: "",
    targetUrl: "",
    message: "",
  };
  export let repositoryRenameError: string | null = null;
  export let repositoryRenameRunning = false;
  export let repositoryDeleteForm: {
    url: string;
    message: string;
  } = {
    url: "",
    message: "",
  };
  export let repositoryDeleteError: string | null = null;
  export let repositoryDeleteRunning = false;
  export let repositoryCheckoutForm: {
    url: string;
    localPath: string;
    revision: string;
  } = {
    url: "",
    localPath: "",
    revision: "",
  };
  export let repositoryCheckoutError: string | null = null;
  export let repositoryCheckoutRunning = false;
  export let repositoryExportForm: {
    url: string;
    localPath: string;
    revision: string;
  } = {
    url: "",
    localPath: "",
    revision: "",
  };
  export let repositoryExportError: string | null = null;
  export let repositoryExportRunning = false;

  export let svnLog: SvnLog | null = null;
  export let svnLogLoading = false;
  export let svnLogError: CommandError | null = null;
  export let svnLogAuthorFilter = "";
  export let svnLogKeywordFilter = "";
  export let svnLogDateFromFilter = "";
  export let svnLogDateToFilter = "";
  export let svnLogFileOnly = false;
  export let svnLogLimit = 50;

  export let branchPool: BranchPool = { entries: [] };
  export let branchPoolForm = {
    branchUrl: "",
    localPath: "",
    revision: "",
  };
  export let branchPoolFormErrors = {
    localPath: null as string | null,
  };
  export let branchPoolLoading = false;
  export let branchPoolError: CommandError | null = null;
  export let branchCheckoutError: string | null = null;
  export let branchCheckoutRunning = false;
  export let mergeForm = {
    sourceUrl: "",
    startRevision: "",
    endRevision: "",
    dryRun: true,
    recordOnly: false,
    ignoreAncestry: false,
    force: false,
  };
  export let mergeRunning = false;
  export let mergeError: string | null = null;
  export let mergeResult: MergeResult | null = null;
  export let applyPatchDialogOpen = false;
  export let applyPatchFilePath = "";
  export let applyPatchRunning = false;
  export let applyPatchResult: ApplyPatchResult | null = null;
  export let applyPatchError: string | null = null;
  export let taskWorkspaces: TaskWorkspaceList = { entries: [] };
  export let activeTaskWorkspaceId: string | null = null;

  export let selectedFileDiff: FileDiff | null = null;
  export let selectedFileContentDiff: FileContentDiff | null = null;
  export let selectedFileParsedDiff: ParsedFileDiff | null = null;
  export let selectedHunkIds: string[] = [];
  export let selectedPatch: { text: string; file_count: number; hunk_count: number } | null = null;
  export let svnBlame: SvnBlame | null = null;
  export let svnBlameLoading = false;
  export let svnBlameError: CommandError | null = null;
  export let diffLoading = false;
  export let contentDiffLoading = false;
  export let conflictResolutionSaving = false;
  export let selectedPatchLoading = false;
  export let diffError: CommandError | null = null;
  export let contentDiffError: CommandError | null = null;
  export let conflictResolutionError: CommandError | null = null;
  export let parsedDiffError: CommandError | null = null;
  export let selectedPatchError: CommandError | null = null;
  export let safetyCheck: SafetyCheckSummary = {
    blockers: [],
    warnings: [],
    infos: [],
    confirmedWarningIds: [],
  };
  export let svnProperties: SvnProperties | null = null;
  export let svnPropertiesLoading = false;
  export let svnPropertiesError: CommandError | null = null;
  export let propertyEditForm = {
    name: "",
    value: "",
  };

  export let commitFormOpenDisabled = false;
  export let commitFormRequestId = 0;
  export let partialCommitDisabled = false;
  export let tasks: TaskSummary[] = [];
  export let selectedTask: Task | null = null;
  export let runningTaskId: string | null = null;
  export let pendingSvnOperationKind: PendingSvnOperationKind | null = null;
  export let inlineUpdateRoot: string | null = null;
  export let inlineUpdateTask: Task | null = null;
  export let inlineUpdateMinimized = false;
  export let inlineUpdateSvnExecutable: string | undefined = undefined;
  export let inlineUpdateTarget: UpdateTargetSummary | null = null;
  export let svnOperationFeedback: SvnOperationFeedback | null = null;
  export let taskError: CommandError | null = null;
  export let commandError: CommandError | null = null;

  export let svnDetection: SvnDetection | null = null;
  export let svnError: CommandError | null = null;
  export let svnExecutableInput = "";
  export let svnLoading = false;
  export let svnAuthenticationPassword = "";
  export let svnAuthenticationStatus: SvnAuthenticationStatus | null = null;
  export let svnAuthenticationError: CommandError | null = null;
  export let svnAuthenticationLoading = false;
  export let onInlineSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;
  export let svnCertificateTrustStatus: SvnCertificateTrustStatus | null = null;
  export let svnCertificateTrustError: CommandError | null = null;
  export let svnCertificateTrustLoading = false;
  export let appSettings: AppSettingsState = {
    svnExecutable: "",
    svnAuthenticationMode: "system",
    svnUsername: "",
    svnRememberPassword: true,
    diffMode: "side_by_side",
    showWhitespace: false,
    themeMode: "system",
    showSourceList: true,
    commitTemplate: "",
    branchPoolBasePath: "",
    largeFileThresholdMb: 20,
    externalDiffTool: "",
    externalMergeTool: "",
    diagnosticExportPath: "",
    diagnosticExportError: null,
    validationErrors: {
      svnExecutable: null,
      svnUsername: null,
      branchPoolBasePath: null,
      externalDiffTool: null,
      externalMergeTool: null,
    },
    loading: false,
  };

  export let onSelectView: (value: AppView) => void = () => {};
  export let onAddWorkspace: () => void = () => {};
  export let onChooseWorkspace: () => void = () => {};
  export let onOpenWorkspace: () => void = () => {};
  export let onRefreshStatus: () => void = () => {};
  export let onUpdateWorkspace: () => void = () => {};
  export let onUpdatePath: (path: string) => void = () => {};
  export let onCleanupWorkspace: () => void = () => {};
  export let onToggleInlineUpdate: () => void = () => {};
  export let onCloseInlineUpdate: () => void = () => {};
  export let onDismissSvnOperationFeedback: () => void = () => {};
  export let onChooseApplyPatch: () => void = () => {};
  export let onRunApplyPatch: (dryRun: boolean) => void = () => {};
  export let onCloseApplyPatch: () => void = () => {};
  export let onLoadMoreStatus: () => void = () => {};
  export let onWorkspacePathInput: (value: string) => void = () => {};
  export let onSearchTextInput: (value: string) => void = () => {};
  export let onRefreshSvnBlame: () => void = () => {};
  export let onSelectFile: (path: string) => void = () => {};
  export let onSelectWorkspacePath: (path: string) => void = () => {};
  export let onActiveWorkspacePathChange: (path: string | null) => void = () => {};
  export let onAddFile: (path: string) => void = () => {};
  export let onIgnorePath: (path: string) => void = () => {};
  export let onDeletePath: (path: string) => void = () => {};
  export let onMovePath: (path: string) => void = () => {};
  export let onCopyPath: (path: string) => void = () => {};
  export let onRevertFile: (path: string) => void = () => {};
  export let onRevertPaths: (paths: string[]) => void = () => {};
  export let onDeletePaths: (paths: string[]) => void = () => {};
  export let onMovePaths: (paths: string[]) => void = () => {};
  export let onAssignChangelist: (paths: string[]) => void = () => {};
  export let onRemoveChangelist: (paths: string[]) => void = () => {};
  export let onLockFile: (path: string) => void = () => {};
  export let onUnlockFile: (path: string) => void = () => {};
  export let onForceUnlockFile: (path: string) => void = () => {};
  export let onResolveWorking: (path: string) => void = () => {};
  export let onResolveMineFull: (path: string) => void = () => {};
  export let onResolveTheirsFull: (path: string) => void = () => {};
  export let onSaveConflictResolution: (
    path: string,
    resolvedText: string,
  ) => Promise<boolean> = async () => false;
  export let onOpenFileLocation: (path: string) => void = () => {};
  export let onOpenWorkspaceFile: (path: string) => void = () => {};
  export let onLaunchExternalTool: (kind: ExternalToolKind, path: string) => void = () => {};
  export let onMarkFileReviewed: (path: string) => void = () => {};
  export let onMarkFileUnreviewed: (path: string) => void = () => {};
  export let onToggleHunkSelection: (filePath: string, hunkId: string) => void = () => {};
  export let onPreviewSelectedPatch: () => void = () => {};
  export let onRefreshSvnProperties: () => void = () => {};
  export let onPropertyEditInput: (field: keyof typeof propertyEditForm, value: string) => void =
    () => {};
  export let onUsePropertyForEdit: (name: string, value: string) => void = () => {};
  export let onSaveSvnProperty: () => void = () => {};

  export let onRepositoryUrlInput: (value: string) => void = () => {};
  export let onRepositoryRevisionInput: (value: string) => void = () => {};
  export let onUseWorkspaceRepositoryRoot: () => void = () => {};
  export let onOpenStandaloneRepoBrowser: () => void = () => {};
  export let onLoadRepositoryUrl: (url?: string) => void = () => {};
  export let onOpenRepositoryFile: (fileName: string) => void = () => {};
  export let onLoadRepositoryFileLog: (fileName: string) => void = () => {};
  export let onLoadMoreRepositoryFileLog: () => void = () => {};
  export let onCloseRepositoryFileLog: () => void = () => {};
  export let onLoadRepositoryFileBlame: (fileName: string) => void = () => {};
  export let onCloseRepositoryFileBlame: () => void = () => {};
  export let onLoadRepositoryFileProperties: (fileName: string) => void = () => {};
  export let onCloseRepositoryFileProperties: () => void = () => {};
  export let onRepositoryLayoutPathInput: (
    kind: "trunk" | "branches" | "tags",
    value: string,
  ) => void = () => {};
  export let onDetectRepositoryLayout: () => void = () => {};
  export let onRepositoryCopyFormInput: (
    field: keyof typeof repositoryCopyForm,
    value: string,
  ) => void = () => {};
  export let onPrepareRepositoryCopyTarget: (
    kind: RepositoryCopyKind,
    targetBaseUrl?: string | null,
  ) => void = () => {};
  export let onCreateRepositoryCopy: () => void = () => {};
  export let onRepositoryMkdirFormInput: (
    field: keyof typeof repositoryMkdirForm,
    value: string,
  ) => void = () => {};
  export let onPrepareRepositoryMkdir: (parentUrl?: string | null) => void = () => {};
  export let onCreateRepositoryMkdir: () => void = () => {};
  export let onRepositoryImportFormInput: (
    field: keyof typeof repositoryImportForm,
    value: string,
  ) => void = () => {};
  export let onPrepareRepositoryImport: (parentUrl?: string | null) => void = () => {};
  export let onChooseRepositoryImportSource: (directory: boolean) => void = () => {};
  export let onCreateRepositoryImport: () => void = () => {};
  export let onRepositoryMoveFormInput: (
    field: keyof typeof repositoryMoveForm,
    value: string,
  ) => void = () => {};
  export let onPrepareRepositoryMove: (sourceUrl?: string | null) => void = () => {};
  export let onCreateRepositoryMove: () => void = () => {};
  export let onRepositoryRenameFormInput: (
    field: keyof typeof repositoryRenameForm,
    value: string,
  ) => void = () => {};
  export let onPrepareRepositoryRename: (sourceUrl?: string | null) => void = () => {};
  export let onCreateRepositoryRename: () => void = () => {};
  export let onRepositoryDeleteFormInput: (
    field: keyof typeof repositoryDeleteForm,
    value: string,
  ) => void = () => {};
  export let onPrepareRepositoryDelete: (url?: string | null) => void = () => {};
  export let onCreateRepositoryDelete: () => void = () => {};
  export let onRepositoryCheckoutFormInput: (
    field: keyof typeof repositoryCheckoutForm,
    value: string,
  ) => void = () => {};
  export let onPrepareRepositoryCheckout: (
    url?: string | null,
    revision?: string | null,
  ) => void = () => {};
  export let onChooseRepositoryCheckoutParent: () => void = () => {};
  export let onCreateRepositoryCheckout: () => void = () => {};
  export let onRepositoryExportFormInput: (
    field: keyof typeof repositoryExportForm,
    value: string,
  ) => void = () => {};
  export let onPrepareRepositoryExport: (
    url?: string | null,
    revision?: string | null,
  ) => void = () => {};
  export let onChooseRepositoryExportParent: () => void = () => {};
  export let onCreateRepositoryExport: () => void = () => {};
  export let onDragRepositoryEntry: (name: string) => void = () => {};

  export let onRefreshSvnLog: () => void = () => {};
  export let onSvnLogFilterInput: (
    field:
      | "svnLogAuthorFilter"
      | "svnLogKeywordFilter"
      | "svnLogDateFromFilter"
      | "svnLogDateToFilter",
    value: string,
  ) => void = () => {};
  export let onSvnLogFileOnlyInput: (value: boolean) => void = () => {};
  export let onSvnLogLimitInput: (value: number) => void = () => {};
  export let onLoadMoreSvnLog: () => void = () => {};
  export let onLoadAllSvnLog: () => void = () => {};
  export let onRevertToRevision: (revision: string) => void = () => {};
  export let onRevertWorkspaceToRevision: (revision: string) => void = () => {};
  export let onRevertSelectedRevisions: (revisions: string[]) => Promise<boolean> = async () =>
    false;
  export let onExportRevision: (revision: string) => void = () => {};

  export let onPartialCommit: () => void = () => {};
  export let onSelectTask: (taskId: string) => void = () => {};
  export let onCancelTask: (taskId: string) => void = () => {};

  export let onBranchPoolFormInput: (
    field: keyof typeof branchPoolForm,
    value: string,
  ) => void = () => {};
  export let onUseBranchUrlForPool: (branchUrl: string) => void = () => {};
  export let onCheckoutBranchPoolEntry: () => void = () => {};
  export let onReuseBranchPoolEntry: () => void = () => {};
  export let onOpenBranchPoolEntry: (localPath: string) => void = () => {};
  export let onRemoveBranchPoolEntry: (entryId: string, deleteLocalCopy?: boolean) => void =
    () => {};
  export let onReorderBranchPoolEntries: (entryIds: string[]) => void = () => {};
  export let onRenameBranchPoolEntry: (entryId: string, displayName: string) => void = () => {};
  export let onMergeFormInput: (field: keyof typeof mergeForm, value: string | boolean) => void =
    () => {};
  export let onUseRepositoryUrlForMerge: (url: string) => void = () => {};
  export let onRunMerge: () => void = () => {};
  export let onRunSvnSwitch: () => void = () => {};
  export let svnSwitchTargetUrl = "";
  export let svnSwitchError: string | null = null;
  export let svnSwitchRunning = false;
  export let onSvnSwitchTargetInput: (value: string) => void = () => {};

  export let onDetectSvn: () => void = () => {};
  export let onDetectSvnWithInput: () => void = () => {};
  export let onSvnExecutableInput: (value: string) => void = () => {};
  export let onSvnAuthenticationPasswordInput: (value: string) => void = () => {};
  export let onApplySvnAuthentication: () => Promise<boolean> = async () => false;
  export let onConfirmSvnCertificateTrust: (
    failures: SvnCertificateFailure[],
  ) => Promise<boolean> = async () => false;
  export let onClearSvnCertificateTrust: () => void = () => {};
  export let onAppSettingInput: <K extends keyof AppSettingsState>(
    field: K,
    value: AppSettingsState[K],
  ) => void = () => {};
  export let onExportDiagnosticLog: () => void = () => {};

  $: {
    selectedFile;
    selectedFileReviewed;
    selectedFileDiff;
    selectedFileParsedDiff;
    selectedHunkIds;
    selectedPatch;
    svnBlameLoading;
    diffLoading;
    selectedPatchLoading;
    diffError;
    parsedDiffError;
    selectedPatchError;
    svnProperties;
    svnPropertiesLoading;
    propertyEditForm;
    partialCommitDisabled;
    tasks;
    onLockFile;
    onUnlockFile;
    onForceUnlockFile;
    onMarkFileReviewed;
    onMarkFileUnreviewed;
    onToggleHunkSelection;
    onPreviewSelectedPatch;
    onPropertyEditInput;
    onUsePropertyForEdit;
    onSaveSvnProperty;
    onPartialCommit;
    onSelectTask;
    onCancelTask;
  }

  const statusLabels: Record<string, string> = {
    modified: "modify",
    added: "add",
    deleted: "delete",
    renamed: "rename",
    missing: "missing",
    unversioned: "unversioned",
    conflicted: "冲突",
    obstructed: "阻塞",
    external: "外部",
    normal: "",
    changed: "",
  };

  const taskStatusLabels: Record<TaskStatus, string> = {
    pending: "排队",
    running: "运行",
    success: "完成",
    failed: "失败",
    cancelled: "取消",
    interrupted: "中断",
  };

  type WorkingCopyTreeFilter = "all" | "local" | "unversioned";
  type WorkspaceTreeRow = WorkspaceFileNode & {
    depth: number;
  };
  type WorkspaceDirectoryRow = {
    path: string;
    name: string;
    depth: number;
    node: WorkspaceFileNode | null;
  };
  type DirectoryChangeSummary = { local: number; remote: number };
  type VirtualWindow<T> = {
    items: T[];
    startIndex: number;
    beforeHeight: number;
    afterHeight: number;
  };
  type WorkspaceTabUiState = {
    workingCopyTreeFilter: WorkingCopyTreeFilter;
    selectedRevisionFileDiff: { revision: string; path: string } | null;
    revisionFileContentDiff: FileContentDiff | null;
    expandedTimelineRevisions: Set<string>;
    timelineMergeRevisions: Set<string>;
    timelineMergeSelectionAnchor: string | null;
    collapsedTreePaths: Set<string>;
    selectedDirectoryPath: string;
    selectedDirectoryFileTree: WorkspaceFileTree | null;
    selectedDirectoryFileTreePath: string | null;
    selectedRowPaths: Set<string>;
    rowSelectionAnchorPath: string | null;
    activeRowPath: string | null;
    keyboardRangeAnchorPath: string | null;
    keyboardRangeBasePaths: Set<string>;
    fileBrowserScrollTop: number;
    folderBrowserScrollTop: number;
    workspaceBlameScrollTop: number;
    repositoryBlameScrollTop: number;
    changelistFilter: string;
  };

  const fileTreeHeaderHeight = 28;
  const fileTreeRowHeight = 32;
  const blameRowHeight = 27;
  const virtualRowOverscan = 8;

  const folderTreeListOffset = 33;
  const folderTreeRowHeight = 28;
  let folderTreeViewportObserver: ResizeObserver | null = null;

  const fileColumns = [
    { key: "name", label: "Name", ariaLabel: "Name" },
    { key: "base", label: "Base", ariaLabel: "Base" },
    { key: "last", label: "Last", ariaLabel: "Last" },
    { key: "date", label: "Date", ariaLabel: "Date" },
    { key: "author", label: "Author", ariaLabel: "Author" },
    { key: "status", label: "Status", ariaLabel: "Status" },
    { key: "size", label: "Size", ariaLabel: "Size" },
    { key: "actions", label: "", ariaLabel: "操作" },
  ] as const;
  type FileColumnKey = (typeof fileColumns)[number]["key"];

  let diffInline = false;
  let showWhitespace = false;
  let workingCopyTreeFilter: WorkingCopyTreeFilter = "all";
  let selectedRevisionFileDiff: { revision: string; path: string } | null = null;
  let revisionFileContentDiff: FileContentDiff | null = null;
  let revisionFileDiffLoading = false;
  let revisionFileDiffError: CommandError | null = null;
  let revisionFileDiffGeneration = 0;
  let expandedTimelineRevisions = new Set<string>();
  let timelineMergeRevisions = new Set<string>();
  let timelineMergeSelectionAnchor: string | null = null;
  let timelineMergeDialogOpen = false;
  let timelineBatchRevertRunning = false;
  let collapsedTreePaths = new Set<string>();
  let selectedDirectoryPath = "";
  let directorySelectionWorkspaceRoot: string | null = null;
  let selectedDirectoryFileTree: WorkspaceFileTree | null = null;
  let selectedDirectoryFileTreePath: string | null = null;
  const directoryFileTreeCache = new Map<string, WorkspaceFileTree>();
  let directoryFilesLoading = false;
  let directoryFilesError: CommandError | null = null;
  let directoryFilesGeneration = 0;
  let openRowMenuPath: string | null = null;
  let selectedRowPaths = new Set<string>();
  let rowSelectionAnchorPath: string | null = null;
  let activeRowPath: string | null = null;
  let keyboardRangeAnchorPath: string | null = null;
  let keyboardRangeBasePaths = new Set<string>();
  let contextMenuPath: string | null = null;
  let contextMenuX = 0;
  let contextMenuY = 0;
  let fileBrowserElement: HTMLElement | null = null;
  let fileBrowserScrollTop = 0;
  let fileBrowserViewportHeight = 720;
  let folderBrowserElement: HTMLElement | null = null;
  let folderBrowserScrollTop = 0;
  let folderBrowserViewportHeight = 720;
  let workspaceBlameScrollTop = 0;
  let workspaceBlameViewportHeight = 360;
  let repositoryBlameScrollTop = 0;
  let repositoryBlameViewportHeight = 300;
  let virtualizedFileTreeSource: WorkspaceFileTree | null = null;
  let virtualizedWorkspaceBlameSource: SvnBlame | null = null;
  let virtualizedFileTreeWorkspaceKey: string | null = null;
  let virtualizedRepositoryBlameSource: SvnBlame | null = null;
  let blameRevisionLogTarget: {
    revision: string;
    targetPath: string;
    workingCopyRoot: string;
    filePath: string;
    repositoryUrl: string;
    repositoryRevision: string;
  } | null = null;
  let contextMenuElement: HTMLElement | null = null;
  let projectContextMenuElement: HTMLElement | null = null;
  let reportedActiveWorkspacePath: string | null | undefined;
  let selectionWorkspaceRoot: string | null = null;
  let selectionFileTree: WorkspaceFileTree | null = null;
  const folderTreeMinWidth = 180;
  const folderTreeMaxWidth = 480;
  const folderTreeDividerWidth = 6;
  const folderTreeContentMinWidth = 480;
  let folderTreeWidth = 228;
  let resizingFolderTree: { startX: number; startWidth: number } | null = null;
  const fileColumnMinimumWidths: Record<FileColumnKey, number> = {
    name: 120,
    base: 36,
    last: 36,
    date: 72,
    author: 52,
    status: 88,
    size: 40,
    actions: 88,
  };
  const fileColumnMaximumWidths: Record<FileColumnKey, number> = {
    name: 640,
    base: 160,
    last: 160,
    date: 240,
    author: 240,
    status: 320,
    size: 160,
    actions: 280,
  };
  const timelineDiffMinWidth = 360;
  const timelineDiffMaxWidth = 1600;
  const timelineListMinWidth = 360;
  const timelineDiffDividerWidth = 6;
  let timelineDiffWidth = 520;
  let resizingTimelineDiff = false;
  let fileColumnWidths: Record<FileColumnKey, number> = {
    name: 180,
    base: 40,
    last: 40,
    date: 84,
    author: 60,
    status: 106,
    size: 44,
    actions: 112,
  };
  let resizingFileColumn: {
    column: FileColumnKey;
    startX: number;
    startWidth: number;
  } | null = null;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;
  let resolvedTheme: "light" | "dark" = "light";
  let preparedCertificateSignature: string | null = null;
  let dismissedCertificateSignature: string | null = null;
  let selectedCertificateFailures: SvnCertificateFailure[] = [];
  let certificateRiskConfirmed = false;
  let preparedAuthenticationSignature: string | null = null;
  let dismissedAuthenticationSignature: string | null = null;
  let authenticationUsername = "";
  let authenticationPassword = "";
  let authenticationRememberPassword = true;
  let conflictResolverOpen = false;
  let commitDialogOpen = false;
  let appliedCommitFormRequestId = 0;

  $: if (appSettings.diffMode) {
    diffInline = appSettings.diffMode === "inline";
  }
  $: showWhitespace = appSettings.showWhitespace;
  $: if (typeof window !== "undefined") {
    syncLayoutWidthsToWindow();
  }
  $: resolvedTheme =
    appSettings.themeMode === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : appSettings.themeMode;
  $: detectedCertificateFailure = findSvnCertificateFailure([
    commandErrorText(workspaceError),
    commandErrorText(statusError),
    repositoryError,
    repositoryFileError,
    commandErrorText(repositoryFileLogError),
    commandErrorText(repositoryFileBlameError),
    commandErrorText(repositoryFilePropertiesError),
    ...Object.values(repositoryLayoutErrors),
    repositoryCopyError,
    repositoryMkdirError,
    repositoryImportError,
    repositoryDragExportError,
    repositoryMoveError,
    repositoryRenameError,
    repositoryDeleteError,
    repositoryCheckoutError,
    repositoryExportError,
    commandErrorText(svnLogError),
    commandErrorText(revisionFileDiffError),
    branchCheckoutError,
    mergeError,
    selectedTask?.error,
    commandErrorText(taskError),
    commandErrorText(commandError),
    commandErrorText(svnError),
    commandErrorText(svnAuthenticationError),
    svnSwitchError,
  ]);
  $: detectedAuthenticationCandidate = findAuthenticationCandidate([
    { error: commandErrorText(svnLogError), retry: onRefreshSvnLog },
    { error: repositoryError, retry: () => onLoadRepositoryUrl() },
    { error: commandErrorText(statusError), retry: onRefreshStatus },
    { error: commandErrorText(workspaceError), retry: onOpenWorkspace },
    { error: commandErrorText(svnBlameError), retry: onRefreshSvnBlame },
    { error: commandErrorText(svnPropertiesError), retry: onRefreshSvnProperties },
    { error: repositoryFileError, retry: null },
    { error: commandErrorText(repositoryFileLogError), retry: null },
    { error: commandErrorText(repositoryFileBlameError), retry: null },
    { error: commandErrorText(repositoryFilePropertiesError), retry: null },
    ...Object.values(repositoryLayoutErrors).map((error) => ({ error, retry: null })),
    { error: repositoryCopyError, retry: null },
    { error: repositoryMkdirError, retry: null },
    { error: repositoryImportError, retry: null },
    { error: repositoryDragExportError, retry: null },
    { error: repositoryMoveError, retry: null },
    { error: repositoryRenameError, retry: null },
    { error: repositoryDeleteError, retry: null },
    { error: repositoryCheckoutError, retry: null },
    { error: repositoryExportError, retry: null },
    { error: commandErrorText(revisionFileDiffError), retry: null },
    { error: branchCheckoutError, retry: null },
    { error: mergeError, retry: null },
    { error: selectedTask?.error, retry: null },
    { error: commandErrorText(taskError), retry: null },
    { error: commandErrorText(commandError), retry: null },
    { error: svnSwitchError, retry: null },
  ]);
  $: currentWorkspaceListed = branchPool.entries.some((entry) =>
    sameWorkspacePath(entry.local_path, workspace?.local_path ?? ""),
  );
  $: fileTableColumnStyle = fileColumns
    .map((column) => `--file-${column.key}-width: ${fileColumnWidths[column.key]}px`)
    .join("; ");
  $: detectedAuthenticationFailure = detectedAuthenticationCandidate?.failure ?? null;
  $: authenticationDialogOpen =
    detectedAuthenticationFailure !== null &&
    detectedAuthenticationFailure.signature !== dismissedAuthenticationSignature;
  $: if (
    authenticationDialogOpen &&
    detectedAuthenticationFailure &&
    detectedAuthenticationFailure.signature !== preparedAuthenticationSignature
  ) {
    preparedAuthenticationSignature = detectedAuthenticationFailure.signature;
    authenticationUsername =
      detectedAuthenticationFailure.username ?? appSettings.svnUsername.trim();
    authenticationPassword = "";
    authenticationRememberPassword = appSettings.svnRememberPassword;
  }
  $: if (!detectedAuthenticationFailure) {
    preparedAuthenticationSignature = null;
    dismissedAuthenticationSignature = null;
  }
  $: certificateDialogOpen =
    detectedCertificateFailure !== null &&
    detectedCertificateFailure.signature !== dismissedCertificateSignature;
  $: if (
    certificateDialogOpen &&
    detectedCertificateFailure &&
    detectedCertificateFailure.signature !== preparedCertificateSignature
  ) {
    preparedCertificateSignature = detectedCertificateFailure.signature;
    selectedCertificateFailures = [...detectedCertificateFailure.failures];
    certificateRiskConfirmed = false;
  }
  $: if (!detectedCertificateFailure) {
    preparedCertificateSignature = null;
    dismissedCertificateSignature = null;
  }

  function labelStatus(status: string) {
    return statusLabels[status] ?? status;
  }

  function commandErrorText(error: CommandError | null) {
    if (!error) {
      return null;
    }
    return [error.code, error.message, error.detail].filter(Boolean).join("\n");
  }

  function directoryFilesErrorLabel(error: CommandError) {
    const message = error.message?.trim() || "";
    const detail = error.detail?.trim() || "";
    if (message && detail && !message.includes(detail)) {
      return `${message}：${detail}`;
    }
    return message || detail || "读取文件失败";
  }

  function findAuthenticationCandidate(
    candidates: Array<{ error: string | null | undefined; retry: (() => void) | null }>,
  ) {
    for (const candidate of candidates) {
      const failure = detectSvnAuthenticationFailure(candidate.error);
      if (failure) {
        return { failure, retry: candidate.retry };
      }
    }
    return null;
  }

  function hostFromRepositoryUrl(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return new URL(trimmed).hostname || null;
    } catch {
      return null;
    }
  }

  function dismissAuthenticationDialog() {
    if (svnAuthenticationLoading || !detectedAuthenticationFailure) {
      return;
    }
    dismissedAuthenticationSignature = detectedAuthenticationFailure.signature;
    authenticationPassword = "";
  }

  async function confirmAuthentication() {
    if (
      !detectedAuthenticationFailure ||
      !authenticationUsername.trim() ||
      !authenticationPassword ||
      svnAuthenticationLoading
    ) {
      return;
    }

    onAppSettingInput("svnAuthenticationMode", "password");
    onAppSettingInput("svnUsername", authenticationUsername.trim());
    onAppSettingInput("svnRememberPassword", authenticationRememberPassword);
    onSvnAuthenticationPasswordInput(authenticationPassword);
    const retry = detectedAuthenticationCandidate?.retry ?? null;
    const applied = await onApplySvnAuthentication();
    if (applied) {
      dismissedAuthenticationSignature = detectedAuthenticationFailure.signature;
      authenticationPassword = "";
      queueMicrotask(() => retry?.());
    }
  }

  function focusAuthenticationDialog(node: HTMLElement) {
    queueMicrotask(() => {
      const selector = authenticationUsername ? 'input[type="password"]' : 'input[type="text"]';
      node.querySelector<HTMLInputElement>(selector)?.focus();
    });
  }

  function handleAuthenticationDialogKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      dismissAuthenticationDialog();
    } else if (
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement &&
      event.target.type !== "checkbox"
    ) {
      event.preventDefault();
      void confirmAuthentication();
    }
  }

  function toggleCertificateFailure(failure: SvnCertificateFailure) {
    selectedCertificateFailures = selectedCertificateFailures.includes(failure)
      ? selectedCertificateFailures.filter((selected) => selected !== failure)
      : [...selectedCertificateFailures, failure];
  }

  function dismissCertificateDialog() {
    if (svnCertificateTrustLoading || !detectedCertificateFailure) {
      return;
    }
    dismissedCertificateSignature = detectedCertificateFailure.signature;
    certificateRiskConfirmed = false;
  }

  async function confirmCertificateTrust() {
    if (
      !detectedCertificateFailure ||
      !certificateRiskConfirmed ||
      selectedCertificateFailures.length === 0 ||
      svnCertificateTrustLoading
    ) {
      return;
    }
    const applied = await onConfirmSvnCertificateTrust(selectedCertificateFailures);
    if (applied) {
      dismissedCertificateSignature = detectedCertificateFailure.signature;
      certificateRiskConfirmed = false;
    }
  }

  function focusCertificateDialog(node: HTMLElement) {
    queueMicrotask(() => node.focus());
  }

  function handleCertificateDialogKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      dismissCertificateDialog();
    }
  }

  function statusClass(status: string) {
    return `status-${status.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
  }

  function basename(path: string) {
    const windowsPath = /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
    const normalized = windowsPath
      ? path.replace(/[\\/]+$/, "")
      : path.replace(/\/+$/, "");
    return (windowsPath ? normalized.split(/[\\/]/) : normalized.split("/")).pop() || path;
  }

  function dirname(path: string) {
    const index = path.lastIndexOf("/");
    return index > 0 ? path.slice(0, index) : "根目录";
  }

  function formatBytes(bytes: number | null) {
    if (bytes === null) {
      return "-";
    }
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    }
    if (bytes >= 1024) {
      return `${Math.round(bytes / 1024)}KB`;
    }
    return `${bytes}B`;
  }

  function formatDate(value: string) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function formatTaskTime(value: number) {
    return new Date(value).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function isReviewed(path: string) {
    return reviewedFiles.some((file) => file.path === path);
  }

  function isCommittable(file: ChangedFile) {
    return ![
      "normal",
      "missing",
      "conflicted",
      "obstructed",
      "unversioned",
      "external",
    ].includes(file.status);
  }

  function isSelected(file: ChangedFile) {
    return selectedFilePath === file.path;
  }

  function isSelectedPath(path: string) {
    return selectedFilePath === path;
  }

  function changedFileForPath(path: string) {
    return (files ?? []).find((file) => file.path === path) ?? null;
  }

  function treeNodeForPath(path: string | null): WorkspaceFileNode | null {
    if (!path) {
      return null;
    }
    return (
      findTreeNode(workspaceFileTree?.nodes ?? [], path) ??
      findTreeNode(selectedDirectoryFileTree?.nodes ?? [], path)
    );
  }

  function findTreeNode(nodes: WorkspaceFileNode[], path: string): WorkspaceFileNode | null {
    for (const node of nodes) {
      if (node.path === path) {
        return node;
      }
      const child = findTreeNode(node.children, path);
      if (child) {
        return child;
      }
    }
    return null;
  }

  function flattenWorkspaceNodes(
    nodes: WorkspaceFileNode[],
    flattened: WorkspaceFileNode[] = [],
  ) {
    for (const node of nodes) {
      flattened.push(node);
      flattenWorkspaceNodes(node.children, flattened);
    }
    return flattened;
  }

  function parentDirectoryPath(path: string) {
    const index = path.lastIndexOf("/");
    return index < 0 ? "" : path.slice(0, index);
  }

  function directoryContainsPath(directoryPath: string, path: string) {
    return !directoryPath || path === directoryPath || path.startsWith(`${directoryPath}/`);
  }

  function directoryRowsForNodes(
    nodes: WorkspaceFileNode[],
    collapsedPaths = collapsedTreePaths,
  ): WorkspaceDirectoryRow[] {
    const directoryNodes = new Map<string, WorkspaceFileNode | null>();
    const orderedPaths: string[] = [];
    const addDirectory = (path: string, node: WorkspaceFileNode | null = null) => {
      if (!path) return;
      if (!directoryNodes.has(path)) {
        orderedPaths.push(path);
        directoryNodes.set(path, node);
      } else if (node) {
        directoryNodes.set(path, node);
      }
    };

    for (const node of flattenWorkspaceNodes(nodes)) {
      const segments = node.path.split("/");
      const directoryDepth = node.kind === "dir" ? segments.length : segments.length - 1;
      for (let index = 1; index <= directoryDepth; index += 1) {
        const path = segments.slice(0, index).join("/");
        addDirectory(path, node.kind === "dir" && path === node.path ? node : null);
      }
    }

    const childrenByParent = new Map<string, string[]>();
    for (const path of orderedPaths) {
      const parentPath = parentDirectoryPath(path);
      const children = childrenByParent.get(parentPath) ?? [];
      children.push(path);
      childrenByParent.set(parentPath, children);
    }

    const rows: WorkspaceDirectoryRow[] = [];
    const appendChildren = (parentPath: string, depth: number) => {
      for (const path of childrenByParent.get(parentPath) ?? []) {
        rows.push({
          path,
          name: basename(path),
          depth,
          node: directoryNodes.get(path) ?? null,
        });
        if (!collapsedPaths.has(path)) appendChildren(path, depth + 1);
      }
    };
    appendChildren("", 0);
    return rows;
  }

  function directoryPathsWithChildren(nodes: WorkspaceFileNode[]) {
    const parents = new Set<string>();
    for (const node of flattenWorkspaceNodes(nodes)) {
      const segments = node.path.split("/").filter(Boolean);
      const lastParentIndex = node.kind === "dir" ? segments.length - 1 : segments.length - 2;
      for (let index = 1; index <= lastParentIndex; index += 1) {
        parents.add(segments.slice(0, index).join("/"));
      }
    }
    return parents;
  }

  function filesForDirectory(nodes: WorkspaceFileNode[], directoryPath: string) {
    return flattenWorkspaceNodes(nodes)
      .filter(
        (node) => node.kind === "file" && directoryContainsPath(directoryPath, node.path),
      )
      .map((node) => ({ ...node, depth: 0 }));
  }

  function summarizeDirectoryChanges(files: ChangedFile[]) {
    const summary = new Map<string, DirectoryChangeSummary>();
    for (const file of files) {
      let directoryPath = parentDirectoryPath(file.path);
      while (directoryPath) {
        const current = summary.get(directoryPath) ?? { local: 0, remote: 0 };
        if (["local", "both"].includes(file.change_scope)) current.local += 1;
        if (["remote", "both"].includes(file.change_scope)) current.remote += 1;
        summary.set(directoryPath, current);
        directoryPath = parentDirectoryPath(directoryPath);
      }
    }
    return summary;
  }

  function reconcileSelectedDirectory(
    workingCopyRoot: string | null,
    directoryRows: WorkspaceDirectoryRow[],
    inspectedPath: string | null,
  ) {
    const available = new Set(directoryRows.map((row) => row.path));
    if (directorySelectionWorkspaceRoot !== workingCopyRoot) {
      directorySelectionWorkspaceRoot = workingCopyRoot;
      const inspectedDirectory = inspectedPath ? parentDirectoryPath(inspectedPath) : "";
      selectedDirectoryPath = available.has(inspectedDirectory) ? inspectedDirectory : "";
      return;
    }
    if (selectedDirectoryPath && !available.has(selectedDirectoryPath)) {
      selectedDirectoryPath = "";
    }
  }

  function toggleDirectoryPath(path: string) {
    const next = new Set(collapsedTreePaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsedTreePaths = next;
  }

  function expandDirectoryPath(path: string) {
    if (!path || !collapsedTreePaths.has(path)) {
      return;
    }
    const next = new Set(collapsedTreePaths);
    next.delete(path);
    collapsedTreePaths = next;
  }

  function directoryFileTreeCacheKey(root: string, path: string) {
    return `${root}\0${path}`;
  }

  function applyCachedDirectoryTree(path: string) {
    const root = workspace?.working_copy_root;
    if (!root || !path) {
      return false;
    }
    const cached = directoryFileTreeCache.get(directoryFileTreeCacheKey(root, path));
    if (!cached) {
      return false;
    }
    selectedDirectoryFileTree = cached;
    selectedDirectoryFileTreePath = path;
    directoryFilesError = null;
    return true;
  }

  function selectWorkspaceDirectory(path: string) {
    const changed = selectedDirectoryPath !== path;
    if (changed) {
      selectedDirectoryPath = path;
      clearRowSelection();
      activeRowPath = null;
      fileBrowserScrollTop = 0;
      if (fileBrowserElement) fileBrowserElement.scrollTop = 0;
      closeContextMenu();
      applyCachedDirectoryTree(path);
    }
    if (path && directoryParentPaths.has(path) && collapsedTreePaths.has(path)) {
      expandDirectoryPath(path);
    }
    if (!path) {
      directoryFilesGeneration += 1;
      selectedDirectoryFileTree = null;
      selectedDirectoryFileTreePath = null;
      directoryFilesLoading = false;
      directoryFilesError = null;
      return;
    }
    if (changed || selectedDirectoryFileTreePath !== path) {
      applyCachedDirectoryTree(path);
      void loadSelectedDirectoryFiles(path);
    }
  }

  function observeFolderTreeViewport(node: HTMLElement) {
    folderBrowserElement = node;
    const apply = () => {
      const height = node.clientHeight;
      if (height > 0) {
        folderBrowserViewportHeight = height;
      }
    };
    apply();
    folderTreeViewportObserver?.disconnect();
    if (typeof ResizeObserver === "function") {
      folderTreeViewportObserver = new ResizeObserver(apply);
      folderTreeViewportObserver.observe(node);
    }
    return {
      destroy() {
        folderTreeViewportObserver?.disconnect();
        folderTreeViewportObserver = null;
        if (folderBrowserElement === node) {
          folderBrowserElement = null;
        }
      },
    };
  }

  async function loadSelectedDirectoryFiles(path: string) {
    const root = workspace?.working_copy_root;
    if (!root) return;
    applyCachedDirectoryTree(path);
    const generation = ++directoryFilesGeneration;
    directoryFilesLoading =
      selectedDirectoryFileTreePath !== path || selectedDirectoryFileTree === null;
    directoryFilesError = null;
    try {
      const fileTree = await listWorkspaceFiles({
        working_copy_root: root,
        scope_path: path,
        svn_executable: svnExecutable?.trim() || undefined,
        max_files: 100_000,
      });
      if (generation !== directoryFilesGeneration || selectedDirectoryPath !== path || !fileTree) {
        return;
      }
      directoryFileTreeCache.set(directoryFileTreeCacheKey(root, path), fileTree);
      selectedDirectoryFileTree = fileTree;
      selectedDirectoryFileTreePath = path;
    } catch (error) {
      if (generation === directoryFilesGeneration && selectedDirectoryPath === path) {
        directoryFilesError = error as CommandError;
      }
    } finally {
      if (generation === directoryFilesGeneration && selectedDirectoryPath === path) {
        directoryFilesLoading = false;
      }
    }
  }

  function handleFolderBrowserScroll(event: Event) {
    const element = event.currentTarget as HTMLElement;
    folderBrowserScrollTop = element.scrollTop;
    folderBrowserViewportHeight = element.clientHeight || folderBrowserViewportHeight;
  }

  function openSelectedDirectoryMenu(event: MouseEvent) {
    if (!selectedDirectoryNode) return;
    openRowContextMenu(event, { ...selectedDirectoryNode, depth: 0 });
  }

  function isChangedPath(path: string) {
    return changedFileForPath(path) !== null;
  }

  function formatTimelineTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  function repositoryEntryKindLabel(kind: string) {
    if (kind === "dir") {
      return "目录";
    }
    if (kind === "file") {
      return "文件";
    }
    return kind || "未知";
  }

  function toggleTimelineEntryPaths(revision: string) {
    const next = new Set(expandedTimelineRevisions);
    if (next.has(revision)) {
      next.delete(revision);
    } else {
      next.add(revision);
    }
    expandedTimelineRevisions = next;
  }

  function toggleTimelineMerge(event: MouseEvent, revision: string) {
    const checkbox = event.currentTarget as HTMLInputElement;
    const next = new Set(timelineMergeRevisions);
    if (event.shiftKey && timelineMergeSelectionAnchor) {
      const anchorIndex = filteredLogEntries.findIndex(
        (entry) => entry.revision === timelineMergeSelectionAnchor,
      );
      const targetIndex = filteredLogEntries.findIndex((entry) => entry.revision === revision);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = [anchorIndex, targetIndex].sort((left, right) => left - right);
        for (const entry of filteredLogEntries.slice(start, end + 1)) {
          if (checkbox.checked) next.add(entry.revision);
          else next.delete(entry.revision);
        }
      }
    } else if (checkbox.checked) {
      next.add(revision);
    } else {
      next.delete(revision);
    }
    timelineMergeRevisions = next;
    timelineMergeSelectionAnchor = revision;
  }

  function clearTimelineMergeSelection() {
    timelineMergeRevisions = new Set();
    timelineMergeSelectionAnchor = null;
    timelineMergeDialogOpen = false;
  }

  function openTimelineMergeDialog() {
    if (!workspace?.repository_url || !workspace.repository_root || timelineMergeRevisions.size === 0) {
      return;
    }
    timelineMergeDialogOpen = true;
  }

  function closeTimelineMergeDialog() {
    timelineMergeDialogOpen = false;
  }

  async function revertSelectedTimelineRevisions() {
    if (timelineBatchRevertRunning || selectedTimelineMergeRevisions.length === 0) {
      return;
    }
    timelineBatchRevertRunning = true;
    try {
      if (await onRevertSelectedRevisions(selectedTimelineMergeRevisions)) {
        clearTimelineMergeSelection();
      }
    } finally {
      timelineBatchRevertRunning = false;
    }
  }

  $: selectedTimelineMergeRevisions = [...timelineMergeRevisions].sort(
    (left, right) => Number(left) - Number(right),
  );

  function openTimelineEntryDiff(entry: SvnLogEntry, path: SvnChangedPath) {
    return openChangedPathRevisionDiff(entry.revision, path.path, path.action);
  }

  function timelineRevertDisabled() {
    return !workspace || toolbarLocked;
  }

  function timelineWorkspaceRevertDisabled() {
    return !workspace || toolbarLocked;
  }

  function revertTimelineEntry(entry: SvnLogEntry) {
    onRevertToRevision(entry.revision);
  }

  function exportTimelineEntry(entry: SvnLogEntry) {
    onExportRevision(entry.revision);
  }

  function timelineExportDisabled() {
    return !svnLog?.repository_url?.trim() || toolbarLocked || repositoryExportRunning;
  }

  function formatTimelineDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value || "-";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  async function openConflictResolver(path: string) {
    if (selectedFilePath !== path) {
      await onSelectFile(path);
    }
    conflictResolverOpen = true;
  }

  function isLocalChangedPath(path: string) {
    const scope = changedFileForPath(path)?.change_scope;
    return scope === "local" || scope === "both";
  }

  function isUnversionedPath(path: string) {
    return changedFileForPath(path)?.status === "unversioned";
  }

  function isConflictedPath(path: string) {
    const file = changedFileForPath(path);
    return file?.status === "conflicted" || !!file?.conflict_kind;
  }

  function toggleRowMenu(path: string) {
    openRowMenuPath = openRowMenuPath === path ? null : path;
  }

  function runRowAction(action: () => void) {
    openRowMenuPath = null;
    action();
  }

  function localStatusText(node: WorkspaceFileNode) {
    if (node.kind === "dir") {
      return "本地";
    }
    if (["normal", "none"].includes(node.status)) {
      return "本地 属性";
    }
    return `本地 ${labelStatus(node.status)}`;
  }

  function remoteStatusText(node: WorkspaceFileNode) {
    if (node.kind === "dir") {
      return "远端";
    }
    const status = node.remote_status;
    if (!status || ["normal", "none"].includes(status)) {
      return "远端 属性";
    }
    return `远端 ${labelStatus(status)}`;
  }

  function selectedStatusText(file: ChangedFile | null, node: WorkspaceFileNode | null) {
    const scope = file?.change_scope ?? node?.change_scope ?? "none";
    const localStatus = file?.status ?? node?.status ?? "normal";
    const remoteStatus = file?.remote_status ?? node?.remote_status;
    const localLabel = ["normal", "none"].includes(localStatus)
      ? "属性"
      : labelStatus(localStatus);
    const remoteLabel = !remoteStatus || ["normal", "none"].includes(remoteStatus)
      ? "属性"
      : labelStatus(remoteStatus);
    if (scope === "both") {
      return `本地 ${localLabel} / 远端 ${remoteLabel}`;
    }
    if (scope === "local") {
      return `本地 ${localLabel}`;
    }
    if (scope === "remote") {
      return `远端 ${remoteLabel}`;
    }
    return labelStatus(localStatus);
  }

  function canDeleteVersionedPath(node: WorkspaceFileNode | null) {
    return (
      !!node &&
      node.versioned &&
      ["file", "dir"].includes(node.kind) &&
      !["deleted", "missing", "external", "unversioned"].includes(node.status)
    );
  }

  function canDeleteUnversionedFile(node: WorkspaceFileNode | null) {
    return !!node && node.kind === "file" && node.status === "unversioned";
  }

  function canDeletePath(node: WorkspaceFileNode | null) {
    return canDeleteVersionedPath(node) || canDeleteUnversionedFile(node);
  }

  function formatSvnDate(value: string | null) {
    if (!value) {
      return "-";
    }
    return value.replace("T", " ").replace(/\.\d+Z$/, "Z").slice(0, 16);
  }

  function canMovePath(node: WorkspaceFileNode | null) {
    return canDeleteVersionedPath(node);
  }

  function canIgnorePath(node: WorkspaceFileNode | null) {
    return (
      !!node &&
      !node.versioned &&
      ["file", "dir"].includes(node.kind) &&
      node.status === "unversioned"
    );
  }

  function isTreeNodeCollapsed(
    node: WorkspaceFileNode,
    collapsedPaths = collapsedTreePaths,
  ) {
    return node.kind === "dir" && collapsedPaths.has(node.path);
  }

  function toggleTreeNode(node: WorkspaceFileNode) {
    openRowMenuPath = null;
    if (node.kind !== "dir") {
      selectTreeNode(node);
      return;
    }

    const next = new Set(collapsedTreePaths);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
    }
    collapsedTreePaths = next;
  }

  function selectTreeNode(node: WorkspaceFileNode) {
    if (node.kind !== "file") {
      return;
    }
    if (node.changed || isChangedPath(node.path)) {
      onSelectFile(node.path);
      return;
    }
    onSelectWorkspacePath(node.path);
  }

  function collectTreePaths(nodes: WorkspaceFileNode[], paths = new Set<string>()) {
    for (const node of nodes) {
      paths.add(node.path);
      collectTreePaths(node.children, paths);
    }
    return paths;
  }

  function collectChangelistNames(
    nodes: WorkspaceFileNode[],
    names = new Set<string>(),
  ) {
    for (const node of nodes) {
      if (node.changelist) {
        names.add(node.changelist);
      }
      collectChangelistNames(node.children, names);
    }
    return names;
  }

  function reconcileRowSelection(
    workingCopyRoot: string | null,
    fileTree: WorkspaceFileTree | null,
  ) {
    if (selectionWorkspaceRoot !== workingCopyRoot) {
      selectionWorkspaceRoot = workingCopyRoot;
      clearRevisionFileDiff();
      expandedTimelineRevisions = new Set();
      timelineMergeRevisions = new Set();
      timelineMergeSelectionAnchor = null;
      timelineMergeDialogOpen = false;
      selectedRowPaths = new Set();
      rowSelectionAnchorPath = null;
      activeRowPath = null;
      keyboardRangeAnchorPath = null;
      keyboardRangeBasePaths = new Set();
      closeContextMenu();
    }
    if (selectionFileTree === fileTree) {
      return;
    }
    selectionFileTree = fileTree;
    const availablePaths = collectTreePaths(fileTree?.nodes ?? []);
    const reconciled = new Set(
      [...selectedRowPaths].filter((path) => availablePaths.has(path)),
    );
    if (reconciled.size !== selectedRowPaths.size) {
      selectedRowPaths = reconciled;
    }
    if (rowSelectionAnchorPath && !availablePaths.has(rowSelectionAnchorPath)) {
      rowSelectionAnchorPath = null;
    }
    if (contextMenuPath && !availablePaths.has(contextMenuPath)) {
      closeContextMenu();
    }
  }

  function isRowSelected(path: string, selectedPaths = selectedRowPaths) {
    return selectedPaths.has(path);
  }

  function toggleRowSelection(path: string, checked: boolean, extendRange: boolean) {
    const next = new Set(selectedRowPaths);
    const currentIndex = treeRows.findIndex((row) => row.path === path);
    const anchorIndex = rowSelectionAnchorPath
      ? treeRows.findIndex((row) => row.path === rowSelectionAnchorPath)
      : -1;
    if (extendRange && currentIndex >= 0 && anchorIndex >= 0) {
      const start = Math.min(currentIndex, anchorIndex);
      const end = Math.max(currentIndex, anchorIndex);
      for (const row of treeRows.slice(start, end + 1)) {
        if (checked) {
          next.add(row.path);
        } else {
          next.delete(row.path);
        }
      }
    } else if (checked) {
      next.add(path);
    } else {
      next.delete(path);
    }
    selectedRowPaths = next;
    if (!extendRange || anchorIndex < 0) {
      rowSelectionAnchorPath = path;
    }
    keyboardRangeAnchorPath = path;
    keyboardRangeBasePaths = new Set(next);
    openRowMenuPath = null;
  }

  function toggleVisibleRowSelection(checked: boolean) {
    const next = new Set(selectedRowPaths);
    for (const row of treeRows) {
      if (checked) {
        next.add(row.path);
      } else {
        next.delete(row.path);
      }
    }
    selectedRowPaths = next;
    rowSelectionAnchorPath = checked ? treeRows.at(-1)?.path ?? null : null;
    keyboardRangeAnchorPath = rowSelectionAnchorPath;
    keyboardRangeBasePaths = new Set(next);
    openRowMenuPath = null;
  }

  function clearRowSelection() {
    selectedRowPaths = new Set();
    rowSelectionAnchorPath = null;
    keyboardRangeAnchorPath = activeRowPath;
    keyboardRangeBasePaths = new Set();
    openRowMenuPath = null;
  }

  function collapseSelectedOperationPaths(paths: string[]) {
    const selected = new Set(paths);
    return paths.filter((path) => {
      let current = path;
      while (current.includes("/")) {
        current = current.slice(0, current.lastIndexOf("/"));
        if (selected.has(current)) {
          return false;
        }
      }
      return true;
    });
  }

  function openCommitForm() {
    if (!workspace?.working_copy_root?.trim()) {
      return;
    }
    commitDialogOpen = true;
  }

  function closeCommitDialog() {
    commitDialogOpen = false;
  }

  function commitTargetPath() {
    const root = workspace?.working_copy_root?.trim() ?? "";
    if (!root || !selectedDirectoryPath) {
      return root;
    }
    return `${root.replaceAll("\\", "/").replace(/\/+$/, "")}/${selectedDirectoryPath.replaceAll("\\", "/")}`;
  }

  function rowDomId(path: string) {
    return `workspace-row-${encodeURIComponent(path)}`;
  }

  function reconcileActiveRow(rows: WorkspaceTreeRow[], inspectedPath: string | null) {
    if (activeRowPath && rows.some((row) => row.path === activeRowPath)) {
      return;
    }
    activeRowPath = rows.find((row) => row.path === inspectedPath)?.path ?? null;
  }

  function reportActiveWorkspacePath(path: string | null) {
    if (reportedActiveWorkspacePath === path) {
      return;
    }
    reportedActiveWorkspacePath = path;
    onActiveWorkspacePathChange(path);
  }

  function scrollActiveRowIntoView(path: string) {
    const rowIndex = treeRows.findIndex((row) => row.path === path);
    if (fileBrowserElement && rowIndex >= 0) {
      const viewportHeight = fileBrowserElement.clientHeight || fileBrowserViewportHeight;
      const rowTop = fileTreeHeaderHeight + rowIndex * fileTreeRowHeight;
      const rowBottom = rowTop + fileTreeRowHeight;
      const visibleTop = fileBrowserElement.scrollTop + fileTreeHeaderHeight;
      const visibleBottom = fileBrowserElement.scrollTop + viewportHeight;
      if (rowTop < visibleTop) {
        fileBrowserElement.scrollTop = Math.max(0, rowTop - fileTreeHeaderHeight);
      } else if (rowBottom > visibleBottom) {
        fileBrowserElement.scrollTop = Math.max(0, rowBottom - viewportHeight);
      }
      fileBrowserScrollTop = fileBrowserElement.scrollTop;
    }
    queueMicrotask(() => {
      const row = document.getElementById(rowDomId(path));
      row?.scrollIntoView?.({ block: "nearest" });
    });
  }

  function virtualWindow<T>(
    items: T[],
    scrollTop: number,
    viewportHeight: number,
    rowHeight: number,
    headerHeight = 0,
  ): VirtualWindow<T> {
    if (items.length === 0) {
      return { items: [], startIndex: 0, beforeHeight: 0, afterHeight: 0 };
    }
    const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const windowSize = visibleRows + virtualRowOverscan * 2;
    const firstVisible = Math.floor(Math.max(0, scrollTop - headerHeight) / rowHeight);
    const maxStart = Math.max(0, items.length - windowSize);
    const startIndex = Math.min(maxStart, Math.max(0, firstVisible - virtualRowOverscan));
    const endIndex = Math.min(items.length, startIndex + windowSize);
    return {
      items: items.slice(startIndex, endIndex),
      startIndex,
      beforeHeight: startIndex * rowHeight,
      afterHeight: (items.length - endIndex) * rowHeight,
    };
  }

  function handleFileBrowserScroll(event: Event) {
    const element = event.currentTarget as HTMLElement;
    fileBrowserScrollTop = element.scrollTop;
    fileBrowserViewportHeight = element.clientHeight || fileBrowserViewportHeight;
  }

  function handleWorkspaceBlameScroll(event: Event) {
    const element = event.currentTarget as HTMLElement;
    workspaceBlameScrollTop = element.scrollTop;
    workspaceBlameViewportHeight = element.clientHeight || workspaceBlameViewportHeight;
  }

  function handleRepositoryBlameScroll(event: Event) {
    const element = event.currentTarget as HTMLElement;
    repositoryBlameScrollTop = element.scrollTop;
    repositoryBlameViewportHeight = element.clientHeight || repositoryBlameViewportHeight;
  }

  function openWorkspaceBlameRevisionLog(revision: string) {
    if (!revision || !workspace?.working_copy_root || !selectedFilePath) {
      return;
    }
    blameRevisionLogTarget = {
      revision,
      targetPath: "",
      workingCopyRoot: workspace.working_copy_root,
      filePath: selectedFilePath,
      repositoryUrl: "",
      repositoryRevision: "",
    };
  }

  function openRepositoryBlameRevisionLog(revision: string) {
    if (!revision || !repositoryFileBlame?.target) {
      return;
    }
    blameRevisionLogTarget = {
      revision,
      targetPath: "",
      workingCopyRoot: "",
      filePath: "",
      repositoryUrl: repositoryFileBlame.target,
      repositoryRevision: repositoryFileBlameRevision ?? "",
    };
  }

  function selectKeyboardRange(anchorPath: string, targetPath: string) {
    const anchorIndex = treeRows.findIndex((row) => row.path === anchorPath);
    const targetIndex = treeRows.findIndex((row) => row.path === targetPath);
    if (anchorIndex < 0 || targetIndex < 0) {
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const next = new Set(keyboardRangeBasePaths);
    for (const row of treeRows.slice(start, end + 1)) {
      next.add(row.path);
    }
    selectedRowPaths = next;
    rowSelectionAnchorPath = anchorPath;
  }

  function activateTreeRow(node: WorkspaceTreeRow, extendSelection = false) {
    const previousActivePath = activeRowPath;
    activeRowPath = node.path;
    if (extendSelection) {
      const anchorPath = keyboardRangeAnchorPath ?? previousActivePath ?? node.path;
      selectKeyboardRange(anchorPath, node.path);
    } else {
      rowSelectionAnchorPath = node.path;
      keyboardRangeAnchorPath = node.path;
      keyboardRangeBasePaths = new Set(selectedRowPaths);
    }
    if (node.kind === "file") {
      selectTreeNode(node);
    }
    openRowMenuPath = null;
    scrollActiveRowIntoView(node.path);
  }

  function setTreeNodeCollapsed(node: WorkspaceTreeRow, collapsed: boolean) {
    if (node.kind !== "dir") {
      return;
    }
    const next = new Set(collapsedTreePaths);
    if (collapsed) {
      next.add(node.path);
    } else {
      next.delete(node.path);
    }
    collapsedTreePaths = next;
  }

  function activateTreeNodeFromPointer(node: WorkspaceFileNode) {
    activeRowPath = node.path;
    rowSelectionAnchorPath = node.path;
    keyboardRangeAnchorPath = node.path;
    keyboardRangeBasePaths = new Set(selectedRowPaths);
    toggleTreeNode(node);
  }

  function canOpenWorkspaceNode(node: WorkspaceFileNode | null) {
    return !!node && node.kind === "file" && !["deleted", "missing"].includes(node.status);
  }

  function canShowPathContextMenu(node: WorkspaceFileNode | null) {
    return !!node && (node.kind !== "dir" || node.versioned);
  }

  function openTreeNodeFromPointer(node: WorkspaceFileNode) {
    activeRowPath = node.path;
    rowSelectionAnchorPath = node.path;
    keyboardRangeAnchorPath = node.path;
    keyboardRangeBasePaths = new Set(selectedRowPaths);
    if (node.kind === "dir") {
      setTreeNodeCollapsed(node, !isTreeNodeCollapsed(node));
      return;
    }
    if (canOpenWorkspaceNode(node)) {
      onOpenWorkspaceFile(node.path);
    }
  }

  function closeContextMenu(restoreGridFocus = false) {
    contextMenuPath = null;
    contextMenuElement = null;
    if (restoreGridFocus) {
      queueMicrotask(() => fileBrowserElement?.focus());
    }
  }

  function focusInitialContextMenuItem() {
    queueMicrotask(() => {
      if (!contextMenuElement) {
        return;
      }
      const rect = contextMenuElement.getBoundingClientRect();
      contextMenuX = Math.max(8, Math.min(contextMenuX, window.innerWidth - rect.width - 8));
      contextMenuY = Math.max(8, Math.min(contextMenuY, window.innerHeight - rect.height - 8));
      contextMenuElement
        .querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    });
  }

  function openContextMenuAt(node: WorkspaceTreeRow, clientX: number, clientY: number) {
    closeProjectContextMenu();
    if (!canShowPathContextMenu(node)) {
      closeContextMenu();
      openRowMenuPath = null;
      return;
    }
    activeRowPath = node.path;
    rowSelectionAnchorPath = node.path;
    keyboardRangeAnchorPath = node.path;
    if (!selectedRowPaths.has(node.path)) {
      selectedRowPaths = new Set([node.path]);
      keyboardRangeBasePaths = new Set(selectedRowPaths);
    }
    contextMenuPath = node.path;
    contextMenuX = clientX;
    contextMenuY = clientY;
    openRowMenuPath = null;
    if (node.kind === "file") {
      selectTreeNode(node);
    }
    focusInitialContextMenuItem();
  }

  function openRowContextMenu(event: MouseEvent, node: WorkspaceTreeRow) {
    event.preventDefault();
    event.stopPropagation();
    openContextMenuAt(node, event.clientX, event.clientY);
  }

  function openActiveRowContextMenu() {
    const node = treeRows.find((row) => row.path === activeRowPath) ?? treeRows[0];
    if (!node) {
      return;
    }
    const row = document.getElementById(rowDomId(node.path));
    const rect = row?.getBoundingClientRect();
    openContextMenuAt(node, rect?.left ?? 12, rect?.bottom ?? 12);
  }

  function runContextMenuAction(action: () => void) {
    closeContextMenu();
    action();
  }

  function runContextRevert() {
    const paths = selectedRevertablePaths;
    if (paths.length === 1) {
      onRevertFile(paths[0]);
    } else if (paths.length > 1) {
      onRevertPaths(paths);
    }
  }

  function runContextMove() {
    const paths = selectedMovablePaths;
    if (paths.length === 1) {
      onMovePath(paths[0]);
    } else if (paths.length > 1) {
      onMovePaths(paths);
    }
  }

  function runContextDelete() {
    const paths = selectedDeletablePaths;
    if (paths.length === 1) {
      onDeletePath(paths[0]);
    } else if (paths.length > 1) {
      onDeletePaths(paths);
    }
  }

  function contextMenuItems() {
    return Array.from(
      contextMenuElement?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
  }

  function handleContextMenuKeydown(event: KeyboardEvent) {
    const items = contextMenuItems();
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === "Escape") {
      closeContextMenu(true);
      event.preventDefault();
      return;
    } else {
      return;
    }
    items[nextIndex]?.focus();
    event.preventDefault();
  }

  function closeContextMenuOnOutsidePointer(event: PointerEvent) {
    if (
      contextMenuPath &&
      event.target instanceof Node &&
      !contextMenuElement?.contains(event.target)
    ) {
      closeContextMenu();
    }
    if (
      projectContextMenuEntryId &&
      event.target instanceof Node &&
      !projectContextMenuElement?.contains(event.target)
    ) {
      closeProjectContextMenu();
    }
  }

  function closeContextMenuOnWindowChange() {
    if (contextMenuPath) {
      closeContextMenu();
    }
    closeProjectContextMenu();
  }

  function moveActiveRow(targetIndex: number, extendSelection: boolean) {
    const boundedIndex = Math.max(0, Math.min(treeRows.length - 1, targetIndex));
    const target = treeRows[boundedIndex];
    if (target) {
      activateTreeRow(target, extendSelection);
    }
  }

  function handleFileTableFocus(event: FocusEvent) {
    if (event.target !== event.currentTarget || activeRowPath || treeRows.length === 0) {
      return;
    }
    activateTreeRow(treeRows[0]);
  }

  function handleFileTableKeydown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget || treeRows.length === 0) {
      return;
    }
    const currentIndex = Math.max(
      0,
      treeRows.findIndex((row) => row.path === activeRowPath),
    );
    const current = treeRows[currentIndex];
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      openActiveRowContextMenu();
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      toggleVisibleRowSelection(true);
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case "ArrowUp":
        moveActiveRow(currentIndex - 1, event.shiftKey);
        break;
      case "ArrowDown":
        moveActiveRow(currentIndex + 1, event.shiftKey);
        break;
      case "Home":
        moveActiveRow(0, event.shiftKey);
        break;
      case "End":
        moveActiveRow(treeRows.length - 1, event.shiftKey);
        break;
      case "ArrowLeft": {
        if (current.kind === "dir" && !isTreeNodeCollapsed(current)) {
          setTreeNodeCollapsed(current, true);
          break;
        }
        const parentPath = current.path.includes("/")
          ? current.path.slice(0, current.path.lastIndexOf("/"))
          : null;
        const parentIndex = parentPath
          ? treeRows.findIndex((row) => row.path === parentPath)
          : -1;
        if (parentIndex >= 0) {
          moveActiveRow(parentIndex, event.shiftKey);
        }
        break;
      }
      case "ArrowRight": {
        if (current.kind !== "dir") {
          break;
        }
        if (isTreeNodeCollapsed(current)) {
          setTreeNodeCollapsed(current, false);
          break;
        }
        const childIndex = treeRows.findIndex(
          (row, index) => index > currentIndex && row.depth === current.depth + 1,
        );
        if (childIndex >= 0) {
          moveActiveRow(childIndex, event.shiftKey);
        }
        break;
      }
      case "Enter":
        if (current.kind === "dir") {
          setTreeNodeCollapsed(current, !isTreeNodeCollapsed(current));
        } else {
          selectTreeNode(current);
        }
        break;
      case " ":
        toggleRowSelection(current.path, !isRowSelected(current.path), false);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function filterTreeNodes(
    nodes: WorkspaceFileNode[],
    filter: WorkingCopyTreeFilter,
    queryText: string,
    selectedChangelist: string,
  ): WorkspaceFileNode[] {
    const query = queryText.trim().toLowerCase();
    return nodes.flatMap((node) => {
      const children = filterTreeNodes(node.children, filter, queryText, selectedChangelist);
      const selfMatchesSearch = !query || node.path.toLowerCase().includes(query);
      const selfMatchesMode =
        filter === "all" ||
        (filter === "local" &&
          ["local", "both"].includes(node.change_scope) &&
          node.status !== "unversioned") ||
        (filter === "unversioned" && node.status === "unversioned");
      const selfMatchesChangelist =
        selectedChangelist === "all" ||
        (node.kind === "file" &&
          (selectedChangelist === "unassigned"
            ? !node.changelist
            : node.changelist === selectedChangelist));
      const keepNode =
        children.length > 0 || (selfMatchesSearch && selfMatchesMode && selfMatchesChangelist);

      if (!keepNode) {
        return [];
      }

      return [
        {
          ...node,
          children,
        },
      ];
    });
  }

  function flattenTreeNodes(
    nodes: WorkspaceFileNode[],
    depth = 0,
    collapsedPaths = collapsedTreePaths,
  ): WorkspaceTreeRow[] {
    return nodes.flatMap((node) => {
      const row = {
        ...node,
        depth,
      };
      if (isTreeNodeCollapsed(node, collapsedPaths)) {
        return [row];
      }
      return [row, ...flattenTreeNodes(node.children, depth + 1, collapsedPaths)];
    });
  }

  function filterLogEntries(entries: SvnLog["entries"]) {
    const author = svnLogAuthorFilter.trim().toLowerCase();
    const keyword = svnLogKeywordFilter.trim().toLowerCase();
    const fromTime = localDateBoundary(svnLogDateFromFilter);
    const toDate = localDateBoundary(svnLogDateToFilter);
    const toExclusive = toDate === null ? null : nextLocalDay(toDate);
    if (fromTime !== null && toExclusive !== null && fromTime >= toExclusive) {
      return [];
    }

    return entries.filter((entry) => {
      const entryTime = new Date(entry.date).getTime();
      if (author && !entry.author.toLowerCase().includes(author)) {
        return false;
      }
      if (
        keyword &&
        !`${entry.revision} ${entry.author} ${entry.message} ${entry.changed_paths
          .map((path) => path.path)
          .join(" ")}`
          .toLowerCase()
          .includes(keyword)
      ) {
        return false;
      }
      if ((fromTime !== null || toExclusive !== null) && Number.isNaN(entryTime)) {
        return false;
      }
      if (fromTime !== null && entryTime < fromTime) {
        return false;
      }
      if (toExclusive !== null && entryTime >= toExclusive) {
        return false;
      }
      return true;
    });
  }

  function localDateBoundary(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date.getTime();
  }

  function nextLocalDay(timestamp: number) {
    const date = new Date(timestamp);
    date.setDate(date.getDate() + 1);
    return date.getTime();
  }

  function clearTimelineFilters() {
    onSvnLogFilterInput("svnLogKeywordFilter", "");
    onSvnLogFilterInput("svnLogAuthorFilter", "");
    onSvnLogFilterInput("svnLogDateFromFilter", "");
    onSvnLogFilterInput("svnLogDateToFilter", "");
    onSvnLogFileOnlyInput(false);
  }

  function joinRepositoryUrl(baseUrl: string, name: string) {
    return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(name)}`;
  }

  function parentRepositoryUrl(url: string) {
    const normalized = url.replace(/\/+$/, "");
    const protocolMatch = normalized.match(/^[a-z][a-z0-9+.-]*:\/\//i);
    const minimum = protocolMatch ? protocolMatch[0].length : 0;
    const slashIndex = normalized.lastIndexOf("/");
    if (slashIndex <= minimum) {
      return normalized;
    }
    return normalized.slice(0, slashIndex);
  }

  function repositoryBreadcrumbs(url: string) {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) {
      return [];
    }

    const protocolMatch = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\//i);
    if (!protocolMatch) {
      const segments = trimmed.split("/").filter(Boolean);
      return segments.map((segment, index) => ({
        label: segment,
        url: segments.slice(0, index + 1).join("/"),
      }));
    }

    const prefix = protocolMatch[0];
    const rest = trimmed.slice(prefix.length);
    const [host = "", ...segments] = rest.split("/").filter(Boolean);
    return [
      { label: `${prefix}${host}`, url: `${prefix}${host}` },
      ...segments.map((segment, index) => ({
        label: segment,
        url: `${prefix}${host}/${segments.slice(0, index + 1).join("/")}`,
      })),
    ];
  }

  function branchName(entry: BranchPoolEntry) {
    const url = entry.branch_url.replace(/\/+$/, "");
    return url.slice(url.lastIndexOf("/") + 1) || entry.branch_url;
  }

  function chooseDefaultRepositoryUrl() {
    if (repositoryUrlInput.trim()) {
      onLoadRepositoryUrl();
      return;
    }
    if (workspace?.repository_root) {
      onLoadRepositoryUrl(workspace.repository_root);
    }
  }

  function workspaceEntryName(entry: BranchPoolEntry) {
    return entry.display_name?.trim() || basename(entry.local_path) || branchName(entry);
  }

  let draggedBranchPoolEntryId: string | null = null;
  let branchPoolDropTarget: { id: string; position: "before" | "after" } | null = null;
  let branchPoolPointerDrag: {
    entryId: string;
    pointerId: number;
    captureElement: HTMLElement;
    startX: number;
    startY: number;
    active: boolean;
  } | null = null;
  let suppressProjectOpenEntryId: string | null = null;
  let projectContextMenuEntryId: string | null = null;
  let projectContextMenuEntry: BranchPoolEntry | null = null;
  let projectContextMenuX = 0;
  let projectContextMenuY = 0;
  let editingBranchPoolEntryId: string | null = null;
  let branchPoolDisplayNameDraft = "";
  let changelistFilter = "all";
  const workspaceTabUiStates = new Map<string, WorkspaceTabUiState>();
  let activeWorkspaceTabUiKey: string | null = null;

  function workspaceTabUiKey(localPath: string | null | undefined) {
    if (!localPath?.trim()) return null;
    const path = localPath.trim().replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[a-z]:\//i.test(path) || path.startsWith("//") ? path.toLowerCase() : path;
  }

  function captureWorkspaceTabUiState(): WorkspaceTabUiState {
    return {
      workingCopyTreeFilter,
      selectedRevisionFileDiff,
      revisionFileContentDiff,
      expandedTimelineRevisions: new Set(expandedTimelineRevisions),
      timelineMergeRevisions: new Set(timelineMergeRevisions),
      timelineMergeSelectionAnchor,
      collapsedTreePaths: new Set(collapsedTreePaths),
      selectedDirectoryPath,
      selectedDirectoryFileTree,
      selectedDirectoryFileTreePath,
      selectedRowPaths: new Set(selectedRowPaths),
      rowSelectionAnchorPath,
      activeRowPath,
      keyboardRangeAnchorPath,
      keyboardRangeBasePaths: new Set(keyboardRangeBasePaths),
      fileBrowserScrollTop,
      folderBrowserScrollTop,
      workspaceBlameScrollTop,
      repositoryBlameScrollTop,
      changelistFilter,
    };
  }

  function syncWorkspaceTabUiState(
    key: string | null,
    workingCopyRoot: string | null,
    fileTree: WorkspaceFileTree | null,
    workspaceBlame: SvnBlame | null,
    repositoryBlame: SvnBlame | null,
  ) {
    if (key === activeWorkspaceTabUiKey) return;
    if (activeWorkspaceTabUiKey) {
      workspaceTabUiStates.set(activeWorkspaceTabUiKey, captureWorkspaceTabUiState());
    }
    activeWorkspaceTabUiKey = key;
    const cached = key ? workspaceTabUiStates.get(key) : null;

    workingCopyTreeFilter =
      cached?.workingCopyTreeFilter === "local" || cached?.workingCopyTreeFilter === "unversioned"
        ? cached.workingCopyTreeFilter
        : "all";
    selectedRevisionFileDiff = cached?.selectedRevisionFileDiff ?? null;
    revisionFileContentDiff = cached?.revisionFileContentDiff ?? null;
    revisionFileDiffLoading = false;
    revisionFileDiffError = null;
    expandedTimelineRevisions = new Set(cached?.expandedTimelineRevisions ?? []);
    timelineMergeRevisions = new Set(cached?.timelineMergeRevisions ?? []);
    timelineMergeSelectionAnchor = cached?.timelineMergeSelectionAnchor ?? null;
    collapsedTreePaths = new Set(cached?.collapsedTreePaths ?? []);
    selectedDirectoryPath = cached?.selectedDirectoryPath ?? "";
    selectedDirectoryFileTree = cached?.selectedDirectoryFileTree ?? null;
    selectedDirectoryFileTreePath = cached?.selectedDirectoryFileTreePath ?? null;
    if (workingCopyRoot && selectedDirectoryFileTree && selectedDirectoryFileTreePath) {
      directoryFileTreeCache.set(
        directoryFileTreeCacheKey(workingCopyRoot, selectedDirectoryFileTreePath),
        selectedDirectoryFileTree,
      );
    }
    selectedRowPaths = new Set(cached?.selectedRowPaths ?? []);
    rowSelectionAnchorPath = cached?.rowSelectionAnchorPath ?? null;
    activeRowPath = cached?.activeRowPath ?? null;
    keyboardRangeAnchorPath = cached?.keyboardRangeAnchorPath ?? null;
    keyboardRangeBasePaths = new Set(cached?.keyboardRangeBasePaths ?? []);
    fileBrowserScrollTop = cached?.fileBrowserScrollTop ?? 0;
    folderBrowserScrollTop = cached?.folderBrowserScrollTop ?? 0;
    workspaceBlameScrollTop = cached?.workspaceBlameScrollTop ?? 0;
    repositoryBlameScrollTop = cached?.repositoryBlameScrollTop ?? 0;
    changelistFilter = cached?.changelistFilter ?? "all";
    directorySelectionWorkspaceRoot = workingCopyRoot;
    selectionWorkspaceRoot = workingCopyRoot;
    selectionFileTree = fileTree;
    virtualizedFileTreeSource = fileTree;
    virtualizedFileTreeWorkspaceKey = key;
    virtualizedWorkspaceBlameSource = workspaceBlame;
    virtualizedRepositoryBlameSource = repositoryBlame;
    directoryFilesGeneration += 1;
    directoryFilesLoading = false;
    directoryFilesError = null;
    timelineMergeDialogOpen = false;
    closeContextMenu();

    queueMicrotask(() => {
      if (key !== activeWorkspaceTabUiKey) return;
      if (fileBrowserElement) fileBrowserElement.scrollTop = fileBrowserScrollTop;
      if (folderBrowserElement) folderBrowserElement.scrollTop = folderBrowserScrollTop;
    });
  }

  $: projectContextMenuEntry =
    branchPool.entries.find((entry) => entry.id === projectContextMenuEntryId) ?? null;

  function startBranchPoolPointerDrag(event: PointerEvent, entryId: string) {
    if (event.button !== 0 || branchPoolLoading || editingBranchPoolEntryId === entryId) {
      return;
    }
    finishBranchPoolDrag();
    closeProjectContextMenu();
    const captureElement = event.currentTarget as HTMLElement;
    branchPoolPointerDrag = {
      entryId,
      pointerId: event.pointerId,
      captureElement,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    try {
      captureElement.setPointerCapture?.(event.pointerId);
    } catch {
      // Window listeners still provide a fallback on WebViews without pointer capture.
    }
    window.addEventListener("pointermove", updateBranchPoolPointerDrag);
    window.addEventListener("pointerup", finishBranchPoolPointerDrag);
    window.addEventListener("pointercancel", cancelBranchPoolPointerDrag);
    event.preventDefault();
  }

  function updateBranchPoolPointerDrag(event: PointerEvent) {
    const pointerDrag = branchPoolPointerDrag;
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    if (
      !pointerDrag.active &&
      Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 4
    ) {
      return;
    }
    pointerDrag.active = true;
    suppressProjectOpenEntryId = pointerDrag.entryId;
    draggedBranchPoolEntryId = pointerDrag.entryId;
    const pointedElement = document.elementFromPoint?.(event.clientX, event.clientY);
    const eventElement = event.target instanceof Element ? event.target : null;
    const targetElement = pointedElement?.closest<HTMLElement>("[data-project-entry-id]")
      ?? eventElement?.closest<HTMLElement>("[data-project-entry-id]")
      ?? null;
    const targetId = targetElement?.dataset.projectEntryId;
    if (!targetElement || !targetId || targetId === pointerDrag.entryId) {
      branchPoolDropTarget = null;
      return;
    }
    updateBranchPoolDropPosition(targetElement, targetId, event.clientX);
    event.preventDefault();
  }

  function finishBranchPoolPointerDrag(event: PointerEvent) {
    const pointerDrag = branchPoolPointerDrag;
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const dropTarget = branchPoolDropTarget;
    if (pointerDrag.active && dropTarget) {
      reorderBranchPoolDrop(pointerDrag.entryId, dropTarget.id, dropTarget.position);
    }
    finishBranchPoolDrag();
  }

  function cancelBranchPoolPointerDrag(event: PointerEvent) {
    if (branchPoolPointerDrag && event.pointerId !== branchPoolPointerDrag.pointerId) return;
    finishBranchPoolDrag();
  }

  function updateBranchPoolDropPosition(
    targetElement: HTMLElement,
    entryId: string,
    clientX: number,
  ) {
    const bounds = targetElement.getBoundingClientRect();
    const position = bounds.width <= 0 || clientX < bounds.left + bounds.width / 2
      ? "before"
      : "after";
    branchPoolDropTarget = { id: entryId, position };
  }

  function reorderBranchPoolDrop(
    sourceId: string,
    targetId: string,
    position: "before" | "after",
  ) {
    const ids = branchPool.entries.map((entry) => entry.id).filter((id) => id !== sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex < 0) return;
    ids.splice(targetIndex + (position === "after" ? 1 : 0), 0, sourceId);
    onReorderBranchPoolEntries(ids);
  }

  function finishBranchPoolDrag() {
    const suppressedEntryId = suppressProjectOpenEntryId;
    const pointerDrag = branchPoolPointerDrag;
    if (pointerDrag) {
      try {
        pointerDrag.captureElement.releasePointerCapture?.(pointerDrag.pointerId);
      } catch {
        // The WebView may have already released capture after pointercancel.
      }
    }
    branchPoolPointerDrag = null;
    draggedBranchPoolEntryId = null;
    branchPoolDropTarget = null;
    window.removeEventListener("pointermove", updateBranchPoolPointerDrag);
    window.removeEventListener("pointerup", finishBranchPoolPointerDrag);
    window.removeEventListener("pointercancel", cancelBranchPoolPointerDrag);
    if (suppressedEntryId) {
      window.setTimeout(() => {
        if (suppressProjectOpenEntryId === suppressedEntryId) {
          suppressProjectOpenEntryId = null;
        }
      }, 0);
    }
  }

  function openProjectContextMenu(event: MouseEvent, entry: BranchPoolEntry) {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
    projectContextMenuEntryId = entry.id;
    projectContextMenuX = event.clientX;
    projectContextMenuY = event.clientY + 10;
    queueMicrotask(() => {
      if (!projectContextMenuElement) return;
      const rect = projectContextMenuElement.getBoundingClientRect();
      projectContextMenuX = Math.max(
        8,
        Math.min(projectContextMenuX, window.innerWidth - rect.width - 8),
      );
      projectContextMenuY = Math.max(
        8,
        Math.min(projectContextMenuY, window.innerHeight - rect.height - 8),
      );
      projectContextMenuElement
        .querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    });
  }

  function closeProjectContextMenu() {
    projectContextMenuEntryId = null;
    projectContextMenuElement = null;
  }

  function runProjectContextMenuAction(action: () => void) {
    closeProjectContextMenu();
    action();
  }

  function editProjectContextMenuEntry() {
    const entry = projectContextMenuEntry;
    if (!entry) return;
    runProjectContextMenuAction(() => editBranchPoolEntry(entry));
  }

  function removeProjectContextMenuEntry() {
    const entry = projectContextMenuEntry;
    if (!entry) return;
    runProjectContextMenuAction(() => onRemoveBranchPoolEntry(entry.id, false));
  }

  function handleProjectContextMenuKeydown(event: KeyboardEvent) {
    const items = Array.from(
      projectContextMenuElement?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === "Escape") {
      closeProjectContextMenu();
      event.preventDefault();
      return;
    } else {
      return;
    }
    items[nextIndex]?.focus();
    event.preventDefault();
  }

  function moveBranchPoolEntry(entryId: string, offset: -1 | 1) {
    if (branchPoolLoading) return;
    const ids = branchPool.entries.map((entry) => entry.id);
    const sourceIndex = ids.indexOf(entryId);
    const targetIndex = sourceIndex + offset;
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= ids.length) return;
    [ids[sourceIndex], ids[targetIndex]] = [ids[targetIndex], ids[sourceIndex]];
    onReorderBranchPoolEntries(ids);
  }

  function handleBranchPoolDragKeydown(event: KeyboardEvent, entryId: string) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    moveBranchPoolEntry(entryId, ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
  }

  function editBranchPoolEntry(entry: BranchPoolEntry) {
    editingBranchPoolEntryId = entry.id;
    branchPoolDisplayNameDraft = entry.display_name?.trim() || "";
  }

  function cancelBranchPoolEntryEdit() {
    editingBranchPoolEntryId = null;
    branchPoolDisplayNameDraft = "";
  }

  function saveBranchPoolEntryName(entry: BranchPoolEntry) {
    if (editingBranchPoolEntryId !== entry.id) return;
    const displayName = branchPoolDisplayNameDraft.trim();
    cancelBranchPoolEntryEdit();
    if (displayName !== (entry.display_name?.trim() || "")) {
      onRenameBranchPoolEntry(entry.id, displayName);
    }
  }

  function focusBranchPoolNameInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  function openWorkspaceEntry(entry: BranchPoolEntry) {
    if (sameWorkspacePath(entry.local_path, workspace?.local_path ?? "")) {
      if (view.id === "changes") {
        onRefreshStatus();
      } else if (view.id === "history") {
        onRefreshSvnLog();
      }
      return;
    }
    onOpenBranchPoolEntry(entry.local_path);
  }

  function openWorkspaceEntryFromClick(entry: BranchPoolEntry) {
    if (suppressProjectOpenEntryId === entry.id) {
      suppressProjectOpenEntryId = null;
      return;
    }
    openWorkspaceEntry(entry);
  }

  function sameWorkspacePath(left: string, right: string) {
    if (!left.trim() || !right.trim()) {
      return false;
    }
    return comparableWorkspacePath(left) === comparableWorkspacePath(right);
  }

  function comparableWorkspacePath(value: string) {
    const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  }

  function canUseChangelist(node: WorkspaceFileNode) {
    return node.kind === "file" && node.versioned && !["unversioned", "external"].includes(node.status);
  }

  function clearRevisionFileDiff() {
    stopTimelineDiffResize();
    revisionFileDiffGeneration += 1;
    selectedRevisionFileDiff = null;
    revisionFileContentDiff = null;
    revisionFileDiffLoading = false;
    revisionFileDiffError = null;
  }

  async function openChangedPathRevisionDiff(
    revision: string,
    repositoryPath: string,
    action: string,
  ) {
    selectedRevisionFileDiff = { revision, path: repositoryPath };
    revisionFileContentDiff = null;
    revisionFileDiffError = null;

    const previousRevision = revisionBefore(revision);
    const targetUrl = repositoryPathUrlAtRevision(
      svnLog?.repository_root ?? workspace?.repository_root,
      repositoryPath,
      revision,
      action,
    );
    if (!previousRevision || !targetUrl) {
      revisionFileDiffError = {
        code: "REVISION_DIFF_CONTEXT_MISSING",
        message: "无法准备文件 Diff",
        detail: "日志缺少仓库路径或 revision 信息，请刷新日志后重试。",
        recoverable: true,
      };
      return;
    }

    const generation = ++revisionFileDiffGeneration;
    revisionFileDiffLoading = true;
    try {
      const contentDiff = await getRevisionFileContentDiff({
        target_url: targetUrl,
        file_path: repositoryPath,
        left_revision: previousRevision,
        right_revision: revision,
        action,
        svn_executable: appSettings.svnExecutable.trim() || undefined,
        max_bytes: LOG_FILE_DIFF_MAX_BYTES,
      });
      if (generation === revisionFileDiffGeneration) {
        revisionFileContentDiff = contentDiff;
      }
    } catch (error) {
      if (generation === revisionFileDiffGeneration) {
        revisionFileDiffError = normalizeRevisionFileDiffError(error);
      }
    } finally {
      if (generation === revisionFileDiffGeneration) {
        revisionFileDiffLoading = false;
      }
    }
  }

  function normalizeRevisionFileDiffError(error: unknown): CommandError {
    if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
      return error as CommandError;
    }
    return {
      code: "REVISION_FILE_DIFF_FAILED",
      message: error instanceof Error ? error.message : "文件 Diff 读取失败",
      recoverable: true,
    };
  }

  function selectWorkingCopyTreeFilter(filter: WorkingCopyTreeFilter) {
    workingCopyTreeFilter = filter;
    openRowMenuPath = null;
  }


  function startFileColumnResize(event: MouseEvent, column: FileColumnKey) {
    stopTimelineDiffResize();
    stopFolderTreeResize();
    resizingFileColumn = {
      column,
      startX: event.clientX,
      startWidth: fileColumnWidths[column],
    };
    window.addEventListener("mousemove", resizeFileColumn);
    window.addEventListener("mouseup", stopFileColumnResize);
    event.preventDefault();
    event.stopPropagation();
  }

  function stopFileColumnResize() {
    if (!resizingFileColumn) {
      return;
    }
    resizingFileColumn = null;
    window.removeEventListener("mousemove", resizeFileColumn);
    window.removeEventListener("mouseup", stopFileColumnResize);
  }

  function resizeFileColumn(event: MouseEvent) {
    if (!resizingFileColumn) {
      return;
    }
    const { column, startX, startWidth } = resizingFileColumn;
    setFileColumnWidth(column, startWidth + event.clientX - startX);
  }

  function adjustFileColumnWidth(column: FileColumnKey, delta: number) {
    setFileColumnWidth(column, fileColumnWidths[column] + delta);
  }

  function setFileColumnWidth(column: FileColumnKey, width: number) {
    fileColumnWidths = {
      ...fileColumnWidths,
      [column]: Math.min(
        Math.max(width, fileColumnMinimumWidths[column]),
        fileColumnMaximumWidths[column],
      ),
    };
  }

  function handleFileColumnResizeKeydown(event: KeyboardEvent, column: FileColumnKey) {
    if (event.key === "ArrowLeft") {
      adjustFileColumnWidth(column, -12);
      event.preventDefault();
    }
    if (event.key === "ArrowRight") {
      adjustFileColumnWidth(column, 12);
      event.preventDefault();
    }
    if (event.key === "Home") {
      setFileColumnWidth(column, fileColumnMinimumWidths[column]);
      event.preventDefault();
    }
    if (event.key === "End") {
      setFileColumnWidth(column, fileColumnMaximumWidths[column]);
      event.preventDefault();
    }
  }

  function startTimelineDiffResize(event: MouseEvent) {
    stopFileColumnResize();
    stopFolderTreeResize();
    if (!resizingTimelineDiff) {
      window.addEventListener("mousemove", resizeTimelineDiff);
      window.addEventListener("mouseup", stopTimelineDiffResize);
    }
    resizingTimelineDiff = true;
    event.preventDefault();
  }

  function stopTimelineDiffResize() {
    if (!resizingTimelineDiff) {
      return;
    }
    resizingTimelineDiff = false;
    window.removeEventListener("mousemove", resizeTimelineDiff);
    window.removeEventListener("mouseup", stopTimelineDiffResize);
  }

  function resizeTimelineDiff(event: MouseEvent) {
    if (!resizingTimelineDiff) {
      return;
    }
    timelineDiffWidth = constrainTimelineDiffWidth(window.innerWidth - event.clientX);
  }

  function adjustTimelineDiffWidth(delta: number) {
    timelineDiffWidth = constrainTimelineDiffWidth(timelineDiffWidth + delta);
  }

  function constrainTimelineDiffWidth(width: number) {
    const availableMaximum =
      window.innerWidth -
      folderTreeWidth -
      folderTreeDividerWidth -
      timelineListMinWidth -
      timelineDiffDividerWidth;
    const maximum = Math.max(
      timelineDiffMinWidth,
      Math.min(timelineDiffMaxWidth, availableMaximum),
    );
    return Math.min(Math.max(width, timelineDiffMinWidth), maximum);
  }

  function startFolderTreeResize(event: MouseEvent) {
    stopTimelineDiffResize();
    stopFileColumnResize();
    resizingFolderTree = {
      startX: event.clientX,
      startWidth: folderTreeWidth,
    };
    window.addEventListener("mousemove", resizeFolderTree);
    window.addEventListener("mouseup", stopFolderTreeResize);
    event.preventDefault();
  }

  function stopFolderTreeResize() {
    if (!resizingFolderTree) {
      return;
    }
    resizingFolderTree = null;
    window.removeEventListener("mousemove", resizeFolderTree);
    window.removeEventListener("mouseup", stopFolderTreeResize);
  }

  function resizeFolderTree(event: MouseEvent) {
    if (!resizingFolderTree) {
      return;
    }
    folderTreeWidth = constrainFolderTreeWidth(
      resizingFolderTree.startWidth + event.clientX - resizingFolderTree.startX,
    );
  }

  function adjustFolderTreeWidth(delta: number) {
    folderTreeWidth = constrainFolderTreeWidth(folderTreeWidth + delta);
  }

  function constrainFolderTreeWidth(width: number) {
    const availableMaximum = Math.max(
      folderTreeMinWidth,
      window.innerWidth - folderTreeContentMinWidth - folderTreeDividerWidth,
    );
    const maximum = Math.min(folderTreeMaxWidth, availableMaximum);
    return Math.min(Math.max(Math.round(width), folderTreeMinWidth), maximum);
  }

  function syncLayoutWidthsToWindow() {
    folderTreeWidth = constrainFolderTreeWidth(folderTreeWidth);
    timelineDiffWidth = constrainTimelineDiffWidth(timelineDiffWidth);
  }

  function handleWindowResize() {
    syncLayoutWidthsToWindow();
  }

  function syncSystemTheme(event?: MediaQueryListEvent) {
    systemPrefersDark = event?.matches ?? themeMediaQuery?.matches ?? false;
  }

  function focusPatchDialog(node: HTMLElement) {
    node.focus();
  }

  function handlePatchDialogKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && !applyPatchRunning) {
      event.preventDefault();
      event.stopPropagation();
      onCloseApplyPatch();
    }
  }

  onDestroy(() => {
    revisionFileDiffGeneration += 1;
    finishBranchPoolDrag();
    stopTimelineDiffResize();
    stopFileColumnResize();
    stopFolderTreeResize();
    window.removeEventListener("resize", handleWindowResize);
    window.removeEventListener("resize", closeContextMenuOnWindowChange);
    window.removeEventListener("blur", closeContextMenuOnWindowChange);
    window.removeEventListener("pointerdown", closeContextMenuOnOutsidePointer);
    themeMediaQuery?.removeEventListener("change", syncSystemTheme);
    folderTreeViewportObserver?.disconnect();
    folderTreeViewportObserver = null;
  });

  onMount(() => {
    syncLayoutWidthsToWindow();
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("resize", closeContextMenuOnWindowChange);
    window.addEventListener("blur", closeContextMenuOnWindowChange);
    window.addEventListener("pointerdown", closeContextMenuOnOutsidePointer);
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      syncSystemTheme();
      themeMediaQuery.addEventListener("change", syncSystemTheme);
    }
  });

  $: syncWorkspaceTabUiState(
    workspaceTabUiKey(workspace?.local_path),
    workspace?.working_copy_root ?? null,
    workspaceFileTree,
    svnBlame,
    repositoryFileBlame,
  );
  $: files = workingCopyStatus?.files ?? [];
  $: directoryChangeSummary = summarizeDirectoryChanges(files);
  $: filteredTreeNodes = filterTreeNodes(
    workspaceFileTree?.nodes ?? [],
    workingCopyTreeFilter,
    searchText,
    changelistFilter,
  );
  $: directoryParentPaths = directoryPathsWithChildren(filteredTreeNodes);
  $: directoryRows = directoryRowsForNodes(filteredTreeNodes, collapsedTreePaths);
  $: selectedDirectoryTreeNodes =
    selectedDirectoryFileTreePath === selectedDirectoryPath && selectedDirectoryFileTree
      ? filterTreeNodes(
          selectedDirectoryFileTree.nodes,
          workingCopyTreeFilter,
          searchText,
          changelistFilter,
        )
      : filteredTreeNodes;
  $: treeRows = filesForDirectory(selectedDirectoryTreeNodes, selectedDirectoryPath);
  $: mergeOutputFiles = extractSvnFileChangesFromText(
    (mergeResult?.output_text ?? "").split(/\r?\n/),
  );
  $: if (virtualizedFileTreeSource !== workspaceFileTree) {
    const nextWorkspaceKey = workspaceTabUiKey(workspace?.local_path);
    const workspaceChanged = virtualizedFileTreeWorkspaceKey !== nextWorkspaceKey;
    virtualizedFileTreeSource = workspaceFileTree;
    virtualizedFileTreeWorkspaceKey = nextWorkspaceKey;
    if (selectedDirectoryPath && selectedDirectoryFileTreePath !== selectedDirectoryPath) {
      applyCachedDirectoryTree(selectedDirectoryPath);
      void loadSelectedDirectoryFiles(selectedDirectoryPath);
    } else if (selectedDirectoryPath && !workspaceChanged) {
      void loadSelectedDirectoryFiles(selectedDirectoryPath);
    }
  }
  $: if (virtualizedWorkspaceBlameSource !== svnBlame) {
    virtualizedWorkspaceBlameSource = svnBlame;
    workspaceBlameScrollTop = 0;
  }
  $: if (virtualizedRepositoryBlameSource !== repositoryFileBlame) {
    virtualizedRepositoryBlameSource = repositoryFileBlame;
    repositoryBlameScrollTop = 0;
  }
  $: folderTreeWindow = virtualWindow(
    directoryRows,
    folderBrowserScrollTop,
    folderBrowserViewportHeight,
    folderTreeRowHeight,
    folderTreeListOffset,
  );
  $: treeRowWindow = virtualWindow(
    treeRows,
    fileBrowserScrollTop,
    fileBrowserViewportHeight,
    fileTreeRowHeight,
    fileTreeHeaderHeight,
  );
  $: workspaceBlameWindow = virtualWindow(
    svnBlame?.lines ?? [],
    workspaceBlameScrollTop,
    workspaceBlameViewportHeight,
    blameRowHeight,
    blameRowHeight,
  );
  $: repositoryBlameWindow = virtualWindow(
    repositoryFileBlame?.lines ?? [],
    repositoryBlameScrollTop,
    repositoryBlameViewportHeight,
    blameRowHeight,
    blameRowHeight,
  );
  $: reconcileRowSelection(
    workspace?.working_copy_root ?? null,
    workspaceFileTree,
  );
  $: reconcileActiveRow(treeRows, selectedFilePath);
  $: reportActiveWorkspacePath((activeRowPath ?? selectedDirectoryPath) || null);
  $: selectedDirectoryNode = treeNodeForPath(selectedDirectoryPath);
  $: selectedDirectoryCommittablePaths = files
    .filter(
      (file) =>
        directoryContainsPath(selectedDirectoryPath, file.path) && isCommittable(file),
    )
    .map((file) => file.path);
  $: selectedDirectoryRemoteCount = files.filter(
    (file) =>
      directoryContainsPath(selectedDirectoryPath, file.path) &&
      ["remote", "both"].includes(file.change_scope),
  ).length;
  $: selectedRowNodes = [...selectedRowPaths]
    .map((path) => treeNodeForPath(path))
    .filter((node): node is WorkspaceFileNode => node !== null);
  $: selectedRevertablePaths = selectedRowNodes
    .filter((node) => isLocalChangedPath(node.path) && !isUnversionedPath(node.path))
    .map((node) => node.path);
  $: selectedMovablePaths = collapseSelectedOperationPaths(
    selectedRowNodes.filter((node) => canMovePath(node)).map((node) => node.path),
  );
  $: selectedDeletablePaths = collapseSelectedOperationPaths(
    selectedRowNodes.filter((node) => canDeletePath(node)).map((node) => node.path),
  );
  $: selectedChangelistPaths = selectedRowNodes
    .filter(canUseChangelist)
    .map((node) => node.path);
  $: selectedAssignedChangelistPaths = selectedRowNodes
    .filter((node) => canUseChangelist(node) && Boolean(node.changelist))
    .map((node) => node.path);
  $: availableChangelists = [...collectChangelistNames(workspaceFileTree?.nodes ?? [])]
    .sort((left, right) => left.localeCompare(right));
  $: if (
    changelistFilter !== "all" &&
    changelistFilter !== "unassigned" &&
    !availableChangelists.includes(changelistFilter)
  ) {
    changelistFilter = "all";
  }
  $: visibleSelectedRowCount = treeRows.filter((row) => selectedRowPaths.has(row.path)).length;
  $: allVisibleRowsSelected = treeRows.length > 0 && visibleSelectedRowCount === treeRows.length;
  $: someVisibleRowsSelected = visibleSelectedRowCount > 0 && !allVisibleRowsSelected;
  $: abnormalCount =
    (workingCopyStatus?.missing ?? 0) +
    (workingCopyStatus?.conflicted ?? 0) +
    (workingCopyStatus?.obstructed ?? 0);
  $: repositoryEntries = repositoryList?.entries ?? [];
  $: repositoryCurrentUrl = repositoryList?.url ?? repositoryUrlInput.trim();
  $: breadcrumbs = repositoryBreadcrumbs(repositoryCurrentUrl);
  $: branchEntries =
    repositoryLayoutResults.branches?.entries.filter((entry) => entry.kind === "dir") ?? [];
  $: tagEntries =
    repositoryLayoutResults.tags?.entries.filter((entry) => entry.kind === "dir") ?? [];
  $: filteredLogEntries = filterLogEntries(svnLog?.entries ?? []);
  $: svnLogDateRangeInvalid =
    localDateBoundary(svnLogDateFromFilter) !== null &&
    localDateBoundary(svnLogDateToFilter) !== null &&
    localDateBoundary(svnLogDateFromFilter)! > localDateBoundary(svnLogDateToFilter)!;
  $: timelineHasFilters =
    !!svnLogKeywordFilter ||
    !!svnLogAuthorFilter ||
    !!svnLogDateFromFilter ||
    !!svnLogDateToFilter ||
    svnLogFileOnly;
  $: selectedTreeNode = treeNodeForPath(selectedFilePath);
  $: contextMenuNode = treeNodeForPath(contextMenuPath);
  $: unconfirmedWarningCount = safetyCheck.warnings.filter(
    (item) => !safetyCheck.confirmedWarningIds.includes(item.id),
  ).length;
  $: overlayDialogOpen = applyPatchDialogOpen || conflictResolverOpen || commitDialogOpen;
  $: if (commitFormRequestId !== appliedCommitFormRequestId) {
    appliedCommitFormRequestId = commitFormRequestId;
    if (commitFormRequestId > 0) {
      openCommitForm();
    }
  }
  $: activeTask = selectedTask ?? null;
  $: applyPatchHasIssues =
    !!applyPatchError ||
    (!!applyPatchResult &&
      (applyPatchResult.rejected > 0 ||
        applyPatchResult.skipped > 0 ||
        applyPatchResult.conflicted > 0));
  $: applyPatchCanProceed =
    !!applyPatchResult &&
    applyPatchResult.dry_run &&
    applyPatchResult.applied > 0 &&
    !applyPatchHasIssues;
  $: updateRunning = pendingSvnOperationKind === "update" || pendingSvnOperationKind === "update_path";
  $: cleanupRunning = pendingSvnOperationKind === "cleanup";
  $: toolbarLocked =
    runningTaskId !== null ||
    pendingSvnOperationKind !== null ||
    applyPatchRunning ||
    changelistRunning;
</script>

<section
  class="versions-workbench"
  class:has-inline-update={inlineUpdateRoot !== null}
  class:resizing-layout={
    resizingTimelineDiff || resizingFileColumn !== null || resizingFolderTree !== null
  }
  data-theme={resolvedTheme}
  data-theme-mode={appSettings.themeMode}
  style={`--timeline-diff-width: ${timelineDiffWidth}px; --folder-tree-width: ${folderTreeWidth}px; --folder-tree-divider-width: ${folderTreeDividerWidth}px`}
  aria-label="NovaSVN 工作台"
>
  {#if svnOperationFeedback}
    <div
      class="svn-operation-feedback"
      class:success={svnOperationFeedback.phase === "success"}
      class:error={svnOperationFeedback.phase === "error"}
      role={svnOperationFeedback.phase === "error" ? "alert" : "status"}
      aria-live={svnOperationFeedback.phase === "error" ? "assertive" : "polite"}
    >
      <span class="svn-operation-feedback-icon" aria-hidden="true">
        {#if svnOperationFeedback.phase === "running"}
          <LoaderCircle class="toolbar-spinner" size={20} strokeWidth={1.9} />
        {:else if svnOperationFeedback.phase === "success"}
          <CircleCheck size={20} strokeWidth={1.9} />
        {:else}
          <CircleX size={20} strokeWidth={1.9} />
        {/if}
      </span>
      <div class="svn-operation-feedback-copy">
        <strong>{svnOperationFeedback.title}</strong>
        <span>{svnOperationFeedback.detail}</span>
        {#if svnOperationFeedback.phase === "running"}
          <span
            class="svn-operation-progress"
            role="progressbar"
            aria-label={`${svnOperationFeedback.title}进度`}
          ><i></i></span>
        {/if}
      </div>
      {#if svnOperationFeedback.phase !== "running"}
        <button
          type="button"
          class="svn-operation-feedback-close"
          aria-label="关闭操作提示"
          title="关闭操作提示"
          on:click={onDismissSvnOperationFeedback}
        >
          <X size={16} strokeWidth={1.9} aria-hidden="true" />
        </button>
      {/if}
    </div>
  {/if}

  <div class="workspace-location" inert={overlayDialogOpen}>
    <span class="location-icon" aria-hidden="true">
      <FolderOpen size={16} strokeWidth={1.8} />
    </span>
    <input
      type="text"
      value={workspacePathInput}
      placeholder="拖入或输入 SVN 工作副本路径"
      on:input={(event) =>
        onWorkspacePathInput((event.currentTarget as HTMLInputElement).value)}
      on:keydown={(event) => {
        if (event.key === "Enter") {
          onOpenWorkspace();
        }
      }}
    />
  </div>

  <nav class="project-tabs" aria-label="项目标签" inert={overlayDialogOpen}>
    {#if !workspace}
      <button
        type="button"
        class="project-tab"
        title="打开工作副本"
        disabled={workspaceLoading || branchPoolLoading}
        on:click={onChooseWorkspace}
      >
        <FolderOpen size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>打开工作副本</span>
        <em>0</em>
      </button>
    {/if}
    {#each branchPool.entries as entry (entry.id)}
      <div
        role="group"
        aria-label={`项目 ${workspaceEntryName(entry)}`}
        class="project-tab-shell"
        class:active={sameWorkspacePath(entry.local_path, workspace?.local_path ?? "")}
        class:editing={editingBranchPoolEntryId === entry.id}
        class:dragging={draggedBranchPoolEntryId === entry.id}
        class:drop-before={branchPoolDropTarget?.id === entry.id && branchPoolDropTarget.position === "before"}
        class:drop-after={branchPoolDropTarget?.id === entry.id && branchPoolDropTarget.position === "after"}
        data-project-entry-id={entry.id}
        on:contextmenu={(event) => openProjectContextMenu(event, entry)}
      >
        <button
          type="button"
          class="project-tab-drag"
          aria-label={`拖动排序 ${workspaceEntryName(entry)}`}
          title="拖动调整项目顺序"
          disabled={branchPoolLoading}
          on:pointerdown={(event) => startBranchPoolPointerDrag(event, entry.id)}
        >
          <GripVertical size={13} strokeWidth={2} aria-hidden="true" />
        </button>
        {#if editingBranchPoolEntryId === entry.id}
          <input
            use:focusBranchPoolNameInput
            class="project-tab-name-input"
            bind:value={branchPoolDisplayNameDraft}
            aria-label={`项目备注名 ${workspaceEntryName(entry)}`}
            maxlength="80"
            placeholder={basename(entry.local_path) || branchName(entry)}
            on:blur={() => saveBranchPoolEntryName(entry)}
            on:keydown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveBranchPoolEntryName(entry);
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelBranchPoolEntryEdit();
              }
            }}
          />
        {:else}
          <button
            type="button"
            class="project-tab"
            class:active={sameWorkspacePath(entry.local_path, workspace?.local_path ?? "")}
            title={entry.local_path}
            on:keydown={(event) => handleBranchPoolDragKeydown(event, entry.id)}
            on:click={() => openWorkspaceEntryFromClick(entry)}
          >
            <FolderOpen size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>{workspaceEntryName(entry)}</span>
            <em>{sameWorkspacePath(entry.local_path, workspace?.local_path ?? "")
                ? workingCopyStatus?.total ?? entry.local_changes
                : entry.local_changes}</em>
          </button>
        {/if}
      </div>
    {/each}
    {#if workspace && !currentWorkspaceListed}
      <button
        type="button"
        class="project-tab"
        class:active={true}
        title={workspace.local_path}
        disabled={workspaceLoading || branchPoolLoading}
        on:click={() => onSelectView("changes")}
      >
        <FolderOpen size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>{basename(workspace.local_path)}</span>
        <em>{workingCopyStatus?.total ?? 0}</em>
      </button>
    {/if}
    <button
      type="button"
      class="project-tab-add"
      aria-label="添加工作副本"
      title="添加工作副本"
      disabled={workspaceLoading || branchPoolLoading}
      on:click={onAddWorkspace}
    >
      <Plus size={15} strokeWidth={2} aria-hidden="true" />
    </button>
    {#if branchPoolError}
      <span class="project-tabs-error" role="alert" title={branchPoolError.detail ?? branchPoolError.message}>
        {branchPoolError.message}
      </span>
    {/if}
  </nav>

  <div
    class="versions-layout"
    class:workspace-navigation-layout={view.id === "changes" || view.id === "history"}
    class:auxiliary-layout={view.id !== "changes" && view.id !== "history"}
    inert={overlayDialogOpen}
  >
    {#if view.id === "changes" || view.id === "history"}
            <aside class="folder-browser" aria-label="工作副本文件夹树">
              <header class="folder-browser-header">
                <strong>文件夹</strong>
                <span>{directoryRows.length}</span>
              </header>
              <div
                bind:this={folderBrowserElement}
                use:observeFolderTreeViewport
                class="folder-tree"
                role="tree"
                aria-label="文件夹层级"
                data-rowcount={directoryRows.length + 1}
                on:scroll={handleFolderBrowserScroll}
              >
                <div
                  class="folder-tree-row"
                  class:selected={selectedDirectoryPath === ""}
                  role="treeitem"
                  tabindex="-1"
                  aria-level="1"
                  aria-selected={selectedDirectoryPath === ""}
                  on:click={() => selectWorkspaceDirectory("")}
                  on:keydown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectWorkspaceDirectory("");
                    }
                  }}
                >
                  <span class="folder-tree-spacer" aria-hidden="true"></span>
                  <button
                    type="button"
                    class="folder-tree-select"
                    aria-label="选择工作副本根目录"
                    title="工作副本根目录"
                    on:click|stopPropagation={() => selectWorkspaceDirectory("")}
                  >
                    <FolderOpen size={15} strokeWidth={1.8} aria-hidden="true" />
                    <span>工作副本根目录</span>
                  </button>
                </div>
                {#if folderTreeWindow.beforeHeight > 0}
                  <div
                    class="virtual-list-spacer folder-tree-virtual-spacer"
                    style={`height: ${folderTreeWindow.beforeHeight}px`}
                    aria-hidden="true"
                  ></div>
                {/if}
                {#each folderTreeWindow.items as row (row.path)}
                  <div
                    class="folder-tree-row"
                    class:selected={selectedDirectoryPath === row.path}
                    role="treeitem"
                    tabindex="-1"
                    aria-level={row.depth + 2}
                    aria-selected={selectedDirectoryPath === row.path}
                    aria-expanded={directoryParentPaths.has(row.path)
                      ? !collapsedTreePaths.has(row.path)
                      : undefined}
                    style={`--folder-depth: ${row.depth}`}
                    on:click={() => selectWorkspaceDirectory(row.path)}
                    on:keydown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectWorkspaceDirectory(row.path);
                      }
                    }}
                    on:contextmenu={(event) =>
                      row.node && openRowContextMenu(event, { ...row.node, depth: row.depth })}
                  >
                    {#if directoryParentPaths.has(row.path)}
                      <button
                        type="button"
                        class="folder-tree-toggle"
                        aria-label={`${collapsedTreePaths.has(row.path) ? "展开" : "折叠"}文件夹 ${row.path}`}
                        title={`${collapsedTreePaths.has(row.path) ? "展开" : "折叠"} ${row.name}`}
                        on:click|stopPropagation={() => toggleDirectoryPath(row.path)}
                      >
                        <span
                          class="tree-affordance visible"
                          class:collapsed={collapsedTreePaths.has(row.path)}
                          aria-hidden="true"
                        ></span>
                      </button>
                    {:else}
                      <span class="folder-tree-spacer" aria-hidden="true"></span>
                    {/if}
                    <button
                      type="button"
                      class="folder-tree-select"
                      aria-label={`选择文件夹 ${row.path}`}
                      title={row.path}
                      on:click|stopPropagation={() => selectWorkspaceDirectory(row.path)}
                    >
                      <span class="tree-icon folder-icon" aria-hidden="true"></span>
                      <span>{row.name}</span>
                      {#if
                        (directoryChangeSummary.get(row.path)?.local ?? 0) > 0 ||
                        row.node?.change_scope === "local" ||
                        row.node?.change_scope === "both"}
                        <i class="folder-change-marker local" title="包含本地改动"></i>
                      {/if}
                      {#if
                        (directoryChangeSummary.get(row.path)?.remote ?? 0) > 0 ||
                        row.node?.change_scope === "remote" ||
                        row.node?.change_scope === "both"}
                        <i class="folder-change-marker remote" title="包含远端更新"></i>
                      {/if}
                    </button>
                  </div>
                {/each}
                {#if folderTreeWindow.afterHeight > 0}
                  <div
                    class="virtual-list-spacer folder-tree-virtual-spacer"
                    style={`height: ${folderTreeWindow.afterHeight}px`}
                    aria-hidden="true"
                  ></div>
                {/if}
              </div>
            </aside>
            <div
              class="folder-tree-resizer"
              role="slider"
              aria-label="调整文件夹树宽度"
              aria-orientation="horizontal"
              aria-valuemin={folderTreeMinWidth}
              aria-valuemax={folderTreeMaxWidth}
              aria-valuenow={folderTreeWidth}
              title="拖动调整文件夹树宽度"
              tabindex="0"
              on:mousedown={startFolderTreeResize}
              on:keydown={(event) => {
                if (event.key === "ArrowLeft") {
                  adjustFolderTreeWidth(-12);
                  event.preventDefault();
                }
                if (event.key === "ArrowRight") {
                  adjustFolderTreeWidth(12);
                  event.preventDefault();
                }
                if (event.key === "Home") {
                  folderTreeWidth = folderTreeMinWidth;
                  event.preventDefault();
                }
                if (event.key === "End") {
                  folderTreeWidth = constrainFolderTreeWidth(folderTreeMaxWidth);
                  event.preventDefault();
                }
              }}
            ></div>
    {/if}

    <main
      class="content-pane"
      class:timeline-merge-active={view.id === "history" && selectedTimelineMergeRevisions.length > 0}
      aria-label={view.title}
    >
      {#if view.id === "changes" || view.id === "history"}
        <section class="content-tab-bar" aria-label="工作区内容标签">
          <div class="content-tabs" role="tablist" aria-label="工作副本内容">
            <button
              type="button"
              role="tab"
              class:active={view.id === "changes"}
              aria-selected={view.id === "changes"}
              title="工作副本"
              on:click={() => onSelectView("changes")}
            >
              <ListChecks size={15} strokeWidth={1.8} aria-hidden="true" />
              工作副本
            </button>
            <button
              type="button"
              role="tab"
              class:active={view.id === "history"}
              aria-selected={view.id === "history"}
              title="时间线"
              on:click={() => onSelectView("history")}
            >
              <History size={15} strokeWidth={1.8} aria-hidden="true" />
              时间线
            </button>
          </div>
          <div class="content-tab-actions" aria-label={view.id === "changes" ? "工作副本操作" : "时间线操作"}>
            {#if view.id === "changes"}
              <button
                type="button"
                aria-label={statusLoading ? "正在刷新工作副本状态" : "刷新工作副本状态"}
                title={statusLoading ? "正在刷新工作副本状态" : "刷新工作副本状态"}
                disabled={!workspace || statusLoading || toolbarLocked}
                on:click={onRefreshStatus}
              >
                {#if statusLoading}
                  <LoaderCircle class="toolbar-spinner" size={15} aria-hidden="true" />
                {:else}
                  <RefreshCw size={15} aria-hidden="true" />
                {/if}
                刷新
              </button>
              <button
                type="button"
                aria-busy={updateRunning}
                aria-label={updateRunning ? "正在更新工作副本" : "更新工作副本"}
                title={updateRunning ? "正在更新工作副本" : "更新工作副本"}
                disabled={!workspace || statusLoading || toolbarLocked}
                on:click={onUpdateWorkspace}
              >
                {#if updateRunning}
                  <LoaderCircle class="toolbar-spinner" size={15} aria-hidden="true" />
                {:else}
                  <Download size={15} aria-hidden="true" />
                {/if}
                更新
              </button>
              <button
                type="button"
                class="primary"
                aria-label="提交工作副本"
                title="选择提交内容并填写提交信息"
                disabled={commitFormOpenDisabled}
                on:click={openCommitForm}
              >
                <GitCommitHorizontal size={15} aria-hidden="true" />
                提交
              </button>
              <button
                type="button"
                aria-label={applyPatchRunning ? "正在应用 Patch" : "应用 Patch"}
                title={applyPatchRunning ? "正在应用 Patch" : "应用 Patch"}
                disabled={!workspace || statusLoading || toolbarLocked}
                on:click={onChooseApplyPatch}
                aria-busy={applyPatchRunning}
              >
                <FileUp size={15} aria-hidden="true" />
                Patch
              </button>
              <button
                type="button"
                aria-busy={cleanupRunning}
                aria-label={cleanupRunning ? "正在清理工作副本" : "清理工作副本"}
                title={cleanupRunning ? "正在清理工作副本" : "清理工作副本"}
                disabled={!workspace || statusLoading || toolbarLocked}
                on:click={onCleanupWorkspace}
              >
                <Wrench size={15} aria-hidden="true" />
                清理
              </button>
            {:else}
              <button
                type="button"
                aria-label={svnLogLoading ? "正在刷新时间线" : "刷新时间线"}
                title={svnLogLoading ? "正在刷新时间线" : "刷新时间线"}
                disabled={!workspace || svnLogLoading}
                on:click={onRefreshSvnLog}
              >
                {#if svnLogLoading}
                  <LoaderCircle class="toolbar-spinner" size={15} aria-hidden="true" />
                {:else}
                  <RefreshCw size={15} aria-hidden="true" />
                {/if}
                刷新
              </button>
            {/if}
          </div>
        </section>
      {/if}
      <ErrorNotice error={workspaceError} />
      <ErrorNotice error={statusError} />
      <ErrorNotice error={commandError} />

      {#if inlineUpdateRoot}
        <StandaloneUpdateWindow
          targetPath={inlineUpdateRoot}
          svnExecutable={inlineUpdateSvnExecutable}
          themeMode={appSettings.themeMode}
          svnAuthenticationUsername={appSettings.svnUsername}
          svnRememberPassword={appSettings.svnRememberPassword}
          {svnAuthenticationLoading}
          svnAuthenticationError={svnAuthenticationError}
          onSvnAuthenticationSubmit={onInlineSvnAuthenticationSubmit}
          embedded={true}
          autoStart={false}
          initialTask={inlineUpdateTask}
          initialTarget={inlineUpdateTarget}
          minimized={inlineUpdateMinimized}
          onToggleMinimized={onToggleInlineUpdate}
          onClose={onCloseInlineUpdate}
        />
      {:else if view.id === "history"}
        <section class="pane-header">
          <div>
            <h1>时间线</h1>
            <p>{svnLog?.target ?? workspace?.repository_url ?? "读取工作副本历史"}</p>
          </div>
          <div class="pane-actions">
            <button
              type="button"
              aria-label="加载更多 Revision"
              on:click={onLoadMoreSvnLog}
              disabled={!workspace || svnLogLoading || !svnLog?.has_more}
            >
              更多
            </button>
            <button
              type="button"
              aria-label="加载全部 Revision"
              on:click={onLoadAllSvnLog}
              disabled={!workspace || svnLogLoading || !svnLog?.has_more}
            >
              加载全部
            </button>
          </div>
        </section>

        <section class="timeline-filters" aria-label="日志过滤">
          <input
            type="search"
            aria-label="Timeline 关键字"
            value={svnLogKeywordFilter}
            placeholder="搜索 revision、路径或提交信息"
            on:input={(event) =>
              onSvnLogFilterInput(
                "svnLogKeywordFilter",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
          <input
            type="search"
            aria-label="Timeline 作者"
            value={svnLogAuthorFilter}
            placeholder="作者"
            on:input={(event) =>
              onSvnLogFilterInput(
                "svnLogAuthorFilter",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
          <label class="timeline-date-filter">
            <span>开始</span>
            <input
              type="date"
              value={svnLogDateFromFilter}
              max={svnLogDateToFilter || undefined}
              aria-label="Timeline 开始日期"
              on:input={(event) =>
                onSvnLogFilterInput(
                  "svnLogDateFromFilter",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
          <label class="timeline-date-filter">
            <span>结束</span>
            <input
              type="date"
              value={svnLogDateToFilter}
              min={svnLogDateFromFilter || undefined}
              aria-label="Timeline 结束日期"
              on:input={(event) =>
                onSvnLogFilterInput(
                  "svnLogDateToFilter",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
          </label>
          <label class="timeline-number-filter">
            <span>每页</span>
            <input
              type="number"
              aria-label="Timeline 日志数量"
              min="1"
              max="200"
              value={svnLogLimit}
              on:input={(event) =>
                onSvnLogLimitInput(Number((event.currentTarget as HTMLInputElement).value))}
            />
          </label>
          <label
            class="timeline-file-filter"
            title={selectedFilePath ? `仅显示 ${selectedFilePath} 的历史` : "先在工作副本中选择文件"}
          >
            <input
              type="checkbox"
              checked={svnLogFileOnly}
              disabled={svnLogLoading || (!selectedFilePath && !svnLogFileOnly)}
              on:change={(event) =>
                onSvnLogFileOnlyInput((event.currentTarget as HTMLInputElement).checked)}
            />
            <span>{selectedFilePath ? basename(selectedFilePath) : "选中文件"}</span>
          </label>
          <button type="button" on:click={clearTimelineFilters} disabled={!timelineHasFilters}>
            清除过滤
          </button>
          <span class="timeline-filter-summary" aria-live="polite">
            {filteredLogEntries.length} / {svnLog?.entries.length ?? 0} revisions{svnLog?.has_more ? " · 还有更多" : ""}
          </span>
          {#if svnLogDateRangeInvalid}
            <span class="timeline-filter-error" role="status">开始日期不能晚于结束日期</span>
          {/if}
        </section>
        <div class="timeline-error">
          <ErrorNotice error={svnLogError} />
        </div>

        <div
          class="timeline-layout"
          class:file-diff-open={selectedRevisionFileDiff !== null || selectedTimelineMergeRevisions.length > 0}
        >
          <SvnLogRevisionList
            entries={filteredLogEntries}
            totalEntries={svnLog?.entries.length ?? 0}
            loading={svnLogLoading}
            hasLoadError={svnLogError !== null}
            expandedRevisions={expandedTimelineRevisions}
            mergeRevisions={timelineMergeRevisions}
            diffLoading={revisionFileDiffLoading}
            compact={selectedRevisionFileDiff !== null || selectedTimelineMergeRevisions.length > 0}
            currentRevision={svnLog?.working_copy_revision ?? (workingCopyStatus?.mixed_revision
              ? workspace?.revision ?? null
              : workingCopyStatus?.revision_range ?? workspace?.revision ?? null)}
            effectiveRevision={resolveWorkingCopyLogRevision(
              svnLog?.entries ?? [],
              svnLog?.working_copy_revision ?? (workingCopyStatus?.mixed_revision
                ? workspace?.revision ?? null
                : workingCopyStatus?.revision_range ?? workspace?.revision ?? null),
            )}
            theme={resolvedTheme}
            emptyText="暂无修订历史"
            loadingText="正在读取日志"
            formatDate={formatTimelineDate}
            revertDisabled={timelineRevertDisabled}
            workspaceRevertDisabled={timelineWorkspaceRevertDisabled}
            workspaceRevertLabel={(entry) => svnLogFileOnly
              ? `回退当前文件到 r${entry.revision}`
              : `回退工作区到 r${entry.revision}`}
            workspaceRevertTitle={(entry) =>
              workspace
                ? `${svnLogFileOnly ? "回退当前文件" : "回退整个工作区"}到 r${entry.revision}`
                : "请先打开 SVN 工作副本"}
            exportDisabled={timelineExportDisabled}
            exportTitle={(entry) => svnLog?.repository_url?.trim()
              ? `Export r${entry.revision} 到本地（不含 .svn）`
              : "当前日志没有可用的仓库 URL"}
            onTogglePaths={toggleTimelineEntryPaths}
            onToggleMerge={toggleTimelineMerge}
            onOpenDiff={openTimelineEntryDiff}
            onRevert={revertTimelineEntry}
            onRevertWorkspace={(entry) => onRevertWorkspaceToRevision(entry.revision)}
            onExport={exportTimelineEntry}
          />

          {#if selectedRevisionFileDiff || selectedTimelineMergeRevisions.length > 0}
            <div
              class="timeline-diff-resizer"
              role="slider"
              aria-label={selectedRevisionFileDiff ? "调整文件 Diff 宽度" : "调整文件变化宽度"}
              aria-orientation="horizontal"
              aria-valuemin={timelineDiffMinWidth}
              aria-valuemax={timelineDiffMaxWidth}
              aria-valuenow={timelineDiffWidth}
              tabindex="0"
              on:mousedown={startTimelineDiffResize}
              on:keydown={(event) => {
                if (event.key === "ArrowLeft") {
                  adjustTimelineDiffWidth(16);
                  event.preventDefault();
                }
                if (event.key === "ArrowRight") {
                  adjustTimelineDiffWidth(-16);
                  event.preventDefault();
                }
                if (event.key === "Home") {
                  timelineDiffWidth = timelineDiffMinWidth;
                  event.preventDefault();
                }
                if (event.key === "End") {
                  timelineDiffWidth = constrainTimelineDiffWidth(timelineDiffMaxWidth);
                  event.preventDefault();
                }
              }}
            ></div>
            {#if selectedRevisionFileDiff}
              <aside class="revision-compare" aria-label="文件 Diff 预览">
                <section class="revision-file-diff" aria-label="文件 Diff">
                <header>
                  <div>
                    <h2>r{selectedRevisionFileDiff.revision} 文件 Diff</h2>
                    <p title={selectedRevisionFileDiff.path}>{selectedRevisionFileDiff.path}</p>
                  </div>
                  <button
                    type="button"
                    class="icon-button revision-diff-close"
                    aria-label="关闭文件 Diff"
                    title="关闭"
                    on:click={clearRevisionFileDiff}
                  >
                    <X size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                </header>
                <div class="revision-file-diff-body">
                  {#if revisionFileDiffLoading}
                    <div class="revision-file-diff-empty" role="status">正在读取 Diff...</div>
                  {:else if revisionFileDiffError}
                    <ErrorNotice error={revisionFileDiffError} />
                  {:else if revisionFileContentDiff?.is_image}
                    <ImageDiffViewer contentDiff={revisionFileContentDiff} />
                  {:else if revisionFileContentDiff?.too_large}
                    <div class="revision-file-diff-empty">
                      文件内容超过 {Math.round(revisionFileContentDiff.max_bytes / 1024)} KB，无法在窗口中预览
                    </div>
                  {:else if revisionFileContentDiff?.binary}
                    <div class="revision-file-diff-empty">二进制文件无法预览文本修改</div>
                  {:else if shouldShowTextDiffViewer(revisionFileContentDiff)}
                    <MonacoDiffViewer
                      contentDiff={revisionFileContentDiff}
                      inlineMode={diffInline}
                      {showWhitespace}
                      theme={resolvedTheme}
                    />
                  {:else if revisionFileContentDiff}
                    <div class="revision-file-diff-empty">该文件在此 revision 没有文本 Diff</div>
                  {/if}
                </div>
                </section>
              </aside>
            {:else}
              <SvnLogSelectionDetails
                entries={svnLog?.entries ?? []}
                selectedRevisions={selectedTimelineMergeRevisions}
                diffLoading={revisionFileDiffLoading}
                theme={resolvedTheme}
                onOpenDiff={openTimelineEntryDiff}
              />
            {/if}
          {/if}
        </div>
        {#if selectedTimelineMergeRevisions.length > 0}
          <div class="merge-selection-bar" role="toolbar" aria-label="Revision 批量操作">
            <div>
              <strong>已选 {selectedTimelineMergeRevisions.length} 个 Revision</strong>
              <span>
                {selectedTimelineMergeRevisions.length <= 8
                  ? selectedTimelineMergeRevisions.map((revision) => `r${revision}`).join("、")
                  : `r${selectedTimelineMergeRevisions[0]} 至 r${selectedTimelineMergeRevisions[selectedTimelineMergeRevisions.length - 1]}`}
              </span>
            </div>
            <button type="button" disabled={timelineBatchRevertRunning} on:click={clearTimelineMergeSelection}>清除</button>
            <button
              type="button"
              disabled={!workspace || toolbarLocked || timelineBatchRevertRunning}
              on:click={revertSelectedTimelineRevisions}
            >
              <Undo2 size={16} aria-hidden="true" />
              {timelineBatchRevertRunning ? "正在撤销..." : "撤销选中 Revision"}
            </button>
            <button type="button" class="primary" on:click={openTimelineMergeDialog}>
              <GitMerge size={16} aria-hidden="true" /> Merge 到...
            </button>
          </div>
        {/if}
        {#if timelineMergeDialogOpen && workspace?.repository_url && workspace.repository_root}
          <LogMergeDialog
            sourceUrl={workspace.repository_url}
            sourceRepositoryRoot={workspace.repository_root}
            sourceWorkingCopyRoot={workspace.working_copy_root}
            revisions={selectedTimelineMergeRevisions}
            svnExecutable={svnExecutableInput.trim() || undefined}
            theme={resolvedTheme}
            onClose={closeTimelineMergeDialog}
            onMerged={() => {
              timelineMergeDialogOpen = false;
              timelineMergeRevisions = new Set();
              timelineMergeSelectionAnchor = null;
            }}
          />
        {/if}
      {:else if view.id === "repository"}
        <section class="pane-header">
          <div>
            <h1>仓库</h1>
            <p>{repositoryCurrentUrl || workspace?.repository_root || "浏览远端 SVN 仓库"}</p>
          </div>
          <div class="pane-actions">
            <button type="button" on:click={onUseWorkspaceRepositoryRoot} disabled={!workspace}>
              使用 Root
            </button>
            <button
              type="button"
              on:click={onOpenStandaloneRepoBrowser}
              disabled={!repositoryCurrentUrl && !repositoryUrlInput && !workspace}
            >
              独立窗口
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryMkdir()}
              disabled={!repositoryCurrentUrl && !repositoryUrlInput && !repositoryList}
            >
              准备创建目录
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryImport()}
              disabled={!repositoryCurrentUrl && !repositoryUrlInput && !repositoryList}
            >
              准备 Import
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryMove()}
              disabled={!repositoryCurrentUrl && !repositoryUrlInput && !repositoryList}
            >
              准备 Move
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryRename()}
              disabled={!repositoryCurrentUrl && !repositoryUrlInput && !repositoryList}
            >
              准备 Rename
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryDelete()}
              disabled={!repositoryCurrentUrl && !repositoryUrlInput && !repositoryList}
            >
              准备 Delete
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryCheckout()}
              disabled={!repositoryCurrentUrl && !repositoryUrlInput && !repositoryList}
            >
              准备 Checkout
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryExport()}
              disabled={!repositoryCurrentUrl && !repositoryUrlInput && !repositoryList}
            >
              准备 Export
            </button>
            <button type="button" class="primary" on:click={chooseDefaultRepositoryUrl} disabled={repositoryLoading}>
              {repositoryLoading ? "加载中" : "浏览"}
            </button>
          </div>
        </section>

        <section class="repository-urlbar">
          <input
            type="url"
            value={repositoryUrlInput}
            placeholder="https://example.com/svn/project"
            on:input={(event) =>
              onRepositoryUrlInput((event.currentTarget as HTMLInputElement).value)}
            on:keydown={(event) => {
              if (event.key === "Enter") {
                onLoadRepositoryUrl();
              }
            }}
          />
          <label class="repository-revision-field">
            <span>Revision</span>
            <input
              type="number"
              min="0"
              step="1"
              value={repositoryRevisionInput}
              placeholder="HEAD"
              aria-label="仓库 Revision"
              on:input={(event) =>
                onRepositoryRevisionInput((event.currentTarget as HTMLInputElement).value)}
              on:keydown={(event) => {
                if (event.key === "Enter") {
                  onLoadRepositoryUrl();
                }
              }}
            />
          </label>
          <span class="repository-revision-status" aria-live="polite">
            @{repositoryList?.revision ? `r${repositoryList.revision}` : "HEAD"}
          </span>
        </section>

        {#if repositoryError}
          <p class="inline-error">{repositoryError}</p>
        {/if}
        {#if repositoryFileError}
          <p class="inline-error">{repositoryFileError}</p>
        {/if}

        {#if breadcrumbs.length > 0}
          <nav class="breadcrumbs" aria-label="仓库路径">
            {#each breadcrumbs as crumb, index (crumb.url)}
              <button
                type="button"
                disabled={repositoryLoading || crumb.url === repositoryCurrentUrl}
                on:click={() => onLoadRepositoryUrl(crumb.url)}
              >
                {crumb.label}
              </button>
              {#if index < breadcrumbs.length - 1}
                <span>/</span>
              {/if}
            {/each}
          </nav>
        {/if}

        <section
          class="repository-table"
          class:repository-drop-active={repositoryImportDropActive}
          aria-label="仓库目录"
          aria-dropeffect="copy"
        >
          <div class="table-head">
            <span>名称</span>
            <span>类型</span>
            <span>Last Revision</span>
            <span>作者</span>
            <span>日期</span>
            <span aria-label="操作"></span>
          </div>
          {#if repositoryLoading}
            <article class="empty-state">仓库目录加载中</article>
          {:else if repositoryList}
            <button
              type="button"
              class="repository-row"
              on:click={() => onLoadRepositoryUrl(parentRepositoryUrl(repositoryList.url))}
            >
              <strong>..</strong>
              <span>目录</span>
              <span>-</span>
              <span>-</span>
              <span>-</span>
              <span></span>
            </button>
            {#each repositoryEntries as entry (entry.kind + ":" + entry.name)}
              <div class="repository-row-shell">
                <button
                  type="button"
                  class="repository-row"
                  disabled={entry.kind !== "dir" && (entry.kind !== "file" || repositoryFileLoading)}
                  aria-label={entry.kind === "dir"
                    ? `打开仓库目录 ${entry.name}`
                    : entry.kind === "file"
                      ? `打开仓库文件 ${entry.name} 的临时副本`
                      : `仓库条目 ${entry.name}`}
                  title={entry.kind === "dir"
                    ? `打开目录 ${entry.name}`
                    : entry.kind === "file"
                      ? `下载并打开 ${entry.name} @${repositoryList.revision ? `r${repositoryList.revision}` : "HEAD"}`
                      : undefined}
                  on:click={() =>
                    entry.kind === "dir"
                      ? onLoadRepositoryUrl(joinRepositoryUrl(repositoryList.url, entry.name))
                      : onOpenRepositoryFile(entry.name)}
                >
                  <strong>{entry.name || "/"}</strong>
                  <span title={entry.kind}>{repositoryEntryKindLabel(entry.kind)}</span>
                  <span>{entry.revision || "-"}</span>
                  <span title={entry.author || undefined}>{entry.author || "-"}</span>
                  <span title={entry.date || undefined}>{formatDate(entry.date)}</span>
                  <span></span>
                </button>
                <div class="repository-row-actions">
                  <button
                    type="button"
                    class="repository-row-action repository-drag-export-handle"
                    aria-label={`拖出仓库条目 ${entry.name} 执行 Export`}
                    title={repositoryDragExportRunningName === entry.name
                      ? `正在准备 ${entry.name}`
                      : `按住并拖出 ${entry.name} 到文件管理器`}
                    disabled={repositoryDragExportRunning}
                    on:pointerdown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }
                      event.preventDefault();
                      onDragRepositoryEntry(entry.name);
                    }}
                  >
                    {#if repositoryDragExportRunningName === entry.name}
                      <LoaderCircle class="spin" size={15} strokeWidth={2} aria-hidden="true" />
                    {:else}
                      <GripVertical size={15} strokeWidth={2} aria-hidden="true" />
                    {/if}
                  </button>
                  {#if entry.kind === "file"}
                    <button
                      type="button"
                      class="repository-row-action"
                      aria-label={`查看仓库文件 ${entry.name} 的 Log`}
                      title={`查看 ${entry.name} 的 Log`}
                      disabled={repositoryFileLogLoading}
                      on:click={() => onLoadRepositoryFileLog(entry.name)}
                    >
                      <History size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="repository-row-action"
                      aria-label={`查看仓库文件 ${entry.name} 的 Blame`}
                      title={`查看 ${entry.name} 的 Blame`}
                      disabled={repositoryFileBlameLoading}
                      on:click={() => onLoadRepositoryFileBlame(entry.name)}
                    >
                      <GitCommitHorizontal size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="repository-row-action"
                      aria-label={`查看仓库文件 ${entry.name} 的 Properties`}
                      title={`查看 ${entry.name} 的 Properties`}
                      disabled={repositoryFilePropertiesLoading}
                      on:click={() => onLoadRepositoryFileProperties(entry.name)}
                    >
                      <ListChecks size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
            {#if repositoryEntries.length === 0}
              <article class="empty-state">当前目录为空</article>
            {/if}
          {:else}
            <article class="empty-state">输入仓库 URL 后开始浏览</article>
          {/if}
        </section>

        {#if repositoryDragExportError}
          <p class="inline-error">{repositoryDragExportError}</p>
        {/if}

        {#if repositoryFileLog || repositoryFileLogLoading || repositoryFileLogError}
          <section class="repository-file-log-panel" aria-label="仓库文件日志">
            <header>
              <div>
                <h2>文件 Log</h2>
                <code title={repositoryFileLog?.target}>{repositoryFileLog?.target ?? "正在读取仓库文件历史"}</code>
                <span>@{repositoryFileLogRevision ? `r${repositoryFileLogRevision}` : "HEAD"}</span>
              </div>
              <div class="repository-file-log-actions">
                <button
                  type="button"
                  disabled={repositoryFileLogLoading || !repositoryFileLog?.has_more}
                  on:click={onLoadMoreRepositoryFileLog}
                >
                  {repositoryFileLogLoading && repositoryFileLog ? "加载中" : "更多"}
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label="关闭仓库文件 Log"
                  title="关闭仓库文件 Log"
                  on:click={onCloseRepositoryFileLog}
                >
                  <X size={15} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </header>
            <ErrorNotice error={repositoryFileLogError} />
            {#if repositoryFileLog?.entries.length}
              <div class="repository-file-log-list">
                {#each repositoryFileLog.entries as entry (entry.revision)}
                  <article>
                    <strong>r{entry.revision}</strong>
                    <span title={entry.author || undefined}>{entry.author || "-"}</span>
                    <time title={entry.date}>{formatTimelineTime(entry.date)}</time>
                    <p>{entry.message || "无提交信息"}</p>
                  </article>
                {/each}
              </div>
            {:else if repositoryFileLogLoading}
              <article class="empty-state">正在读取文件 Log</article>
            {:else if repositoryFileLog}
              <article class="empty-state">当前快照之前没有文件日志</article>
            {/if}
          </section>
        {/if}

        {#if repositoryFileBlame || repositoryFileBlameLoading || repositoryFileBlameError}
          <section class="repository-file-blame-panel" aria-label="仓库文件 Blame">
            <header>
              <div>
                <h2>文件 Blame</h2>
                <code title={repositoryFileBlame?.target}>{repositoryFileBlame?.target ?? "正在读取仓库文件 Blame"}</code>
                <span>@{repositoryFileBlameRevision ? `r${repositoryFileBlameRevision}` : "HEAD"}</span>
              </div>
              <div class="repository-file-blame-actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label="关闭仓库文件 Blame"
                  title="关闭仓库文件 Blame"
                  on:click={onCloseRepositoryFileBlame}
                >
                  <X size={15} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </header>
            <ErrorNotice error={repositoryFileBlameError} />
            {#if repositoryFileBlame}
              <p class="repository-file-blame-summary">
                {repositoryFileBlame.total_lines} 行
                {repositoryFileBlame.truncated ? ` · 仅显示前 ${repositoryFileBlame.lines.length} 行` : ""}
              </p>
              <div
                class="blame-table repository-file-blame-table"
                role="table"
                aria-label={`${repositoryFileBlame.target} Repository Blame`}
                on:scroll={handleRepositoryBlameScroll}
              >
                <div class="blame-row blame-head" role="row">
                  <span role="columnheader">Revision</span>
                  <span role="columnheader">作者</span>
                  <span role="columnheader">行</span>
                  <span role="columnheader">内容</span>
                </div>
                {#if repositoryBlameWindow.beforeHeight > 0}
                  <div class="virtual-list-spacer" style={`height: ${repositoryBlameWindow.beforeHeight}px`} aria-hidden="true"></div>
                {/if}
                {#each repositoryBlameWindow.items as line (line.line_number)}
                  <div class="blame-row" role="row" title={formatDate(line.date)}>
                    <span role="cell" class="blame-revision-cell">
                      {#if line.revision}
                        <button
                          type="button"
                          class="blame-revision-button"
                          aria-label={`查看 r${line.revision} Log`}
                          title={`查看 r${line.revision} 提交信息`}
                          on:click={() => openRepositoryBlameRevisionLog(line.revision)}
                        >r{line.revision}</button>
                      {:else}
                        -
                      {/if}
                    </span>
                    <span role="cell">{line.author || "-"}</span>
                    <span role="cell" class="blame-line-number">{line.line_number}</span>
                    <span role="cell" class="blame-content">
                      <SyntaxHighlightedCode
                        content={line.content}
                        language={repositoryFileBlame.language ?? "plaintext"}
                        title={line.content}
                        theme={resolvedTheme}
                      />
                    </span>
                  </div>
                {/each}
                {#if repositoryBlameWindow.afterHeight > 0}
                  <div class="virtual-list-spacer" style={`height: ${repositoryBlameWindow.afterHeight}px`} aria-hidden="true"></div>
                {/if}
              </div>
            {:else if repositoryFileBlameLoading}
              <article class="empty-state">正在读取文件 Blame</article>
            {/if}
          </section>
        {/if}

        {#if repositoryFileProperties || repositoryFilePropertiesLoading || repositoryFilePropertiesError}
          <section class="repository-file-properties-panel" aria-label="仓库文件 Properties">
            <header>
              <div>
                <h2>文件 Properties</h2>
                <code title={repositoryFileProperties?.target}>{repositoryFileProperties?.target ?? "正在读取仓库文件 Properties"}</code>
                <span>@{repositoryFilePropertiesRevision ? `r${repositoryFilePropertiesRevision}` : "HEAD"}</span>
              </div>
              <div class="repository-file-properties-actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label="关闭仓库文件 Properties"
                  title="关闭仓库文件 Properties"
                  on:click={onCloseRepositoryFileProperties}
                >
                  <X size={15} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </header>
            <ErrorNotice error={repositoryFilePropertiesError} />
            {#if repositoryFileProperties}
              <div class="repository-file-properties-list">
                {#each repositoryFileProperties.properties as property (property.name)}
                  <article>
                    <strong>{property.name}</strong>
                    <pre>{property.value || " "}</pre>
                  </article>
                {/each}
                {#if repositoryFileProperties.properties.length === 0}
                  <article class="empty-state">当前文件没有显式 Properties</article>
                {/if}
              </div>
            {:else if repositoryFilePropertiesLoading}
              <article class="empty-state">正在读取文件 Properties</article>
            {/if}
          </section>
        {/if}

        <details class="advanced-section">
          <summary>分支和标签</summary>
          <div class="layout-detect">
            <label>
              <span>trunk</span>
              <input
                type="text"
                value={repositoryLayout.trunkPath}
                on:input={(event) =>
                  onRepositoryLayoutPathInput("trunk", (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label>
              <span>branches</span>
              <input
                type="text"
                value={repositoryLayout.branchesPath}
                on:input={(event) =>
                  onRepositoryLayoutPathInput(
                    "branches",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
            <label>
              <span>tags</span>
              <input
                type="text"
                value={repositoryLayout.tagsPath}
                on:input={(event) =>
                  onRepositoryLayoutPathInput("tags", (event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <button type="button" on:click={onDetectRepositoryLayout} disabled={repositoryLayoutLoading}>
              {repositoryLayoutLoading ? "识别中" : "识别"}
            </button>
          </div>
          <div class="branch-tags">
            <section>
              <h3>分支 {branchEntries.length}</h3>
              {#if repositoryLayoutErrors.branches}
                <p class="inline-error">{repositoryLayoutErrors.branches}</p>
              {/if}
              {#each branchEntries as entry (entry.name)}
                <div class="branch-pick-row">
                  <button
                    type="button"
                    on:click={() =>
                      repositoryLayoutResults.branches &&
                      onLoadRepositoryUrl(joinRepositoryUrl(repositoryLayoutResults.branches.url, entry.name))}
                  >
                    {entry.name}
                  </button>
                  <button
                    type="button"
                    on:click={() =>
                      repositoryLayoutResults.branches &&
                      onUseBranchUrlForPool(
                        joinRepositoryUrl(repositoryLayoutResults.branches.url, entry.name),
                      )}
                  >
                    加入池
                  </button>
                </div>
              {/each}
            </section>
            <section>
              <h3>标签 {tagEntries.length}</h3>
              {#if repositoryLayoutErrors.tags}
                <p class="inline-error">{repositoryLayoutErrors.tags}</p>
              {/if}
              {#each tagEntries as entry (entry.name)}
                <button
                  type="button"
                  on:click={() =>
                    repositoryLayoutResults.tags &&
                    onLoadRepositoryUrl(joinRepositoryUrl(repositoryLayoutResults.tags.url, entry.name))}
                >
                  {entry.name}
                </button>
              {/each}
            </section>
          </div>
        </details>

        <details class="advanced-section" open={Boolean(repositoryMkdirForm.targetUrl)}>
          <summary>创建仓库目录</summary>
          <div class="copy-form" aria-label="创建仓库目录">
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryMkdir(
                  repositoryCurrentUrl || repositoryList?.url || repositoryUrlInput,
                )}
            >
              使用当前 URL
            </button>
            <input
              type="url"
              value={repositoryMkdirForm.targetUrl}
              placeholder="新目录 URL"
              aria-label="新仓库目录 URL"
              on:input={(event) =>
                onRepositoryMkdirFormInput(
                  "targetUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <textarea
              rows="3"
              value={repositoryMkdirForm.message}
              placeholder="提交信息"
              aria-label="创建仓库目录提交信息"
              on:input={(event) =>
                onRepositoryMkdirFormInput(
                  "message",
                  (event.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
            {#if repositoryMkdirError}
              <p class="inline-error">{repositoryMkdirError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onCreateRepositoryMkdir}
              disabled={repositoryMkdirRunning}
            >
              {repositoryMkdirRunning ? "创建中" : "创建目录"}
            </button>
          </div>
        </details>

        <details class="advanced-section" open={Boolean(repositoryImportForm.targetUrl)}>
          <summary>Import 到仓库</summary>
          <div class="copy-form" aria-label="Repository Import">
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryImport(
                  repositoryCurrentUrl || repositoryList?.url || repositoryUrlInput,
                )}
            >
              使用当前 URL
            </button>
            <div class="button-row">
              <input
                type="text"
                value={repositoryImportForm.sourcePath}
                placeholder="本地文件或目录"
                aria-label="Import 本地源路径"
                on:input={(event) =>
                  onRepositoryImportFormInput(
                    "sourcePath",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
              <button type="button" on:click={() => onChooseRepositoryImportSource(false)}>
                选择 Import 文件
              </button>
              <button type="button" on:click={() => onChooseRepositoryImportSource(true)}>
                选择 Import 目录
              </button>
            </div>
            <input
              type="url"
              value={repositoryImportForm.targetUrl}
              placeholder="目标 URL"
              aria-label="Import 目标 URL"
              on:input={(event) =>
                onRepositoryImportFormInput(
                  "targetUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <textarea
              rows="3"
              value={repositoryImportForm.message}
              placeholder="提交信息"
              aria-label="Repository Import 提交信息"
              on:input={(event) =>
                onRepositoryImportFormInput(
                  "message",
                  (event.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
            {#if repositoryImportError}
              <p class="inline-error">{repositoryImportError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onCreateRepositoryImport}
              disabled={repositoryImportRunning}
            >
              {repositoryImportRunning ? "Import 中" : "Import"}
            </button>
          </div>
        </details>

        <details class="advanced-section" open={Boolean(repositoryMoveForm.sourceUrl)}>
          <summary>Move 仓库条目</summary>
          <div class="copy-form" aria-label="Repository Move">
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryMove(
                  repositoryCurrentUrl || repositoryList?.url || repositoryUrlInput,
                )}
            >
              使用当前 URL
            </button>
            <input
              type="url"
              value={repositoryMoveForm.sourceUrl}
              placeholder="源 URL"
              aria-label="Repository Move 源 URL"
              on:input={(event) =>
                onRepositoryMoveFormInput(
                  "sourceUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <input
              type="url"
              value={repositoryMoveForm.targetUrl}
              placeholder="目标 URL"
              aria-label="Repository Move 目标 URL"
              on:input={(event) =>
                onRepositoryMoveFormInput(
                  "targetUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <textarea
              rows="3"
              value={repositoryMoveForm.message}
              placeholder="提交信息"
              aria-label="Repository Move 提交信息"
              on:input={(event) =>
                onRepositoryMoveFormInput(
                  "message",
                  (event.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
            {#if repositoryMoveError}
              <p class="inline-error">{repositoryMoveError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onCreateRepositoryMove}
              disabled={repositoryMoveRunning}
            >
              {repositoryMoveRunning ? "Move 中" : "Move"}
            </button>
          </div>
        </details>

        <details class="advanced-section" open={Boolean(repositoryRenameForm.sourceUrl)}>
          <summary>Rename 仓库条目</summary>
          <div class="copy-form" aria-label="Repository Rename">
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryRename(
                  repositoryCurrentUrl || repositoryList?.url || repositoryUrlInput,
                )}
            >
              使用当前 URL
            </button>
            <input
              type="url"
              value={repositoryRenameForm.sourceUrl}
              placeholder="源 URL"
              aria-label="Repository Rename 源 URL"
              on:input={(event) =>
                onRepositoryRenameFormInput(
                  "sourceUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <input
              type="url"
              value={repositoryRenameForm.targetUrl}
              placeholder="同目录目标 URL"
              aria-label="Repository Rename 目标 URL"
              on:input={(event) =>
                onRepositoryRenameFormInput(
                  "targetUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <textarea
              rows="3"
              value={repositoryRenameForm.message}
              placeholder="提交信息"
              aria-label="Repository Rename 提交信息"
              on:input={(event) =>
                onRepositoryRenameFormInput(
                  "message",
                  (event.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
            {#if repositoryRenameError}
              <p class="inline-error">{repositoryRenameError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onCreateRepositoryRename}
              disabled={repositoryRenameRunning}
            >
              {repositoryRenameRunning ? "Rename 中" : "Rename"}
            </button>
          </div>
        </details>

        <details class="advanced-section" open={Boolean(repositoryDeleteForm.url)}>
          <summary>Delete 仓库条目</summary>
          <div class="copy-form" aria-label="Repository Delete">
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryDelete(
                  repositoryCurrentUrl || repositoryList?.url || repositoryUrlInput,
                )}
            >
              使用当前 URL
            </button>
            <input
              type="url"
              value={repositoryDeleteForm.url}
              placeholder="要删除的仓库 URL"
              aria-label="Repository Delete 目标 URL"
              on:input={(event) =>
                onRepositoryDeleteFormInput(
                  "url",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <textarea
              rows="3"
              value={repositoryDeleteForm.message}
              placeholder="提交信息"
              aria-label="Repository Delete 提交信息"
              on:input={(event) =>
                onRepositoryDeleteFormInput(
                  "message",
                  (event.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
            {#if repositoryDeleteError}
              <p class="inline-error">{repositoryDeleteError}</p>
            {/if}
            <button
              type="button"
              class="danger"
              on:click={onCreateRepositoryDelete}
              disabled={repositoryDeleteRunning}
            >
              {repositoryDeleteRunning ? "Delete 中" : "Delete"}
            </button>
          </div>
        </details>

        <details class="advanced-section" open={Boolean(repositoryCheckoutForm.url || repositoryCheckoutForm.localPath)}>
          <summary>Checkout 到本地</summary>
          <div class="copy-form" aria-label="仓库 Checkout">
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryCheckout(
                  repositoryCurrentUrl || repositoryList?.url || repositoryUrlInput,
                  repositoryList?.revision ?? repositoryRevisionInput,
                )}
            >
              使用当前 URL
            </button>
            <input
              type="url"
              value={repositoryCheckoutForm.url}
              placeholder="仓库 URL"
              aria-label="Checkout 仓库 URL"
              on:input={(event) =>
                onRepositoryCheckoutFormInput(
                  "url",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <div class="button-row">
              <input
                type="text"
                value={repositoryCheckoutForm.localPath}
                placeholder="本地工作副本路径"
                aria-label="Checkout 本地路径"
                on:input={(event) =>
                  onRepositoryCheckoutFormInput(
                    "localPath",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
              <button type="button" on:click={onChooseRepositoryCheckoutParent}>
                选择父目录
              </button>
            </div>
            <input
              type="text"
              value={repositoryCheckoutForm.revision}
              placeholder="Revision，留空为 HEAD"
              aria-label="Checkout Revision"
              on:input={(event) =>
                onRepositoryCheckoutFormInput(
                  "revision",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if repositoryCheckoutError}
              <p class="inline-error">{repositoryCheckoutError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onCreateRepositoryCheckout}
              disabled={repositoryCheckoutRunning}
            >
              {repositoryCheckoutRunning ? "Checkout 中" : "Checkout"}
            </button>
          </div>
        </details>

        <details class="advanced-section" open={Boolean(repositoryExportForm.url || repositoryExportForm.localPath)}>
          <summary>Export 到本地</summary>
          <div class="copy-form" aria-label="仓库 Export">
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryExport(
                  repositoryCurrentUrl || repositoryList?.url || repositoryUrlInput,
                  repositoryList?.revision ?? repositoryRevisionInput,
                )}
            >
              使用当前 URL
            </button>
            <input
              type="url"
              value={repositoryExportForm.url}
              placeholder="仓库 URL"
              aria-label="Export 仓库 URL"
              on:input={(event) =>
                onRepositoryExportFormInput(
                  "url",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <div class="button-row">
              <input
                type="text"
                value={repositoryExportForm.localPath}
                placeholder="本地导出路径"
                aria-label="Export 本地路径"
                on:input={(event) =>
                  onRepositoryExportFormInput(
                    "localPath",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
              <button type="button" on:click={onChooseRepositoryExportParent}>
                选择父目录
              </button>
            </div>
            <input
              type="text"
              value={repositoryExportForm.revision}
              placeholder="Revision，留空为 HEAD"
              aria-label="Export Revision"
              on:input={(event) =>
                onRepositoryExportFormInput(
                  "revision",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if repositoryExportError}
              <p class="inline-error">{repositoryExportError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onCreateRepositoryExport}
              disabled={repositoryExportRunning}
            >
              {repositoryExportRunning ? "Export 中" : "Export"}
            </button>
          </div>
        </details>

        <details class="advanced-section">
          <summary>Copy 仓库条目、分支或标签</summary>
          <div class="copy-form">
            <div class="segmented-control">
              <button
                type="button"
                class:active={repositoryCopyForm.kind === "branch"}
                on:click={() => onRepositoryCopyFormInput("kind", "branch")}
              >
                Branch
              </button>
              <button
                type="button"
                class:active={repositoryCopyForm.kind === "tag"}
                on:click={() => onRepositoryCopyFormInput("kind", "tag")}
              >
                Tag
              </button>
              <button
                type="button"
                class:active={repositoryCopyForm.kind === "entry"}
                on:click={() => onRepositoryCopyFormInput("kind", "entry")}
              >
                Entry
              </button>
            </div>
            <button
              type="button"
              on:click={() =>
                onPrepareRepositoryCopyTarget("branch", repositoryLayoutResults.branches?.url)}
            >
              填充分支目标
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryCopyTarget("tag", repositoryLayoutResults.tags?.url)}
            >
              填充标签目标
            </button>
            <button
              type="button"
              on:click={() => onPrepareRepositoryCopyTarget("entry", repositoryCurrentUrl)}
            >
              复制当前条目
            </button>
            <input
              type="url"
              value={repositoryCopyForm.sourceUrl}
              placeholder="源 URL"
              aria-label="Repository Copy 源 URL"
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "sourceUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <input
              type="url"
              value={repositoryCopyForm.targetUrl}
              placeholder="目标 URL"
              aria-label="Repository Copy 目标 URL"
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "targetUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <input
              type="text"
              value={repositoryCopyForm.revision}
              placeholder="Revision，留空为 HEAD"
              aria-label="Repository Copy Revision"
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "revision",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <textarea
              rows="3"
              value={repositoryCopyForm.message}
              placeholder="提交信息"
              aria-label="Repository Copy 提交信息"
              on:input={(event) =>
                onRepositoryCopyFormInput(
                  "message",
                  (event.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
            {#if repositoryCopyError}
              <p class="inline-error">{repositoryCopyError}</p>
            {/if}
            <button type="button" class="primary" on:click={onCreateRepositoryCopy} disabled={repositoryCopyRunning}>
              {repositoryCopyRunning ? "创建中" : "创建"}
            </button>
          </div>
        </details>
      {:else if view.id === "branches"}
        <section class="pane-header">
          <div>
            <h1>高级</h1>
            <p>分支工作副本、Merge 和 switch 放在这里，不打扰日常提交。</p>
          </div>
          <div class="pane-actions">
            <button type="button" on:click={() => onSelectView("settings")}>偏好</button>
          </div>
        </section>

        <section class="advanced-grid">
          <article class="advanced-card">
            <h2>分支工作副本</h2>
            <input
              type="url"
              value={branchPoolForm.branchUrl}
              placeholder="分支 URL"
              on:input={(event) =>
                onBranchPoolFormInput(
                  "branchUrl",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <input
              type="text"
              value={branchPoolForm.localPath}
              placeholder="本地路径"
              on:input={(event) =>
                onBranchPoolFormInput(
                  "localPath",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if branchPoolFormErrors.localPath}
              <p class="inline-error">{branchPoolFormErrors.localPath}</p>
            {/if}
            <input
              type="text"
              value={branchPoolForm.revision}
              placeholder="Revision，留空为 HEAD"
              on:input={(event) =>
                onBranchPoolFormInput(
                  "revision",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            <div class="button-row">
              <button type="button" class="primary" on:click={onCheckoutBranchPoolEntry} disabled={branchCheckoutRunning}>
                {branchCheckoutRunning ? "Checkout 中" : "Checkout"}
              </button>
              <button type="button" on:click={onReuseBranchPoolEntry} disabled={branchPoolLoading}>
                复用已有
              </button>
            </div>
            {#if branchCheckoutError}
              <p class="inline-error">{branchCheckoutError}</p>
            {/if}
            <ErrorNotice error={branchPoolError} />
            <div class="branch-pool-list">
              {#each branchPool.entries as entry (entry.id)}
                <div>
                  <strong>{branchName(entry)}</strong>
                  <span>{entry.local_changes} 改动 · r{entry.revision || "-"}</span>
                  <button type="button" on:click={() => onOpenBranchPoolEntry(entry.local_path)}>
                    打开
                  </button>
                  <button type="button" on:click={() => onRemoveBranchPoolEntry(entry.id, false)}>
                    移除
                  </button>
                </div>
              {/each}
            </div>
          </article>

          <article class="advanced-card">
            <h2>Merge</h2>
            <input
              type="url"
              value={mergeForm.sourceUrl}
              placeholder="源 URL"
              on:input={(event) =>
                onMergeFormInput("sourceUrl", (event.currentTarget as HTMLInputElement).value)}
            />
            <div class="two-cols">
              <input
                type="text"
                value={mergeForm.startRevision}
                placeholder="起始 revision"
                on:input={(event) =>
                  onMergeFormInput(
                    "startRevision",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
              <input
                type="text"
                value={mergeForm.endRevision}
                placeholder="结束 revision"
                on:input={(event) =>
                  onMergeFormInput("endRevision", (event.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="merge-options" aria-label="Merge tracking 参数">
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={mergeForm.recordOnly}
                  disabled={mergeForm.ignoreAncestry}
                  on:change={(event) =>
                    onMergeFormInput(
                      "recordOnly",
                      (event.currentTarget as HTMLInputElement).checked,
                    )}
                />
                <span>Record only</span>
              </label>
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={mergeForm.ignoreAncestry}
                  disabled={mergeForm.recordOnly}
                  on:change={(event) =>
                    onMergeFormInput(
                      "ignoreAncestry",
                      (event.currentTarget as HTMLInputElement).checked,
                    )}
                />
                <span>Ignore ancestry</span>
              </label>
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={mergeForm.force}
                  on:change={(event) =>
                    onMergeFormInput("force", (event.currentTarget as HTMLInputElement).checked)}
                />
                <span>Force</span>
              </label>
            </div>
            {#if branchPool.entries.length > 0}
              <div class="quick-picks">
                {#each branchPool.entries as entry (entry.id)}
                  <button type="button" on:click={() => onUseRepositoryUrlForMerge(entry.branch_url)}>
                    {branchName(entry)}
                  </button>
                {/each}
              </div>
            {/if}
            {#if mergeError}
              <p class="inline-error">{mergeError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onRunMerge}
              disabled={!workspace || mergeRunning || !mergeForm.sourceUrl.trim()}
            >
              {mergeRunning ? "执行中" : "Merge"}
            </button>
            {#if mergeResult}
              <div class="merge-result-meta">
                <span>Merge 结果</span>
                <span>{mergeResult.revision_range === "默认"
                    ? "默认范围"
                    : `r${mergeResult.revision_range}`}</span>
                {#if mergeResult.record_only}<span>Record only</span>{/if}
                {#if mergeResult.ignore_ancestry}<span>Ignore ancestry</span>{/if}
                {#if mergeResult.force}<span>Force</span>{/if}
                {#if mergeResult.output_truncated}
                  <span>输出预览已截断（上限 {Math.round(mergeResult.max_output_bytes / 1024)} KiB）</span>
                {/if}
              </div>
              <div class="merge-result-summary" aria-label="Merge 结果统计">
                <span><strong>{mergeResult.file_count}</strong>条目</span>
                <span><strong>{mergeResult.updated}</strong>更新</span>
                <span><strong>{mergeResult.added}</strong>新增</span>
                <span><strong>{mergeResult.deleted}</strong>删除</span>
                <span><strong>{mergeResult.conflicted}</strong>冲突</span>
              </div>
              {#if mergeOutputFiles.length > 0}
                <div class="merge-diff-files" aria-label="Merge 差异文件">
                  {#each mergeOutputFiles as file (file.path)}
                    <div>
                      <span class="merge-file-status">{file.action}</span>
                      <code>{file.path}</code>
                    </div>
                  {/each}
                </div>
              {/if}
              <details class="merge-output">
                <summary>SVN 输出</summary>
                <pre>{mergeResult.output_text || "svn merge 没有输出。"}</pre>
              </details>
            {/if}
          </article>

          <article class="advanced-card">
            <h2>Switch</h2>
            <input
              type="url"
              value={svnSwitchTargetUrl}
              placeholder="目标 URL"
              on:input={(event) =>
                onSvnSwitchTargetInput((event.currentTarget as HTMLInputElement).value)}
            />
            {#if svnSwitchError}
              <p class="inline-error">{svnSwitchError}</p>
            {/if}
            <button
              type="button"
              class="primary"
              on:click={onRunSvnSwitch}
              disabled={!workspace || svnSwitchRunning || !svnSwitchTargetUrl.trim()}
            >
              {svnSwitchRunning ? "Switch 中" : "Switch"}
            </button>
          </article>

          <article class="advanced-card">
            <h2>任务工作区</h2>
            <p>{taskWorkspaces.entries.length} 个任务，当前 {activeTaskWorkspaceId ? "已选择" : "未选择"}。</p>
            <div class="task-list compact">
              {#each taskWorkspaces.entries as entry (entry.id)}
                <div>
                  <strong>{entry.name}</strong>
                  <span>{entry.local_path}</span>
                </div>
              {/each}
            </div>
          </article>
        </section>
      {:else if view.id === "settings"}
        <section class="pane-header">
          <div>
            <h1>偏好</h1>
            <p>只保留日常会用到的配置。</p>
          </div>
          <div class="pane-actions">
            <button type="button" on:click={() => onSelectView("branches")}>高级</button>
          </div>
        </section>

        <section class="settings-view">
          <article>
            <h2>界面</h2>
            <div class="segmented-control theme-control" aria-label="主题模式">
              <button
                type="button"
                class:active={appSettings.themeMode === "system"}
                aria-pressed={appSettings.themeMode === "system"}
                on:click={() => onAppSettingInput("themeMode", "system")}
              >
                跟随系统
              </button>
              <button
                type="button"
                class:active={appSettings.themeMode === "light"}
                aria-pressed={appSettings.themeMode === "light"}
                on:click={() => onAppSettingInput("themeMode", "light")}
              >
                浅色
              </button>
              <button
                type="button"
                class:active={appSettings.themeMode === "dark"}
                aria-pressed={appSettings.themeMode === "dark"}
                on:click={() => onAppSettingInput("themeMode", "dark")}
              >
                深色
              </button>
            </div>
          </article>
          <article>
            <h2>SVN</h2>
            <div class="button-row">
              <button type="button" on:click={onDetectSvn} disabled={svnLoading}>
                {svnLoading ? "检测中" : "自动检测"}
              </button>
              <span>{svnDetection?.version ?? "尚未检测"}</span>
            </div>
            <ErrorNotice error={svnError} />
            <input
              type="text"
              value={svnExecutableInput}
              placeholder="svn 或 svn.exe"
              on:input={(event) =>
                onSvnExecutableInput((event.currentTarget as HTMLInputElement).value)}
            />
            <button type="button" on:click={onDetectSvnWithInput} disabled={svnLoading}>
              使用此路径
            </button>
            <input
              type="text"
              value={appSettings.svnExecutable}
              placeholder="保存的 SVN 路径"
              on:input={(event) =>
                onAppSettingInput(
                  "svnExecutable",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if appSettings.validationErrors.svnExecutable}
              <p class="inline-error">{appSettings.validationErrors.svnExecutable}</p>
            {/if}
            <div class="segmented-control svn-auth-control" aria-label="SVN 认证方式">
              <button
                type="button"
                class:active={appSettings.svnAuthenticationMode === "system"}
                aria-pressed={appSettings.svnAuthenticationMode === "system"}
                on:click={() => onAppSettingInput("svnAuthenticationMode", "system")}
              >
                系统凭据
              </button>
              <button
                type="button"
                class:active={appSettings.svnAuthenticationMode === "password"}
                aria-pressed={appSettings.svnAuthenticationMode === "password"}
                on:click={() => onAppSettingInput("svnAuthenticationMode", "password")}
              >
                用户名密码
              </button>
              <button
                type="button"
                class:active={appSettings.svnAuthenticationMode === "ssh"}
                aria-pressed={appSettings.svnAuthenticationMode === "ssh"}
                on:click={() => onAppSettingInput("svnAuthenticationMode", "ssh")}
              >
                SSH
              </button>
            </div>
            <label>
              <span>用户名</span>
              <input
                type="text"
                autocomplete="username"
                value={appSettings.svnUsername}
                on:input={(event) =>
                  onAppSettingInput(
                    "svnUsername",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            </label>
            {#if appSettings.validationErrors.svnUsername}
              <p class="inline-error">{appSettings.validationErrors.svnUsername}</p>
            {/if}
            {#if appSettings.svnAuthenticationMode === "password"}
              <label>
                <span>密码</span>
                <input
                  type="password"
                  autocomplete="current-password"
                  value={svnAuthenticationPassword}
                  on:input={(event) =>
                    onSvnAuthenticationPasswordInput(
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                />
              </label>
              <label class="checkbox-row">
                <input
                  type="checkbox"
                  checked={appSettings.svnRememberPassword}
                  on:change={(event) =>
                    onAppSettingInput(
                      "svnRememberPassword",
                      (event.currentTarget as HTMLInputElement).checked,
                    )}
                />
                <span>保存到系统凭据存储</span>
              </label>
            {/if}
            <div class="button-row">
              <button
                type="button"
                class="primary"
                on:click={onApplySvnAuthentication}
                disabled={svnAuthenticationLoading || !!appSettings.validationErrors.svnUsername}
              >
                {svnAuthenticationLoading ? "应用中" : "应用认证"}
              </button>
              {#if svnAuthenticationStatus}
                <span class="settings-status">
                  {svnAuthenticationStatus.mode === "password"
                    ? svnAuthenticationStatus.remember_password
                      ? "密码已交给系统存储"
                      : "密码仅用于当前会话"
                    : svnAuthenticationStatus.mode === "ssh"
                      ? "使用系统 SSH"
                      : "使用系统凭据"}
                </span>
              {/if}
            </div>
            <ErrorNotice error={svnAuthenticationError} />
            <section class="certificate-trust-settings" aria-label="服务器证书例外">
              <div class="certificate-trust-heading">
                <strong>服务器证书例外</strong>
                <span>
                  {svnCertificateTrustStatus?.active ? "当前会话已启用" : "未启用"}
                </span>
              </div>
              {#if svnCertificateTrustStatus?.active}
                <ul class="certificate-failure-summary">
                  {#each svnCertificateTrustStatus.failures as failure}
                    <li>{svnCertificateFailureLabel(failure)}</li>
                  {/each}
                </ul>
                <button
                  type="button"
                  on:click={onClearSvnCertificateTrust}
                  disabled={svnCertificateTrustLoading}
                >
                  {svnCertificateTrustLoading ? "正在清除" : "清除会话证书例外"}
                </button>
              {/if}
              <ErrorNotice error={svnCertificateTrustError} />
            </section>
          </article>

          <article>
            <h2>Diff 和提交</h2>
            <label>
              <span>默认 Diff</span>
              <select
                value={appSettings.diffMode}
                on:change={(event) =>
                  onAppSettingInput(
                    "diffMode",
                    (event.currentTarget as HTMLSelectElement).value as AppSettingsState["diffMode"],
                  )}
              >
                <option value="side_by_side">双栏</option>
                <option value="inline">行内</option>
              </select>
            </label>
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={appSettings.showWhitespace}
                on:change={(event) =>
                  onAppSettingInput(
                    "showWhitespace",
                    (event.currentTarget as HTMLInputElement).checked,
                  )}
              />
              <span>显示空白字符</span>
            </label>
            <textarea
              rows="4"
              value={appSettings.commitTemplate}
              placeholder="提交模板"
              on:input={(event) =>
                onAppSettingInput(
                  "commitTemplate",
                  (event.currentTarget as HTMLTextAreaElement).value,
                )}
            ></textarea>
          </article>

          <article>
            <h2>工具</h2>
            <input
              type="text"
              value={appSettings.externalDiffTool}
              placeholder="外部 Diff 工具"
              on:input={(event) =>
                onAppSettingInput(
                  "externalDiffTool",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if appSettings.validationErrors.externalDiffTool}
              <p class="inline-error">{appSettings.validationErrors.externalDiffTool}</p>
            {/if}
            <input
              type="text"
              value={appSettings.externalMergeTool}
              placeholder="外部 Merge 工具"
              on:input={(event) =>
                onAppSettingInput(
                  "externalMergeTool",
                  (event.currentTarget as HTMLInputElement).value,
                )}
            />
            {#if appSettings.validationErrors.externalMergeTool}
              <p class="inline-error">{appSettings.validationErrors.externalMergeTool}</p>
            {/if}
            <input
              type="number"
              min="1"
              max="2048"
              value={appSettings.largeFileThresholdMb}
              on:input={(event) =>
                onAppSettingInput(
                  "largeFileThresholdMb",
                  (event.currentTarget as HTMLInputElement).valueAsNumber,
                )}
            />
            <button type="button" on:click={onExportDiagnosticLog} disabled={appSettings.loading}>
              {appSettings.loading ? "导出中" : "导出诊断日志"}
            </button>
            {#if appSettings.diagnosticExportPath}
              <p>{appSettings.diagnosticExportPath}</p>
            {:else if appSettings.diagnosticExportError}
              <p class="inline-error">{appSettings.diagnosticExportError}</p>
            {/if}
          </article>
        </section>
      {:else}
        <section class="pane-header">
          <div>
            <h1>工作副本</h1>
            <p>{workspace?.working_copy_root ?? "打开 SVN 工作副本后开始浏览"}</p>
          </div>
          <div class="pane-actions">
            {#if workingCopyStatus && workingCopyStatus.files.length < workingCopyStatus.total}
              <button type="button" on:click={onLoadMoreStatus} disabled={statusLoading}>
                更多改动
              </button>
            {/if}
          </div>
        </section>

        <section class="summary-strip" aria-label="工作副本摘要">
          <span><strong>{workingCopyStatus?.local_changes ?? 0}</strong> 本地改动</span>
          <span><strong>{workingCopyStatus?.remote_changes ?? 0}</strong> 远端更新</span>
          <span><strong>{workingCopyStatus?.combined_changes ?? 0}</strong> 同时变化</span>
          <span><strong>{abnormalCount}</strong> 异常</span>
          <span>
            <strong>r{workingCopyStatus?.revision_range ?? workspace?.revision ?? "-"}</strong>
            {#if workingCopyStatus}
              {#if workingCopyStatus.remote_updates_checked}
                → r{workingCopyStatus.repository_revision ?? "-"}
              {:else}
                · 远端未检查
              {/if}
            {/if}
          </span>
        </section>

        <section class="changes-toolbar" aria-label="改动过滤">
          <input
            type="search"
            value={searchText}
            placeholder="搜索文件"
            on:input={(event) =>
              onSearchTextInput((event.currentTarget as HTMLInputElement).value)}
          />
          <div class="segmented-control">
            <button
              type="button"
              class:active={workingCopyTreeFilter === "all"}
              on:click={() => selectWorkingCopyTreeFilter("all")}
            >
              全部文件
            </button>
            <button
              type="button"
              class:active={workingCopyTreeFilter === "local"}
              on:click={() => selectWorkingCopyTreeFilter("local")}
            >
              本地改动
            </button>
            <button
              type="button"
              class:active={workingCopyTreeFilter === "unversioned"}
              on:click={() => selectWorkingCopyTreeFilter("unversioned")}
            >
              未管理文件
            </button>
          </div>
          <label class="changelist-filter">
            <span>Changelist</span>
            <select aria-label="Changelist 过滤" bind:value={changelistFilter}>
              <option value="all">全部</option>
              <option value="unassigned">未分组</option>
              {#each availableChangelists as changelist (changelist)}
                <option value={changelist}>{changelist}</option>
              {/each}
            </select>
          </label>
          {#if selectedRowPaths.size > 0}
            <div class="batch-action-bar" role="toolbar" aria-label="所选路径批量操作">
            <strong>{selectedRowPaths.size} 个已选</strong>
            <button
              type="button"
              disabled={selectedRevertablePaths.length === 0 || statusLoading || toolbarLocked}
              on:click={() => onRevertPaths(selectedRevertablePaths)}
            >
              Revert
            </button>
            <button
              type="button"
              disabled={selectedChangelistPaths.length === 0 || statusLoading || toolbarLocked}
              on:click={() => onAssignChangelist(selectedChangelistPaths)}
            >
              加入 Changelist
            </button>
            <button
              type="button"
              disabled={selectedAssignedChangelistPaths.length === 0 || statusLoading || toolbarLocked}
              on:click={() => onRemoveChangelist(selectedAssignedChangelistPaths)}
            >
              移出 Changelist
            </button>
            <button
              type="button"
              disabled={selectedMovablePaths.length === 0 || statusLoading || toolbarLocked}
              on:click={() => onMovePaths(selectedMovablePaths)}
            >
              Move
            </button>
            <button
              type="button"
              class="danger-action"
              disabled={selectedDeletablePaths.length === 0 || statusLoading || toolbarLocked}
              on:click={() => onDeletePaths(selectedDeletablePaths)}
            >
              Delete
            </button>
            <button type="button" class="batch-clear" on:click={clearRowSelection}>清除选择</button>
            </div>
          {/if}
        </section>

        <section
          class="work-copy-grid"
          class:file-columns-resizing={resizingFileColumn !== null}
          style={fileTableColumnStyle}
        >
          <div class="workspace-file-explorer folder-detached">

            <div class="file-list-pane">
              <header class="selected-directory-toolbar" aria-label="当前文件夹操作">
                <div>
                  <strong>{selectedDirectoryPath ? basename(selectedDirectoryPath) : "工作副本根目录"}</strong>
                  <span title={selectedDirectoryPath || workspace?.working_copy_root}>
                    {selectedDirectoryPath || workspace?.working_copy_root || "未打开工作副本"}
                  </span>
                </div>
                <p>
                  {#if directoryFilesLoading && treeRows.length === 0}
                    正在读取全部文件...
                  {:else if directoryFilesError}
                    <span class="inline-error" role="alert" title={directoryFilesErrorLabel(directoryFilesError)}>
                      读取文件失败：{directoryFilesErrorLabel(directoryFilesError)}
                    </span>
                  {:else}
                    {treeRows.length} 个文件
                    <span>·</span>
                    {selectedDirectoryCommittablePaths.length} 个可提交
                    {#if selectedDirectoryRemoteCount > 0}
                      <span>·</span>
                      {selectedDirectoryRemoteCount} 个远端更新
                    {/if}
                    {#if selectedDirectoryFileTree?.truncated}
                      <span>·</span>
                      已显示 {selectedDirectoryFileTree.returned_files}/{selectedDirectoryFileTree.total_files}
                    {/if}
                  {/if}
                </p>
                {#if selectedDirectoryNode && canShowPathContextMenu(selectedDirectoryNode)}
                  <div class="selected-directory-actions">
                    <button
                      type="button"
                      class="icon-button"
                      aria-label={`更多操作 目录 ${selectedDirectoryPath}`}
                      title="更多文件夹操作"
                      on:click={openSelectedDirectoryMenu}
                    >
                      <Ellipsis size={15} aria-hidden="true" />
                    </button>
                  </div>
                {/if}
              </header>
          <div
            bind:this={fileBrowserElement}
            class="file-browser"
            role="treegrid"
            tabindex="0"
            aria-label="工作副本文件列表"
            aria-rowcount={treeRows.length + 1}
            aria-multiselectable="true"
            aria-activedescendant={activeRowPath && treeRowWindow.items.some((row) => row.path === activeRowPath)
              ? rowDomId(activeRowPath)
              : undefined}
            on:focus={handleFileTableFocus}
            on:keydown={handleFileTableKeydown}
            on:scroll={handleFileBrowserScroll}
          >
            <div class="file-table-head" role="row" aria-rowindex="1">
              <span class="selection-cell" role="columnheader">
                <input
                  type="checkbox"
                  aria-label="选择当前可见路径"
                  checked={allVisibleRowsSelected}
                  indeterminate={someVisibleRowsSelected}
                  disabled={treeRows.length === 0}
                  on:click={(event) => toggleVisibleRowSelection(event.currentTarget.checked)}
                />
              </span>
              {#each fileColumns as column (column.key)}
                <span
                  class="file-column-header"
                  role="columnheader"
                  aria-label={column.label || column.ariaLabel}
                >
                  {column.label}
                  <div
                    role="slider"
                    tabindex="0"
                    class="file-column-resizer"
                    class:active={resizingFileColumn?.column === column.key}
                    aria-label={`调整 ${column.ariaLabel} 列宽`}
                    aria-orientation="horizontal"
                    aria-valuemin={fileColumnMinimumWidths[column.key]}
                    aria-valuemax={fileColumnMaximumWidths[column.key]}
                    aria-valuenow={fileColumnWidths[column.key]}
                    on:mousedown={(event) => startFileColumnResize(event, column.key)}
                    on:keydown={(event) => handleFileColumnResizeKeydown(event, column.key)}
                  ></div>
                </span>
              {/each}
            </div>
            {#if treeRows.length > 0}
              {#if treeRowWindow.beforeHeight > 0}
                <div class="virtual-list-spacer file-tree-spacer" style={`height: ${treeRowWindow.beforeHeight}px`} aria-hidden="true"></div>
              {/if}
              {#each treeRowWindow.items as node, index (node.path)}
                <div
                  id={rowDomId(node.path)}
                  class="file-row"
                  role="row"
                  tabindex="-1"
                  aria-rowindex={treeRowWindow.startIndex + index + 2}
                  aria-level={node.depth + 1}
                  aria-expanded={node.kind === "dir" ? !isTreeNodeCollapsed(node, collapsedTreePaths) : undefined}
                  aria-selected={isRowSelected(node.path, selectedRowPaths)}
                  class:directory={node.kind === "dir"}
                  class:selected={isRowSelected(node.path, selectedRowPaths)}
                  class:active-row={activeRowPath === node.path}
                  class:inspected={node.kind === "file" && isSelectedPath(node.path)}
                  class:abnormal={["missing", "conflicted", "obstructed"].includes(node.status)}
                  on:contextmenu={(event) => openRowContextMenu(event, node)}
                >
                  <span class="selection-cell" role="gridcell">
                    <input
                      type="checkbox"
                      aria-label={`选择${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                      checked={isRowSelected(node.path, selectedRowPaths)}
                      on:click={(event) => {
                        event.stopPropagation();
                        activeRowPath = node.path;
                        toggleRowSelection(node.path, event.currentTarget.checked, event.shiftKey);
                      }}
                    />
                  </span>
                  <span class="file-name-cell" role="gridcell">
                    <button
                      type="button"
                      class="file-name"
                      style={`--tree-depth: ${node.depth}`}
                      aria-label={node.kind === "dir" ? `切换目录 ${node.path}` : `选择文件 ${node.path}`}
                      aria-expanded={node.kind === "dir" ? !isTreeNodeCollapsed(node, collapsedTreePaths) : undefined}
                      on:click={() => activateTreeNodeFromPointer(node)}
                      on:dblclick={() => openTreeNodeFromPointer(node)}
                    >
                      <strong>
                        <span
                          class="tree-affordance"
                          class:visible={node.kind === "dir"}
                          class:collapsed={isTreeNodeCollapsed(node, collapsedTreePaths)}
                          aria-hidden="true"
                        ></span>
                        <span
                          class="tree-icon"
                          class:folder-icon={node.kind === "dir"}
                          class:file-icon={node.kind === "file"}
                          aria-hidden="true"
                        ></span>
                        {node.name}
                      </strong>
                    </button>
                  </span>
                  <span class="metadata-cell" role="gridcell">{node.base_revision ?? node.revision ?? "-"}</span>
                  <span class="metadata-cell" role="gridcell">{node.last_revision ?? "-"}</span>
                  <span class="metadata-cell" role="gridcell" title={node.last_changed_date ?? undefined}>
                    {formatSvnDate(node.last_changed_date)}
                  </span>
                  <span class="metadata-cell" role="gridcell" title={node.last_changed_author ?? undefined}>
                    {node.last_changed_author ?? "-"}
                  </span>
                  <span class="status-stack" role="gridcell">
                    {#if node.changelist}
                      <span class="status-pill changelist-status" title={`Changelist: ${node.changelist}`}>
                        {node.changelist}
                      </span>
                    {/if}
                    {#if node.change_scope === "local" || node.change_scope === "both"}
                      <span class="status-pill local-status {statusClass(node.status)}">
                        {localStatusText(node)}
                      </span>
                    {/if}
                    {#if node.change_scope === "remote" || node.change_scope === "both"}
                      <span class="status-pill remote-status {statusClass(node.remote_status ?? "modified")}">
                        {remoteStatusText(node)}
                      </span>
                    {/if}
                    {#if node.change_scope === "none" && node.kind === "file" && !["normal", "none"].includes(node.status)}
                      <span class="status-pill {statusClass(node.status)}">{labelStatus(node.status)}</span>
                    {/if}
                  </span>
                  <span role="gridcell">{formatBytes(node.file_size)}</span>
                  <span class="inline-row-actions" role="gridcell">
                    {#if isUnversionedPath(node.path)}
                      <button
                        type="button"
                        class="row-primary-action"
                        aria-label={`Add ${node.path}`}
                        disabled={statusLoading || toolbarLocked}
                        on:click={() => onAddFile(node.path)}
                      >
                        Add
                      </button>
                    {:else}
                      {#if isConflictedPath(node.path)}
                        <button
                          type="button"
                          class="row-primary-action"
                          aria-label={`可视化解决 ${node.path}`}
                          on:click={() => openConflictResolver(node.path)}
                        >
                          Resolve
                        </button>
                      {/if}
                      {#if node.change_scope === "remote" || node.change_scope === "both"}
                        <button
                          type="button"
                          class="row-primary-action"
                          aria-label={`Update ${node.path}`}
                          disabled={statusLoading || toolbarLocked}
                          on:click={() => onUpdatePath(node.path)}
                        >
                          Update
                        </button>
                      {/if}
                    {/if}
                    {#if canShowPathContextMenu(node) && (isUnversionedPath(node.path) || isLocalChangedPath(node.path) || canMovePath(node) || canDeletePath(node))}
                      <button
                        type="button"
                        class="row-menu-trigger"
                        aria-label={`更多操作 ${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                        aria-haspopup="menu"
                        aria-expanded={openRowMenuPath === node.path}
                        on:click={() => toggleRowMenu(node.path)}
                        on:keydown={(event) => {
                          if (event.key === "Escape") {
                            openRowMenuPath = null;
                          }
                        }}
                      >
                        <Ellipsis size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                    {/if}
                    {#if canShowPathContextMenu(node) && openRowMenuPath === node.path}
                      <div
                        class="row-action-menu"
                        role="menu"
                        tabindex="-1"
                        aria-label={`路径操作 ${node.path}`}
                        on:keydown={(event) => {
                          if (event.key === "Escape") {
                            openRowMenuPath = null;
                          }
                        }}
                      >
                        {#if isUnversionedPath(node.path)}
                          <button
                            type="button"
                            role="menuitem"
                            aria-label={`Ignore ${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                            disabled={statusLoading || toolbarLocked}
                            on:click={() => runRowAction(() => onIgnorePath(node.path))}
                          >
                            <EyeOff size={15} aria-hidden="true" />
                            Ignore
                          </button>
                        {/if}
                        {#if isLocalChangedPath(node.path) && !isUnversionedPath(node.path)}
                          <button
                            type="button"
                            role="menuitem"
                            aria-label={`撤销${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                            disabled={statusLoading || toolbarLocked}
                            on:click={() => runRowAction(() => onRevertFile(node.path))}
                          >
                            <Undo2 size={15} aria-hidden="true" />
                            撤销
                          </button>
                        {/if}
                        {#if canUseChangelist(node)}
                          <button
                            type="button"
                            role="menuitem"
                            disabled={statusLoading || toolbarLocked}
                            on:click={() => runRowAction(() => onAssignChangelist([node.path]))}
                          >
                            <ListPlus size={15} aria-hidden="true" />
                            加入 Changelist...
                          </button>
                          {#if node.changelist}
                            <button
                              type="button"
                              role="menuitem"
                              disabled={statusLoading || toolbarLocked}
                              on:click={() => runRowAction(() => onRemoveChangelist([node.path]))}
                            >
                              <ListMinus size={15} aria-hidden="true" />
                              移出 Changelist
                            </button>
                          {/if}
                        {/if}
                        {#if canMovePath(node)}
                          <button
                            type="button"
                            role="menuitem"
                            aria-label={`移动${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                            disabled={statusLoading || toolbarLocked}
                            on:click={() => runRowAction(() => onMovePath(node.path))}
                          >
                            <MoveRight size={15} aria-hidden="true" />
                            移动
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            aria-label={`复制${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                            disabled={statusLoading || toolbarLocked}
                            on:click={() => runRowAction(() => onCopyPath(node.path))}
                          >
                            <Copy size={15} aria-hidden="true" />
                            复制
                          </button>
                        {/if}
                        {#if canDeletePath(node)}
                          <button
                            type="button"
                            role="menuitem"
                            aria-label={`删除${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                            disabled={statusLoading || toolbarLocked}
                            on:click={() => runRowAction(() => onDeletePath(node.path))}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                            删除
                          </button>
                        {/if}
                      </div>
                    {/if}
                  </span>
                </div>
              {/each}
              {#if treeRowWindow.afterHeight > 0}
                <div class="virtual-list-spacer file-tree-spacer" style={`height: ${treeRowWindow.afterHeight}px`} aria-hidden="true"></div>
              {/if}
            {:else if workspace && statusLoading}
              <article class="empty-state" role="status" aria-live="polite">
                正在扫描工作副本...
              </article>
            {:else if workspaceFileTree}
              <article class="empty-state">没有匹配的文件</article>
            {:else if workspace}
              <article class="empty-state">点击“刷新”扫描工作副本</article>
            {:else}
              <article class="empty-state workspace-empty-state">
                <span class="empty-state-icon" aria-hidden="true">
                  <FolderOpen size={30} strokeWidth={1.55} />
                </span>
                <strong>未打开工作副本</strong>
                <button type="button" class="primary" on:click={onChooseWorkspace}>选择目录</button>
              </article>
            {/if}
          </div>
            </div>
          </div>

        </section>
      {/if}
    </main>
  </div>

  {#if projectContextMenuEntry}
    <div
      bind:this={projectContextMenuElement}
      class="workspace-context-menu project-context-menu"
      role="menu"
      tabindex="-1"
      aria-label={`项目菜单 ${workspaceEntryName(projectContextMenuEntry)}`}
      style={`left: ${projectContextMenuX}px; top: ${projectContextMenuY}px`}
      on:keydown={handleProjectContextMenuKeydown}
      on:focusout={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && !event.currentTarget.contains(nextTarget)) {
          closeProjectContextMenu();
        }
      }}
    >
      <button
        type="button"
        role="menuitem"
        disabled={branchPoolLoading}
        on:click={editProjectContextMenuEntry}
      >
        <Pencil size={15} aria-hidden="true" />
        修改备注
      </button>
      <span role="separator"></span>
      <button
        type="button"
        role="menuitem"
        class="danger-action"
        disabled={branchPoolLoading}
        on:click={removeProjectContextMenuEntry}
      >
        <ListMinus size={15} aria-hidden="true" />
        从项目列表移除
      </button>
    </div>
  {/if}

  {#if contextMenuNode && canShowPathContextMenu(contextMenuNode)}
    <div
      bind:this={contextMenuElement}
      class="workspace-context-menu"
      role="menu"
      tabindex="-1"
      aria-label={`路径菜单 ${contextMenuNode.path}`}
      style={`left: ${contextMenuX}px; top: ${contextMenuY}px`}
      on:keydown={handleContextMenuKeydown}
      on:focusout={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && !event.currentTarget.contains(nextTarget)) {
          closeContextMenu();
        }
      }}
    >
      {#if canOpenWorkspaceNode(contextMenuNode)}
        <button
          type="button"
          role="menuitem"
          on:click={() => runContextMenuAction(() => onOpenWorkspaceFile(contextMenuNode.path))}
        >
          <ExternalLink size={15} aria-hidden="true" />
          打开
        </button>
        <button
          type="button"
          role="menuitem"
          on:click={() => runContextMenuAction(() => onOpenFileLocation(contextMenuNode.path))}
        >
          <FolderOpen size={15} aria-hidden="true" />
          显示位置
        </button>
        <span role="separator"></span>
      {/if}
      {#if isUnversionedPath(contextMenuNode.path)}
        <button
          type="button"
          role="menuitem"
          disabled={statusLoading || toolbarLocked}
          on:click={() => runContextMenuAction(() => onAddFile(contextMenuNode.path))}
        >
          <Plus size={15} aria-hidden="true" />
          Add
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={statusLoading || toolbarLocked}
          on:click={() => runContextMenuAction(() => onIgnorePath(contextMenuNode.path))}
        >
          <EyeOff size={15} aria-hidden="true" />
          Ignore
        </button>
      {:else}
        {#if isConflictedPath(contextMenuNode.path)}
          <button
            type="button"
            role="menuitem"
            on:click={() => runContextMenuAction(() => openConflictResolver(contextMenuNode.path))}
          >
            <GitMerge size={15} aria-hidden="true" />
            可视化解决
          </button>
        {/if}
        {#if selectedChangelistPaths.length > 0}
          <button
            type="button"
            role="menuitem"
            disabled={statusLoading || toolbarLocked}
            on:click={() => runContextMenuAction(() => onAssignChangelist(selectedChangelistPaths))}
          >
            <ListPlus size={15} aria-hidden="true" />
            加入 Changelist...
          </button>
        {/if}
        {#if selectedAssignedChangelistPaths.length > 0}
          <button
            type="button"
            role="menuitem"
            disabled={statusLoading || toolbarLocked}
            on:click={() => runContextMenuAction(() => onRemoveChangelist(selectedAssignedChangelistPaths))}
          >
            <ListMinus size={15} aria-hidden="true" />
            移出 Changelist
          </button>
        {/if}
        {#if contextMenuNode.change_scope === "remote" || contextMenuNode.change_scope === "both"}
          <button
            type="button"
            role="menuitem"
            disabled={statusLoading || toolbarLocked}
            on:click={() => runContextMenuAction(() => onUpdatePath(contextMenuNode.path))}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Update
          </button>
        {/if}
      {/if}
      {#if selectedRevertablePaths.length > 0 || selectedMovablePaths.length > 0 || selectedDeletablePaths.length > 0}
        <span role="separator"></span>
      {/if}
      {#if selectedRevertablePaths.length > 0}
        <button
          type="button"
          role="menuitem"
          disabled={statusLoading || toolbarLocked}
          on:click={() => runContextMenuAction(runContextRevert)}
        >
          <Undo2 size={15} aria-hidden="true" />
          Revert{selectedRevertablePaths.length > 1 ? ` ${selectedRevertablePaths.length} 项` : ""}
        </button>
      {/if}
      {#if selectedMovablePaths.length > 0}
        <button
          type="button"
          role="menuitem"
          disabled={statusLoading || toolbarLocked}
          on:click={() => runContextMenuAction(runContextMove)}
        >
          <MoveRight size={15} aria-hidden="true" />
          Move{selectedMovablePaths.length > 1 ? ` ${selectedMovablePaths.length} 项` : ""}
        </button>
      {/if}
      {#if canMovePath(contextMenuNode)}
        <button
          type="button"
          role="menuitem"
          disabled={statusLoading || toolbarLocked}
          on:click={() => runContextMenuAction(() => onCopyPath(contextMenuNode.path))}
        >
          <Copy size={15} aria-hidden="true" />
          Copy
        </button>
      {/if}
      {#if selectedDeletablePaths.length > 0}
        <button
          type="button"
          role="menuitem"
          class="danger-action"
          disabled={statusLoading || toolbarLocked}
          on:click={() => runContextMenuAction(runContextDelete)}
        >
          <Trash2 size={15} aria-hidden="true" />
          Delete{selectedDeletablePaths.length > 1 ? ` ${selectedDeletablePaths.length} 项` : ""}
        </button>
      {/if}
    </div>
  {/if}

  {#if authenticationDialogOpen && detectedAuthenticationFailure}
    {@const authRepositoryUrl =
      detectedAuthenticationFailure.repositoryUrl?.trim() ||
      workspace?.repository_url?.trim() ||
      ""}
    {@const authLocalPath =
      workspace?.working_copy_root?.trim() ||
      workspace?.local_path?.trim() ||
      ""}
    <div class="patch-dialog-backdrop authentication-dialog-backdrop">
      <div
        class="patch-dialog authentication-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="authentication-dialog-title"
        tabindex="-1"
        use:focusAuthenticationDialog
        on:keydown={handleAuthenticationDialogKeydown}
      >
        <header>
          <div>
            <h2 id="authentication-dialog-title">登录 SVN</h2>
            <p>
              {detectedAuthenticationFailure.hostname ??
                hostFromRepositoryUrl(authRepositoryUrl) ??
                "SVN 仓库"}
            </p>
          </div>
          <button
            type="button"
            class="dialog-close"
            aria-label="关闭 SVN 登录对话框"
            title="关闭"
            disabled={svnAuthenticationLoading}
            on:click={dismissAuthenticationDialog}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {#if authRepositoryUrl || authLocalPath}
          <div class="authentication-target" aria-label="认证目标仓库">
            {#if authRepositoryUrl}
              <div>
                <span>仓库 URL</span>
                <code title={authRepositoryUrl}>{authRepositoryUrl}</code>
              </div>
            {/if}
            {#if authLocalPath}
              <div>
                <span>本地路径</span>
                <code title={authLocalPath}>{authLocalPath}</code>
              </div>
            {/if}
          </div>
        {/if}

        <div class="authentication-fields">
          <label>
            <span>用户名</span>
            <input
              type="text"
              autocomplete="username"
              bind:value={authenticationUsername}
              disabled={svnAuthenticationLoading}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              autocomplete="current-password"
              bind:value={authenticationPassword}
              disabled={svnAuthenticationLoading}
            />
          </label>
          <label class="checkbox-row">
            <input
              type="checkbox"
              bind:checked={authenticationRememberPassword}
              disabled={svnAuthenticationLoading}
            />
            <span>保存到系统凭据存储</span>
          </label>
        </div>

        <ErrorNotice error={svnAuthenticationError} />
        <footer>
          <button
            type="button"
            on:click={dismissAuthenticationDialog}
            disabled={svnAuthenticationLoading}
          >
            取消
          </button>
          <button
            type="button"
            class="primary"
            on:click={confirmAuthentication}
            disabled={svnAuthenticationLoading ||
              !authenticationUsername.trim() ||
              !authenticationPassword}
          >
            {svnAuthenticationLoading
              ? "正在登录"
              : detectedAuthenticationCandidate?.retry
                ? "登录并重试"
                : "应用认证"}
          </button>
        </footer>
      </div>
    </div>
  {:else if certificateDialogOpen && detectedCertificateFailure}
    <div class="patch-dialog-backdrop certificate-dialog-backdrop">
      <div
        class="patch-dialog certificate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="certificate-dialog-title"
        tabindex="-1"
        use:focusCertificateDialog
        on:keydown={handleCertificateDialogKeydown}
      >
        <header>
          <div>
            <h2 id="certificate-dialog-title">确认服务器证书风险</h2>
            <p>{detectedCertificateFailure.hostname ?? "未识别服务器"}</p>
          </div>
          <button
            type="button"
            class="dialog-close"
            aria-label="关闭证书确认对话框"
            title="关闭"
            disabled={svnCertificateTrustLoading}
            on:click={dismissCertificateDialog}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <dl class="certificate-identity">
          <div>
            <dt>服务器</dt>
            <dd>{detectedCertificateFailure.hostname ?? "未知"}</dd>
          </div>
          <div>
            <dt>指纹</dt>
            <dd>{detectedCertificateFailure.fingerprint ?? "SVN 未提供"}</dd>
          </div>
        </dl>

        <fieldset class="certificate-failures">
          <legend>本次允许的失败类型</legend>
          {#each detectedCertificateFailure.failures as failure}
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={selectedCertificateFailures.includes(failure)}
                disabled={svnCertificateTrustLoading}
                on:change={() => toggleCertificateFailure(failure)}
              />
              <span>{svnCertificateFailureLabel(failure)}</span>
            </label>
          {/each}
        </fieldset>

        <label class="checkbox-row certificate-risk-confirmation">
          <input
            type="checkbox"
            bind:checked={certificateRiskConfirmed}
            disabled={svnCertificateTrustLoading}
          />
          <span>我已核对服务器身份，并同意仅在当前会话中允许以上证书失败类型</span>
        </label>
        <ErrorNotice error={svnCertificateTrustError} />

        <footer>
          <button
            type="button"
            on:click={dismissCertificateDialog}
            disabled={svnCertificateTrustLoading}
          >
            取消
          </button>
          <button
            type="button"
            class="primary"
            on:click={confirmCertificateTrust}
            disabled={svnCertificateTrustLoading ||
              !certificateRiskConfirmed ||
              selectedCertificateFailures.length === 0}
          >
            {svnCertificateTrustLoading ? "正在应用" : "仅本次会话允许"}
          </button>
        </footer>
      </div>
    </div>
  {/if}

  {#if commitDialogOpen && workspace}
    <div class="embedded-commit-host">
      <StandaloneCommitWindow
        targetPath={commitTargetPath()}
        svnExecutable={svnExecutable?.trim() || svnExecutableInput.trim() || undefined}
        themeMode={appSettings.themeMode}
        diffMode={appSettings.diffMode}
        showWhitespace={appSettings.showWhitespace}
        svnAuthenticationUsername={appSettings.svnUsername}
        svnRememberPassword={appSettings.svnRememberPassword}
        {svnAuthenticationLoading}
        {svnAuthenticationError}
        onSvnAuthenticationSubmit={onInlineSvnAuthenticationSubmit}
        embedded={true}
        onClose={() => {
          closeCommitDialog();
          onRefreshStatus();
        }}
        onSwitchToUpdate={() => {
          closeCommitDialog();
          onUpdateWorkspace();
        }}
      />
    </div>
  {/if}

  {#if applyPatchDialogOpen}
    <div class="patch-dialog-backdrop">
      <div
        class="patch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-patch-title"
        tabindex="-1"
        use:focusPatchDialog
        on:keydown={handlePatchDialogKeydown}
      >
        <header>
          <div>
            <h2 id="apply-patch-title">应用 Patch</h2>
            <p title={applyPatchFilePath}>{basename(applyPatchFilePath)}</p>
          </div>
          <button
            type="button"
            class="dialog-close"
            aria-label="关闭 Patch 对话框"
            title="关闭"
            disabled={applyPatchRunning}
            on:click={onCloseApplyPatch}
          >
            ×
          </button>
        </header>

        {#if applyPatchRunning}
          <p class="patch-dialog-status">
            {applyPatchResult?.dry_run ? "正在应用 Patch" : "正在预检 Patch"}
          </p>
        {:else if applyPatchResult}
          <p class:patch-warning={applyPatchHasIssues} class="patch-dialog-status">
            {applyPatchResult.dry_run
              ? applyPatchCanProceed
                ? "预检通过"
                : "预检发现问题"
              : applyPatchHasIssues
                ? "Patch 已部分应用"
                : "Patch 已应用"}
          </p>
        {/if}

        {#if applyPatchError}
          <p class="inline-error">{applyPatchError}</p>
        {/if}

        {#if applyPatchResult}
          <div class="patch-summary" aria-label="Patch 结果统计">
            <span><strong>{applyPatchResult.applied}</strong>应用</span>
            <span><strong>{applyPatchResult.offset_hunks}</strong>偏移</span>
            <span><strong>{applyPatchResult.rejected}</strong>拒绝</span>
            <span><strong>{applyPatchResult.skipped}</strong>跳过</span>
            <span><strong>{applyPatchResult.conflicted}</strong>冲突</span>
          </div>
          {#if applyPatchResult.output_truncated}
            <p class="patch-output-limit" role="status">
              输出预览已截断（上限 {Math.round(applyPatchResult.max_output_bytes / 1024)} KiB）
            </p>
          {/if}
          <pre class="patch-output">{applyPatchResult.output_text || "SVN 未返回输出"}</pre>
        {/if}

        <footer>
          <button type="button" on:click={onCloseApplyPatch} disabled={applyPatchRunning}>
            {applyPatchResult && !applyPatchResult.dry_run && !applyPatchError ? "完成" : "关闭"}
          </button>
          {#if !applyPatchRunning && applyPatchError && !applyPatchResult}
            <button type="button" on:click={() => onRunApplyPatch(true)}>重新预检</button>
          {/if}
          {#if applyPatchResult?.dry_run}
            {#if applyPatchError}
              <button type="button" on:click={() => onRunApplyPatch(true)}>重新预检</button>
            {:else}
              <button
                type="button"
                class="primary"
                on:click={() => onRunApplyPatch(false)}
                disabled={applyPatchRunning || !applyPatchCanProceed}
              >
                应用 Patch
              </button>
            {/if}
          {/if}
        </footer>
      </div>
    </div>
  {/if}

  {#if blameRevisionLogTarget}
    <SvnRevisionLogDialog
      revision={blameRevisionLogTarget.revision}
      targetPath={blameRevisionLogTarget.targetPath}
      workingCopyRoot={blameRevisionLogTarget.workingCopyRoot}
      filePath={blameRevisionLogTarget.filePath}
      repositoryUrl={blameRevisionLogTarget.repositoryUrl}
      repositoryRevision={blameRevisionLogTarget.repositoryRevision}
      svnExecutable={svnExecutableInput.trim() || undefined}
      theme={resolvedTheme}
      svnAuthenticationUsername={appSettings.svnUsername}
      svnRememberPassword={appSettings.svnRememberPassword}
      {svnAuthenticationLoading}
      {svnAuthenticationError}
      onSvnAuthenticationSubmit={onInlineSvnAuthenticationSubmit}
      onClose={() => (blameRevisionLogTarget = null)}
    />
  {/if}
</section>

<ConflictResolver
  open={conflictResolverOpen}
  theme={resolvedTheme}
  filePath={selectedFilePath ?? ""}
  contentDiff={selectedFileContentDiff}
  loading={contentDiffLoading}
  saving={conflictResolutionSaving}
  error={conflictResolutionError ?? contentDiffError}
  onClose={() => (conflictResolverOpen = false)}
  onSave={onSaveConflictResolution}
  onUseWorking={onResolveWorking}
  onUseMineFull={onResolveMineFull}
  onUseTheirsFull={onResolveTheirsFull}
  onOpenExternalMerge={(path) => onLaunchExternalTool("merge", path)}
/>
