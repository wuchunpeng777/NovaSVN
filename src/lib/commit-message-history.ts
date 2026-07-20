export const COMMIT_MESSAGE_SETTINGS_KEY = "novasvn:commit-message-settings";
export const PENDING_COMMIT_MESSAGE_KEY = "novasvn:pending-commit-message";
export const COMMIT_MESSAGE_SELECTED_EVENT = "novasvn-commit-message-selected";

export interface CommitMessageSettings {
  template: string;
  history: string[];
}

export function readCommitMessageSettings(): CommitMessageSettings {
  if (typeof window === "undefined") {
    return { template: "", history: [] };
  }

  try {
    const raw = window.localStorage.getItem(COMMIT_MESSAGE_SETTINGS_KEY);
    if (!raw) {
      return { template: "", history: [] };
    }
    const parsed = JSON.parse(raw) as Partial<CommitMessageSettings>;
    return {
      template: typeof parsed.template === "string" ? parsed.template : "",
      history: normalizeHistory(parsed.history),
    };
  } catch {
    return { template: "", history: [] };
  }
}

export function writeCommitMessageSettings(settings: CommitMessageSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      COMMIT_MESSAGE_SETTINGS_KEY,
      JSON.stringify({
        template: settings.template,
        history: normalizeHistory(settings.history),
      }),
    );
  } catch {
    // 本地设置保存失败不应阻断提交或日志浏览。
  }
}

export function cacheCommitMessages(messages: string[]) {
  const current = readCommitMessageSettings();
  const history = normalizeHistory([...messages, ...current.history]);
  writeCommitMessageSettings({ ...current, history });
  return history;
}

export function setPendingCommitMessage(message: string) {
  const normalized = message.trim();
  if (!normalized || typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(PENDING_COMMIT_MESSAGE_KEY, normalized);
    window.dispatchEvent(new Event(COMMIT_MESSAGE_SELECTED_EVENT));
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
