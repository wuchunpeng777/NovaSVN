import { describe, expect, it } from "vitest";
import {
  detectSvnAuthenticationFailure,
  findSvnAuthenticationFailure,
} from "./svn-authentication";

describe("SVN authentication failures", () => {
  it("detects exhausted credentials and extracts a safe identity", () => {
    const detected = detectSvnAuthenticationFailure(
      "svn: E170013: Unable to connect to a repository at URL 'https://alice%40example.com:secret@svn.example.test/repo' svn: E215004: No more credentials or we tried too many times. Authentication failed",
    );

    expect(detected).toEqual({
      signature: "svn.example.test|alice@example.com|authentication",
      hostname: "svn.example.test",
      username: "alice@example.com",
      repositoryUrl: "https://alice%40example.com@svn.example.test/repo",
    });
    expect(JSON.stringify(detected)).not.toContain("secret");
  });

  it("finds Chinese authentication errors without requiring a URL", () => {
    expect(findSvnAuthenticationFailure(["普通 SVN 错误", "认证失败：凭据已失效"])).toEqual({
      signature: "unknown-host|unknown-user|authentication",
      hostname: null,
      username: null,
      repositoryUrl: null,
    });
  });

  it("ignores permission, certificate, and network failures", () => {
    expect(detectSvnAuthenticationFailure("svn: E170001: Authorization failed")).toBeNull();
    expect(
      detectSvnAuthenticationFailure("svn: E230001: Server certificate verification failed"),
    ).toBeNull();
    expect(detectSvnAuthenticationFailure("svn: E170013: Unable to connect to repository")).toBeNull();
  });
});
