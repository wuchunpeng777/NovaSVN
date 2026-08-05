export interface DetectedSvnAuthenticationFailure {
  signature: string;
  hostname: string | null;
  username: string | null;
  /** 从错误信息中提取的仓库 URL（已剥离密码），便于用户确认目标仓库 */
  repositoryUrl: string | null;
}

const authenticationMarkers = [
  "e215004",
  "authentication failed",
  "could not authenticate",
  "no more credentials",
  "credentials were rejected",
  "认证失败",
  "凭据无效",
  "凭据已失效",
];

export function findSvnAuthenticationFailure(
  errors: Array<string | null | undefined>,
): DetectedSvnAuthenticationFailure | null {
  for (const error of errors) {
    const detected = detectSvnAuthenticationFailure(error);
    if (detected) {
      return detected;
    }
  }
  return null;
}

export function detectSvnAuthenticationFailure(
  error: string | null | undefined,
): DetectedSvnAuthenticationFailure | null {
  const value = error?.trim();
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (!authenticationMarkers.some((marker) => normalized.includes(marker))) {
    return null;
  }

  const identity = extractRepositoryIdentity(value);
  return {
    signature: `${identity.hostname ?? "unknown-host"}|${identity.username ?? "unknown-user"}|authentication`,
    hostname: identity.hostname,
    username: identity.username,
    repositoryUrl: identity.repositoryUrl,
  };
}

function extractRepositoryIdentity(value: string) {
  // 优先匹配 URL 字面量（含 http / https / svn / svn+ssh）
  const match = value.match(
    /(?:https?|svn(?:\+ssh)?):\/\/[^\s'"<>]+/i,
  );
  if (!match) {
    return { hostname: null, username: null, repositoryUrl: null };
  }
  try {
    const raw = match[0].replace(/[.,;]+$/, "");
    const url = new URL(raw);
    const username = decodeUrlComponent(url.username);
    // 绝不把密码带回 UI
    url.password = "";
    const repositoryUrl = url.toString().replace(/\/$/, "") || null;
    return {
      hostname: url.hostname || null,
      username,
      repositoryUrl,
    };
  } catch {
    return { hostname: null, username: null, repositoryUrl: null };
  }
}

function decodeUrlComponent(value: string) {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
