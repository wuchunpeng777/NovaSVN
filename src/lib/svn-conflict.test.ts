import { describe, expect, it } from "vitest";
import { conflictKindLabel, isConflictedFile, isTreeConflict } from "./svn-conflict";

describe("svn-conflict helpers", () => {
  it("detects text, property, and tree conflicts", () => {
    expect(isConflictedFile({ status: "conflicted", conflict_kind: "text" })).toBe(true);
    expect(isConflictedFile({ status: "normal", conflict_kind: "tree:update" })).toBe(true);
    expect(isConflictedFile({ status: "modified", conflict_kind: null })).toBe(false);
    expect(isTreeConflict({ conflict_kind: "tree:update" })).toBe(true);
    expect(isTreeConflict({ conflict_kind: "text" })).toBe(false);
  });

  it("formats conflict labels for the UI", () => {
    expect(conflictKindLabel({ status: "conflicted", conflict_kind: "text" })).toBe("文本冲突");
    expect(conflictKindLabel({ status: "conflicted", conflict_kind: "property" })).toBe(
      "属性冲突",
    );
    expect(conflictKindLabel({ status: "normal", conflict_kind: "tree" })).toBe("树冲突");
    expect(conflictKindLabel({ status: "normal", conflict_kind: "tree:update" })).toBe(
      "树冲突 (update)",
    );
    expect(conflictKindLabel({ status: "normal", conflict_kind: "tree:switch" })).toBe(
      "树冲突 (switch)",
    );
    expect(conflictKindLabel({ status: "modified", conflict_kind: null })).toBeNull();
  });
});
