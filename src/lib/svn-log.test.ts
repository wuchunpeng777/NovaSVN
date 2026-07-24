import { describe, expect, it } from "vitest";
import {
  loadAllSvnLogPages,
  mergeSvnLogPage,
  repositoryPathLogTarget,
  resolveWorkingCopyLogRevision,
  repositoryPathUrlAtRevision,
  summarizeSvnChangeActions,
} from "./svn-log";

describe("resolveWorkingCopyLogRevision", () => {
  it("maps a working-copy baseline to the newest loaded path revision", () => {
    expect(resolveWorkingCopyLogRevision([
      { revision: "80", author: "a", date: "", message: "", changed_paths: [] },
      { revision: "65", author: "b", date: "", message: "", changed_paths: [] },
    ], "r100M")).toBe("80");
  });

  it("ignores revisions newer than the working-copy baseline", () => {
    expect(resolveWorkingCopyLogRevision([
      { revision: "105", author: "a", date: "", message: "", changed_paths: [] },
      { revision: "99", author: "b", date: "", message: "", changed_paths: [] },
    ], "100")).toBe("99");
  });

  it("returns null when no applicable revision is loaded", () => {
    expect(resolveWorkingCopyLogRevision([], "100")).toBeNull();
    expect(resolveWorkingCopyLogRevision([
      { revision: "101", author: "a", date: "", message: "", changed_paths: [] },
    ], "100")).toBeNull();
  });
});
import type { SvnLog } from "../types/api";

describe("svn log helpers", () => {
  it("loads every remaining page and removes duplicate revisions", async () => {
    const pages: Record<string, SvnLog> = {
      "9": makeLog(["9", "8"], true, "8"),
      "8": makeLog(["8", "7"], false, null),
    };
    const requested: string[] = [];
    const snapshots: string[][] = [];

    const result = await loadAllSvnLogPages(
      makeLog(["10", "9"], true, "9"),
      async (startRevision) => {
        requested.push(startRevision);
        return pages[startRevision];
      },
      (log) => snapshots.push(log.entries.map((entry) => entry.revision)),
    );

    expect(requested).toEqual(["9", "8"]);
    expect(snapshots).toEqual([
      ["10", "9", "8"],
      ["10", "9", "8", "7"],
    ]);
    expect(result.entries.map((entry) => entry.revision)).toEqual(["10", "9", "8", "7"]);
    expect(result.has_more).toBe(false);
  });

  it("stops loading when a server repeats the pagination cursor", async () => {
    let calls = 0;
    const result = await loadAllSvnLogPages(
      makeLog(["10"], true, "9"),
      async () => {
        calls += 1;
        return makeLog(["9"], true, "9");
      },
    );

    expect(calls).toBe(1);
    expect(result.entries.map((entry) => entry.revision)).toEqual(["10", "9"]);
  });

  it("merges pages without changing the original log target", () => {
    expect(
      mergeSvnLogPage(
        makeLog(["10", "9"], true, "9", "working-copy"),
        makeLog(["9", "8"], false, null, "repository-url"),
      ),
    ).toMatchObject({
      target: "working-copy",
      entries: [{ revision: "10" }, { revision: "9" }, { revision: "8" }],
    });
  });

  it("summarizes A/M/D paths in stable order", () => {
    const path = (action: string) => ({
      path: `/trunk/${action}.txt`,
      action,
      kind: "file",
      copy_from_path: null,
      copy_from_revision: null,
    });

    expect(summarizeSvnChangeActions([path("M"), path("A"), path("M"), path("D")])).toEqual([
      { action: "A", count: 1 },
      { action: "M", count: 2 },
      { action: "D", count: 1 },
    ]);
  });

  it("uses the previous revision as the peg for a deleted path", () => {
    expect(
      repositoryPathUrlAtRevision(
        "https://svn.example.test/repo",
        "/trunk/deleted file.txt",
        "20",
        "D",
      ),
    ).toBe("https://svn.example.test/repo/trunk/deleted%20file.txt@19");
    expect(
      repositoryPathUrlAtRevision(
        "https://svn.example.test/repo",
        "/trunk/modified.txt",
        "20",
        "M",
      ),
    ).toBe("https://svn.example.test/repo/trunk/modified.txt@20");
    expect(
      repositoryPathLogTarget(
        "https://svn.example.test/repo",
        "/trunk/deleted file.txt",
        "20",
        "D",
      ),
    ).toEqual({
      repositoryUrl: "https://svn.example.test/repo/trunk/deleted%20file.txt",
      revision: "19",
    });
  });
});

function makeLog(
  revisions: string[],
  hasMore: boolean,
  nextStartRevision: string | null,
  target = "target",
): SvnLog {
  return {
    target,
    entries: revisions.map((revision) => ({
      revision,
      author: "alice",
      date: "2026-07-23T00:00:00Z",
      message: revision,
      changed_paths: [],
    })),
    has_more: hasMore,
    next_start_revision: nextStartRevision,
  };
}
