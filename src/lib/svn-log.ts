import type { SvnChangedPath, SvnLog } from "../types/api";

export const LOG_FILE_DIFF_MAX_BYTES = 20 * 1024 * 1024;

export interface SvnChangeActionSummary {
  action: "A" | "M" | "D";
  count: number;
}

export interface RepositoryPathLogTarget {
  repositoryUrl: string;
  revision: string;
}

/** 规范化用户输入的 SVN revision。空 / HEAD → ""；r123 / 123 → "123"；非法 → null。 */
export function normalizeSvnRevisionInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /^HEAD$/i.test(trimmed)) {
    return "";
  }
  const digits = trimmed.replace(/^r/i, "");
  if (!/^\d+$/.test(digits)) {
    return null;
  }
  return digits;
}

export function resolveWorkingCopyLogRevision(
  entries: SvnLog["entries"],
  workingCopyRevision: string | null | undefined,
) {
  const baseline = normalizeRevisionNumber(workingCopyRevision);
  if (baseline === null) {
    return null;
  }
  let effective: bigint | null = null;
  let effectiveText: string | null = null;
  for (const entry of entries) {
    const revision = normalizeRevisionNumber(entry.revision);
    if (revision !== null && revision <= baseline && (effective === null || revision > effective)) {
      effective = revision;
      effectiveText = revision.toString();
    }
  }
  return effectiveText;
}

function normalizeRevisionNumber(value: string | null | undefined) {
  const revisions = value?.trim().replace(/^r/i, "").match(/\d+/g);
  const revision = revisions?.at(-1);
  return revision ? BigInt(revision) : null;
}

export function mergeSvnLogPage(current: SvnLog, next: SvnLog): SvnLog {
  const revisions = new Set(current.entries.map((entry) => entry.revision));
  const appendedEntries = next.entries.filter((entry) => {
    if (revisions.has(entry.revision)) {
      return false;
    }
    revisions.add(entry.revision);
    return true;
  });

  return {
    ...next,
    target: current.target,
    entries: [...current.entries, ...appendedEntries],
  };
}

export async function loadAllSvnLogPages(
  initial: SvnLog,
  loadPage: (startRevision: string) => Promise<SvnLog>,
  onPage?: (log: SvnLog) => void,
  shouldContinue: () => boolean = () => true,
): Promise<SvnLog> {
  let current = initial;
  const requestedRevisions = new Set<string>();

  while (current.has_more && current.next_start_revision && shouldContinue()) {
    const startRevision = current.next_start_revision;
    if (requestedRevisions.has(startRevision)) {
      break;
    }
    requestedRevisions.add(startRevision);

    const next = await loadPage(startRevision);
    if (!shouldContinue()) {
      break;
    }
    current = mergeSvnLogPage(current, next);
    onPage?.(current);
  }

  return current;
}

export function summarizeSvnChangeActions(
  paths: SvnChangedPath[],
): SvnChangeActionSummary[] {
  const counts = { A: 0, M: 0, D: 0 };
  for (const path of paths) {
    const action = path.action.toUpperCase();
    if (action === "A" || action === "M" || action === "D") {
      counts[action] += 1;
    }
  }
  return (["A", "M", "D"] as const)
    .map((action) => ({ action, count: counts[action] }))
    .filter((summary) => summary.count > 0);
}

/** Suggest a local export path under parentDirectory based on the repository URL leaf name. */
export function suggestExportLocalPath(
  repositoryUrl: string,
  parentDirectory: string,
  revision?: string | null,
) {
  const parent = parentDirectory.trim().replace(/[\\/]+$/, "");
  if (!parent) {
    return "";
  }

  const pathSegments = repositoryUrl
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const leaf = pathSegments.at(-1) ?? "export";
  const safeLeaf = leaf.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  const normalizedRevision = revision?.trim().replace(/^r/i, "") ?? "";
  const directoryName =
    normalizedRevision && /^\d+$/.test(normalizedRevision)
      ? `${safeLeaf}-r${normalizedRevision}`
      : safeLeaf;
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent}${separator}${directoryName}`;
}

/** Repository-absolute path of the log target, e.g. `/trunk/src`. `/` means repository root. */
export function logTargetRepositoryPath(
  repositoryRoot: string | null | undefined,
  repositoryUrl: string | null | undefined,
) {
  const root = normalizeRepositoryUrl(repositoryRoot);
  const url = normalizeRepositoryUrl(repositoryUrl);
  if (!root || !url) {
    return null;
  }
  if (url === root) {
    return "/";
  }
  if (!url.startsWith(`${root}/`)) {
    return null;
  }
  const remainder = url.slice(root.length);
  return remainder || "/";
}

/** True when a changed path is under the log target folder (or is the target file). Unknown scope stays visible. */
export function isChangedPathInLogTarget(
  changedPath: string,
  targetRepositoryPath: string | null | undefined,
) {
  if (targetRepositoryPath == null || targetRepositoryPath === "" || targetRepositoryPath === "/") {
    return true;
  }
  const path = normalizeRepositoryPath(changedPath);
  const target = normalizeRepositoryPath(targetRepositoryPath);
  if (!path || !target || target === "/") {
    return true;
  }
  return path === target || path.startsWith(`${target}/`);
}

function normalizeRepositoryUrl(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  return decodeRepositoryValue(trimmed.replace(/\/+$/, "").replace(/@\d+$/, ""));
}

function normalizeRepositoryPath(value: string) {
  const trimmed = decodeRepositoryValue(value.trim().replaceAll("\\", "/"));
  if (!trimmed) {
    return "";
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

function decodeRepositoryValue(value: string) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

export function repositoryPathUrl(
  repositoryRoot: string | null | undefined,
  repositoryPath: string,
) {
  const root = repositoryRoot?.trim().replace(/\/+$/, "");
  if (
    !root ||
    !repositoryPath.startsWith("/") ||
    repositoryPath.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(repositoryPath)
  ) {
    return null;
  }
  const segments = repositoryPath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return segments.length > 0
    ? `${root}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`
    : root;
}

export function revisionBefore(revision: string) {
  const normalized = revision.trim();
  return /^[1-9]\d*$/.test(normalized)
    ? (BigInt(normalized) - 1n).toString()
    : null;
}

export function repositoryPathUrlAtRevision(
  repositoryRoot: string | null | undefined,
  repositoryPath: string,
  revision: string,
  action: string,
) {
  const target = repositoryPathLogTarget(
    repositoryRoot,
    repositoryPath,
    revision,
    action,
  );
  return target ? `${target.repositoryUrl}@${target.revision}` : null;
}

export function repositoryPathLogTarget(
  repositoryRoot: string | null | undefined,
  repositoryPath: string,
  revision: string,
  action: string,
): RepositoryPathLogTarget | null {
  const url = repositoryPathUrl(repositoryRoot, repositoryPath);
  const previousRevision = revisionBefore(revision);
  if (!url || !previousRevision) {
    return null;
  }
  const pegRevision = action.toUpperCase() === "D" ? previousRevision : revision.trim();
  return { repositoryUrl: url, revision: pegRevision };
}
