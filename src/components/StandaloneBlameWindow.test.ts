import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getPathSvnLog: vi.fn(),
  getRepositoryFileBlame: vi.fn(),
  getRepositoryFileLog: vi.fn(),
  getSvnLog: vi.fn(),
  getSvnBlame: vi.fn(),
  inspectUpdateTarget: vi.fn(),
}));

import {
  getPathSvnLog,
  getRepositoryFileBlame,
  getSvnBlame,
  inspectUpdateTarget,
} from "../lib/api";
import StandaloneBlameWindow from "./StandaloneBlameWindow.svelte";

const getSvnBlameMock = vi.mocked(getSvnBlame);
const getPathSvnLogMock = vi.mocked(getPathSvnLog);
const getRepositoryFileBlameMock = vi.mocked(getRepositoryFileBlame);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);

beforeEach(() => {
  getSvnBlameMock.mockReset();
  getPathSvnLogMock.mockReset();
  getRepositoryFileBlameMock.mockReset();
  inspectUpdateTargetMock.mockReset();
  inspectUpdateTargetMock.mockResolvedValue({
    target_path: "C:\\repo\\src\\main.ts",
    working_copy_root: "C:\\repo",
    relative_path: "src/main.ts",
    repository_url: "https://example.com/svn/trunk",
    repository_root: "https://example.com/svn",
    revision: "42",
    kind: "file",
  });
  getSvnBlameMock.mockResolvedValue({
    target: "src/main.ts",
    total_lines: 2,
    truncated: false,
    lines: [
      {
        line_number: 1,
        revision: "40",
        author: "alice",
        date: "2026-07-10T10:00:00Z",
        content: "const answer = 42;",
      },
      {
        line_number: 2,
        revision: "41",
        author: "bob",
        date: "2026-07-11T10:00:00Z",
        content: "export default answer;",
      },
    ],
  });
  getRepositoryFileBlameMock.mockResolvedValue({
    target: "https://example.com/svn/trunk/src/main.ts",
    total_lines: 1,
    truncated: false,
    lines: [
      {
        line_number: 1,
        revision: "42",
        author: "alice",
        date: "2026-07-10T10:00:00Z",
        content: "const answer = 42;",
      },
    ],
  });
});

describe("StandaloneBlameWindow", () => {
  it("使用仓库 URL 和 peg revision 读取独立窗口中的 Blame", async () => {
    render(StandaloneBlameWindow, {
      props: {
        targetPath: "https://example.com/svn/trunk/src/main.ts",
        repositoryRevision: "42",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });

    await waitFor(() => {
      expect(getRepositoryFileBlameMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk/src/main.ts",
        revision: "42",
        svn_executable: "C:\\Tools\\svn.exe",
        max_lines: 5000,
      });
    });
    expect(inspectUpdateTargetMock).not.toHaveBeenCalled();
    expect(getSvnBlameMock).not.toHaveBeenCalled();
    expect(screen.getByText("const answer = 42;")).toBeInTheDocument();
    expect(screen.getByLabelText("Blame 摘要")).toHaveTextContent("Revision 42");
  });

  it("读取右键文件的逐行历史并支持过滤", async () => {
    render(StandaloneBlameWindow, {
      props: {
        targetPath: "C:\\repo\\src\\main.ts",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });

    await waitFor(() => {
      expect(getSvnBlameMock).toHaveBeenCalledWith({
        working_copy_root: "C:\\repo",
        file_path: "src/main.ts",
        svn_executable: "C:\\Tools\\svn.exe",
        max_lines: 5000,
      });
    });
    const table = await screen.findByRole("table", { name: "src/main.ts Blame" });
    expect(within(table).getByText("const answer = 42;")).toBeInTheDocument();
    expect(within(table).getByText("export default answer;")).toBeInTheDocument();

    await fireEvent.input(screen.getByRole("searchbox", { name: "过滤 Blame" }), {
      target: { value: "alice" },
    });
    expect(within(table).getByText("const answer = 42;")).toBeInTheDocument();
    expect(within(table).queryByText("export default answer;")).not.toBeInTheDocument();
  });

  it("支持拖动或键盘调整表头列宽", async () => {
    render(StandaloneBlameWindow, { props: { targetPath: "C:\\repo\\src\\main.ts" } });
    await screen.findByText("const answer = 42;");

    const revisionResizer = screen.getByRole("button", { name: "调整 Revision 列宽" });
    expect(revisionResizer).toHaveAttribute("data-width", "86");
    await fireEvent.keyDown(revisionResizer, { key: "ArrowRight" });
    expect(revisionResizer).toHaveAttribute("data-width", "96");

    await fireEvent.pointerDown(revisionResizer, { clientX: 100 });
    await fireEvent.pointerMove(window, { clientX: 130 });
    await fireEvent.pointerUp(window);
    expect(revisionResizer).toHaveAttribute("data-width", "126");
  });

  it("点击 Revision 后弹窗显示对应 Log 信息", async () => {
    getPathSvnLogMock.mockResolvedValue({
      target: "C:\\repo\\src\\main.ts",
      working_copy_root: "C:\\repo",
      repository_root: "https://example.com/svn",
      repository_url: "https://example.com/svn/trunk/src/main.ts",
      has_more: false,
      next_start_revision: null,
      entries: [
        {
          revision: "40",
          author: "alice",
          date: "2026-07-10T10:00:00Z",
          message: "Introduce the answer",
          changed_paths: [
            {
              path: "/trunk/src/main.ts",
              action: "M",
              kind: "file",
              copy_from_path: null,
              copy_from_revision: null,
            },
          ],
        },
      ],
    });
    render(StandaloneBlameWindow, {
      props: {
        targetPath: "C:\\repo\\src\\main.ts",
        svnExecutable: "C:\\Tools\\svn.exe",
      },
    });

    await fireEvent.click(await screen.findByRole("button", { name: "查看 r40 Log" }));

    const dialog = await screen.findByRole("dialog", { name: "r40 Log 信息" });
    expect(getPathSvnLogMock).toHaveBeenCalledWith({
      path: "C:\\repo\\src\\main.ts",
      svn_executable: "C:\\Tools\\svn.exe",
      limit: 1,
      start_revision: "40",
    });
    expect(within(dialog).getByText("Introduce the answer")).toBeInTheDocument();
    expect(within(dialog).getByText("/trunk/src/main.ts")).toBeInTheDocument();
    expect(within(dialog).getByText("alice")).toBeInTheDocument();

    await fireEvent.click(within(dialog).getByRole("button", { name: "关闭 Revision Log" }));
    expect(screen.queryByRole("dialog", { name: "r40 Log 信息" })).not.toBeInTheDocument();
  });

  it("拒绝目录目标", async () => {
    inspectUpdateTargetMock.mockResolvedValue({
      target_path: "C:\\repo\\src",
      working_copy_root: "C:\\repo",
      relative_path: "src",
      repository_url: "https://example.com/svn/trunk",
      repository_root: "https://example.com/svn",
      revision: "42",
      kind: "dir",
    });
    render(StandaloneBlameWindow, { props: { targetPath: "C:\\repo\\src" } });

    const alert = await screen.findByRole("alert", { name: "命令错误" });
    expect(alert).toHaveTextContent("Blame 仅支持文件");
    expect(getSvnBlameMock).not.toHaveBeenCalled();
  });
});
