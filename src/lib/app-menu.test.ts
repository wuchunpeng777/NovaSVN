import { describe, expect, it, vi } from "vitest";
import type { ChangedFile, WorkspaceFileNode, WorkspaceFileTree } from "../types/api";
import { buildAppMenuState, dispatchAppMenuPathCommand } from "./app-menu";

describe("buildAppMenuState", () => {
  it("exposes local and remote actions for the active versioned file", () => {
    const node = makeNode("src/main.ts", "modified", true, "both");
    const state = buildAppMenuState({
      ...baseInput(node, makeFile("src/main.ts", "modified", "both")),
    });

    expect(state).toMatchObject({
      active_path: "src/main.ts",
      active_label: "main.ts",
      commit_selected: false,
      can_open: true,
      can_show: true,
      can_commit: true,
      can_update: true,
      can_revert: true,
      can_move: true,
      can_copy: true,
      can_delete: true,
      can_add: false,
      can_ignore: false,
    });
  });

  it("offers Add and Ignore for an active unversioned directory without Delete", () => {
    const node = makeNode("drafts", "unversioned", false, "local", "dir");
    const state = buildAppMenuState({
      ...baseInput(node, makeFile("drafts", "unversioned", "local")),
    });

    expect(state.can_open).toBe(false);
    expect(state.can_add).toBe(true);
    expect(state.can_ignore).toBe(true);
    expect(state.can_commit).toBe(false);
    expect(state.can_revert).toBe(false);
    expect(state.can_delete).toBe(false);
  });

  it("offers Delete for an active unversioned file", () => {
    const node = makeNode("notes/new.txt", "unversioned", false, "local");
    const state = buildAppMenuState({
      ...baseInput(node, makeFile("notes/new.txt", "unversioned", "local")),
    });

    expect(state.can_add).toBe(true);
    expect(state.can_ignore).toBe(true);
    expect(state.can_delete).toBe(true);
    expect(state.can_move).toBe(false);
    expect(state.can_copy).toBe(false);
  });

  it("disables mutating path actions while keeping safe file actions available", () => {
    const node = makeNode("conflict.txt", "conflicted", true, "local");
    const state = buildAppMenuState({
      ...baseInput(node, {
        ...makeFile("conflict.txt", "conflicted", "local"),
        conflict_kind: "text",
      }),
      workspaceLocked: true,
    });

    expect(state.workspace_busy).toBe(true);
    expect(state.can_open).toBe(true);
    expect(state.can_show).toBe(true);
    expect(state.can_resolve).toBe(true);
    expect(state.can_revert).toBe(false);
    expect(state.can_move).toBe(false);
    expect(state.can_delete).toBe(false);
  });

  it("clears the active path outside the Working Copy view", () => {
    const node = makeNode("src/main.ts", "modified", true, "local");
    const state = buildAppMenuState({
      ...baseInput(node, makeFile("src/main.ts", "modified", "local")),
      viewId: "history",
    });

    expect(state.active_path).toBeNull();
    expect(state.active_label).toBeNull();
    expect(state.can_open).toBe(false);
    expect(state.can_commit).toBe(false);
  });

  it("dispatches enabled path commands and rejects stale disabled actions", async () => {
    const node = makeNode("src/main.ts", "modified", true, "both");
    const state = buildAppMenuState({
      ...baseInput(node, makeFile("src/main.ts", "modified", "both")),
    });
    const actions = {
      open: vi.fn(),
      show: vi.fn(),
      commit: vi.fn(),
      update: vi.fn(),
      add: vi.fn(),
      resolve: vi.fn(),
      revert: vi.fn(),
      move: vi.fn(),
      copy: vi.fn(),
      ignore: vi.fn(),
      delete: vi.fn(),
    };

    expect(await dispatchAppMenuPathCommand("path_commit", state, actions)).toBe(true);
    expect(actions.commit).toHaveBeenCalledWith("src/main.ts", false);
    expect(await dispatchAppMenuPathCommand("path_add", state, actions)).toBe(true);
    expect(actions.add).not.toHaveBeenCalled();
    expect(await dispatchAppMenuPathCommand("refresh_status", state, actions)).toBe(false);
  });
});

function baseInput(node: WorkspaceFileNode, file: ChangedFile) {
  const fileTree: WorkspaceFileTree = {
    working_copy_root: "C:/repo/wc",
    total_files: 1,
    returned_files: 1,
    truncated: false,
    nodes: [node],
  };
  return {
    viewId: "changes",
    workspaceOpen: true,
    activePath: node.path,
    fileTree,
    status: {
      working_copy_root: "C:/repo/wc",
      total: 1,
      returned: 1,
      offset: 0,
      limit: 500,
      revision_range: "12",
      mixed_revision: false,
      remote_updates_checked: true,
      repository_revision: "13",
      local_changes: 1,
      remote_changes: 0,
      combined_changes: 0,
      modified: 1,
      added: 0,
      deleted: 0,
      missing: 0,
      unversioned: 0,
      conflicted: 0,
      obstructed: 0,
      property_changed: 0,
      files: [file],
    },
    statusLoading: false,
    workspaceLocked: false,
  };
}

function makeNode(
  path: string,
  status: string,
  versioned: boolean,
  changeScope: "none" | "local" | "remote" | "both",
  kind = "file",
): WorkspaceFileNode {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    kind,
    status,
    remote_status: changeScope === "remote" || changeScope === "both" ? "modified" : null,
    remote_property_status: null,
    change_scope: changeScope,
    revision: versioned ? "12" : null,
    base_revision: versioned ? "12" : null,
    last_revision: versioned ? "11" : null,
    last_changed_date: versioned ? "2026-07-11T01:02:03Z" : null,
    last_changed_author: versioned ? "alice" : null,
    file_size: kind === "file" ? 64 : null,
    changed: status !== "normal",
    versioned,
    children: [],
  };
}

function makeFile(
  path: string,
  status: string,
  changeScope: "none" | "local" | "remote" | "both",
): ChangedFile {
  return {
    path,
    status,
    revision: "12",
    property_status: null,
    property_changed: false,
    remote_status: changeScope === "remote" || changeScope === "both" ? "modified" : null,
    remote_property_status: null,
    change_scope: changeScope,
    abnormal: status === "conflicted",
    lock_state: "none",
    lock_owner: null,
    lock_comment: null,
    conflict_kind: null,
    file_size: 64,
    content_digest: "digest",
  };
}
