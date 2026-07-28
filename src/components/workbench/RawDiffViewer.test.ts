import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RawDiffViewer from "./RawDiffViewer.svelte";

describe("RawDiffViewer", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it("reveals the first unified diff hunk, then jumps between hunks", async () => {
    render(RawDiffViewer, {
      props: {
        text: [
          "Index: src/main.ts",
          "@@ -1,2 +1,2 @@",
          "-before",
          "+after",
          "@@ -8,2 +8,2 @@",
          "-old",
          "+new",
        ].join("\n"),
      },
    });

    expect(screen.getByText("1 / 2 处差异")).toBeInTheDocument();
    await waitFor(() => expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledOnce());
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({
      top: 4,
      behavior: "auto",
    });
    await fireEvent.click(screen.getByRole("button", { name: "下一处差异" }));
    expect(screen.getByText("2 / 2 处差异")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "上一处差异" }));
    expect(screen.getByText("1 / 2 处差异")).toBeInTheDocument();

    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledTimes(3);
  });
});
