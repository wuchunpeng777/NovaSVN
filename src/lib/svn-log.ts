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
