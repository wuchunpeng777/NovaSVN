/** 远端仓库 URL 拼接与导航辅助。 */

export function isRepositoryUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return /^(https?|svn|svn\+ssh|file):\/\//i.test(trimmed);
}

export function joinRepositoryUrl(root: string, path: string): string {
  const normalizedPath = path
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(decodeRepositorySegment(segment)))
    .join("/");
  if (!normalizedPath) {
    return root.replace(/\/+$/, "");
  }
  return `${root.replace(/\/+$/, "")}/${normalizedPath}`;
}

export function parentRepositoryUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  const schemeIndex = normalized.indexOf("://");
  const minIndex = schemeIndex >= 0 ? schemeIndex + 3 : 0;
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex > minIndex ? normalized.slice(0, separatorIndex) : normalized;
}

export function repositoryBreadcrumbs(url: string): Array<{ label: string; url: string }> {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) {
    return [];
  }

  const schemeIndex = normalized.indexOf("://");
  if (schemeIndex < 0) {
    return [{ label: normalized, url: normalized }];
  }

  const authorityEnd = normalized.indexOf("/", schemeIndex + 3);
  if (authorityEnd < 0) {
    return [{ label: normalized, url: normalized }];
  }

  const crumbs: Array<{ label: string; url: string }> = [];
  const root = normalized.slice(0, authorityEnd);
  crumbs.push({ label: root, url: root });

  const remainder = normalized.slice(authorityEnd + 1);
  if (!remainder) {
    return crumbs;
  }

  let current = root;
  for (const segment of remainder.split("/").filter(Boolean)) {
    current = `${current}/${segment}`;
    crumbs.push({
      label: decodeRepositorySegment(segment),
      url: current,
    });
  }
  return crumbs;
}

export function repositoryEntryKindLabel(kind: string): string {
  if (kind === "dir") {
    return "目录";
  }
  if (kind === "file") {
    return "文件";
  }
  return kind || "条目";
}

function decodeRepositorySegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
