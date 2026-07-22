import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { FileContentDiff } from "../../types/api";
import ConflictResolver from "./ConflictResolver.svelte";

const contentDiff: FileContentDiff = {
  path: "src/conflict.ts",
  original_text: "const value = 'base';\n",
  modified_text: [
    "<<<<<<< .mine\n",
    "const value = 'mine';\n",
    "||||||| .r10\n",
    "const value = 'base';\n",
    "=======\n",
    "const value = 'theirs';\n",
    ">>>>>>> .r11\n",
  ].join(""),
  language: "typescript",
  binary: false,
  too_large: false,
  max_bytes: 512 * 1024,
};

describe("ConflictResolver", () => {
  it("resolves a conflict block, permits editing, and saves the result", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(true);
    render(ConflictResolver, {
      props: {
        open: true,
        filePath: contentDiff.path,
        contentDiff,
        onClose,
        onSave,
      },
    });

    const dialog = screen.getByRole("dialog", { name: "解决文本冲突" });
    expect(within(dialog).getByText("0/1")).toBeInTheDocument();
    const saveButton = within(dialog).getByRole("button", { name: "保存并标记已解决" });
    expect(saveButton).toBeDisabled();

    await fireEvent.click(
      within(within(dialog).getByLabelText("我的版本")).getByRole("button", { name: "采用" }),
    );
    expect(within(dialog).getByText("1/1")).toBeInTheDocument();
    expect(saveButton).toBeEnabled();

    const result = within(dialog).getByLabelText("可编辑的合并结果");
    expect(result).toHaveValue("const value = 'mine';\n");
    await fireEvent.input(result, { target: { value: "const value = 'reviewed';\n" } });
    await fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledWith(
      "src/conflict.ts",
      "const value = 'reviewed';\n",
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("falls back to whole-file actions when text markers are unavailable", async () => {
    const onUseMineFull = vi.fn();
    const onClose = vi.fn();
    render(ConflictResolver, {
      props: {
        open: true,
        filePath: "asset.bin",
        contentDiff: { ...contentDiff, path: "asset.bin", binary: true, modified_text: "" },
        onUseMineFull,
        onClose,
      },
    });

    expect(screen.getByText("二进制冲突")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "使用我的版本" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onUseMineFull).toHaveBeenCalledWith("asset.bin");
  });
});
