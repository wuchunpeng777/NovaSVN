import type { SvnCertificateFailure } from "../types/api";

export interface DetectedSvnCertificateFailure {
  signature: string;
  hostname: string | null;
  fingerprint: string | null;
  failures: SvnCertificateFailure[];
}

const certificateMarkers = [
  "e230001",
  "error validating server certificate",
  "server certificate verification failed",
  "certificate verification failed",
  "ssl certificate problem",
  "certificate is not trusted",
  "服务器证书验证失败",
  "证书验证失败",
];

export function findSvnCertificateFailure(
  errors: Array<string | null | undefined>,
): DetectedSvnCertificateFailure | null {
  for (const error of errors) {
    const detected = detectSvnCertificateFailure(error);
    if (detected) {
      return detected;
    }
  }
  return null;
}

export function detectSvnCertificateFailure(
  error: string | null | undefined,
): DetectedSvnCertificateFailure | null {
  const value = error?.trim();
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (!certificateMarkers.some((marker) => normalized.includes(marker))) {
    return null;
  }

  const failures = classifyCertificateFailures(normalized);
  const hostname = extractCertificateField(value, "Hostname") ?? extractHttpsHostname(value);
  const fingerprint = extractCertificateField(value, "Fingerprint");
  const signature = [hostname ?? "unknown-host", fingerprint ?? "no-fingerprint", ...failures].join(
    "|",
  );
  return { signature, hostname, fingerprint, failures };
}

export function svnCertificateFailureLabel(failure: SvnCertificateFailure) {
  const labels: Record<SvnCertificateFailure, string> = {
    "unknown-ca": "未知签发机构",
    "cn-mismatch": "主机名不匹配",
    expired: "证书已过期",
    "not-yet-valid": "证书尚未生效",
    other: "其他证书错误",
  };
  return labels[failure];
}

function classifyCertificateFailures(normalized: string): SvnCertificateFailure[] {
  const failures: SvnCertificateFailure[] = [];
  if (
    includesAny(normalized, [
      "not issued by a trusted authority",
      "unknown authority",
      "unknown ca",
      "self-signed certificate",
      "unable to get local issuer certificate",
      "未知签发机构",
      "不受信任的签发机构",
    ])
  ) {
    failures.push("unknown-ca");
  }
  if (
    includesAny(normalized, [
      "hostname mismatch",
      "hostname does not match",
      "issued for a different hostname",
      "certificate name mismatch",
      "主机名不匹配",
    ])
  ) {
    failures.push("cn-mismatch");
  }
  if (includesAny(normalized, ["certificate has expired", "certificate is expired", "证书已过期"])) {
    failures.push("expired");
  }
  if (
    includesAny(normalized, [
      "certificate is not yet valid",
      "certificate has not yet become valid",
      "证书尚未生效",
    ])
  ) {
    failures.push("not-yet-valid");
  }
  return failures.length > 0 ? failures : ["other"];
}

function includesAny(value: string, markers: string[]) {
  return markers.some((marker) => value.includes(marker));
}

function extractCertificateField(value: string, field: string) {
  const match = value.match(
    new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?${field}:\\s*([^\\r\\n]+)`, "i"),
  );
  return match?.[1]?.trim() || null;
}

function extractHttpsHostname(value: string) {
  const match = value.match(/https:\/\/[^\s'"<>]+/i);
  if (!match) {
    return null;
  }
  try {
    return new URL(match[0]).hostname || null;
  } catch {
    return null;
  }
}
