import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileContentDiff } from "../../types/api";

const mocks = vi.hoisted(() => {
  const state: { onDidUpdateDiff: (() => void) | null } = { onDidUpdateDiff: null };
  return {
    state,
    goToDiff: vi.fn(),
    focus: vi.fn(),
    getLineChanges: vi.fn(() => [{ originalStartLineNumber: 1 }, { originalStartLineNumber: 4 }]),
    onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
    createModel: vi.fn((value: string) => ({
      dispose: vi.fn(),
      getLineCount: () => value.split("\n").length,
    })),
    setModel: vi.fn(),
    updateOptions: vi.fn(),
    disposeEditor: vi.fn(),
    disposeDiffListener: vi.fn(),
  };
});

vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({ default: vi.fn() }));
vi.mock("monaco-editor/esm/vs/editor/editor.api", () => ({
  editor: {
    createDiffEditor: vi.fn(() => ({
      dispose: mocks.disposeEditor,
      getLineChanges: mocks.getLineChanges,
      getModifiedEditor: () => ({
        focus: mocks.focus,
        onDidChangeCursorPosition: mocks.onDidChangeCursorPosition,
      }),
      goToDiff: mocks.goToDiff,
      onDidUpdateDiff: (callback: () => void) => {
        mocks.state.onDidUpdateDiff = callback;
        return { dispose: mocks.disposeDiffListener };
      },
      setModel: mocks.setModel,
      updateOptions: mocks.updateOptions,
    })),
    createModel: mocks.createModel,
    setTheme: vi.fn(),
  },
}));

vi.mock("monaco-editor/esm/vs/basic-languages/css/css.contribution", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/html/html.contribution", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/rust/rust.contribution", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/shell/shell.contribution", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/sql/sql.contribution", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/xml/xml.contribution", () => ({}));
vi.mock("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution", () => ({}));

import MonacoDiffViewer from "./MonacoDiffViewer.svelte";

const contentDiff: FileContentDiff = {
  path: "src/main.ts",
  original_text: "const before = 1;\n",
  modified_text: "const after = 2;\n",
  language: "typescript",
  binary: false,
  too_large: false,
  max_bytes: 512 * 1024,
};

describe("MonacoDiffViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.onDidUpdateDiff = null;
  });

  it("reveals the first computed difference, then navigates between differences", async () => {
    render(MonacoDiffViewer, { props: { contentDiff } });

    await waitFor(() => expect(mocks.state.onDidUpdateDiff).not.toBeNull());
    mocks.state.onDidUpdateDiff?.();
    await waitFor(() => expect(screen.getByText("1 / 2 处差异")).toBeInTheDocument());
    expect(mocks.goToDiff).toHaveBeenCalledOnce();
    expect(mocks.goToDiff).toHaveBeenLastCalledWith("next");
    expect(mocks.focus).not.toHaveBeenCalled();
    mocks.state.onDidUpdateDiff?.();
    expect(mocks.goToDiff).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByRole("button", { name: "下一处差异" }));
    expect(screen.getByText("2 / 2 处差异")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "上一处差异" }));
    expect(screen.getByText("1 / 2 处差异")).toBeInTheDocument();

    expect(mocks.goToDiff).toHaveBeenNthCalledWith(2, "next");
    expect(mocks.goToDiff).toHaveBeenNthCalledWith(3, "previous");
    expect(mocks.focus).toHaveBeenCalledTimes(2);
  });

  it("reserves line number separation when side-by-side mode automatically collapses", async () => {
    const largeContentDiff: FileContentDiff = {
      ...contentDiff,
      original_text: `${"unchanged\n".repeat(1_000)}before\n`,
      modified_text: `${"unchanged\n".repeat(1_000)}after\n`,
    };
    const { container } = render(MonacoDiffViewer, {
      props: { contentDiff: largeContentDiff },
    });

    await waitFor(() => {
      expect(mocks.updateOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          renderSideBySide: true,
          lineNumbersMinChars: 6,
        }),
      );
    });
    expect(container.querySelector(".monaco-diff-viewer")).not.toHaveClass("inline-mode");
  });
});
