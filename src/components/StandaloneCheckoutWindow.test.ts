import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  chooseCheckoutTargetDirectory: vi.fn(),
  createRepositoryCheckoutTask: vi.fn(),
  getTask: vi.fn(),
  openLocalPathLocation: vi.fn(),
}));

import {
  cancelTask,
  chooseCheckoutTargetDirectory,
  createRepositoryCheckoutTask,
  getTask,
  openLocalPathLocation,
} from "../lib/api";
import type { Task, TaskStatus } from "../types/api";
import StandaloneCheckoutWindow from "./StandaloneCheckoutWindow.svelte";

const cancelTaskMock = vi.mocked(cancelTask);
const chooseCheckoutTargetDirectoryMock = vi.mocked(chooseCheckoutTargetDirectory);
const createRepositoryCheckoutTaskMock = vi.mocked(createRepositoryCheckoutTask);
const getTaskMock = vi.mocked(getTask);
const openLocalPathLocationMock = vi.mocked(openLocalPathLocation);

beforeEach(() => {
  cancelTaskMock.mockReset();
  chooseCheckoutTargetDirectoryMock.mockReset();
  createRepositoryCheckoutTaskMock.mockReset();
  getTaskMock.mockReset();
  openLocalPathLocationMock.mockReset();
  createRepositoryCheckoutTaskMock.mockResolvedValue(makeTask("pending"));
  getTaskMock.mockResolvedValue(
    makeTask("success", [
      "仓库 Checkout 开始执行",
      "A    src/main.ts",
      "Checked out revision 42.",
      "仓库 Checkout 成功",
    ]),
  );
  openLocalPathLocationMock.mockResolvedValue({ target_path: "C:\\work\\project" });
});

describe("StandaloneCheckoutWindow", () => {
  it("预填右键目录并通过独立窗口执行 Checkout", async () => {
    render(StandaloneCheckoutWindow, {
      props: {
        targetPath: "C:\\work\\project",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });

    const urlInput = screen.getByLabelText("仓库 URL");
    expect(urlInput).toHaveFocus();
    expect(screen.getByLabelText("本地目录")).toHaveValue("C:\\work\\project");
    await fireEvent.input(urlInput, {
      target: { value: "https://example.com/svn/project/trunk" },
    });
    await fireEvent.input(screen.getByLabelText("Revision"), { target: { value: "42" } });
    await fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(createRepositoryCheckoutTaskMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/project/trunk",
        local_path: "C:\\work\\project",
        revision: "42",
        svn_executable: "C:\\Tools\\svn.exe",
      });
    });
    const output = screen.getByRole("log");
    expect(await within(output).findByText("Checked out revision 42.")).toBeInTheDocument();
    expect(within(output).getByRole("status", { name: "Checkout 完成" })).toHaveTextContent(
      "C:\\work\\project",
    );
  });

  it("缺少仓库 URL 时在窗口内显示校验错误", async () => {
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });

    await fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    expect(screen.getByRole("alert", { name: "命令错误" })).toHaveTextContent("请输入仓库 URL");
    expect(createRepositoryCheckoutTaskMock).not.toHaveBeenCalled();
  });

  it("允许重新选择 Checkout 目标目录", async () => {
    chooseCheckoutTargetDirectoryMock.mockResolvedValue("D:\\checkouts\\trunk");
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });

    await fireEvent.click(screen.getByRole("button", { name: "选择 Checkout 目录" }));

    expect(screen.getByLabelText("本地目录")).toHaveValue("D:\\checkouts\\trunk");
  });

  it("运行中可以取消 Checkout", async () => {
    createRepositoryCheckoutTaskMock.mockResolvedValue(makeTask("running"));
    getTaskMock.mockImplementation(() => new Promise<Task>(() => {}));
    cancelTaskMock.mockResolvedValue(makeTask("cancelled"));
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });
    await fireEvent.input(screen.getByLabelText("仓库 URL"), {
      target: { value: "https://example.com/svn/project/trunk" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    const stopButton = await screen.findByRole("button", { name: "停止" });
    await fireEvent.click(stopButton);

    expect(cancelTaskMock).toHaveBeenCalledWith("checkout-task");
    expect(await screen.findByText("已取消")).toBeInTheDocument();
  });

  it("完成后可以在资源管理器中显示目标目录", async () => {
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });
    await fireEvent.input(screen.getByLabelText("仓库 URL"), {
      target: { value: "https://example.com/svn/project/trunk" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await fireEvent.click(
      await screen.findByRole("button", { name: "在资源管理器中显示" }),
    );

    expect(openLocalPathLocationMock).toHaveBeenCalledWith({ path: "C:\\work\\project" });
  });
});

function makeTask(status: TaskStatus, messages = ["仓库 Checkout 任务已加入队列"]): Task {
  return {
    task_id: "checkout-task",
    title: "Checkout trunk",
    status,
    error: null,
    logs: messages.map((message, index) => ({
      message,
      created_at: 1_725_000_000_000 + index * 1000,
    })),
    result: null,
    created_at: 1_725_000_000_000,
    updated_at: 1_725_000_000_000,
  };
}
