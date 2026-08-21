import { describe, expect, it } from "vitest";
import { svnStatusMark, svnStatusMarkTitle } from "./svn-file-status";

describe("svnStatusMark", () => {
  it("uses A/M/D for common local changes", () => {
    expect(svnStatusMark({ status: "added", property_changed: false, conflict_kind: null })).toBe(
      "A",
    );
    expect(svnStatusMark({ status: "modified", property_changed: false, conflict_kind: null })).toBe(
      "M",
    );
    expect(svnStatusMark({ status: "deleted", property_changed: false, conflict_kind: null })).toBe(
      "D",
    );
  });

  it("uses C for text and tree conflicts even when item status is still normal", () => {
    expect(
      svnStatusMark({ status: "conflicted", property_changed: false, conflict_kind: "text" }),
    ).toBe("C");
    expect(
      svnStatusMark({
        status: "normal",
        property_changed: false,
        conflict_kind: "tree:update|add|add",
      }),
    ).toBe("C");
  });
});

describe("svnStatusMarkTitle", () => {
  it("labels added files and tree conflicts", () => {
    expect(
      svnStatusMarkTitle({ status: "added", property_changed: false, conflict_kind: null }),
    ).toBe("新增");
    expect(
      svnStatusMarkTitle({
        status: "normal",
        property_changed: false,
        conflict_kind: "tree:update|add|add",
      }),
    ).toBe("树冲突 (更新)");
  });
});
