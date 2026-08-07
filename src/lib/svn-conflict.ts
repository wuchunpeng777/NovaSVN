import type { ChangedFile, SvnOperationKind } from "../types/api";

/** True when the path has a text, property, or tree conflict. */
export function isConflictedFile(file: Pick<ChangedFile, "status" | "conflict_kind">) {
  return file.status === "conflicted" || Boolean(file.conflict_kind?.trim());
}

/** True when the conflict is a tree conflict (optionally with operation/reason/action). */
export function isTreeConflict(file: Pick<ChangedFile, "conflict_kind">) {
  const kind = file.conflict_kind?.trim() ?? "";
  return kind === "tree" || kind.startsWith("tree:");
}

export type ConflictCategory = "text" | "property" | "tree" | "unknown";

export interface ParsedConflictKind {
  category: ConflictCategory;
  /** SVN operation that produced the conflict: update / switch / merge */
  operation: string | null;
  /** Local reason (tree conflict): edit / delete / add / ... */
  reason: string | null;
  /** Incoming action (tree conflict): edit / delete / add / ... */
  action: string | null;
}

/**
 * Parse conflict_kind encodings produced by the backend:
 * - text / property / tree
 * - tree:{operation}
 * - tree:{operation}|{reason}|{action}
 * - legacy tree:{operation}:{reason}:{action}
 */
