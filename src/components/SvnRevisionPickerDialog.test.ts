import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getRepositoryFileLog: vi.fn(),
}));

import { getRepositoryFileLog } from "../lib/api";
import type { SvnLog } from "../types/api";
import SvnRevisionPickerDialog from "./SvnRevisionPickerDialog.svelte";

const getRepositoryFileLogMock = vi.mocked(getRepositoryFileLog);

beforeEach(() => {
  getRepositoryFileLogMock.mockReset();
  getRepositoryFileLogMock.mockResolvedValue(makeLog());
});

describe("SvnRevisionPickerDialog", () => {
  it("读取仓库日志并选择指定 Revision", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(SvnRevisionPickerDialog, {
      props: {
        repositoryUrl: "https://example.com/svn/trunk",
        currentRevision: "10",
        onSelect,
        onClose,
      },
    });

    const dialog = await screen.findByRole("dialog", { name: "选择 Revision" });
    await waitFor(() => {
      expect(getRepositoryFileLogMock).toHaveBeenCalledWith({
        url: "https://example.com/svn/trunk",
        svn_executable: undefined,
        limit: 50,
      });
    });
    expect(dialog).toHaveTextContent("Add checkout window");

    await fireEvent.click(screen.getByRole("option", { name: "选择 r42" }));
    await fireEvent.click(screen.getByRole("button", { name: "使用 r42" }));

    expect(onSelect).toHaveBeenCalledWith("42");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("双击条目立即回填 Revision", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(SvnRevisionPickerDialog, {
      props: {
        repositoryUrl: "https://example.com/svn/project",
        onSelect,
        onClose,
      },
    });

    await screen.findByRole("option", { name: "选择 r42" });
    await fireEvent.dblClick(screen.getByRole("option", { name: "选择 r42" }));

    expect(onSelect).toHaveBeenCalledWith("42");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("可以选择 HEAD 并加载更多日志", async () => {
    getRepositoryFileLogMock
      .mockResolvedValueOnce(
        makeLog({
          has_more: true,
          next_start_revision: "41",
        }),
      )
      .mockResolvedValueOnce(
        makeLog({
          entries: [
            {
              revision: "40",
              author: "bob",
              date: "2026-07-20T10:00:00Z",
              message: "Older change",
              changed_paths: [],
            },
          ],
        }),
      );
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(SvnRevisionPickerDialog, {
      props: {
        repositoryUrl: "https://example.com/svn/trunk",
        currentRevision: "42",
        svnExecutable: "C:\\Tools\\svn.exe",
        onSelect,
        onClose,
      },
    });

    await screen.findByText("Add checkout window");
    await fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("Older change")).toBeInTheDocument();
    expect(getRepositoryFileLogMock).toHaveBeenLastCalledWith({
      url: "https://example.com/svn/trunk",
      svn_executable: "C:\\Tools\\svn.exe",
      limit: 50,
      start_revision: "41",
    });

    await fireEvent.click(screen.getByRole("option", { name: "选择 HEAD" }));
    await fireEvent.click(screen.getByRole("button", { name: "使用 HEAD" }));
    expect(onSelect).toHaveBeenCalledWith("");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("仓库 URL 无效时显示错误且不请求日志", async () => {
    render(SvnRevisionPickerDialog, {
      props: {
        repositoryUrl: "not-a-url",
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("请先输入有效的仓库 URL");
    expect(getRepositoryFileLogMock).not.toHaveBeenCalled();
  });
});

function makeLog(overrides: Partial<SvnLog> = {}): SvnLog {
  return {
    target: "https://example.com/svn/trunk",
    entries: [
      {
        revision: "42",
        author: "alice",
        date: "2026-07-22T18:30:00Z",
        message: "Add checkout window",
        changed_paths: [],
      },
    ],
    has_more: false,
    next_start_revision: null,
    ...overrides,
  };
}
