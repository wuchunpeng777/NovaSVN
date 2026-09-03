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

  it("按关键字过滤已加载的 Revision", async () => {
    getRepositoryFileLogMock.mockResolvedValue(
      makeLog({
        entries: [
          {
            revision: "42",
            author: "alice",
            date: "2026-07-22T18:30:00Z",
            message: "Add checkout window",
            changed_paths: [],
          },
          {
            revision: "41",
            author: "bob",
            date: "2026-07-21T10:00:00Z",
            message: "Fix menu",
            changed_paths: [
              {
                path: "/trunk/src/menu.ts",
                action: "M",
                kind: "file",
                copy_from_path: null,
                copy_from_revision: null,
              },
            ],
          },
        ],
      }),
    );
    render(SvnRevisionPickerDialog, {
      props: {
        repositoryUrl: "https://example.com/svn/trunk",
      },
    });

    await screen.findByText("Add checkout window");
    expect(screen.getByRole("option", { name: "选择 HEAD" })).toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText("搜索 Revision"), {
      target: { value: "menu" },
    });

    expect(screen.queryByText("Add checkout window")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "选择 HEAD" })).not.toBeInTheDocument();
    expect(screen.getByText("Fix menu")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "选择 r41" })).toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText("搜索 Revision"), {
      target: { value: "nobody" },
    });
    expect(screen.getByText("没有匹配的 Revision")).toBeInTheDocument();
  });

  it("连续加载全部剩余日志页", async () => {
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
              revision: "42",
              author: "alice",
              date: "2026-07-22T18:30:00Z",
              message: "duplicate",
              changed_paths: [],
            },
            {
              revision: "41",
              author: "bob",
              date: "2026-07-21T10:00:00Z",
              message: "Second page",
              changed_paths: [],
            },
          ],
          has_more: true,
          next_start_revision: "40",
        }),
      )
      .mockResolvedValueOnce(
        makeLog({
          entries: [
            {
              revision: "40",
              author: "carol",
              date: "2026-07-20T10:00:00Z",
              message: "Final page",
              changed_paths: [],
            },
          ],
        }),
      );

    render(SvnRevisionPickerDialog, {
      props: {
        repositoryUrl: "https://example.com/svn/trunk",
      },
    });

    await screen.findByText("Add checkout window");
    expect(screen.getByRole("button", { name: "加载全部" })).toBeEnabled();

    await fireEvent.click(screen.getByRole("button", { name: "加载全部" }));

    expect(await screen.findByText("Final page")).toBeInTheDocument();
    expect(screen.getByText("Second page")).toBeInTheDocument();
    expect(getRepositoryFileLogMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        start_revision: "41",
      }),
    );
    expect(getRepositoryFileLogMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        start_revision: "40",
      }),
    );
    expect(screen.getByRole("button", { name: "加载全部" })).toBeDisabled();
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
