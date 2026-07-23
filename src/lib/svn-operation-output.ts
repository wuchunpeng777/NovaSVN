import type { TaskLog } from "../types/api";

export interface SvnFileChange {
  action: string;
  path: string;
}

export function extractSvnFileChanges(
  logs: TaskLog[],
  workingCopyRoot?: string | null,
): SvnFileChange[] {
  const files = new Map<string, SvnFileChange>();
  for (const log of logs) {
    const match = /^([ACDMRUGER!~ ]{1,4})\s+(.+?)\s*$/.exec(log.message);
    if (!match) {
      continue;
    }
    const action = match[1].replaceAll(" ", "");
    const path = normalizeSvnOutputPath(match[2], workingCopyRoot);
    if (action && path) {
      files.set(path, { action, path });
    }
  }
  return [...files.values()];
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
