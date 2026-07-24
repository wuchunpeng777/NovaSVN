export interface SyntaxToken {
  text: string;
  kind: string;
}

type MonacoApi = typeof import("monaco-editor");

const tokenCache = new Map<string, SyntaxToken[]>();
const pendingTokenizations = new Map<string, Promise<SyntaxToken[]>>();
let monacoPromise: Promise<MonacoApi> | null = null;

const languageContributions = [
  () => import("monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/css/css.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/go/go.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/html/html.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/java/java.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution"),
  () => import("monaco-editor/esm/vs/language/json/monaco.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/python/python.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution"),
  () => import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution"),
];

const aliases: Record<string, string> = {
  c: "cpp",
  html: "html",
  plaintext: "plaintext",
  scss: "css",
  toml: "plaintext",
};

export function tokenizeCodeLine(content: string, language: string): Promise<SyntaxToken[]> {
  const normalizedLanguage = aliases[language.toLowerCase()] ?? language.toLowerCase();
  const key = `${normalizedLanguage}\u0000${content}`;
  const cached = tokenCache.get(key);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  const pending = pendingTokenizations.get(key);
  if (pending) {
    return pending;
  }

  const task = tokenizeLine(content, normalizedLanguage)
    .catch(() => plainTokens(content))
    .then((tokens) => {
      tokenCache.set(key, tokens);
      pendingTokenizations.delete(key);
      return tokens;
    });
  pendingTokenizations.set(key, task);
  return task;
}

async function tokenizeLine(content: string, language: string): Promise<SyntaxToken[]> {
  if (!content || language === "plaintext") {
    return plainTokens(content);
  }

  const monaco = await loadMonaco();
  const lines = monaco.editor.tokenize(content, language);
  const tokens = lines[0] ?? [];
  if (tokens.length === 0) {
    return plainTokens(content);
  }

  const result: SyntaxToken[] = [];
  let cursor = 0;
  tokens.forEach((token, index) => {
    const start = Math.min(Math.max(token.offset, 0), content.length);
    const nextOffset = index + 1 < tokens.length ? tokens[index + 1].offset : content.length;
    const end = Math.min(Math.max(nextOffset, start), content.length);
    if (start > cursor) {
      result.push({ text: content.slice(cursor, start), kind: "plain" });
    }
    if (end > start) {
      result.push({ text: content.slice(start, end), kind: tokenKind(token.type) });
    }
    cursor = end;
  });
  if (cursor < content.length) {
    result.push({ text: content.slice(cursor), kind: "plain" });
  }
  return result.length > 0 ? result : plainTokens(content);
}

async function loadMonaco(): Promise<MonacoApi> {
  if (!monacoPromise) {
    monacoPromise = Promise.all(languageContributions.map((load) => load())).then(
      () => import("monaco-editor/esm/vs/editor/editor.api"),
    );
  }
  return monacoPromise;
}

function plainTokens(content: string): SyntaxToken[] {
  return content ? [{ text: content, kind: "plain" }] : [];
}

function tokenKind(type: string): string {
  const base = type.split(/[.\s]/, 1)[0].toLowerCase();
  if (base.includes("comment")) return "comment";
  if (base.includes("string") || base.includes("regexp")) return "string";
  if (base.includes("number")) return "number";
  if (base.includes("keyword") || base.includes("control")) return "keyword";
  if (base.includes("type") || base.includes("class")) return "type";
  if (base.includes("tag")) return "tag";
  if (base.includes("attribute")) return "attribute";
  if (base.includes("operator")) return "operator";
  return "plain";
}

export function clearSyntaxTokenCache() {
  tokenCache.clear();
  pendingTokenizations.clear();
}
