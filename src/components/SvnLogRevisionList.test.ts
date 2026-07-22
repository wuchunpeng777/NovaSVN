import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SvnLogRevisionList from "./SvnLogRevisionList.svelte";

describe("SvnLogRevisionList", () => {
  it("keeps author and time immediately after the revision markers", () => {
    render(SvnLogRevisionList, {
      props: {
        entries: [
          {
            revision: "42",
            author: "alice",
            date: "2026-07-22T10:30:00Z",
            message: "Shared log row",
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
        totalEntries: 1,
        formatDate: () => "2026/07/22 18:30",
      },
    });

    const summary = screen.getByRole("button", { name: "展开 r42 日志" });
    const revision = summary.querySelector(".svn-log-revision");
    const author = summary.querySelector(".svn-log-author");
    const time = summary.querySelector("time");

    expect([...summary.children]).toEqual([revision, author, time]);
    expect(revision?.textContent?.replace(/\s/g, "")).toBe("r42M1");
    expect(author).toHaveTextContent("alice");
    expect(time).toHaveTextContent("2026/07/22 18:30");
  });
});
