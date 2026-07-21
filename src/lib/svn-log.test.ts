import { describe, expect, it } from "vitest";
import {
  repositoryPathUrlAtRevision,
  summarizeSvnChangeActions,
} from "./svn-log";

describe("svn log helpers", () => {
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
  });
});
