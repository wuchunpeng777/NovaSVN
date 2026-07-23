import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getSvnInfo: vi.fn(),
}));

import { getSvnInfo } from "../lib/api";
import StandaloneInfoWindow from "./StandaloneInfoWindow.svelte";

const getSvnInfoMock = vi.mocked(getSvnInfo);

beforeEach(() => {
  getSvnInfoMock.mockReset();
  getSvnInfoMock.mockResolvedValue({
    target_path: "C:\\repo\\src\\main.rs",
    working_copy_root: "C:\\repo",
    relative_path: "src/main.rs",
    kind: "file",
    repository_url: "https://example.com/svn/trunk/src/main.rs",
    repository_root: "https://example.com/svn",
    repository_uuid: "abc-123",
    revision: "42",
    last_changed_revision: "41",
    last_changed_author: "alice",
    last_changed_date: "2026-07-23T10:20:30Z",
  });
});

describe("StandaloneInfoWindow", () => {
  it("读取并展示当前路径的 SVN 信息", async () => {
    render(StandaloneInfoWindow, {
      props: { targetPath: "C:\\repo\\src\\main.rs", svnExecutable: "C:\\Tools\\svn.exe" },
    });

    await waitFor(() => {
      expect(getSvnInfoMock).toHaveBeenCalledWith({
        path: "C:\\repo\\src\\main.rs",
        svn_executable: "C:\\Tools\\svn.exe",
      });
    });
    expect(await screen.findByText("https://example.com/svn/trunk/src/main.rs")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("r42")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "登录 SVN" })).not.toBeInTheDocument();
  });

  it("仅在 SVN 返回认证失败后显示登录对话框", async () => {
    getSvnInfoMock.mockRejectedValue({
      code: "SVN_INFO_FAILED",
      message: "无法读取 SVN 信息",
      detail: "svn: E215004: Authentication failed",
      recoverable: true,
    });
    render(StandaloneInfoWindow, { props: { targetPath: "C:\\repo" } });

    expect(await screen.findByRole("dialog", { name: "登录 SVN" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录并重试" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "关闭 SVN 登录对话框" }));
    expect(screen.queryByRole("dialog", { name: "登录 SVN" })).not.toBeInTheDocument();
  });
});
