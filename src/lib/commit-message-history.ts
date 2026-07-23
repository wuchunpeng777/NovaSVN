export const COMMIT_MESSAGE_SETTINGS_KEY = "novasvn:commit-message-settings";
export const PENDING_COMMIT_MESSAGE_KEY = "novasvn:pending-commit-message";
export const COMMIT_MESSAGE_SELECTED_EVENT = "novasvn-commit-message-selected";

export interface CommitMessageSettings {
  template: string;
  history: string[];
}

interface StoredCommitMessageSettings extends CommitMessageSettings {
  project_histories: Record<string, string[]>;
}

export function readCommitMessageSettings(workingCopyRoot?: string): CommitMessageSettings {
  const settings = readStoredCommitMessageSettings();
  const projectKey = normalizeWorkingCopyRoot(workingCopyRoot);
  return {
    template: settings.template,
    history: projectKey ? settings.project_histories[projectKey] ?? [] : settings.history,
  };
}

export function writeCommitMessageSettings(
  settings: CommitMessageSettings,
  workingCopyRoot?: string,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const current = readStoredCommitMessageSettings();
    const projectKey = normalizeWorkingCopyRoot(workingCopyRoot);
    const projectHistories = projectKey
      ? {
          ...current.project_histories,
          [projectKey]: normalizeHistory(settings.history),
        }
      : current.project_histories;
    window.localStorage.setItem(
      COMMIT_MESSAGE_SETTINGS_KEY,
      JSON.stringify({
        template: settings.template,
        history: projectKey ? current.history : normalizeHistory(settings.history),
        project_histories: projectHistories,
      }),
    );
  } catch {
    // 本地设置保存失败不应阻断提交或日志浏览。
  }
}

export function cacheCommitMessages(messages: string[], workingCopyRoot?: string) {
  const current = readCommitMessageSettings(workingCopyRoot);
  const history = normalizeHistory([...messages, ...current.history]);
  writeCommitMessageSettings({ ...current, history }, workingCopyRoot);
  return history;
}

function readStoredCommitMessageSettings(): StoredCommitMessageSettings {
  if (typeof window === "undefined") {
    return { template: "", history: [], project_histories: {} };
  }

  try {
    const raw = window.localStorage.getItem(COMMIT_MESSAGE_SETTINGS_KEY);
    if (!raw) {
      return { template: "", history: [], project_histories: {} };
    }
    const parsed = JSON.parse(raw) as Partial<StoredCommitMessageSettings>;
    return {
      template: typeof parsed.template === "string" ? parsed.template : "",
      history: normalizeHistory(parsed.history),
      project_histories: normalizeProjectHistories(parsed.project_histories),
    };
  } catch {
    return { template: "", history: [], project_histories: {} };
  }
}

function normalizeProjectHistories(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([root, history]) => [normalizeWorkingCopyRoot(root), normalizeHistory(history)] as const)
      .filter(([root]) => Boolean(root)),
  );
}

export function setPendingCommitMessage(message: string, notifyCurrentWindow = true) {
  const normalized = message.trim();
  if (!normalized || typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PENDING_COMMIT_MESSAGE_KEY, normalized);
    if (notifyCurrentWindow) {
      window.dispatchEvent(new Event(COMMIT_MESSAGE_SELECTED_EVENT));
    }
  } catch {
    // 本地缓存不可用时不影响日志浏览。
  }
}

export function consumePendingCommitMessage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const message = window.localStorage.getItem(PENDING_COMMIT_MESSAGE_KEY)?.trim() ?? "";
    if (!message) {
      return null;
    }
    window.localStorage.removeItem(PENDING_COMMIT_MESSAGE_KEY);
    return message;
  } catch {
    return null;
  }
}

function normalizeHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )].slice(0, 50);
}

function normalizeWorkingCopyRoot(value: string | undefined) {
  let normalized = value?.trim().replace(/\\/g, "/") ?? "";
  if (normalized !== "/") {
    normalized = normalized.replace(/\/+$/, "");
  }
  if (/^[a-z]:(?:\/|$)/i.test(normalized) || normalized.startsWith("//")) {
    return normalized.toLocaleLowerCase("en-US");
  }
  return normalized;
}
