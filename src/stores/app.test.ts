import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  detectSvn: vi.fn(),
}));

import { detectSvn } from "../lib/api";
import { isSameRepositoryUrl, revisionDiffPatchFileName, svnStore } from "./app";

const detectSvnMock = vi.mocked(detectSvn);

beforeEach(() => {
  detectSvnMock.mockReset();
  svnStore.setExecutableInput("");
});

describe("revisionDiffPatchFileName", () => {
  it("uses sanitized revision diff mode and target", () => {
    vi.setSystemTime(new Date("2026-07-03T00:00:00Z"));

    const name = revisionDiffPatchFileName({
      mode: "urls",
      target: "branches/feature to trunk?bad:name",
    });

    expect(name).toBe("novasvn-urls-branches-feature-to-trunk-bad-name-1783036800000.patch");
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe("svnStore", () => {
  it("falls back to default svn detection when saved executable fails", async () => {
    detectSvnMock
      .mockRejectedValueOnce({
        code: "SVN_NOT_FOUND",
        message: "自定义 SVN 不可用",
        recoverable: true,
      })
      .mockResolvedValueOnce({
        available: true,
        version: "1.14.3",
        executable: "svn",
        resolved_path: "C:\\Tools\\svn.exe",
      });

    svnStore.setExecutableInput("C:\\Missing\\svn.exe");
    const detection = await svnStore.detectWithInputFallback();

    expect(detectSvnMock).toHaveBeenNthCalledWith(1, {
      executable: "C:\\Missing\\svn.exe",
    });
    expect(detectSvnMock).toHaveBeenNthCalledWith(2);
    expect(detection?.resolved_path).toBe("C:\\Tools\\svn.exe");
  });
});

describe("isSameRepositoryUrl", () => {
  it("normalizes whitespace and trailing slashes", () => {
    expect(
      isSameRepositoryUrl(
        " https://example.com/svn/trunk/ ",
        "https://example.com/svn/trunk",
      ),
    ).toBe(true);
    expect(
      isSameRepositoryUrl(
        "https://example.com/svn/branches/feature",
        "https://example.com/svn/trunk",
      ),
    ).toBe(false);
    expect(isSameRepositoryUrl("", "https://example.com/svn/trunk")).toBe(false);
  });
});
