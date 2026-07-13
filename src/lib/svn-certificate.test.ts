import { describe, expect, it } from "vitest";

import { detectSvnCertificateFailure, findSvnCertificateFailure } from "./svn-certificate";

describe("SVN certificate failures", () => {
  it("extracts host, fingerprint, and exact failure types", () => {
    const detected = detectSvnCertificateFailure(`svn: E230001: Error validating server certificate for 'https://alice:secret@svn.example.test/repo':
 - The certificate is not issued by a trusted authority.
 - The certificate hostname does not match.
Certificate information:
 - Hostname: svn.example.test
 - Fingerprint: AA:BB:CC`);

    expect(detected).toEqual({
      signature: "svn.example.test|AA:BB:CC|unknown-ca|cn-mismatch",
      hostname: "svn.example.test",
      fingerprint: "AA:BB:CC",
      failures: ["unknown-ca", "cn-mismatch"],
    });
    expect(JSON.stringify(detected)).not.toContain("secret");
  });

  it("falls back to other for unclassified certificate errors", () => {
    expect(
      findSvnCertificateFailure([
        "普通 SVN 错误",
        "svn: E230001: Server certificate verification failed for https://svn.example.test/repo",
      ]),
    ).toMatchObject({
      hostname: "svn.example.test",
      failures: ["other"],
    });
  });

  it("ignores unrelated errors", () => {
    expect(detectSvnCertificateFailure("svn: E170001: Authentication failed")).toBeNull();
  });
});
