<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    Download,
    Ellipsis,
    FileUp,
    FolderOpen,
    GitCompareArrows,
    GitCommitHorizontal,
    GripVertical,
    History,
    ListChecks,
    LoaderCircle,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
    RefreshCw,
    RotateCcw,
    Wrench,
    X,
  } from "@lucide/svelte";
  import ErrorNotice from "../ErrorNotice.svelte";
  import MonacoDiffViewer from "./MonacoDiffViewer.svelte";
  import {
    findSvnCertificateFailure,
    svnCertificateFailureLabel,
  } from "../../lib/svn-certificate";
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
    RevisionDiffMode,
    RevisionDiffResult,
    SvnBlame,
    SvnDetection,
    SvnAuthenticationStatus,
    SvnCertificateFailure,
    SvnCertificateTrustStatus,
    SvnLog,
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
  } from "../../types/api";
  import type {
    AppSettingsState,
    AppView,
    ReviewedFileState,
    SafetyCheckSummary,
    WorkbenchView,
  } from "../../types/app";

  export let view: WorkbenchView;
  export let workspace: WorkspaceSummary | null = null;
  export let workspacePathInput = "";
  export let workspaceLoading = false;
  export let workspaceError: CommandError | null = null;
  export let workingCopyStatus: WorkingCopyStatus | null = null;
  export let workspaceFileTree: WorkspaceFileTree | null = null;
  export let searchText = "";
  export let selectedFilePath: string | null = null;
  export let selectedFile: ChangedFile | null = null;
  export let selectedFileReviewed = false;
  export let commitFiles: Array<{ path: string; status: string }> = [];
  export let reviewedFiles: ReviewedFileState[] = [];
  export let statusLoading = false;
  export let statusError: CommandError | null = null;

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
  export let revisionDiffForm: {
    mode: RevisionDiffMode;
    filePath: string;
    targetUrl: string;
    leftRevision: string;
    rightRevision: string;
    leftUrl: string;
    rightUrl: string;
  } = {
    mode: "revisions",
    filePath: "",
    targetUrl: "",
    leftRevision: "",
    rightRevision: "",
    leftUrl: "",
    rightUrl: "",
  };
  export let revisionDiffLoading = false;
  export let revisionDiffError: string | null = null;
  export let revisionDiffResult: RevisionDiffResult | null = null;

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
  export let selectedPatchLoading = false;
  export let diffError: CommandError | null = null;
  export let contentDiffError: CommandError | null = null;
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

  export let commitTemplate = "";
  export let commitHistory: string[] = [];
  export let commitMessage = "";
  export let commitError: string | null = null;
  export let commitFormOpenDisabled = false;
  export let commitDisabled = false;
  export let partialCommitDisabled = false;
  export let tasks: TaskSummary[] = [];
  export let selectedTask: Task | null = null;
  export let runningTaskId: string | null = null;
  export let pendingSvnOperationKind: PendingSvnOperationKind | null = null;
  export let taskError: CommandError | null = null;
  export let backendMessage = "";
  export let commandError: CommandError | null = null;

  export let svnDetection: SvnDetection | null = null;
  export let svnError: CommandError | null = null;
  export let svnExecutableInput = "";
  export let svnLoading = false;
  export let svnAuthenticationPassword = "";
  export let svnAuthenticationStatus: SvnAuthenticationStatus | null = null;
  export let svnAuthenticationError: CommandError | null = null;
  export let svnAuthenticationLoading = false;
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
    showInspector: true,
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
  export let onChooseWorkspace: () => void = () => {};
  export let onOpenWorkspace: () => void = () => {};
  export let onRefreshStatus: () => void = () => {};
  export let onUpdateWorkspace: () => void = () => {};
  export let onUpdatePath: (path: string) => void = () => {};
  export let onCleanupWorkspace: () => void = () => {};
  export let onChooseApplyPatch: () => void = () => {};
  export let onRunApplyPatch: (dryRun: boolean) => void = () => {};
  export let onCloseApplyPatch: () => void = () => {};
  export let onLoadMoreStatus: () => void = () => {};
  export let onWorkspacePathInput: (value: string) => void = () => {};
  export let onSearchTextInput: (value: string) => void = () => {};
  export let onClearFilters: () => void = () => {};
  export let onRefreshSvnBlame: () => void = () => {};
  export let onSelectFile: (path: string) => void = () => {};
  export let onSelectWorkspacePath: (path: string) => void = () => {};
  export let onActiveWorkspacePathChange: (path: string | null) => void = () => {};
  export let onSelectCommitFile: (path: string) => void = () => {};
  export let onUnselectCommitFile: (path: string) => void = () => {};
  export let onSelectCommitFiles: (paths: string[]) => void = () => {};
  export let onUnselectCommitFiles: (paths: string[]) => void = () => {};
  export let onSelectAllCommitFiles: () => void = () => {};
  export let onClearCommitFiles: () => void = () => {};
  export let onAddFile: (path: string) => void = () => {};
  export let onIgnorePath: (path: string) => void = () => {};
  export let onDeletePath: (path: string) => void = () => {};
  export let onMovePath: (path: string) => void = () => {};
  export let onCopyPath: (path: string) => void = () => {};
  export let onRevertFile: (path: string) => void = () => {};
  export let onRevertPaths: (paths: string[]) => void = () => {};
  export let onDeletePaths: (paths: string[]) => void = () => {};
  export let onMovePaths: (paths: string[]) => void = () => {};
  export let onLockFile: (path: string) => void = () => {};
  export let onUnlockFile: (path: string) => void = () => {};
  export let onForceUnlockFile: (path: string) => void = () => {};
  export let onResolveWorking: (path: string) => void = () => {};
  export let onResolveMineFull: (path: string) => void = () => {};
  export let onResolveTheirsFull: (path: string) => void = () => {};
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
  export let onRevisionDiffFormInput: (
    field: keyof typeof revisionDiffForm,
    value: string,
  ) => void = () => {};
  export let onRunRevisionDiff: () => void = () => {};
  export let onPrepareRevisionDiffFromLog: (
    revision: string,
    repositoryPath?: string,
  ) => boolean = () => false;
  export let onPrepareRevisionDiffRange: (
    leftRevision: string,
    rightRevision: string,
  ) => boolean = () => false;
  export let onPrepareWorkingCopyFileRevisionDiff: (
    filePath: string,
    revision: string,
  ) => boolean = () => false;
  export let onRevertToRevision: (revision: string) => void = () => {};
  export let onExportRevisionDiffPatch: () => void = () => {};

  export let onCommitMessageInput: (value: string) => void = () => {};
  export let onCommitTemplateInput: (value: string) => void = () => {};
  export let onUseCommitHistoryMessage: (value: string) => void = () => {};
  export let onConfirmSafetyWarnings: () => void = () => {};
  export let onClearWorkspaceDraft: () => void = () => {};
  export let onCommit: () => void = () => {};
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
  export let onApplySvnAuthentication: () => void = () => {};
  export let onConfirmSvnCertificateTrust: (
    failures: SvnCertificateFailure[],
  ) => Promise<boolean> = async () => false;
  export let onClearSvnCertificateTrust: () => void = () => {};
  export let onAppSettingInput: <K extends keyof AppSettingsState>(
    field: K,
    value: AppSettingsState[K],
  ) => void = () => {};
  export let onExportDiagnosticLog: () => void = () => {};

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

  type WorkingCopyTreeFilter = "all" | "local" | "remote" | "unversioned";
  type InspectorTab = "information" | "properties" | "diff" | "blame" | "commit" | "tasks";
  type WorkspaceTreeRow = WorkspaceFileNode & {
    depth: number;
  };
  type VirtualWindow<T> = {
    items: T[];
    startIndex: number;
    beforeHeight: number;
    afterHeight: number;
  };

  const fileTreeHeaderHeight = 28;
  const fileTreeRowHeight = 32;
  const blameRowHeight = 27;
  const virtualRowOverscan = 8;

  const inspectorTabs: Array<{ id: InspectorTab; label: string }> = [
    { id: "information", label: "Information" },
    { id: "properties", label: "Properties" },
    { id: "diff", label: "Diff" },
    { id: "blame", label: "Blame" },
    { id: "commit", label: "Commit" },
    { id: "tasks", label: "Tasks" },
  ];

  let selectedCommitHistoryMessage = "";
  let activeInspectorTab: InspectorTab = "information";
  let diffInline = false;
  let showWhitespace = false;
  let workingCopyTreeFilter: WorkingCopyTreeFilter = "all";
  let selectedLogRevision: string | null = null;
  let expandedTimelineRevisions = new Set<string>();
  let selectedComparisonRevisions: string[] = [];
  let collapsedTreePaths = new Set<string>();
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
  let workspaceBlameScrollTop = 0;
  let workspaceBlameViewportHeight = 360;
  let repositoryBlameScrollTop = 0;
  let repositoryBlameViewportHeight = 300;
  let virtualizedFileTreeSource: WorkspaceFileTree | null = null;
  let virtualizedWorkspaceBlameSource: SvnBlame | null = null;
  let virtualizedRepositoryBlameSource: SvnBlame | null = null;
  let contextMenuElement: HTMLElement | null = null;
  let commitMessageElement: HTMLTextAreaElement | null = null;
  let commitMessageFocusRequested = false;
  let reportedActiveWorkspacePath: string | null | undefined;
  let selectionWorkspaceRoot: string | null = null;
  let selectionFileTree: WorkspaceFileTree | null = null;
  const inspectorMinWidth = 300;
  const inspectorMaxWidth = 720;
  const sourceListWidth = 220;
  const inspectorDividerWidth = 6;
  const fileBrowserMinWidth = 360;
  let inspectorWidth = 400;
  let inspectorMaximumWidth = inspectorMaxWidth;
  let resizingInspector = false;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;
  let resolvedTheme: "light" | "dark" = "light";
  let inspectorSelectionSignature = "";
  let preparedCertificateSignature: string | null = null;
  let dismissedCertificateSignature: string | null = null;
  let selectedCertificateFailures: SvnCertificateFailure[] = [];
  let certificateRiskConfirmed = false;

  $: if (appSettings.diffMode) {
    diffInline = appSettings.diffMode === "inline";
  }
  $: showWhitespace = appSettings.showWhitespace;
  $: if (typeof window !== "undefined" && appSettings.showSourceList !== undefined) {
    syncInspectorWidthToWindow();
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
    revisionDiffError,
    branchCheckoutError,
    mergeError,
    selectedTask?.error,
    commandErrorText(taskError),
    commandErrorText(commandError),
    commandErrorText(svnError),
    commandErrorText(svnAuthenticationError),
    svnSwitchError,
  ]);
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
  $: if (
    commitMessageFocusRequested &&
    appSettings.showInspector &&
    activeInspectorTab === "commit" &&
    commitMessageElement
  ) {
    commitMessageFocusRequested = false;
    queueMicrotask(() => commitMessageElement?.focus());
  }
  $: {
    const selected = selectedFilePath
      ? selectedFile ?? workingCopyStatus?.files.find((file) => file.path === selectedFilePath)
      : null;
    const selectionSignature = `${selectedFilePath ?? ""}:${selected?.status ?? ""}:${selected?.conflict_kind ?? ""}`;
    if (
      selectionSignature !== inspectorSelectionSignature &&
      selected &&
      (selected.status === "conflicted" || selected.conflict_kind)
    ) {
      activeInspectorTab = "information";
    }
    inspectorSelectionSignature = selectionSignature;
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
    return path.split("/").pop() || path;
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

  function isCommitSelected(path: string, selectedCommitFiles = commitFiles) {
    return selectedCommitFiles.some((file) => file.path === path);
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
    return findTreeNode(workspaceFileTree?.nodes ?? [], path);
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

  function isChangedPath(path: string) {
    return changedFileForPath(path) !== null;
  }

  function groupTimelineEntries(entries: SvnLog["entries"]) {
    const groups = new Map<
      string,
      { key: string; label: string; entries: SvnLog["entries"] }
    >();
    for (const entry of entries) {
      const date = new Date(entry.date);
      const valid = !Number.isNaN(date.getTime());
      const year = valid ? date.getFullYear() : 0;
      const month = valid ? date.getMonth() + 1 : 0;
      const day = valid ? date.getDate() : 0;
      const key = valid
        ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        : "unknown";
      const label = valid ? `${year}年${month}月${day}日` : "日期未知";
      const group = groups.get(key);
      if (group) {
        group.entries.push(entry);
      } else {
        groups.set(key, { key, label, entries: [entry] });
      }
    }
    return [...groups.values()];
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

  function timelineEntryPaths(
    entry: SvnLog["entries"][number],
    expandedRevisions: Set<string>,
  ) {
    return expandedRevisions.has(entry.revision)
      ? entry.changed_paths
      : entry.changed_paths.slice(0, 3);
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

  function selectInspectorTab(tab: InspectorTab, focus = false) {
    if (tab !== "commit") {
      commitMessageFocusRequested = false;
    }
    activeInspectorTab = tab;
    if (focus) {
      queueMicrotask(() => document.getElementById(`inspector-tab-${tab}`)?.focus());
    }
  }

  function handleInspectorTabKeydown(event: KeyboardEvent, tab: InspectorTab) {
    const currentIndex = inspectorTabs.findIndex((item) => item.id === tab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % inspectorTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + inspectorTabs.length) % inspectorTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = inspectorTabs.length - 1;
    } else {
      return;
    }
    selectInspectorTab(inspectorTabs[nextIndex].id, true);
    event.preventDefault();
  }

  function openBlameInspector() {
    selectInspectorTab("blame");
    onRefreshSvnBlame();
  }

  function isLocalChangedPath(path: string) {
    const scope = changedFileForPath(path)?.change_scope;
    return scope === "local" || scope === "both";
  }

  function isCommittablePath(path: string) {
    const file = changedFileForPath(path);
    return !!file && isCommittable(file);
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

  function canDeletePath(node: WorkspaceFileNode | null) {
    return (
      !!node &&
      node.versioned &&
      ["file", "dir"].includes(node.kind) &&
      !["deleted", "missing", "external", "unversioned"].includes(node.status)
    );
  }

  function formatSvnDate(value: string | null) {
    if (!value) {
      return "-";
    }
    return value.replace("T", " ").replace(/\.\d+Z$/, "Z").slice(0, 16);
  }

  function canMovePath(node: WorkspaceFileNode | null) {
    return canDeletePath(node);
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

  function reconcileRowSelection(
    workingCopyRoot: string | null,
    fileTree: WorkspaceFileTree | null,
  ) {
    if (selectionWorkspaceRoot !== workingCopyRoot) {
      selectionWorkspaceRoot = workingCopyRoot;
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

  function toggleSelectedCommitPaths() {
    if (selectedCommittablePaths.length === 0) {
      return;
    }
    if (selectedCommittablePaths.every((path) => isCommitSelected(path, commitFiles))) {
      onUnselectCommitFiles(selectedCommittablePaths);
    } else {
      onSelectCommitFiles(selectedCommittablePaths);
      openCommitForm();
    }
  }

  function openCommitForm() {
    activeInspectorTab = "commit";
    commitMessageFocusRequested = true;
    if (!appSettings.showInspector) {
      onAppSettingInput("showInspector", true);
    }
  }

  function selectCommitFileAndOpen(path: string) {
    onSelectCommitFile(path);
    openCommitForm();
  }

  function rowDomId(path: string) {
    return `workspace-row-${encodeURIComponent(path)}`;
  }

  function reconcileActiveRow(rows: WorkspaceTreeRow[], inspectedPath: string | null) {
    if (activeRowPath && rows.some((row) => row.path === activeRowPath)) {
      return;
    }
    activeRowPath =
      rows.find((row) => row.path === inspectedPath)?.path ?? rows[0]?.path ?? null;
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
  }

  function closeContextMenuOnWindowChange() {
    if (contextMenuPath) {
      closeContextMenu();
    }
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
  ): WorkspaceFileNode[] {
    const query = queryText.trim().toLowerCase();
    return nodes.flatMap((node) => {
      const children = filterTreeNodes(node.children, filter, queryText);
      const selfMatchesSearch = !query || node.path.toLowerCase().includes(query);
      const selfMatchesMode =
        filter === "all" ||
        (filter === "local" &&
          ["local", "both"].includes(node.change_scope) &&
          node.status !== "unversioned") ||
        (filter === "remote" && ["remote", "both"].includes(node.change_scope)) ||
        (filter === "unversioned" && node.status === "unversioned");
      const keepNode =
        children.length > 0 || (selfMatchesSearch && selfMatchesMode);

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

  function applyCommitHistoryMessage() {
    if (!selectedCommitHistoryMessage) {
      return;
    }
    onUseCommitHistoryMessage(selectedCommitHistoryMessage);
    selectedCommitHistoryMessage = "";
  }

  function selectLogEntry(revision: string) {
    selectedLogRevision = revision;
    onPrepareRevisionDiffFromLog(revision);
  }

  function sortComparisonRevisions(revisions: string[]) {
    return [...revisions].sort((left, right) => {
      if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
        const leftValue = BigInt(left);
        const rightValue = BigInt(right);
        return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
      }
      return left.localeCompare(right, undefined, { numeric: true });
    });
  }

  function toggleComparisonRevision(revision: string) {
    const selected = selectedComparisonRevisions.includes(revision);
    const next = selected
      ? selectedComparisonRevisions.filter((item) => item !== revision)
      : selectedComparisonRevisions.length < 2
        ? [...selectedComparisonRevisions, revision]
        : selectedComparisonRevisions;
    selectedComparisonRevisions = next;
    const range = sortComparisonRevisions(next);
    if (range.length === 2) {
      onPrepareRevisionDiffRange(range[0], range[1]);
    }
  }

  function reconcileComparisonRevisions(log: SvnLog | null, selected: string[]) {
    const available = new Set(log?.entries.map((entry) => entry.revision) ?? []);
    const next = selected.filter((revision) => available.has(revision));
    if (next.length !== selected.length) {
      selectedComparisonRevisions = next;
    }
  }

  function clearComparisonRevisions() {
    selectedComparisonRevisions = [];
  }

  function runSelectedRevisionComparison() {
    const range = sortComparisonRevisions(selectedComparisonRevisions);
    if (range.length === 2 && onPrepareRevisionDiffRange(range[0], range[1])) {
      onRunRevisionDiff();
    }
  }

  function selectWorkingCopyRevisionDiffMode() {
    onRevisionDiffFormInput("mode", "working_copy_to_revision");
    onRevisionDiffFormInput("filePath", selectedRevisionComparisonFile ?? "");
  }

  function compareSelectedFileWithRevision(revision: string) {
    if (
      selectedRevisionComparisonFile &&
      onPrepareWorkingCopyFileRevisionDiff(selectedRevisionComparisonFile, revision)
    ) {
      onRunRevisionDiff();
    }
  }

  function openChangedPathRevisionDiff(revision: string, repositoryPath: string) {
    selectedLogRevision = revision;
    if (onPrepareRevisionDiffFromLog(revision, repositoryPath)) {
      onRunRevisionDiff();
    }
  }

  function clearWorkingCopyFilters() {
    workingCopyTreeFilter = "all";
    openRowMenuPath = null;
    onClearFilters();
  }

  function selectWorkingCopyTreeFilter(filter: WorkingCopyTreeFilter) {
    workingCopyTreeFilter = filter;
    openRowMenuPath = null;
  }

  function startInspectorResize(event: MouseEvent) {
    if (!resizingInspector) {
      window.addEventListener("mousemove", resizeInspector);
      window.addEventListener("mouseup", stopInspectorResize);
    }
    resizingInspector = true;
    event.preventDefault();
  }

  function stopInspectorResize() {
    if (!resizingInspector) {
      return;
    }
    resizingInspector = false;
    window.removeEventListener("mousemove", resizeInspector);
    window.removeEventListener("mouseup", stopInspectorResize);
  }

  function resizeInspector(event: MouseEvent) {
    if (!resizingInspector) {
      return;
    }
    inspectorWidth = constrainInspectorWidth(window.innerWidth - event.clientX);
  }

  function adjustInspectorWidth(delta: number) {
    inspectorWidth = constrainInspectorWidth(inspectorWidth + delta);
  }

  function calculateInspectorMaxWidth() {
    const occupiedSourceWidth = appSettings.showSourceList ? sourceListWidth : 0;
    return Math.max(
      inspectorMinWidth,
      Math.min(
        inspectorMaxWidth,
        window.innerWidth - occupiedSourceWidth - inspectorDividerWidth - fileBrowserMinWidth,
      ),
    );
  }

  function constrainInspectorWidth(width: number) {
    return Math.min(Math.max(width, inspectorMinWidth), inspectorMaximumWidth);
  }

  function syncInspectorWidthToWindow() {
    inspectorMaximumWidth = calculateInspectorMaxWidth();
    inspectorWidth = constrainInspectorWidth(inspectorWidth);
  }

  function toggleSourceList() {
    onAppSettingInput("showSourceList", !appSettings.showSourceList);
  }

  function toggleInspector() {
    if (view.id !== "changes") {
      return;
    }
    if (appSettings.showInspector) {
      stopInspectorResize();
    }
    onAppSettingInput("showInspector", !appSettings.showInspector);
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
    stopInspectorResize();
    window.removeEventListener("resize", syncInspectorWidthToWindow);
    window.removeEventListener("resize", closeContextMenuOnWindowChange);
    window.removeEventListener("blur", closeContextMenuOnWindowChange);
    window.removeEventListener("pointerdown", closeContextMenuOnOutsidePointer);
    themeMediaQuery?.removeEventListener("change", syncSystemTheme);
  });

  onMount(() => {
    syncInspectorWidthToWindow();
    window.addEventListener("resize", syncInspectorWidthToWindow);
    window.addEventListener("resize", closeContextMenuOnWindowChange);
    window.addEventListener("blur", closeContextMenuOnWindowChange);
    window.addEventListener("pointerdown", closeContextMenuOnOutsidePointer);
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      syncSystemTheme();
      themeMediaQuery.addEventListener("change", syncSystemTheme);
    }
  });

  $: files = workingCopyStatus?.files ?? [];
  $: filteredTreeNodes = filterTreeNodes(
    workspaceFileTree?.nodes ?? [],
    workingCopyTreeFilter,
    searchText,
  );
  $: treeRows = flattenTreeNodes(filteredTreeNodes, 0, collapsedTreePaths);
  $: if (virtualizedFileTreeSource !== workspaceFileTree) {
    virtualizedFileTreeSource = workspaceFileTree;
    fileBrowserScrollTop = 0;
    if (fileBrowserElement) {
      fileBrowserElement.scrollTop = 0;
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
  $: reconcileRowSelection(workspace?.working_copy_root ?? null, workspaceFileTree);
  $: reconcileActiveRow(treeRows, selectedFilePath);
  $: reportActiveWorkspacePath(activeRowPath);
  $: selectedRowNodes = [...selectedRowPaths]
    .map((path) => treeNodeForPath(path))
    .filter((node): node is WorkspaceFileNode => node !== null);
  $: selectedCommittablePaths = selectedRowNodes
    .filter((node) => isLocalChangedPath(node.path) && isCommittablePath(node.path))
    .map((node) => node.path);
  $: selectedRevertablePaths = selectedRowNodes
    .filter((node) => isLocalChangedPath(node.path) && !isUnversionedPath(node.path))
    .map((node) => node.path);
  $: selectedMovablePaths = collapseSelectedOperationPaths(
    selectedRowNodes.filter((node) => canMovePath(node)).map((node) => node.path),
  );
  $: selectedDeletablePaths = collapseSelectedOperationPaths(
    selectedRowNodes.filter((node) => canDeletePath(node)).map((node) => node.path),
  );
  $: visibleSelectedRowCount = treeRows.filter((row) => selectedRowPaths.has(row.path)).length;
  $: allVisibleRowsSelected = treeRows.length > 0 && visibleSelectedRowCount === treeRows.length;
  $: someVisibleRowsSelected = visibleSelectedRowCount > 0 && !allVisibleRowsSelected;
  $: allSelectedCommitTargets =
    selectedCommittablePaths.length > 0 &&
    selectedCommittablePaths.every((path) => isCommitSelected(path, commitFiles));
  $: commitFileCount = commitFiles.length;
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
  $: reconcileComparisonRevisions(svnLog, selectedComparisonRevisions);
  $: selectedComparisonRange = sortComparisonRevisions(selectedComparisonRevisions);
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
  $: timelineGroups = groupTimelineEntries(filteredLogEntries);
  $: selectedLogEntry =
    filteredLogEntries.find((entry) => entry.revision === selectedLogRevision) ??
    filteredLogEntries[0] ??
    null;
  $: selectedTreeNode = treeNodeForPath(selectedFilePath);
  $: selectedRevisionComparisonFile =
    selectedTreeNode?.kind === "file" && selectedTreeNode.versioned
      ? selectedTreeNode.path
      : null;
  $: contextMenuNode = treeNodeForPath(contextMenuPath);
  $: unconfirmedWarningCount = safetyCheck.warnings.filter(
    (item) => !safetyCheck.confirmedWarningIds.includes(item.id),
  ).length;
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
    runningTaskId !== null || pendingSvnOperationKind !== null || applyPatchRunning;
</script>

<section
  class="versions-workbench"
  data-theme={resolvedTheme}
  data-theme-mode={appSettings.themeMode}
  aria-label="NovaSVN 工作台"
>
  <header class="versions-titlebar" inert={applyPatchDialogOpen}>
    <div class="window-identity">
      <strong>NovaSVN</strong>
      <span>{workspace ? basename(workspace.working_copy_root) : "Subversion Client"}</span>
    </div>
    <nav class="mode-switcher" aria-label="主视图">
      <button
        type="button"
        class:active={view.id === "changes"}
        on:click={() => onSelectView("changes")}
      >
        工作副本
      </button>
      <button
        type="button"
        class:active={view.id === "history"}
        on:click={() => onSelectView("history")}
      >
        时间线
      </button>
      <button
        type="button"
        class:active={view.id === "repository"}
        on:click={() => onSelectView("repository")}
      >
        仓库
      </button>
      <button
        type="button"
        class:active={view.id === "branches" || view.id === "settings"}
        on:click={() => onSelectView("branches")}
      >
        更多
      </button>
    </nav>
    <div class="toolbar-actions" aria-label="工作副本工具栏">
      <button
        type="button"
        class="icon-button"
        aria-label={appSettings.showSourceList ? "隐藏项目侧栏" : "显示项目侧栏"}
        title={appSettings.showSourceList ? "隐藏项目侧栏" : "显示项目侧栏"}
        on:click={toggleSourceList}
      >
        {#if appSettings.showSourceList}
          <PanelLeftClose size={17} strokeWidth={1.8} aria-hidden="true" />
        {:else}
          <PanelLeftOpen size={17} strokeWidth={1.8} aria-hidden="true" />
        {/if}
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label={appSettings.showInspector ? "隐藏检查器" : "显示检查器"}
        title={view.id === "changes"
          ? appSettings.showInspector
            ? "隐藏检查器"
            : "显示检查器"
          : "检查器仅用于工作副本视图"}
        on:click={toggleInspector}
        disabled={view.id !== "changes"}
      >
        {#if appSettings.showInspector}
          <PanelRightClose size={17} strokeWidth={1.8} aria-hidden="true" />
        {:else}
          <PanelRightOpen size={17} strokeWidth={1.8} aria-hidden="true" />
        {/if}
      </button>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <button
        type="button"
        class="icon-button"
        aria-label={statusLoading ? "正在刷新工作副本状态" : "刷新工作副本状态"}
        aria-busy={statusLoading}
        title={statusLoading ? "正在刷新工作副本状态" : "刷新工作副本状态"}
        on:click={onRefreshStatus}
        disabled={!workspace || statusLoading || toolbarLocked}
      >
        {#if statusLoading}
          <LoaderCircle class="toolbar-spinner" size={17} strokeWidth={1.8} aria-hidden="true" />
        {:else}
          <RefreshCw size={17} strokeWidth={1.8} aria-hidden="true" />
        {/if}
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label={updateRunning ? "正在更新工作副本" : "更新工作副本"}
        aria-busy={updateRunning}
        title={updateRunning ? "正在更新工作副本" : "更新工作副本"}
        on:click={onUpdateWorkspace}
        disabled={!workspace || statusLoading || toolbarLocked}
      >
        {#if updateRunning}
          <LoaderCircle class="toolbar-spinner" size={17} strokeWidth={1.8} aria-hidden="true" />
        {:else}
          <Download size={17} strokeWidth={1.8} aria-hidden="true" />
        {/if}
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label={applyPatchRunning ? "正在应用 Patch" : "应用 Patch"}
        aria-busy={applyPatchRunning}
        title={applyPatchRunning ? "正在应用 Patch" : "应用 Patch"}
        on:click={onChooseApplyPatch}
        disabled={!workspace || statusLoading || toolbarLocked}
      >
        {#if applyPatchRunning}
          <LoaderCircle class="toolbar-spinner" size={17} strokeWidth={1.8} aria-hidden="true" />
        {:else}
          <FileUp size={17} strokeWidth={1.8} aria-hidden="true" />
        {/if}
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label={cleanupRunning ? "正在清理工作副本" : "清理工作副本"}
        aria-busy={cleanupRunning}
        title={cleanupRunning ? "正在清理工作副本" : "清理工作副本"}
        on:click={onCleanupWorkspace}
        disabled={!workspace || statusLoading || toolbarLocked}
      >
        {#if cleanupRunning}
          <LoaderCircle class="toolbar-spinner" size={17} strokeWidth={1.8} aria-hidden="true" />
        {:else}
          <Wrench size={17} strokeWidth={1.8} aria-hidden="true" />
        {/if}
      </button>
    </div>
  </header>

  <div class="workspace-location" inert={applyPatchDialogOpen}>
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
    <button type="button" on:click={onChooseWorkspace} disabled={workspaceLoading}>
      选择
    </button>
    <button type="button" class="primary" on:click={onOpenWorkspace} disabled={workspaceLoading}>
      {workspaceLoading ? "打开中" : "打开"}
    </button>
  </div>

  <div
    class="versions-layout"
    class:source-list-hidden={!appSettings.showSourceList}
    inert={applyPatchDialogOpen}
  >
    {#if appSettings.showSourceList}
      <aside class="source-list" aria-label="项目列表">
      <section>
        <h2>项目</h2>
        <button
          type="button"
          class="source-item"
          class:active={view.id === "changes"}
          on:click={() => onSelectView("changes")}
        >
          <span class="source-icon">W</span>
          <span>
            <strong>{workspace ? basename(workspace.working_copy_root) : "打开工作副本"}</strong>
            <small>{workspace?.working_copy_root ?? "选择或输入本地项目目录"}</small>
          </span>
          <em>{workingCopyStatus?.total ?? 0}</em>
        </button>
        {#if branchPool.entries.length > 0}
          {#each branchPool.entries as entry (entry.id)}
            <button
              type="button"
              class="source-item"
              on:click={() => onOpenBranchPoolEntry(entry.local_path)}
            >
              <span class="source-icon">B</span>
              <span>
                <strong>{branchName(entry)}</strong>
                <small>{entry.local_path}</small>
              </span>
              <em>{entry.local_changes}</em>
            </button>
          {/each}
        {/if}
      </section>

      <section class="source-sidebar-meta">
        <h2>状态</h2>
        <p>{backendMessage}</p>
      </section>
      </aside>
    {/if}

    <main class="content-pane" aria-label={view.title}>
      <ErrorNotice error={workspaceError} />
      <ErrorNotice error={statusError} />
      <ErrorNotice error={commandError} />

      {#if view.id === "history"}
        <section class="pane-header">
          <div>
            <h1>时间线</h1>
            <p>{svnLog?.target ?? workspace?.repository_url ?? "读取工作副本历史"}</p>
          </div>
          <div class="pane-actions">
            <button type="button" on:click={onRefreshSvnLog} disabled={!workspace || svnLogLoading}>
              {svnLogLoading ? "读取中" : "读取日志"}
            </button>
            <button
              type="button"
              aria-label="加载更多 Revision"
              on:click={onLoadMoreSvnLog}
              disabled={!workspace || svnLogLoading || !svnLog?.has_more}
            >
              更多
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
        <ErrorNotice error={svnLogError} />

        {#if selectedComparisonRange.length > 0}
          <div
            class="timeline-comparison-selection"
            role="toolbar"
            aria-label="Revision 比较选择"
          >
            <span>
              已选择
              <strong>
                {#if selectedComparisonRange.length === 2}
                  r{selectedComparisonRange[0]} → r{selectedComparisonRange[1]}
                {:else}
                  r{selectedComparisonRange[0]}
                {/if}
              </strong>
            </span>
            <button
              type="button"
              class="primary"
              disabled={selectedComparisonRange.length !== 2 || revisionDiffLoading}
              on:click={runSelectedRevisionComparison}
            >
              {revisionDiffLoading ? "比较中" : "比较选中 Revision"}
            </button>
            <button
              type="button"
              class="timeline-comparison-clear"
              aria-label="清除 Revision 比较选择"
              title="清除 Revision 比较选择"
              on:click={clearComparisonRevisions}
            >
              <X size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        {/if}

        <div class="timeline-layout">
          <section class="timeline-list" aria-label="Revision 列表">
            {#if timelineGroups.length > 0}
              {#each timelineGroups as group (group.key)}
                <section class="timeline-day-group" role="group" aria-label={group.label}>
                  <header class="timeline-day-header">
                    <h2>{group.label}</h2>
                    <span>{group.entries.length} revision{group.entries.length === 1 ? "" : "s"}</span>
                  </header>
                  {#each group.entries as entry (entry.revision)}
                    <article class="timeline-entry">
                      <header class="timeline-entry-header">
                        <span class="timeline-comparison-cell">
                          <input
                            type="checkbox"
                            aria-label={`选择 r${entry.revision} 进行比较`}
                            checked={selectedComparisonRevisions.includes(entry.revision)}
                            disabled={
                              selectedComparisonRevisions.length >= 2 &&
                              !selectedComparisonRevisions.includes(entry.revision)
                            }
                            on:change={() => toggleComparisonRevision(entry.revision)}
                          />
                        </span>
                        <button
                          type="button"
                          class="timeline-entry-summary"
                          class:active={selectedLogEntry?.revision === entry.revision}
                          on:click={() => selectLogEntry(entry.revision)}
                        >
                          <strong>r{entry.revision}</strong>
                          <span class="timeline-author" title={entry.author || undefined}>{entry.author || "-"}</span>
                          <time title={entry.date}>{formatTimelineTime(entry.date)}</time>
                          <span class="timeline-path-count">{entry.changed_paths.length} paths</span>
                        </button>
                        <button
                          type="button"
                          class="timeline-working-copy-compare"
                          aria-label={selectedRevisionComparisonFile
                            ? `比较 ${selectedRevisionComparisonFile} 的工作副本与 r${entry.revision}`
                            : `比较工作副本文件与 r${entry.revision}`}
                          title={selectedRevisionComparisonFile
                            ? `比较 ${selectedRevisionComparisonFile} 的工作副本与 r${entry.revision}`
                            : "先在工作副本中选择版本化文件"}
                          disabled={!selectedRevisionComparisonFile || revisionDiffLoading}
                          on:click={() => compareSelectedFileWithRevision(entry.revision)}
                        >
                          <GitCompareArrows size={15} strokeWidth={2} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          class="timeline-revert-revision"
                          aria-label={`Revert 工作副本到 r${entry.revision}`}
                          title={`Revert 工作副本到 r${entry.revision}`}
                          disabled={!workspace || toolbarLocked}
                          on:click={() => onRevertToRevision(entry.revision)}
                        >
                          <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </header>
                      <p class="timeline-message">{entry.message || "无提交信息"}</p>
                      {#if entry.changed_paths.length > 0}
                        <div
                          class="timeline-changed-paths"
                          aria-label={`r${entry.revision} 改变路径`}
                        >
                          {#each timelineEntryPaths(entry, expandedTimelineRevisions) as path (`${entry.revision}:${path.path}:${path.action}`)}
                            <div class="timeline-changed-path">
                              <span class="change-action">{path.action || "-"}</span>
                              <button
                                type="button"
                                class="timeline-changed-path-button"
                                aria-label={`比较 r${entry.revision} 的 ${path.path}`}
                                disabled={revisionDiffLoading}
                                on:click={() => openChangedPathRevisionDiff(entry.revision, path.path)}
                              >
                                <code>{path.path}</code>
                              </button>
                              <small>{path.kind || "-"}</small>
                            </div>
                          {/each}
                          {#if entry.changed_paths.length > 3}
                            <button
                              type="button"
                              class="timeline-path-toggle"
                              aria-expanded={expandedTimelineRevisions.has(entry.revision)}
                              on:click={() => toggleTimelineEntryPaths(entry.revision)}
                            >
                              {expandedTimelineRevisions.has(entry.revision)
                                ? "收起改变路径"
                                : `展开其余 ${entry.changed_paths.length - 3} 条路径`}
                            </button>
                          {/if}
                        </div>
                      {:else}
                        <p class="muted timeline-no-paths">没有改变路径</p>
                      {/if}
                    </article>
                  {/each}
                </section>
              {/each}
            {:else if svnLogLoading}
              <article class="empty-state">正在读取日志</article>
            {:else if svnLog && svnLog.entries.length > 0}
              <article class="empty-state">没有符合当前过滤条件的 revision</article>
            {:else}
              <article class="empty-state">点击“读取日志”查看修订历史</article>
            {/if}
          </section>

          <aside class="revision-compare" aria-label="Revision 比较">
            <section class="revision-files">
              <div class="section-title">
                <h2>修改文件</h2>
                <span>{selectedLogEntry?.changed_paths.length ?? 0}</span>
              </div>
              {#if selectedLogEntry}
                <strong>r{selectedLogEntry.revision}</strong>
                <div class="revision-file-list">
                  {#each selectedLogEntry.changed_paths as path (`${selectedLogEntry.revision}:${path.path}:${path.action}`)}
                    <div>
                      <span class="change-action">{path.action || "-"}</span>
                      <span>
                        <button
                          type="button"
                          class="revision-path-button"
                          aria-label={`比较 r${selectedLogEntry.revision} 的 ${path.path}`}
                          disabled={revisionDiffLoading}
                          on:click={() => openChangedPathRevisionDiff(selectedLogEntry.revision, path.path)}
                        >
                          {path.path}
                        </button>
                        <small>{path.kind || "-"}</small>
                      </span>
                    </div>
                  {/each}
                  {#if selectedLogEntry.changed_paths.length === 0}
                    <p class="muted">该日志没有返回修改路径。</p>
                  {/if}
                </div>
              {:else}
                <p class="muted">选择一条日志后显示修改文件。</p>
              {/if}
            </section>
            <h2>比较</h2>
            <div class="segmented-control">
              <button
                type="button"
                class:active={revisionDiffForm.mode === "revisions"}
                on:click={() => onRevisionDiffFormInput("mode", "revisions")}
              >
                Revision
              </button>
              <button
                type="button"
                class:active={revisionDiffForm.mode === "working_copy_to_revision"}
                on:click={selectWorkingCopyRevisionDiffMode}
              >
                工作副本
              </button>
              <button
                type="button"
                class:active={revisionDiffForm.mode === "urls"}
                on:click={() => onRevisionDiffFormInput("mode", "urls")}
              >
                URL
              </button>
            </div>

            {#if revisionDiffForm.mode === "urls"}
              <input
                type="url"
                value={revisionDiffForm.leftUrl}
                placeholder="左侧 URL"
                on:input={(event) =>
                  onRevisionDiffFormInput(
                    "leftUrl",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
              <input
                type="url"
                value={revisionDiffForm.rightUrl}
                placeholder="右侧 URL"
                on:input={(event) =>
                  onRevisionDiffFormInput(
                    "rightUrl",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            {:else}
              {#if revisionDiffForm.mode === "working_copy_to_revision"}
                <input
                  type="text"
                  value={revisionDiffForm.filePath}
                  placeholder="未选择文件时比较整个工作副本"
                  aria-label="工作副本比较文件"
                  readonly
                  title={revisionDiffForm.filePath || "未选择文件时比较整个工作副本"}
                />
              {/if}
              {#if revisionDiffForm.mode === "revisions"}
                <input
                  type="url"
                  value={revisionDiffForm.targetUrl}
                  placeholder="比较目标 URL（留空使用工作副本）"
                  aria-label="Revision Diff 目标 URL"
                  on:input={(event) =>
                    onRevisionDiffFormInput(
                      "targetUrl",
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                />
              {/if}
              {#if revisionDiffForm.mode === "revisions"}
                <input
                  type="text"
                  value={revisionDiffForm.leftRevision}
                  placeholder="左侧 revision"
                  on:input={(event) =>
                    onRevisionDiffFormInput(
                      "leftRevision",
                      (event.currentTarget as HTMLInputElement).value,
                    )}
                />
              {/if}
              <input
                type="text"
                value={revisionDiffForm.rightRevision}
                placeholder={workspace?.revision ? `目标 revision，例如 ${workspace.revision}` : "目标 revision"}
                on:input={(event) =>
                  onRevisionDiffFormInput(
                    "rightRevision",
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
            {/if}

            {#if revisionDiffError}
              <p class="inline-error">{revisionDiffError}</p>
            {/if}
            <button type="button" class="primary" on:click={onRunRevisionDiff} disabled={revisionDiffLoading}>
              {revisionDiffLoading ? "比较中" : "比较"}
            </button>
            <button
              type="button"
              class="revision-patch-action"
              on:click={onExportRevisionDiffPatch}
              disabled={
                !revisionDiffResult ||
                (revisionDiffResult.truncated
                  ? !revisionDiffResult.patch_file_path
                  : !revisionDiffResult.diff_text && !revisionDiffResult.patch_file_path)
              }
            >
              {#if revisionDiffResult?.truncated}
                <FolderOpen size={15} strokeWidth={2} aria-hidden="true" />
                显示完整 Patch 位置
              {:else}
                <Download size={15} strokeWidth={2} aria-hidden="true" />
                导出完整 Patch
              {/if}
            </button>
            <div class="revision-result">
              <span>{revisionDiffResult?.file_count ?? 0} 文件</span>
              <span>{revisionDiffResult?.line_count ?? 0} 行</span>
            </div>
            {#if revisionDiffResult?.truncated}
              <div class="revision-patch-location" role="status">
                <strong>界面仅显示截断预览</strong>
                {#if revisionDiffResult.patch_file_path}
                  <span>完整 Patch 已保存为 {revisionDiffResult.patch_file_name ?? "Patch 文件"}</span>
                  <code title={revisionDiffResult.patch_file_path}>{revisionDiffResult.patch_file_path}</code>
                {:else}
                  <span class="inline-error">完整 Patch 文件位置不可用，请查看任务错误。</span>
                {/if}
              </div>
            {/if}
            <pre>{revisionDiffResult?.diff_text || "暂无比较结果"}</pre>
          </aside>
        </div>
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
                    <span role="cell">{line.revision ? `r${line.revision}` : "-"}</span>
                    <span role="cell">{line.author || "-"}</span>
                    <span role="cell" class="blame-line-number">{line.line_number}</span>
                    <span role="cell" class="blame-content">
                      <code title={line.content}>{line.content || " "}</code>
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
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={mergeForm.dryRun}
                on:change={(event) =>
                  onMergeFormInput("dryRun", (event.currentTarget as HTMLInputElement).checked)}
              />
              <span>先 Dry-run</span>
            </label>
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
              {mergeRunning ? "执行中" : mergeForm.dryRun ? "Dry-run" : "Merge"}
            </button>
            {#if mergeResult}
              <div class="merge-result-meta">
                <span>{mergeResult.dry_run ? "Dry-run 预览" : "Merge 结果"}</span>
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
              <pre class="merge-output">{mergeResult.output_text || "svn merge 没有输出。"}</pre>
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
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={appSettings.showSourceList}
                on:change={(event) =>
                  onAppSettingInput(
                    "showSourceList",
                    (event.currentTarget as HTMLInputElement).checked,
                  )}
              />
              <span>显示项目侧栏</span>
            </label>
            <label class="checkbox-row">
              <input
                type="checkbox"
                checked={appSettings.showInspector}
                on:change={(event) =>
                  onAppSettingInput(
                    "showInspector",
                    (event.currentTarget as HTMLInputElement).checked,
                  )}
              />
              <span>显示工作副本检查器</span>
            </label>
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
            <button
              type="button"
              class="primary"
              aria-label="打开提交表单"
              on:click={openCommitForm}
              disabled={commitFormOpenDisabled}
            >
              提交 {commitFileCount > 0 ? commitFileCount : ""}
            </button>
          </div>
        </section>

        <section class="summary-strip" aria-label="工作副本摘要">
          <span><strong>{workingCopyStatus?.local_changes ?? 0}</strong> 本地改动</span>
          <span><strong>{workingCopyStatus?.remote_changes ?? 0}</strong> 远端更新</span>
          <span><strong>{workingCopyStatus?.combined_changes ?? 0}</strong> 同时变化</span>
          <span><strong>{commitFileCount}</strong> 提交目标</span>
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
              class:active={workingCopyTreeFilter === "remote"}
              on:click={() => selectWorkingCopyTreeFilter("remote")}
            >
              远端更新
            </button>
            <button
              type="button"
              class:active={workingCopyTreeFilter === "unversioned"}
              on:click={() => selectWorkingCopyTreeFilter("unversioned")}
            >
              未管理文件
            </button>
          </div>
          <button type="button" on:click={clearWorkingCopyFilters}>清除</button>
          {#if selectedRowPaths.size > 0}
            <div class="batch-action-bar" role="toolbar" aria-label="所选路径批量操作">
            <strong>{selectedRowPaths.size} 个已选</strong>
            <button
              type="button"
              disabled={selectedCommittablePaths.length === 0 || statusLoading || toolbarLocked}
              on:click={toggleSelectedCommitPaths}
            >
              {allSelectedCommitTargets ? "移出 Commit" : "加入 Commit"}
            </button>
            <button
              type="button"
              disabled={selectedRevertablePaths.length === 0 || statusLoading || toolbarLocked}
              on:click={() => onRevertPaths(selectedRevertablePaths)}
            >
              Revert
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
          class:resizing={resizingInspector}
          class:inspector-hidden={!appSettings.showInspector}
          style={`--inspector-width: ${inspectorWidth}px`}
        >
          <div
            bind:this={fileBrowserElement}
            class="file-browser"
            role="treegrid"
            tabindex="0"
            aria-label="工作副本文件树"
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
              <span role="columnheader">Name</span>
              <span role="columnheader">Base</span>
              <span role="columnheader">Last</span>
              <span role="columnheader">Date</span>
              <span role="columnheader">Author</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Size</span>
              <span role="columnheader" aria-label="操作"></span>
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
                          aria-label={`Resolve ${node.path}`}
                          on:click={() => onSelectFile(node.path)}
                        >
                          Resolve
                        </button>
                      {:else if isLocalChangedPath(node.path) && isCommittablePath(node.path)}
                        <label
                          class="commit-target-control"
                          class:active={isCommitSelected(node.path, commitFiles)}
                          class:disabled={statusLoading || toolbarLocked}
                          title="包含在本次提交"
                        >
                          <input
                            type="checkbox"
                            aria-label={`提交目标 ${node.path}`}
                            checked={isCommitSelected(node.path, commitFiles)}
                            disabled={statusLoading || toolbarLocked}
                            on:change={(event) =>
                              event.currentTarget.checked
                                ? selectCommitFileAndOpen(node.path)
                                : onUnselectCommitFile(node.path)}
                          />
                          <span>Commit</span>
                        </label>
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
                    {#if isUnversionedPath(node.path) || isLocalChangedPath(node.path) || canMovePath(node)}
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
                    {#if openRowMenuPath === node.path}
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
                            撤销
                          </button>
                        {/if}
                        {#if canMovePath(node)}
                          <button
                            type="button"
                            role="menuitem"
                            aria-label={`移动${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                            disabled={statusLoading || toolbarLocked}
                            on:click={() => runRowAction(() => onMovePath(node.path))}
                          >
                            移动
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            aria-label={`复制${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                            disabled={statusLoading || toolbarLocked}
                            on:click={() => runRowAction(() => onCopyPath(node.path))}
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            aria-label={`删除${node.kind === "dir" ? "目录" : "文件"} ${node.path}`}
                            disabled={statusLoading || toolbarLocked}
                            on:click={() => runRowAction(() => onDeletePath(node.path))}
                          >
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
            {:else if workspaceFileTree}
              <article class="empty-state">没有匹配的文件</article>
            {:else if workspace}
              <article class="empty-state">点击“刷新”扫描工作副本</article>
            {:else}
              <article class="empty-state">选择或输入 SVN 工作副本目录</article>
            {/if}
          </div>

          {#if appSettings.showInspector}
            <div
              role="slider"
              tabindex="0"
              class="inspector-resizer"
              aria-label="调整右侧面板宽度"
              aria-orientation="horizontal"
              aria-valuemin={inspectorMinWidth}
              aria-valuemax={inspectorMaximumWidth}
              aria-valuenow={inspectorWidth}
              on:mousedown={startInspectorResize}
              on:keydown={(event) => {
                if (event.key === "ArrowLeft") {
                  adjustInspectorWidth(-24);
                  event.preventDefault();
                }
                if (event.key === "ArrowRight") {
                  adjustInspectorWidth(24);
                  event.preventDefault();
                }
                if (event.key === "Home") {
                  inspectorWidth = inspectorMinWidth;
                  event.preventDefault();
                }
                if (event.key === "End") {
                  inspectorWidth = inspectorMaximumWidth;
                  event.preventDefault();
                }
              }}
            ></div>

            <aside class="inspector" aria-label="详情和提交">
            <div class="inspector-tabs" role="tablist" aria-label="检查器面板">
              {#each inspectorTabs as tab (tab.id)}
                <button
                  id={`inspector-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeInspectorTab === tab.id}
                  aria-controls="inspector-panel"
                  tabindex={activeInspectorTab === tab.id ? 0 : -1}
                  class:active={activeInspectorTab === tab.id}
                  on:click={() => selectInspectorTab(tab.id)}
                  on:keydown={(event) => handleInspectorTabKeydown(event, tab.id)}
                >
                  {tab.label}
                </button>
              {/each}
            </div>

            <div
              id="inspector-panel"
              class="inspector-tab-panel"
              role="tabpanel"
              tabindex="0"
              aria-labelledby={`inspector-tab-${activeInspectorTab}`}
            >
            {#if activeInspectorTab === "information"}
            <section class="inspector-section">
              <h2>Information</h2>
              {#if selectedFile || selectedTreeNode}
                <div class="file-card">
                  <strong>{basename(selectedFile?.path ?? selectedTreeNode?.path ?? "")}</strong>
                  <span>{dirname(selectedFile?.path ?? selectedTreeNode?.path ?? "")}</span>
                  <small>
                    {selectedStatusText(selectedFile, selectedTreeNode)} ·
                    {formatBytes(selectedFile?.file_size ?? selectedTreeNode?.file_size ?? null)}
                  </small>
                </div>
                <dl class="information-list">
                  <div>
                    <dt>Type</dt>
                    <dd>{selectedTreeNode?.kind === "dir" ? "目录" : "文件"}</dd>
                  </div>
                  <div>
                    <dt>Base</dt>
                    <dd>{selectedTreeNode?.base_revision ?? selectedTreeNode?.revision ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Last</dt>
                    <dd>{selectedTreeNode?.last_revision ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Author</dt>
                    <dd>{selectedTreeNode?.last_changed_author ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>{formatSvnDate(selectedTreeNode?.last_changed_date ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Lock</dt>
                    <dd>{selectedFile?.lock_owner ?? (selectedFile?.lock_state === "none" ? "未锁定" : selectedFile?.lock_state ?? "-")}</dd>
                  </div>
                </dl>
                <div class="button-row wrap">
                  <button
                    type="button"
                    disabled={!canOpenWorkspaceNode(selectedTreeNode)}
                    on:click={() =>
                      selectedFilePath && onOpenWorkspaceFile(selectedFilePath)}
                  >
                    打开
                  </button>
                  <button
                    type="button"
                    disabled={!canOpenWorkspaceNode(selectedTreeNode)}
                    on:click={() =>
                      selectedFilePath && onOpenFileLocation(selectedFilePath)}
                  >
                    定位
                  </button>
                  {#if selectedFile?.status === "unversioned"}
                    <button type="button" on:click={() => onAddFile(selectedFile.path)}>Add</button>
                  {:else if selectedTreeNode?.kind === "file" && selectedTreeNode.versioned}
                    <button
                      type="button"
                      title="查看逐行修改作者"
                      on:click={openBlameInspector}
                    >
                      Blame
                    </button>
                  {/if}
                  {#if selectedFile && selectedFile.status !== "unversioned"}
                    <button type="button" on:click={() => onLaunchExternalTool("diff", selectedFile.path)}>
                      外部 Diff
                    </button>
                    {#if selectedFile.change_scope === "local" || selectedFile.change_scope === "both"}
                      <button type="button" on:click={() => onRevertFile(selectedFile.path)}>
                        撤销
                      </button>
                    {/if}
                    {#if selectedFileReviewed}
                      <button type="button" on:click={() => onMarkFileUnreviewed(selectedFile.path)}>
                        标为未审
                      </button>
                    {:else}
                      <button type="button" on:click={() => onMarkFileReviewed(selectedFile.path)}>
                        标为已审
                      </button>
                    {/if}
                    {#if selectedFile.lock_state === "none" && !selectedFile.lock_owner}
                      <button type="button" on:click={() => onLockFile(selectedFile.path)}>Lock</button>
                    {:else}
                      <button type="button" on:click={() => onUnlockFile(selectedFile.path)}>Unlock</button>
                      <button type="button" on:click={() => onForceUnlockFile(selectedFile.path)}>
                        Force Unlock
                      </button>
                    {/if}
                  {/if}
                  {#if canIgnorePath(selectedTreeNode)}
                    <button
                      type="button"
                      aria-label={`在工作副本中 Ignore ${selectedTreeNode?.path ?? ""}`}
                      on:click={() => selectedTreeNode && onIgnorePath(selectedTreeNode.path)}
                    >
                      Ignore
                    </button>
                  {/if}
                  {#if canMovePath(selectedTreeNode)}
                    <button
                      type="button"
                      aria-label={`在工作副本中移动 ${selectedTreeNode?.path ?? ""}`}
                      on:click={() => selectedTreeNode && onMovePath(selectedTreeNode.path)}
                    >
                      移动
                    </button>
                    <button
                      type="button"
                      aria-label={`在工作副本中复制 ${selectedTreeNode?.path ?? ""}`}
                      on:click={() => selectedTreeNode && onCopyPath(selectedTreeNode.path)}
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      aria-label={`从工作副本删除 ${selectedTreeNode?.path ?? ""}`}
                      on:click={() => selectedTreeNode && onDeletePath(selectedTreeNode.path)}
                    >
                      删除
                    </button>
                  {/if}
                </div>

                {#if selectedFile && (selectedFile.status === "conflicted" || selectedFile.conflict_kind)}
                  <div class="conflict-actions">
                    <button type="button" on:click={() => onResolveWorking(selectedFile.path)}>
                      使用工作副本
                    </button>
                    <button type="button" on:click={() => onResolveMineFull(selectedFile.path)}>
                      Mine Full
                    </button>
                    <button type="button" on:click={() => onResolveTheirsFull(selectedFile.path)}>
                      Theirs Full
                    </button>
                  </div>
                {/if}
              {:else}
                <p class="muted">选择文件后显示操作。</p>
              {/if}
            </section>
            {/if}

            {#if activeInspectorTab === "blame"}
              <section class="inspector-section blame-section" aria-label="Blame 逐行历史">
                <div class="section-title">
                  <h2>Blame</h2>
                  <button
                    type="button"
                    on:click={onRefreshSvnBlame}
                    disabled={svnBlameLoading || !selectedFilePath || selectedTreeNode?.kind !== "file" || !selectedTreeNode?.versioned}
                  >
                    {svnBlameLoading ? "读取中" : "刷新"}
                  </button>
                </div>
                <ErrorNotice error={svnBlameError} />
                {#if svnBlame}
                  <p class="muted">
                    {svnBlame.target} · {svnBlame.total_lines} 行
                  </p>
                  <div
                    class="blame-table"
                    role="table"
                    aria-label={`${svnBlame.target} Blame`}
                    on:scroll={handleWorkspaceBlameScroll}
                  >
                    <div class="blame-row blame-head" role="row">
                      <span role="columnheader">Revision</span>
                      <span role="columnheader">作者</span>
                      <span role="columnheader">行</span>
                      <span role="columnheader">内容</span>
                    </div>
                    {#if workspaceBlameWindow.beforeHeight > 0}
                      <div class="virtual-list-spacer" style={`height: ${workspaceBlameWindow.beforeHeight}px`} aria-hidden="true"></div>
                    {/if}
                    {#each workspaceBlameWindow.items as line (line.line_number)}
                      <div class="blame-row" role="row" title={formatDate(line.date)}>
                        <span role="cell">{line.revision ? `r${line.revision}` : "-"}</span>
                        <span role="cell">{line.author || "-"}</span>
                        <span role="cell" class="blame-line-number">{line.line_number}</span>
                        <span role="cell" class="blame-content">
                          <code title={line.content}>{line.content || " "}</code>
                        </span>
                      </div>
                    {/each}
                    {#if workspaceBlameWindow.afterHeight > 0}
                      <div class="virtual-list-spacer" style={`height: ${workspaceBlameWindow.afterHeight}px`} aria-hidden="true"></div>
                    {/if}
                  </div>
                  {#if svnBlame.truncated}
                    <p class="muted">仅显示前 {svnBlame.lines.length} 行。</p>
                  {/if}
                {:else if !svnBlameLoading && !svnBlameError}
                  <p class="muted">选择版本控制文件并读取逐行历史。</p>
                {/if}
              </section>
            {/if}

            {#if activeInspectorTab === "diff"}
            <section class="inspector-section diff-section">
              <div class="section-title">
                <h2>Diff</h2>
                <div class="segmented-control compact">
                  <button type="button" class:active={!diffInline} on:click={() => (diffInline = false)}>
                    双栏
                  </button>
                  <button type="button" class:active={diffInline} on:click={() => (diffInline = true)}>
                    行内
                  </button>
                </div>
              </div>
              {#if contentDiffLoading || diffLoading}
                <p class="muted">Diff 加载中</p>
              {:else if contentDiffError}
                <ErrorNotice error={contentDiffError} />
              {:else if diffError}
                <ErrorNotice error={diffError} />
              {:else if selectedFileContentDiff && !selectedFileContentDiff.binary}
                <MonacoDiffViewer
                  contentDiff={selectedFileContentDiff}
                  inlineMode={diffInline}
                  showWhitespace={showWhitespace}
                  theme={resolvedTheme}
                />
              {:else if selectedFileDiff}
                <pre class="text-diff">{selectedFileDiff.text || "没有文本 diff"}</pre>
              {:else}
                <p class="muted">选择改动文件后显示 diff。</p>
              {/if}
            </section>

            {#if selectedFileParsedDiff}
              <section class="inspector-section hunk-section">
                <div class="section-title">
                  <h2>Hunk</h2>
                  <button type="button" on:click={onPreviewSelectedPatch} disabled={selectedPatchLoading}>
                    {selectedPatchLoading ? "生成中" : "预览 Patch"}
                  </button>
                </div>
                {#if parsedDiffError}
                  <ErrorNotice error={parsedDiffError} />
                {/if}
                <div class="hunk-list">
                  {#each selectedFileParsedDiff.hunks as hunk (hunk.id)}
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedHunkIds.includes(hunk.id)}
                        on:change={() =>
                          onToggleHunkSelection(selectedFileParsedDiff.path, hunk.id)}
                      />
                      <span>{hunk.header}</span>
                    </label>
                  {/each}
                </div>
                {#if selectedPatchError}
                  <ErrorNotice error={selectedPatchError} />
                {:else if selectedPatch}
                  <p class="muted">{selectedPatch.file_count} 文件 · {selectedPatch.hunk_count} hunk</p>
                  <button type="button" on:click={onPartialCommit} disabled={partialCommitDisabled}>
                    提交选中 Hunk
                  </button>
                {/if}
              </section>
            {/if}
            {/if}

            {#if activeInspectorTab === "properties"}
            <section class="inspector-section">
              <div class="section-title">
                <h2>Properties</h2>
                <button type="button" on:click={onRefreshSvnProperties} disabled={!workspace || svnPropertiesLoading}>
                  {svnPropertiesLoading ? "读取中" : "读取"}
                </button>
              </div>
              <ErrorNotice error={svnPropertiesError} />
              {#if svnProperties}
                <p class="muted">作用目录：{svnProperties.target}</p>
                <div class="property-list">
                  {#each svnProperties.properties as property (property.name)}
                    <button type="button" on:click={() => onUsePropertyForEdit(property.name, property.value)}>
                      <strong>{property.name}</strong>
                      <span>{property.value}</span>
                    </button>
                  {/each}
                </div>
              {/if}
              <input
                type="text"
                value={propertyEditForm.name}
                placeholder="svn:ignore"
                on:input={(event) =>
                  onPropertyEditInput("name", (event.currentTarget as HTMLInputElement).value)}
              />
              <textarea
                rows="2"
                value={propertyEditForm.value}
                placeholder="属性值，留空保存为删除"
                on:input={(event) =>
                  onPropertyEditInput(
                    "value",
                    (event.currentTarget as HTMLTextAreaElement).value,
                  )}
              ></textarea>
              <button type="button" on:click={onSaveSvnProperty} disabled={!workspace}>
                保存属性
              </button>
            </section>
            {/if}

            {#if activeInspectorTab === "commit"}
            <section class="inspector-section commit-section">
              <div class="section-title">
                <h2>Commit</h2>
                <div class="button-row">
                  <button type="button" on:click={onSelectAllCommitFiles}>全选改动</button>
                  <button type="button" on:click={onClearCommitFiles}>清除选择</button>
                  <button type="button" on:click={onClearWorkspaceDraft}>清空草稿</button>
                </div>
              </div>
              <p class="muted">本次将提交 {commitFiles.length} 个文件</p>
              <input
                type="text"
                value={commitTemplate}
                placeholder="提交模板"
                on:input={(event) =>
                  onCommitTemplateInput((event.currentTarget as HTMLInputElement).value)}
              />
              {#if commitHistory.length > 0}
                <select
                  bind:value={selectedCommitHistoryMessage}
                  on:change={applyCommitHistoryMessage}
                  aria-label="最近提交信息"
                >
                  <option value="">最近提交信息</option>
                  {#each commitHistory as message}
                    <option value={message}>{message}</option>
                  {/each}
                </select>
              {/if}
              <textarea
                bind:this={commitMessageElement}
                rows="4"
                value={commitMessage}
                placeholder="提交信息"
                on:input={(event) =>
                  onCommitMessageInput((event.currentTarget as HTMLTextAreaElement).value)}
              ></textarea>
              {#if commitError}
                <p class="inline-error">{commitError}</p>
              {/if}
              {#if safetyCheck.blockers.length > 0 || safetyCheck.warnings.length > 0}
                <div class="safety-box">
                  {#if safetyCheck.blockers.length > 0}
                    <strong>{safetyCheck.blockers.length} 个阻塞</strong>
                  {/if}
                  {#if safetyCheck.warnings.length > 0}
                    <span>{safetyCheck.warnings.length} 个警告</span>
                  {/if}
                  {#if unconfirmedWarningCount > 0 && safetyCheck.blockers.length === 0}
                    <button type="button" on:click={onConfirmSafetyWarnings}>
                      确认警告
                    </button>
                  {/if}
                </div>
              {/if}
              <button type="button" class="primary full" on:click={onCommit} disabled={commitDisabled}>
                提交
              </button>
            </section>
            {/if}

            {#if activeInspectorTab === "tasks"}
            <section class="inspector-section task-section">
              <div class="section-title">
                <h2>Tasks</h2>
                <span>{tasks.length}</span>
              </div>
              <ErrorNotice error={taskError} />
              {#if activeTask}
                <div class="task-log">
                  <strong>{activeTask.title}</strong>
                  {#each activeTask.logs as log}
                    <p><time>{formatTaskTime(log.created_at)}</time>{log.message}</p>
                  {/each}
                  {#if activeTask.error}
                    <p class="inline-error">{activeTask.error}</p>
                  {/if}
                </div>
              {:else}
                <p class="muted">{backendMessage || "暂无后台任务"}</p>
              {/if}
              <div class="task-list">
                {#each tasks.slice(0, 6) as task (task.task_id)}
                  <button type="button" on:click={() => onSelectTask(task.task_id)}>
                    <span>{task.title}</span>
                    <em>{taskStatusLabels[task.status]}</em>
                    {#if task.status === "pending" || task.status === "running"}
                      <small
                        role="button"
                        tabindex="0"
                        on:click|stopPropagation={() => onCancelTask(task.task_id)}
                        on:keydown|stopPropagation={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            onCancelTask(task.task_id);
                          }
                        }}
                      >
                        取消
                      </small>
                    {/if}
                  </button>
                {/each}
              </div>
            </section>
            {/if}
            </div>
            </aside>
          {/if}
        </section>
      {/if}
    </main>
  </div>

  {#if contextMenuNode}
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
          打开
        </button>
        <button
          type="button"
          role="menuitem"
          on:click={() => runContextMenuAction(() => onOpenFileLocation(contextMenuNode.path))}
        >
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
          Add
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={statusLoading || toolbarLocked}
          on:click={() => runContextMenuAction(() => onIgnorePath(contextMenuNode.path))}
        >
          Ignore
        </button>
      {:else}
        {#if isConflictedPath(contextMenuNode.path)}
          <button
            type="button"
            role="menuitem"
            on:click={() => runContextMenuAction(() => onSelectFile(contextMenuNode.path))}
          >
            Resolve
          </button>
        {/if}
        {#if selectedCommittablePaths.length > 0}
          <button
            type="button"
            role="menuitem"
            disabled={statusLoading}
            on:click={() => runContextMenuAction(toggleSelectedCommitPaths)}
          >
            {allSelectedCommitTargets ? "移出 Commit" : "加入 Commit"}
          </button>
        {/if}
        {#if contextMenuNode.change_scope === "remote" || contextMenuNode.change_scope === "both"}
          <button
            type="button"
            role="menuitem"
            disabled={statusLoading || toolbarLocked}
            on:click={() => runContextMenuAction(() => onUpdatePath(contextMenuNode.path))}
          >
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
          Delete{selectedDeletablePaths.length > 1 ? ` ${selectedDeletablePaths.length} 项` : ""}
        </button>
      {/if}
    </div>
  {/if}

  {#if certificateDialogOpen && detectedCertificateFailure}
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
</section>