export function parseConflictKind(
  conflictKind: string | null | undefined,
): ParsedConflictKind | null {
  const kind = conflictKind?.trim() ?? "";
  if (!kind) {
    return null;
  }
  if (kind === "text") {
    return { category: "text", operation: null, reason: null, action: null };
  }
  if (kind === "property") {
    return { category: "property", operation: null, reason: null, action: null };
  }
  if (kind === "tree") {
    return { category: "tree", operation: null, reason: null, action: null };
  }
  if (kind.startsWith("tree:")) {
    const rest = kind.slice("tree:".length);
    if (rest.includes("|")) {
      const [operation = "", reason = "", action = ""] = rest.split("|");
      return {
        category: "tree",
        operation: emptyToNull(operation),
        reason: emptyToNull(reason),
        action: emptyToNull(action),
      };
    }
    // 兼容旧格式 tree:update / tree:update:delete:edit
    const parts = rest.split(":");
    return {
      category: "tree",
      operation: emptyToNull(parts[0]),
      reason: emptyToNull(parts[1]),
      action: emptyToNull(parts[2]),
    };
  }
  return { category: "unknown", operation: null, reason: null, action: null };
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

/**
 * Short UI label for a conflict kind, e.g. "树冲突 (更新)", "文本冲突".
 * Returns null when the file is not conflicted.
 */
export function conflictKindLabel(file: Pick<ChangedFile, "status" | "conflict_kind">) {
  if (!isConflictedFile(file)) {
    return null;
  }
  const parsed = parseConflictKind(file.conflict_kind);
  if (!parsed) {
    return "冲突";
  }
  if (parsed.category === "property") {
    return "属性冲突";
  }
  if (parsed.category === "text") {
    return "文本冲突";
  }
  if (parsed.category === "tree") {
    if (parsed.operation) {
      return `树冲突 (${translateOperation(parsed.operation)})`;
    }
    return "树冲突";
  }
  const kind = file.conflict_kind?.trim() ?? "";
  return kind ? `冲突 (${kind})` : "冲突";
}

/**
 * Human-readable conflict cause for tree / text / property conflicts.
 * Used in Update/Revert conflict rows so the user knows why it happened.
 */
export function conflictReasonDescription(
  file: Pick<ChangedFile, "status" | "conflict_kind">,
): string | null {
  if (!isConflictedFile(file)) {
    return null;
  }
  const parsed = parseConflictKind(file.conflict_kind);
  if (!parsed) {
    return "工作副本与仓库状态不一致，需要选择如何解决。";
  }
  if (parsed.category === "text") {
    return "同一文件的本地修改与仓库修改发生文本冲突，需要合并或选择一侧版本。";
  }
  if (parsed.category === "property") {
    return "同一路径的 SVN 属性在本地与仓库上同时被修改，需要选择保留哪一侧。";
  }
  if (parsed.category === "tree") {
    return describeTreeConflict(parsed);
  }
  return "检测到冲突，需要选择如何处理该路径。";
}

export interface ConflictResolutionAction {
  kind: SvnOperationKind | "edit";
  /** Button label */
  label: string;
  /** Longer explanation for title / aria */
  description: string;
  /** Requires window.confirm before running resolve */
  confirm: boolean;
}

/**
 * Resolution actions available for a conflict, tailored by kind/reason.
 * Tree and delete-related conflicts never offer text-edit.
 */
export function conflictResolutionActions(
  file: Pick<ChangedFile, "status" | "conflict_kind">,
): ConflictResolutionAction[] {
  if (!isConflictedFile(file)) {
    return [];
  }
  const parsed = parseConflictKind(file.conflict_kind);
  if (parsed?.category === "tree") {
    return treeConflictActions(parsed);
  }
  if (parsed?.category === "property") {
    return [
      {
        kind: "resolve_working",
        label: "保留当前属性",
        description: "将当前工作副本中的属性状态标记为已解决",
        confirm: false,
      },
      {
        kind: "resolve_mine_full",
        label: "采用我的属性",
        description: "完整采用本地属性版本并解决冲突",
        confirm: true,
      },
      {
        kind: "resolve_theirs_full",
        label: "采用仓库属性",
        description: "完整采用仓库属性版本并解决冲突",
        confirm: true,
      },
    ];
  }
  // text / unknown：允许可视化编辑
  return [
    {
      kind: "edit",
      label: "编辑冲突",
      description: "打开冲突编辑器，逐块选择或合并文本",
      confirm: false,
    },
    {
      kind: "resolve_working",
      label: "保留当前内容",
      description: "将当前工作副本文件内容标记为已解决",
      confirm: false,
    },
    {
      kind: "resolve_mine_full",
      label: "采用我的版本",
      description: "完整采用本地文件版本并解决冲突",
      confirm: true,
    },
    {
      kind: "resolve_theirs_full",
      label: "采用仓库版本",
      description: "完整采用仓库文件版本并解决冲突",
      confirm: true,
    },
  ];
}

/**
 * Intersection of non-edit resolution actions across multiple conflicts.
 * Labels use neutral batch wording so mixed tree/text/property selections stay clear.
 */
export function commonConflictResolutionActions(
  files: Array<Pick<ChangedFile, "status" | "conflict_kind">>,
): ConflictResolutionAction[] {
  if (files.length === 0) {
    return [];
  }

  const actionLists = files.map((file) =>
    conflictResolutionActions(file).filter((action) => action.kind !== "edit"),
  );
  if (actionLists.some((list) => list.length === 0)) {
    return [];
  }

  const firstKinds = actionLists[0].map((action) => action.kind);
  const commonKinds = firstKinds.filter((kind) =>
    actionLists.every((list) => list.some((action) => action.kind === kind)),
  );

  return commonKinds
    .map((kind) => batchResolutionAction(kind))
    .filter((action): action is ConflictResolutionAction => action !== null);
}

function batchResolutionAction(
  kind: ConflictResolutionAction["kind"],
): ConflictResolutionAction | null {
  switch (kind) {
    case "resolve_working":
      return {
        kind,
        label: "保留当前内容",
        description: "将选中路径的当前工作副本状态标记为已解决",
        confirm: false,
      };
    case "resolve_mine_full":
      return {
        kind,
        label: "采用我的版本",
        description: "完整采用本地版本并解决选中冲突",
        confirm: true,
      };
    case "resolve_theirs_full":
      return {
        kind,
        label: "采用仓库版本",
        description: "完整采用仓库版本并解决选中冲突",
        confirm: true,
      };
    default:
      return null;
  }
}

/** Single-letter status mark for conflict rows (always C). */
export function conflictStatusMark(_file: Pick<ChangedFile, "status" | "conflict_kind">) {
  return "C";
}

function describeTreeConflict(parsed: ParsedConflictKind): string {
  const operation = translateOperation(parsed.operation ?? "update");
  const local = translateChange(parsed.reason);
  const incoming = translateChange(parsed.action);

  if (local && incoming) {
    return `树冲突：本地${local}，${operation}时仓库侧${incoming}。需要选择保留本地结果还是接受仓库变更。`;
  }
  if (local) {
    return `树冲突：本地${local}，与${operation}带来的仓库变更冲突。`;
  }
  if (incoming) {
    return `树冲突：${operation}时仓库侧${incoming}，与本地状态冲突。`;
  }
  return `树冲突：本地目录/文件结构与仓库在${operation}时不一致，需要选择如何处理。`;
}

function treeConflictActions(parsed: ParsedConflictKind): ConflictResolutionAction[] {
  const reason = (parsed.reason ?? "").toLowerCase();
  const action = (parsed.action ?? "").toLowerCase();
  const localDeleted = reason === "delete" || reason === "missing";
  const incomingDeleted = action === "delete";

  if (localDeleted && !incomingDeleted) {
    return [
      {
        kind: "resolve_mine_full",
        label: "保持删除",
        description: "保留本地删除结果，丢弃仓库对该路径的变更",
        confirm: true,
      },
      {
        kind: "resolve_theirs_full",
        label: "恢复仓库版本",
        description: "接受仓库内容，恢复该路径",
        confirm: true,
      },
      {
        kind: "resolve_working",
        label: "标记已解决（当前状态）",
        description: "将当前工作副本状态标记为已解决，不再视为冲突",
        confirm: false,
      },
    ];
  }

  if (incomingDeleted && !localDeleted) {
    return [
      {
        kind: "resolve_mine_full",
        label: "保留本地文件",
        description: "保留本地版本，拒绝仓库的删除",
        confirm: true,
      },
      {
        kind: "resolve_theirs_full",
        label: "接受仓库删除",
        description: "按仓库结果删除该路径并解决冲突",
        confirm: true,
      },
      {
        kind: "resolve_working",
        label: "标记已解决（当前状态）",
        description: "将当前工作副本状态标记为已解决",
        confirm: false,
      },
    ];
  }

  if (localDeleted && incomingDeleted) {
    return [
      {
        kind: "resolve_working",
        label: "确认删除并解决",
        description: "本地与仓库均删除该路径，标记冲突已解决",
        confirm: false,
      },
      {
        kind: "resolve_theirs_full",
        label: "按仓库结果处理",
        description: "采用仓库侧处理结果",
        confirm: true,
      },
    ];
  }

  return [
    {
      kind: "resolve_working",
      label: "保留当前结构",
      description: "将当前工作副本的目录/文件结构标记为已解决",
      confirm: false,
    },
    {
      kind: "resolve_mine_full",
      label: "采用我的版本",
      description: "完整采用本地结构/内容并解决树冲突",
      confirm: true,
    },
    {
      kind: "resolve_theirs_full",
      label: "采用仓库版本",
      description: "完整采用仓库结构/内容并解决树冲突",
      confirm: true,
    },
  ];
}

function translateOperation(operation: string): string {
  switch (operation.toLowerCase()) {
    case "update":
      return "更新";
    case "switch":
      return "切换";
    case "merge":
      return "合并";
    default:
      return operation;
  }
}

function translateChange(value: string | null): string | null {
  if (!value) {
    return null;
  }
  switch (value.toLowerCase()) {
    case "edit":
      return "已修改";
    case "add":
      return "已新增";
    case "delete":
      return "已删除";
    case "replace":
      return "已替换";
    case "missing":
      return "文件缺失";
    case "obstructed":
      return "路径被占用";
    case "unversioned":
      return "存在未版本控制内容";
    case "moved-away":
    case "moved_away":
      return "已移走";
    case "moved-here":
    case "moved_here":
      return "已移入";
    default:
      return value;
  }
}
