import { describe, expect, it } from "vitest";
import { buildResolvedConflictText, parseConflictText } from "./conflict-resolution";

describe("conflict resolution", () => {
  const conflictText = [
    "before\r\n",
    "<<<<<<< .mine\r\n",
    "const value = 'mine';\r\n",
    "||||||| .r10\r\n",
    "const value = 'base';\r\n",
    "=======\r\n",
    "const value = 'theirs';\r\n",
    ">>>>>>> .r11\r\n",
    "after\r\n",
  ].join("");

  it("parses SVN diff3 markers without changing line endings", () => {
    const parsed = parseConflictText(conflictText);

    expect(parsed.conflicts).toHaveLength(1);
    expect(parsed.conflicts[0]).toMatchObject({
      id: "conflict-1",
      mine: "const value = 'mine';\r\n",
      base: "const value = 'base';\r\n",
      theirs: "const value = 'theirs';\r\n",
      mineLabel: ".mine",
      baseLabel: ".r10",
      theirsLabel: ".r11",
    });
    expect(buildResolvedConflictText(parsed, {})).toBe(conflictText);
  });

  it("builds mine, theirs, and combined resolutions", () => {
    const parsed = parseConflictText(conflictText);

    expect(buildResolvedConflictText(parsed, { "conflict-1": "mine" })).toBe(
      "before\r\nconst value = 'mine';\r\nafter\r\n",
    );
    expect(buildResolvedConflictText(parsed, { "conflict-1": "theirs" })).toBe(
      "before\r\nconst value = 'theirs';\r\nafter\r\n",
    );
    expect(buildResolvedConflictText(parsed, { "conflict-1": "both" })).toBe(
      "before\r\nconst value = 'mine';\r\nconst value = 'theirs';\r\nafter\r\n",
    );
  });

  it("keeps malformed and marker-free text unchanged", () => {
    for (const text of ["plain text\n", "<<<<<<< .mine\nunfinished\n"]) {
      const parsed = parseConflictText(text);
      expect(parsed.conflicts).toHaveLength(0);
      expect(buildResolvedConflictText(parsed, {})).toBe(text);
    }
  });

  it("parses two-way conflict markers without a base section", () => {
    const parsed = parseConflictText(
      "<<<<<<< local\nleft\n=======\nright\n>>>>>>> incoming\n",
    );

    expect(parsed.conflicts[0].base).toBeNull();
    expect(parsed.conflicts[0].baseLabel).toBeNull();
    expect(buildResolvedConflictText(parsed, { "conflict-1": "theirs" })).toBe("right\n");
  });
});
