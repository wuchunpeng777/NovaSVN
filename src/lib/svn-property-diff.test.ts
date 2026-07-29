import { describe, expect, it } from "vitest";
import { buildPropertyContentDiff } from "./svn-property-diff";

describe("buildPropertyContentDiff", () => {
  it("将多个 SVN 属性补丁转换为左右内容", () => {
    const result = buildPropertyContentDiff({
      path: "src",
      node_kind: "dir",
      binary: false,
      empty: false,
      text: [
        "Index: src",
        "Property changes on: src",
        "___________________________________________________________________",
        "Modified: svn:ignore",
        "## -1 +1,2 ##",
        "-dist",
        "+build",
        "+cache",
        "Added: svn:externals",
        "## -0,0 +1 ##",
        "+vendor https://example.com/svn/vendor",
      ].join("\n"),
    });

    expect(result).toMatchObject({
      path: "src",
      node_kind: "dir",
      language: "plaintext",
      binary: false,
      too_large: false,
      original_encoding: "UTF-8",
      modified_encoding: "UTF-8",
    });
    expect(result?.original_text).toBe(
      "属性: svn:ignore\ndist\n\n属性: svn:externals\n<未设置>",
    );
    expect(result?.modified_text).toBe(
      "属性: svn:ignore\nbuild\ncache\n\n属性: svn:externals\nvendor https://example.com/svn/vendor",
    );
  });

  it("普通代码补丁不生成属性内容", () => {
    expect(buildPropertyContentDiff({
      path: "src/main.ts",
      node_kind: "file",
      binary: false,
      empty: false,
      text: "@@ -1 +1 @@\n-old\n+new",
    })).toBeNull();
  });
});
