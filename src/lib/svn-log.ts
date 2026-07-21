import type { SvnChangedPath } from "../types/api";

export interface SvnChangeActionSummary {
  action: "A" | "M" | "D";
  count: number;
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
  const url = repositoryPathUrl(repositoryRoot, repositoryPath);
  const previousRevision = revisionBefore(revision);
  if (!url || !previousRevision) {
    return null;
  }
  const pegRevision = action.toUpperCase() === "D" ? previousRevision : revision.trim();
  return `${url}@${pegRevision}`;
}
