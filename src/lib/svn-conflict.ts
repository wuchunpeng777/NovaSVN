import type { ChangedFile } from "../types/api";

/** True when the path has a text, property, or tree conflict. */
export function isConflictedFile(file: Pick<ChangedFile, "status" | "conflict_kind">) {
  return file.status === "conflicted" || Boolean(file.conflict_kind?.trim());
}

/** True when the conflict is a tree conflict (optionally with operation suffix). */
export function isTreeConflict(file: Pick<ChangedFile, "conflict_kind">) {
  const kind = file.conflict_kind?.trim() ?? "";
  return kind === "tree" || kind.startsWith("tree:");
}

/**
 * Short UI label for a conflict kind, e.g. "树冲突 (update)", "文本冲突".
 * Returns null when the file is not conflicted.
 */
export function conflictKindLabel(file: Pick<ChangedFile, "status" | "conflict_kind">) {
  if (!isConflictedFile(file)) {
    return null;
  }
  const kind = file.conflict_kind?.trim() ?? "";
  if (kind === "property") {
    return "属性冲突";
  }
  if (kind === "text") {
    return "文本冲突";
  }
  if (kind === "tree") {
    return "树冲突";
  }
  if (kind.startsWith("tree:")) {
    const operation = kind.slice("tree:".length).trim();
    return operation ? `树冲突 (${operation})` : "树冲突";
  }
  if (kind) {
    return `冲突 (${kind})`;
  }
  return "冲突";
}

/** Single-letter status mark for conflict rows (always C). */
export function conflictStatusMark(_file: Pick<ChangedFile, "status" | "conflict_kind">) {
  return "C";
}
