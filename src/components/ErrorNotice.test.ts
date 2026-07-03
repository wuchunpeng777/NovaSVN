import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import ErrorNotice from "./ErrorNotice.svelte";

describe("ErrorNotice", () => {
  it("renders command error details and retry state", () => {
    render(ErrorNotice, {
      props: {
        error: {
          code: "SVN_FAILED",
          message: "SVN 执行失败",
          detail: "请检查 svn.exe 路径",
          recoverable: true,
        },
      },
    });

    expect(screen.getByRole("alert", { name: "命令错误" })).toBeInTheDocument();
    expect(screen.getByText("SVN 执行失败")).toBeInTheDocument();
    expect(screen.getByText("SVN_FAILED")).toBeInTheDocument();
    expect(screen.getByText("请检查 svn.exe 路径")).toBeInTheDocument();
    expect(screen.getByText("可重试")).toBeInTheDocument();
  });
});
