import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { closeWindowMock } = vi.hoisted(() => ({ closeWindowMock: vi.fn() }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: closeWindowMock }),
}));

vi.mock("./workbench/MonacoDiffViewer.svelte", () => ({
  default: vi.fn().mockImplementation((internals) => ({
    c: vi.fn(), m: vi.fn(), p: vi.fn(), d: vi.fn(), ...internals,
  })),
}));

vi.mock("../lib/api", () => ({
  createApplyMergePreviewTask: vi.fn(),
  getMergePreview: vi.fn(),
  getMergePreviewFile: vi.fn(),
  getTask: vi.fn(),
  releaseMergePreview: vi.fn(),
}));

import {
  createApplyMergePreviewTask,
  getMergePreview,
  getMergePreviewFile,
  getTask,
  releaseMergePreview,
} from "../lib/api";
import StandaloneMergePreviewWindow from "./StandaloneMergePreviewWindow.svelte";
import type { Task } from "../types/api";

const createApplyMock = vi.mocked(createApplyMergePreviewTask);
const getPreviewMock = vi.mocked(getMergePreview);
const getFileMock = vi.mocked(getMergePreviewFile);
const getTaskMock = vi.mocked(getTask);
const releaseMock = vi.mocked(releaseMergePreview);

beforeEach(() => {
  closeWindowMock.mockReset();
  createApplyMock.mockReset();
  getPreviewMock.mockReset();
  getFileMock.mockReset();
  getTaskMock.mockReset();
  releaseMock.mockReset();
  getPreviewMock.mockResolvedValue({
    preview_id: "a".repeat(64),
    working_copy_root: "C:\\target",
    source_url: "https://example.com/svn/branches/feature",
    revision_range: "101,105",
    record_only: false,
    ignore_ancestry: false,
    force: false,
    snapshot_digest: "digest",
    created_at: 1,
    expires_at: 9999999999999,
    output_text: "U src/main.ts",
    files: [
      makeFile("src/main.ts", "M"),
      makeFile("src/new.ts", "A"),
    ],
  });
  getFileMock.mockImplementation(async (_id, path) => ({
    path,
    original_text: path.includes("new") ? "" : "before\n",
    modified_text: "after\n",
    language: "typescript",
    binary: false,
    too_large: false,
    max_bytes: 1024,
  }));
  releaseMock.mockResolvedValue({ preview_id: "a".repeat(64), released: true });
});

describe("StandaloneMergePreviewWindow", () => {
  it("loads every file and navigates to the next preview", async () => {
    render(StandaloneMergePreviewWindow, { props: { previewId: "a".repeat(64) } });

    expect((await screen.findAllByText("src/main.ts")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 / 2").length).toBeGreaterThan(0);
    await fireEvent.click(screen.getByRole("button", { name: "下一个 Merge 文件" }));
    await waitFor(() => expect(getFileMock).toHaveBeenLastCalledWith("a".repeat(64), "src/new.ts"));
    expect(screen.getAllByText("2 / 2").length).toBeGreaterThan(0);
  });

  it("applies the guarded preview and keeps the result visible", async () => {
    createApplyMock.mockResolvedValue(makeTask("pending"));
    getTaskMock.mockResolvedValue(makeTask("success"));
    render(StandaloneMergePreviewWindow, { props: { previewId: "a".repeat(64) } });

    await screen.findAllByText("src/main.ts");
    await fireEvent.click(screen.getByRole("button", { name: "应用 Merge" }));
    await waitFor(() => expect(createApplyMock).toHaveBeenCalledWith({ preview_id: "a".repeat(64) }));
    expect(await screen.findByText("2 文件 · 0 冲突")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已应用" })).toBeDisabled();
  });

  it("releases the preview before Escape closes the window", async () => {
    render(StandaloneMergePreviewWindow, { props: { previewId: "a".repeat(64) } });
    await screen.findAllByText("src/main.ts");
    await fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(releaseMock).toHaveBeenCalledWith("a".repeat(64)));
    expect(closeWindowMock).toHaveBeenCalledOnce();
  });
});

function makeFile(path: string, action: string) {
  return {
    path,
    action,
    conflicted: false,
    property_only: false,
    binary: false,
    too_large: false,
    original_exists: action !== "A",
    modified_exists: action !== "D",
    original_bytes: action === "A" ? 0 : 7,
    modified_bytes: action === "D" ? 0 : 6,
  };
}

function makeTask(status: "pending" | "success"): Task {
  return {
    task_id: "merge-apply",
    title: "应用 Merge 预览",
    status,
    error: null,
    logs: [],
    result: status === "success" ? {
      repository_list: null,
      repository_file: null,
      repository_export: null,
      revision_diff: null,
      apply_patch_result: null,
      merge_result: {
        dry_run: false,
        source_url: "https://example.com/svn/branches/feature",
        revision_range: "101,105",
        record_only: false,
        ignore_ancestry: false,
        force: false,
        output_text: "U src/main.ts",
        output_truncated: false,
        max_output_bytes: 1024,
        file_count: 2,
        line_count: 1,
        added: 1,
        deleted: 0,
        updated: 1,
        conflicted: 0,
        preview_id: null,
      },
    } : null,
    created_at: 1,
    updated_at: 2,
  };
}
