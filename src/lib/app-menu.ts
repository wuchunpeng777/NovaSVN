import type {
  AppMenuState,
  ChangedFile,
  WorkspaceFileNode,
  WorkspaceFileTree,
  WorkingCopyStatus,
} from "../types/api";

export interface BuildAppMenuStateInput {
  viewId: string;
  workspaceOpen: boolean;
  activePath: string | null;
  fileTree: WorkspaceFileTree | null;
  status: WorkingCopyStatus | null;
  commitFiles: Array<{ path: string }>;
  statusLoading: boolean;
  workspaceLocked: boolean;
}

export interface AppMenuPathActions {
  open: (path: string) => void | Promise<void>;
  show: (path: string) => void | Promise<void>;
  commit: (path: string, selected: boolean) => void | Promise<void>;
  update: (path: string) => void | Promise<void>;
  add: (path: string) => void | Promise<void>;
  resolve: (path: string) => void | Promise<void>;
  revert: (path: string) => void | Promise<void>;
  move: (path: string) => void | Promise<void>;
  copy: (path: string) => void | Promise<void>;
  ignore: (path: string) => void | Promise<void>;
  delete: (path: string) => void | Promise<void>;
}

export function buildAppMenuState(input: BuildAppMenuStateInput): AppMenuState {
  const workspaceBusy = input.statusLoading || input.workspaceLocked;
  const activePath = input.viewId === "changes" && input.workspaceOpen ? input.activePath : null;
  const node = activePath ? findWorkspaceNode(input.fileTree?.nodes ?? [], activePath) : null;
  const file = activePath
    ? input.status?.files.find((candidate) => candidate.path === activePath) ?? null
    : null;
  const pathBusy = workspaceBusy || !node;
  const versionedOperation = canMoveOrCopy(node);
  const unversioned = node?.status === "unversioned" || file?.status === "unversioned";
  const localChange = hasLocalChange(file);
  const remoteChange = hasRemoteChange(file, node);
  const committable = !!file && isCommittable(file);

  return {
    workspace_open: input.workspaceOpen,
    workspace_busy: workspaceBusy,
    active_path: node?.path ?? null,
    active_label: node ? compactPathLabel(node.path) : null,
    commit_selected:
      !!node && input.commitFiles.some((commitFile) => commitFile.path === node.path),
    can_open: canOpen(node),
    can_show: canOpen(node),
    can_commit: !pathBusy && localChange && committable,
    can_update: !pathBusy && remoteChange,
    can_add: !pathBusy && unversioned,
    can_resolve: !!node && isConflicted(file),
    can_revert: !pathBusy && localChange && !unversioned,
    can_move: !pathBusy && versionedOperation,
    can_copy: !pathBusy && versionedOperation,
    can_ignore: !pathBusy && canIgnore(node),
    can_delete: !pathBusy && (versionedOperation || canDeleteUnversioned(node)),
  };
}

export async function dispatchAppMenuPathCommand(
  command: string,
  state: AppMenuState,
  actions: AppMenuPathActions,
): Promise<boolean> {
  const path = state.active_path;
  switch (command) {
    case "path_open":
      if (path && state.can_open) await actions.open(path);
      return true;
    case "path_show":
      if (path && state.can_show) await actions.show(path);
      return true;
    case "path_commit":
      if (path && state.can_commit) await actions.commit(path, state.commit_selected);
      return true;
    case "path_update":
      if (path && state.can_update) await actions.update(path);
      return true;
    case "path_add":
      if (path && state.can_add) await actions.add(path);
      return true;
    case "path_resolve":
      if (path && state.can_resolve) await actions.resolve(path);
      return true;
    case "path_revert":
      if (path && state.can_revert) await actions.revert(path);
      return true;
    case "path_move":
      if (path && state.can_move) await actions.move(path);
      return true;
    case "path_copy":
      if (path && state.can_copy) await actions.copy(path);
      return true;
    case "path_ignore":
      if (path && state.can_ignore) await actions.ignore(path);
      return true;
    case "path_delete":
      if (path && state.can_delete) await actions.delete(path);
      return true;
    default:
      return false;
  }
}

function findWorkspaceNode(
  nodes: WorkspaceFileNode[],
  path: string,
): WorkspaceFileNode | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const child = findWorkspaceNode(node.children, path);
    if (child) {
      return child;
    }
  }
  return null;
}

function canOpen(node: WorkspaceFileNode | null) {
  return !!node && node.kind === "file" && !["deleted", "missing"].includes(node.status);
}

function canMoveOrCopy(node: WorkspaceFileNode | null) {
  return (
    !!node &&
    node.versioned &&
    ["file", "dir"].includes(node.kind) &&
    !["deleted", "missing", "external", "unversioned"].includes(node.status)
  );
}

function canDeleteUnversioned(node: WorkspaceFileNode | null) {
  return !!node && node.kind === "file" && node.status === "unversioned";
}

function canIgnore(node: WorkspaceFileNode | null) {
  return (
    !!node &&
    !node.versioned &&
    ["file", "dir"].includes(node.kind) &&
    node.status === "unversioned"
  );
}

function hasLocalChange(file: ChangedFile | null) {
  return file?.change_scope === "local" || file?.change_scope === "both";
}

function hasRemoteChange(file: ChangedFile | null, node: WorkspaceFileNode | null) {
  const scope = file?.change_scope ?? node?.change_scope;
  return scope === "remote" || scope === "both";
}

function isCommittable(file: ChangedFile) {
  return ![
    "normal",
    "missing",
    "conflicted",
    "obstructed",
    "unversioned",
    "external",
  ].includes(file.status);
}

function isConflicted(file: ChangedFile | null) {
  return file?.status === "conflicted" || !!file?.conflict_kind;
}

function compactPathLabel(path: string) {
  const name = path.split(/[\\/]/).at(-1) || path;
  return name.length <= 48 ? name : `${name.slice(0, 47)}...`;
}
