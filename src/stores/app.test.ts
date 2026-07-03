import { describe, expect, it, vi } from "vitest";

import { revisionDiffPatchFileName } from "./app";

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
