export interface DetectedSvnAuthenticationFailure {
  signature: string;
  hostname: string | null;
  username: string | null;
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

  const identity = extractHttpsIdentity(value);
  return {
    signature: `${identity.hostname ?? "unknown-host"}|${identity.username ?? "unknown-user"}|authentication`,
    hostname: identity.hostname,
    username: identity.username,
  };
}

function extractHttpsIdentity(value: string) {
  const match = value.match(/https:\/\/[^\s'"<>]+/i);
  if (!match) {
    return { hostname: null, username: null };
  }
  try {
    const url = new URL(match[0]);
    return {
      hostname: url.hostname || null,
      username: decodeUrlComponent(url.username),
    };
  } catch {
    return { hostname: null, username: null };
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
