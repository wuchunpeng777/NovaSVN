import { describe, expect, it } from "vitest";
import {
  isRepositoryUrl,
  joinRepositoryUrl,
  parentRepositoryUrl,
  repositoryBreadcrumbs,
  repositoryEntryKindLabel,
} from "./repository-url";

describe("repository-url", () => {
  it("detects repository URL schemes", () => {
    expect(isRepositoryUrl("https://example.com/svn/trunk")).toBe(true);
    expect(isRepositoryUrl("svn://server/repo")).toBe(true);
    expect(isRepositoryUrl("file:///C:/repo")).toBe(true);
    expect(isRepositoryUrl("C:\\wc")).toBe(false);
    expect(isRepositoryUrl("")).toBe(false);
  });

  it("joins and parents repository URLs", () => {
    expect(joinRepositoryUrl("https://example.com/svn", "trunk/src")).toBe(
      "https://example.com/svn/trunk/src",
    );
    expect(parentRepositoryUrl("https://example.com/svn/trunk/src")).toBe(
      "https://example.com/svn/trunk",
    );
    expect(parentRepositoryUrl("https://example.com")).toBe("https://example.com");
  });

  it("builds breadcrumbs from repository URLs", () => {
    expect(repositoryBreadcrumbs("https://example.com/svn/trunk/src")).toEqual([
      { label: "https://example.com", url: "https://example.com" },
      { label: "svn", url: "https://example.com/svn" },
      { label: "trunk", url: "https://example.com/svn/trunk" },
      { label: "src", url: "https://example.com/svn/trunk/src" },
    ]);
  });

  it("labels entry kinds in Chinese", () => {
    expect(repositoryEntryKindLabel("dir")).toBe("目录");
    expect(repositoryEntryKindLabel("file")).toBe("文件");
    expect(repositoryEntryKindLabel("unknown")).toBe("unknown");
  });
});
