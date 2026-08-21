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
