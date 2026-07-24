import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { closeWindowMock } = vi.hoisted(() => ({
  closeWindowMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: closeWindowMock }),
}));

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  createSvnOperationTask: vi.fn(),
  getTask: vi.fn(),
  inspectUpdateTarget: vi.fn(),
}));

import {
  cancelTask,
  createSvnOperationTask,
  getTask,
  inspectUpdateTarget,
} from "../lib/api";
import type { Task, UpdateTargetSummary } from "../types/api";
import StandaloneCleanupWindow from "./StandaloneCleanupWindow.svelte";

const cancelTaskMock = vi.mocked(cancelTask);
const createSvnOperationTaskMock = vi.mocked(createSvnOperationTask);
const getTaskMock = vi.mocked(getTask);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);

beforeEach(() => {
  closeWindowMock.mockReset();
  closeWindowMock.mockResolvedValue(undefined);
  cancelTaskMock.mockReset();
  createSvnOperationTaskMock.mockReset();
  getTaskMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  inspectUpdateTargetMock.mockResolvedValue(makeTarget());
  createSvnOperationTaskMock.mockResolvedValue(makeTask("pending"));
  getTaskMock.mockResolvedValue(makeTask("success"));
  cancelTaskMock.mockResolvedValue(makeTask("cancelled"));
});

describe("StandaloneCleanupWindow", () => {
  it("在独立窗口中自动清理右键选中的目录", async () => {
    render(StandaloneCleanupWindow, {
      props: {
        targetPath: "C:\\repo\\game",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });

    await waitFor(() => {
      expect(inspectUpdateTargetMock).toHaveBeenCalledWith({
        path: "C:\\repo\\game",
        svn_executable: "C:\\Tools\\svn.exe",
      });
      expect(createSvnOperationTaskMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo\\game",
        kind: "cleanup",
        svn_executable: "C:\\Tools\\svn.exe",
      });
    });
    expect(await screen.findByText("工作副本清理完成")).toBeInTheDocument();
  });

  it("运行中关闭窗口时取消 Clean Up 任务", async () => {
    getTaskMock.mockImplementation(() => new Promise(() => undefined));
    render(StandaloneCleanupWindow, { props: { targetPath: "C:\\repo\\game" } });
    await waitFor(() => expect(createSvnOperationTaskMock).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByRole("button", { name: "关闭 Clean Up 窗口" }));

    expect(cancelTaskMock).toHaveBeenCalledWith("cleanup-task");
    expect(closeWindowMock).toHaveBeenCalledOnce();
  });

  it("Esc 可以关闭已完成的 Clean Up 窗口", async () => {
    render(StandaloneCleanupWindow, { props: { targetPath: "C:\\repo\\game" } });
    await screen.findByText("工作副本清理完成");

    await fireEvent.keyDown(window, { key: "Escape" });

    expect(closeWindowMock).toHaveBeenCalledOnce();
  });
});

function makeTarget(overrides: Partial<UpdateTargetSummary> = {}): UpdateTargetSummary {
  return {
    target_path: "C:\\repo\\game",
    working_copy_root: "C:\\repo",
    relative_path: "game",
    repository_url: "https://example.com/svn/trunk/game",
    repository_root: "https://example.com/svn",
    revision: "100",
    kind: "dir",
    ...overrides,
  };
}

function makeTask(status: Task["status"]): Task {
  return {
    task_id: "cleanup-task",
    title: "清理工作副本",
    status,
    error: null,
    logs: [{ message: "执行 svn cleanup", created_at: 1 }],
    result: null,
    created_at: 1,
    updated_at: 2,
  };
}
