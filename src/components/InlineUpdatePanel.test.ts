import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getWorkspacePathSizes: vi.fn(),
}));

import { getWorkspacePathSizes } from "../lib/api";
import type { Task } from "../types/api";
import InlineUpdatePanel from "./InlineUpdatePanel.svelte";

const getWorkspacePathSizesMock = vi.mocked(getWorkspacePathSizes);

beforeEach(() => {
  getWorkspacePathSizesMock.mockReset();
  getWorkspacePathSizesMock.mockResolvedValue([
    { path: "src/main.ts", bytes: 2048 },
    { path: "src/theme.css", bytes: 1024 },
  ]);
});

describe("InlineUpdatePanel", () => {
  it("显示流式文件、字节指标并支持停止", async () => {
    const onStop = vi.fn();
    const task = makeTask("running", ["U    src/main.ts", "A    src/theme.css"]);
    const { container } = render(InlineUpdatePanel, {
      props: {
        workingCopyRoot: "C:\\repo",
        task,
        theme: "dark",
        onStop,
      },
    });

    const panel = screen.getByLabelText("主界面 Update");
    expect(panel).toHaveAttribute("data-theme", "dark");
    expect(within(panel).getByRole("listitem", { name: "更新文件 src/main.ts" })).toBeInTheDocument();
    expect(within(panel).getByRole("listitem", { name: "更新文件 src/theme.css" })).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByText("3.00 KB")).toBeInTheDocument());
    expect(getWorkspacePathSizesMock).toHaveBeenCalledWith({
      working_copy_root: "C:\\repo",
      paths: ["src/main.ts", "src/theme.css"],
    });

    await fireEvent.click(within(panel).getByRole("button", { name: "停止 Update" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll(".inline-update-file")).toHaveLength(2);
  });

  it("最小化后保留简要信息并隐藏文件详情", async () => {
    const onToggleMinimized = vi.fn();
    const task = makeTask("success", ["U    src/main.ts"]);
    const view = render(InlineUpdatePanel, {
      props: {
        workingCopyRoot: "C:\\repo",
        task,
        onToggleMinimized,
      },
    });
    const panel = screen.getByLabelText("主界面 Update");

    await fireEvent.click(within(panel).getByRole("button", { name: "最小化 Update" }));
    expect(onToggleMinimized).toHaveBeenCalledTimes(1);
    await view.rerender({
      workingCopyRoot: "C:\\repo",
      task,
      minimized: true,
      onToggleMinimized,
    });

    expect(within(panel).getByLabelText("Update 简要信息")).toHaveTextContent("文件 1");
    expect(within(panel).queryByRole("listitem")).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "展开 Update 详情" })).toBeInTheDocument();
  });
});

function makeTask(status: Task["status"], messages: string[]): Task {
  return {
    task_id: "update-1",
    title: "更新工作副本",
    status,
    error: null,
    logs: messages.map((message, index) => ({ message, created_at: index + 1 })),
    result: null,
    created_at: Date.now() - 2000,
    updated_at: Date.now(),
  };
}
