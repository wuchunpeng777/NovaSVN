import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(),
  chooseCheckoutTargetDirectory: vi.fn(),
  createRepositoryCheckoutTask: vi.fn(),
  getTask: vi.fn(),
  openLocalPathLocation: vi.fn(),
  readClipboardText: vi.fn(),
}));

import {
  cancelTask,
  chooseCheckoutTargetDirectory,
  createRepositoryCheckoutTask,
  getTask,
  openLocalPathLocation,
  readClipboardText,
} from "../lib/api";
import type { Task, TaskStatus } from "../types/api";
import StandaloneCheckoutWindow from "./StandaloneCheckoutWindow.svelte";

const cancelTaskMock = vi.mocked(cancelTask);
const chooseCheckoutTargetDirectoryMock = vi.mocked(chooseCheckoutTargetDirectory);
const createRepositoryCheckoutTaskMock = vi.mocked(createRepositoryCheckoutTask);
const getTaskMock = vi.mocked(getTask);
const openLocalPathLocationMock = vi.mocked(openLocalPathLocation);
const readClipboardTextMock = vi.mocked(readClipboardText);

beforeEach(() => {
  cancelTaskMock.mockReset();
  chooseCheckoutTargetDirectoryMock.mockReset();
  createRepositoryCheckoutTaskMock.mockReset();
  getTaskMock.mockReset();
  openLocalPathLocationMock.mockReset();
  readClipboardTextMock.mockReset();
  readClipboardTextMock.mockResolvedValue("");
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
  it("使用剪贴板中的合法仓库 URL 预填输入框", async () => {
    readClipboardTextMock.mockResolvedValue("  svn+ssh://user@example.com/project/trunk\r\n");
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });

    const urlInput = screen.getByLabelText("仓库 URL");
    await waitFor(() => {
      expect(urlInput).toHaveValue("svn+ssh://user@example.com/project/trunk");
    });
    expect(urlInput).not.toHaveAttribute("placeholder");
  });

  it.each(["", "default", "普通文本", "https://"])(
    "剪贴板内容 %j 不是合法仓库 URL 时保持空白",
    async (clipboardText) => {
      readClipboardTextMock.mockResolvedValue(clipboardText);
      render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });

      const urlInput = screen.getByLabelText("仓库 URL");
      await waitFor(() => expect(readClipboardTextMock).toHaveBeenCalledOnce());
      expect(urlInput).toHaveValue("");
      expect(urlInput).not.toHaveAttribute("placeholder");
    },
  );

  it("剪贴板读取失败时保持空白", async () => {
    readClipboardTextMock.mockRejectedValue(new Error("clipboard unavailable"));
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });

    const urlInput = screen.getByLabelText("仓库 URL");
    await waitFor(() => expect(readClipboardTextMock).toHaveBeenCalledOnce());
    expect(urlInput).toHaveValue("");
  });

  it("不会用稍后返回的剪贴板地址覆盖用户输入", async () => {
    let resolveClipboard!: (value: string) => void;
    readClipboardTextMock.mockReturnValue(
      new Promise((resolve) => {
        resolveClipboard = resolve;
      }),
    );
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });

    const urlInput = screen.getByLabelText("仓库 URL");
    await fireEvent.input(urlInput, {
      target: { value: "https://manual.example.com/repo" },
    });
    resolveClipboard("https://clipboard.example.com/repo");

    await waitFor(() => expect(readClipboardTextMock).toHaveBeenCalledOnce());
    expect(urlInput).toHaveValue("https://manual.example.com/repo");
  });

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
    expect(
      await within(output).findByRole("listitem", { name: "Checkout 文件 src/main.ts" }),
    ).toBeInTheDocument();
    expect(within(output).queryByText("Checked out revision 42.")).not.toBeInTheDocument();
    expect(within(output).getByRole("status", { name: "Checkout 完成" })).toHaveTextContent(
      "C:\\work\\project",
    );
  });

  it("Checkout 运行期间逐次展示新增文件", async () => {
    getTaskMock
      .mockResolvedValueOnce(
        makeTask("running", ["仓库 Checkout 开始执行", "A    src/first.ts"]),
      )
      .mockResolvedValueOnce(
        makeTask("success", [
          "仓库 Checkout 开始执行",
          "A    src/first.ts",
          "A    src/second.ts",
          "Checked out revision 42.",
        ]),
      );
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });
    await fireEvent.input(screen.getByLabelText("仓库 URL"), {
      target: { value: "https://example.com/svn/project/trunk" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    expect(
      await screen.findByRole("listitem", { name: "Checkout 文件 src/first.ts" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("listitem", { name: "Checkout 文件 src/second.ts" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("listitem", { name: "Checkout 文件 src/second.ts" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Checkout 完成" })).toBeInTheDocument();
  });

  it("缺少仓库 URL 时在窗口内显示校验错误", async () => {
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });

    await fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    expect(screen.getByRole("alert", { name: "命令错误" })).toHaveTextContent("请输入仓库 URL");
    expect(createRepositoryCheckoutTaskMock).not.toHaveBeenCalled();
  });

  it("手动输入无效仓库 URL 时阻止 Checkout", async () => {
    render(StandaloneCheckoutWindow, { props: { targetPath: "C:\\work\\project" } });
    await fireEvent.input(screen.getByLabelText("仓库 URL"), {
      target: { value: "https://" },
    });

    const form = screen.getByRole("button", { name: "Checkout" }).closest("form");
    expect(form).not.toBeNull();
    await fireEvent.submit(form!);

    expect(screen.getByRole("alert", { name: "命令错误" })).toHaveTextContent("仓库 URL 无效");
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
