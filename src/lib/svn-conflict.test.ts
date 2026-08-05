import { describe, expect, it } from "vitest";
import {
  conflictKindLabel,
  conflictReasonDescription,
  conflictResolutionActions,
  isConflictedFile,
  isTreeConflict,
  parseConflictKind,
} from "./svn-conflict";

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
      "树冲突 (更新)",
    );
    expect(conflictKindLabel({ status: "normal", conflict_kind: "tree:switch" })).toBe(
      "树冲突 (切换)",
    );
    expect(conflictKindLabel({ status: "modified", conflict_kind: null })).toBeNull();
  });

  it("parses tree conflict operation, reason, and action", () => {
    expect(parseConflictKind("tree:update|delete|edit")).toEqual({
      category: "tree",
      operation: "update",
      reason: "delete",
      action: "edit",
    });
    expect(parseConflictKind("tree:merge|edit|delete")).toEqual({
      category: "tree",
      operation: "merge",
      reason: "edit",
      action: "delete",
    });
    expect(parseConflictKind("tree:update||edit")).toEqual({
      category: "tree",
      operation: "update",
      reason: null,
      action: "edit",
    });
    // 兼容旧的冒号编码
    expect(parseConflictKind("tree:update:delete:edit")).toEqual({
      category: "tree",
      operation: "update",
      reason: "delete",
      action: "edit",
    });
  });

  it("describes tree and text conflict reasons", () => {
    expect(
      conflictReasonDescription({
        status: "conflicted",
        conflict_kind: "tree:update|delete|edit",
      }),
    ).toContain("本地已删除");
    expect(
      conflictReasonDescription({
        status: "conflicted",
        conflict_kind: "tree:update|edit|delete",
      }),
    ).toContain("仓库侧已删除");
    expect(
      conflictReasonDescription({ status: "conflicted", conflict_kind: "text" }),
    ).toContain("文本冲突");
  });

  it("offers contextual actions for deleted tree conflicts without text edit", () => {
    const localDeleted = conflictResolutionActions({
      status: "conflicted",
      conflict_kind: "tree:update|delete|edit",
    });
    expect(localDeleted.map((action) => action.kind)).not.toContain("edit");
    expect(localDeleted.some((action) => action.label === "保持删除")).toBe(true);
    expect(localDeleted.some((action) => action.label === "恢复仓库版本")).toBe(true);

    const incomingDeleted = conflictResolutionActions({
      status: "conflicted",
      conflict_kind: "tree:update|edit|delete",
    });
    expect(incomingDeleted.some((action) => action.label === "保留本地文件")).toBe(true);
    expect(incomingDeleted.some((action) => action.label === "接受仓库删除")).toBe(true);

    const text = conflictResolutionActions({
      status: "conflicted",
      conflict_kind: "text",
    });
    expect(text.some((action) => action.kind === "edit")).toBe(true);
  });
});
