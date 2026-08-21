import type { ChangedFile } from "../types/api";
import { conflictKindLabel, isConflictedFile } from "./svn-conflict";

/** Single-letter SVN status mark used by Commit / Revert / Merge file lists. */
export function svnStatusMark(
  file: Pick<ChangedFile, "status" | "property_changed" | "conflict_kind">,
): string {
  if (isConflictedFile(file)) {
    return "C";
  }
  const marks: Record<string, string> = {
    modified: "M",
    added: "A",
    deleted: "D",
    replaced: "R",
    property_modified: "M",
    unversioned: "?",
    missing: "!",
    obstructed: "~",
    conflicted: "C",
    ignored: "I",
    external: "X",
    normal: " ",
    none: " ",
  };
  if (["normal", "none", "property_modified"].includes(file.status) && file.property_changed) {
    return "M";
  }
  if (file.property_changed && !marks[file.status]) {
    return "M";
  }
  return marks[file.status] ?? (file.status.slice(0, 1).toUpperCase() || "?");
}

/** Human-readable title for `svnStatusMark`. */
export function svnStatusMarkTitle(
  file: Pick<ChangedFile, "status" | "property_changed" | "conflict_kind">,
): string {
  const conflictLabel = conflictKindLabel(file);
  if (conflictLabel) {
    return conflictLabel;
  }
  const titles: Record<string, string> = {
    modified: "修改",
    added: "新增",
    deleted: "删除",
    replaced: "替换",
    property_modified: "属性修改",
    unversioned: "未版本控制",
    missing: "丢失",
    obstructed: "受阻",
    conflicted: "冲突",
    ignored: "已忽略",
    external: "外部",
  };
  if (["normal", "none", "property_modified"].includes(file.status) && file.property_changed) {
    return "属性修改";
  }
  if (file.property_changed && titles[file.status]) {
    return `${titles[file.status]} + 属性`;
  }
  return titles[file.status] ?? file.status;
}
