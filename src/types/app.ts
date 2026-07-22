import type { PendingSvnOperationKind } from "./api";

export type AppView =
  | "changes"
  | "history"
  | "branches"
  | "repository"
  | "settings";

export type WorkspaceGroupMode = "status" | "directory" | "extension";

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

export interface ReviewedFileState {
  path: string;
  contentDigest: string;
  reviewedAt: number;
}

export interface SvnOperationFeedback {
  kind: PendingSvnOperationKind;
  phase: "running" | "success" | "error";
  title: string;
  detail: string;
}

export interface AppSettingsState {
  svnExecutable: string;
  svnAuthenticationMode: "system" | "password" | "ssh";
  svnUsername: string;
  svnRememberPassword: boolean;
  diffMode: "side_by_side" | "inline";
  showWhitespace: boolean;
  themeMode: "system" | "light" | "dark";
  showSourceList: boolean;
  showInspector: boolean;
  commitTemplate: string;
  branchPoolBasePath: string;
  largeFileThresholdMb: number;
  externalDiffTool: string;
  externalMergeTool: string;
  diagnosticExportPath: string;
  diagnosticExportError: string | null;
  validationErrors: {
    svnExecutable: string | null;
    svnUsername: string | null;
    branchPoolBasePath: string | null;
    externalDiffTool: string | null;
    externalMergeTool: string | null;
  };
  loading: boolean;
}
