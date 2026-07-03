export type AppView =
  | "changes"
  | "staging"
  | "history"
  | "branches"
  | "repository"
  | "settings";

export type WorkspaceStageFilter = "all" | "staged" | "unstaged";

export type WorkspaceGroupMode = "status" | "directory" | "extension" | "unity";

export type SafetyCheckSeverity = "blocker" | "warning" | "info";

export interface SafetyCheckItem {
  id: string;
  severity: SafetyCheckSeverity;
  title: string;
  detail: string;
  filePath: string | null;
}

export interface SafetyCheckSummary {
  blockers: SafetyCheckItem[];
  warnings: SafetyCheckItem[];
  infos: SafetyCheckItem[];
  confirmedWarningIds: string[];
}

export interface NavigationItem {
  id: AppView;
  label: string;
  description: string;
}

export interface DetailSection {
  title: string;
  description: string;
}

export interface WorkbenchView {
  id: AppView;
  title: string;
  subtitle: string;
  metrics: Array<{
    label: string;
    value: string;
  }>;
  primaryItems: Array<{
    title: string;
    meta: string;
    status: string;
  }>;
}

export interface SidebarFilterStats {
  total: number;
  staged: number;
  unstaged: number;
  abnormal: number;
  unreviewed: number;
  statuses: Array<{
    status: string;
    label: string;
    count: number;
  }>;
}

export interface ReviewedFileState {
  path: string;
  contentDigest: string;
  reviewedAt: number;
}

export interface AppSettingsState {
  svnExecutable: string;
  diffMode: "side_by_side" | "inline";
  showWhitespace: boolean;
  commitTemplate: string;
  largeFileThresholdMb: number;
  unityRulesEnabled: boolean;
  externalDiffTool: string;
  externalMergeTool: string;
  loading: boolean;
}
