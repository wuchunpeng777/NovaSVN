declare module "monaco-editor/esm/vs/editor/editor.api" {
  const api: typeof import("monaco-editor");
  export = api;
}

declare module "monaco-editor/esm/vs/basic-languages/*/*.contribution" {}
declare module "monaco-editor/esm/vs/basic-languages/*" {}

declare module "monaco-editor/esm/vs/language/json/monaco.contribution" {}
