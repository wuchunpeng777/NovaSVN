export type AppView =
  | "changes"
  | "staging"
  | "history"
  | "branches"
  | "repository";

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
