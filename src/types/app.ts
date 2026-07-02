export type AppView =
  | "changes"
  | "staging"
  | "history"
  | "branches"
  | "repository";

export type WorkspaceStageFilter = "all" | "staged" | "unstaged";

export type WorkspaceGroupMode = "status" | "directory" | "extension";

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
