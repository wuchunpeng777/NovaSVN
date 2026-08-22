import type { TaskLog } from "../types/api";

export interface SvnFileChange {
  action: string;
  path: string;
}

export function extractSvnFileChanges(
  logs: TaskLog[],
  workingCopyRoot?: string | null,
): SvnFileChange[] {
  return extractSvnFileChangesFromText(
    logs.map((log) => log.message),
    workingCopyRoot,
  );
}

export function extractSvnFileChangesFromText(
  lines: string[],
  workingCopyRoot?: string | null,
): SvnFileChange[] {
  const files = new Map<string, SvnFileChange>();
  for (const line of lines) {
    const match = /^([ACDMRUGER!~ ]{1,4})(?:\s*\+\s+|\s+)(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const action = match[1].replaceAll(" ", "");
    const path = normalizeSvnOutputPath(match[2], workingCopyRoot);
    if (action && path && !path.startsWith("+")) {
      files.set(path, { action, path });
    }
  }
  return [...files.values()];
}

/** True when SVN finished the operation but reported text/tree/property conflicts. */
export function svnOutputReportsConflicts(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("summary of conflicts:") ||
    lower.includes("tree conflicts:") ||
    lower.includes("text conflicts:") ||
    lower.includes("property conflicts:") ||
    lower.includes("remains in conflict")
  );
}

export function normalizeSvnOutputPath(path: string, workingCopyRoot?: string | null) {
  let normalizedPath = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const normalizedRoot = workingCopyRoot
    ?.trim()
    .replaceAll("\\", "/")
    .replace(/\/+$/, "");
  if (!normalizedRoot) {
    return normalizedPath;
  }
  const windowsPath = /^[a-z]:\//i.test(normalizedRoot) || normalizedRoot.startsWith("//");
  const comparablePath = windowsPath ? normalizedPath.toLocaleLowerCase("en-US") : normalizedPath;
  const comparableRoot = windowsPath ? normalizedRoot.toLocaleLowerCase("en-US") : normalizedRoot;
  if (comparablePath.startsWith(`${comparableRoot}/`)) {
    normalizedPath = normalizedPath.slice(normalizedRoot.length + 1);
  }
  return normalizedPath;
}

/** Convert merge output paths to working-copy-relative paths used by status/diff APIs. */
export function workingCopyRelativeSvnPath(
  path: string,
  options: {
    workingCopyRoot?: string | null;
    targetPath?: string | null;
    relativePath?: string | null;
  } = {},
): string {
  const strippedFromTarget = normalizeSvnOutputPath(path, options.targetPath);
  const strippedFromRoot = normalizeSvnOutputPath(
    strippedFromTarget,
    options.workingCopyRoot,
  );
  const normalized = comparableSvnPath(strippedFromRoot) || ".";
  const prefix = comparableSvnPath(options.relativePath ?? "");
  if (!prefix) {
    return normalized;
  }
  if (normalized === ".") {
    return prefix;
  }
  const comparablePath = normalized.toLocaleLowerCase("en-US");
  const comparablePrefix = prefix.toLocaleLowerCase("en-US");
  if (comparablePath === comparablePrefix || comparablePath.startsWith(`${comparablePrefix}/`)) {
    return normalized;
  }
  return `${prefix}/${normalized}`;
}

export function svnPathsReferToSameFile(left: string, right: string): boolean {
  return comparableSvnPath(left).toLocaleLowerCase("en-US")
    === comparableSvnPath(right).toLocaleLowerCase("en-US");
}

function comparableSvnPath(path: string) {
  return path
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}
