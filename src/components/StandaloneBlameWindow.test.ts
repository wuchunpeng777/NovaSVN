import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getSvnBlame: vi.fn(),
  inspectUpdateTarget: vi.fn(),
}));

import { getSvnBlame, inspectUpdateTarget } from "../lib/api";
import StandaloneBlameWindow from "./StandaloneBlameWindow.svelte";

const getSvnBlameMock = vi.mocked(getSvnBlame);
const inspectUpdateTargetMock = vi.mocked(inspectUpdateTarget);

beforeEach(() => {
  getSvnBlameMock.mockReset();
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
});

describe("StandaloneBlameWindow", () => {
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
