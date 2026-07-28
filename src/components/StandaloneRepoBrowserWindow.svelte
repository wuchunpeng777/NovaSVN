<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    ChevronDown,
    ChevronRight,
    Copy,
    Download,
    ExternalLink,
    FileText,
    FolderOpen,
    FolderTree,
    GitCommitHorizontal,
    History,
    ListChecks,
    LoaderCircle,
    RefreshCw,
    Trash2,
    X,
  } from "@lucide/svelte";
  import {
    chooseCheckoutTargetDirectory,
    chooseExportDirectory,
    chooseImportSource,
    createRepositoryCheckoutTask,
    createRepositoryCopyTask,
    createRepositoryDeleteTask,
    createRepositoryExportTask,
    createRepositoryFileTask,
    createRepositoryImportTask,
    createRepositoryListTask,
    createRepositoryMkdirTask,
    createRepositoryMoveTask,
    getRepositoryFileBlame,
    getRepositoryFileLog,
    getRepositoryFileProperties,
    getSvnInfo,
    getTask,
    launchLogWindow,
    openLocalPathLocation,
    openRepositoryTempFile,
  } from "../lib/api";
  import { detectSvnAuthenticationFailure } from "../lib/svn-authentication";
  import {
    isRepositoryUrl,
    joinRepositoryUrl,
    parentRepositoryUrl,
    repositoryBreadcrumbs,
    repositoryEntryKindLabel,
  } from "../lib/repository-url";
  import type {
    CommandError,
    RepositoryListEntry,
    RepositoryListResult,
    SvnBlame,
    SvnLog,
    SvnProperties,
    Task,
    TaskStatus,
  } from "../types/api";
  import ErrorNotice from "./ErrorNotice.svelte";
  import SvnAuthenticationDialog from "./SvnAuthenticationDialog.svelte";
  import SyntaxHighlightedCode from "./SyntaxHighlightedCode.svelte";

  export let targetPath = "";
  export let repositoryRevision: string | undefined = undefined;
  export let svnExecutable: string | undefined = undefined;
  export let themeMode: "system" | "light" | "dark" = "system";
  export let svnAuthenticationUsername = "";
  export let svnRememberPassword = true;
  export let svnAuthenticationLoading = false;
  export let svnAuthenticationError: CommandError | null = null;
  export let onSvnAuthenticationSubmit: (
    username: string,
    password: string,
    rememberPassword: boolean,
  ) => Promise<boolean> = async () => false;

  type WriteKind =
    | "mkdir"
    | "import"
    | "copy"
    | "move"
    | "rename"
    | "delete"
    | "checkout"
    | "export";

  type TreeNodeState = {
    url: string;
    label: string;
    expanded: boolean;
    loading: boolean;
    loaded: boolean;
    error: string | null;
    children: Array<{ name: string; url: string; kind: string }>;
  };

  type ContextMenuState = {
    x: number;
    y: number;
    url: string;
    name: string;
    kind: string;
  };

  const terminalStatuses: TaskStatus[] = ["success", "failed", "cancelled", "interrupted"];
  const pollIntervalMs = 350;

  let urlInput = "";
  let revisionInput = repositoryRevision?.trim() ?? "";
  let repositoryRoot: string | null = null;
  let list: RepositoryListResult | null = null;
  let listTask: Task | null = null;
  let writeTask: Task | null = null;
  let fileTask: Task | null = null;
  let commandError: CommandError | null = null;
  let statusMessage: string | null = null;
  let selectedName: string | null = null;
  let activePanel: "none" | "log" | "blame" | "properties" | WriteKind = "none";
  let fileLog: SvnLog | null = null;
  let fileBlame: SvnBlame | null = null;
  let fileProperties: SvnProperties | null = null;
  let detailLoading = false;
  let detailError: CommandError | null = null;
  let formName = "";
  let formMessage = "";
  let formSourceUrl = "";
  let formTargetUrl = "";
  let formLocalPath = "";
  let formRevision = "";
  let contextMenu: ContextMenuState | null = null;
  let contextMenuElement: HTMLDivElement | null = null;
  let urlInputElement: HTMLInputElement | null = null;
  let treePaneWidth = 260;
  let treeResizeStart: { x: number; width: number } | null = null;
  let treeByUrl: Record<string, TreeNodeState> = {};
  let treeRootUrl: string | null = null;
  let resolvingInitial = false;
  let pollTimer: number | null = null;
  let generation = 0;
  let systemPrefersDark = false;
  let themeMediaQuery: MediaQueryList | null = null;

  $: resolvedTheme =
    themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  $: listRunning = isTaskRunning(listTask);
  $: writeRunning = isTaskRunning(writeTask);
  $: fileRunning = isTaskRunning(fileTask);
  $: busy = listRunning || writeRunning || fileRunning || resolvingInitial || detailLoading;
  $: currentUrl = list?.url ?? urlInput.trim();
  $: breadcrumbs = repositoryBreadcrumbs(currentUrl);
  $: entries = list?.entries ?? [];
  $: authenticationFailure =
    detectSvnAuthenticationFailure(commandErrorText(commandError)) ??
    detectSvnAuthenticationFailure(listTask?.error ?? null) ??
    detectSvnAuthenticationFailure(writeTask?.error ?? null) ??
    detectSvnAuthenticationFailure(fileTask?.error ?? null) ??
    detectSvnAuthenticationFailure(commandErrorText(detailError));
  $: revisionLabel = list?.revision
    ? `r${list.revision}`
    : revisionInput.trim()
      ? `r${revisionInput.trim()}`
      : "HEAD";

  onMount(() => {
    if (typeof window.matchMedia === "function") {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      systemPrefersDark = themeMediaQuery.matches;
      themeMediaQuery.addEventListener("change", handleThemeChange);
    }
    window.addEventListener("keydown", handleWindowKeydown);
    window.addEventListener("pointerdown", handleOutsidePointer, true);
    void initialize();
  });

  onDestroy(() => {
    generation += 1;
    clearPollTimer();
    window.removeEventListener("keydown", handleWindowKeydown);
    window.removeEventListener("pointerdown", handleOutsidePointer, true);
    themeMediaQuery?.removeEventListener("change", handleThemeChange);
    window.removeEventListener("pointermove", handleTreeResizeMove);
    window.removeEventListener("pointerup", handleTreeResizeEnd);
  });

  async function initialize() {
    const currentGeneration = ++generation;
    resolvingInitial = true;
    commandError = null;
    statusMessage = null;
    try {
      const initial = targetPath.trim();
      if (!initial) {
        await tick();
        urlInputElement?.focus();
        return;
      }
      if (isRepositoryUrl(initial)) {
        urlInput = initial.replace(/\/+$/, "");
        await loadDirectory(urlInput, currentGeneration, true);
        return;
      }
      statusMessage = "正在解析工作副本仓库 URL...";
      const info = await getSvnInfo({
        path: initial,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (currentGeneration !== generation) {
        return;
      }
      repositoryRoot = info.repository_root?.replace(/\/+$/, "") || null;
      urlInput = (info.repository_url || info.repository_root || "").replace(/\/+$/, "");
      if (!revisionInput && info.revision) {
        // 默认从 WC 打开时浏览 HEAD，避免锁定在旧 revision。
        revisionInput = "";
      }
      if (!urlInput) {
        commandError = formError(
          "REPO_BROWSER_URL_MISSING",
          "无法解析仓库 URL",
          "该路径没有返回可用的 SVN 仓库 URL。",
        );
        await tick();
        urlInputElement?.focus();
        return;
      }
      await loadDirectory(urlInput, currentGeneration, true);
    } catch (caught) {
      if (currentGeneration === generation) {
        commandError = normalizeCommandError(caught);
        await tick();
        urlInputElement?.focus();
      }
    } finally {
      if (currentGeneration === generation) {
        resolvingInitial = false;
        statusMessage = null;
      }
    }
  }

  async function loadDirectory(
    url: string,
    requestGeneration = generation,
    seedTree = false,
  ) {
    const target = url.trim().replace(/\/+$/, "");
    if (!target) {
      commandError = formError(
        "REPO_BROWSER_URL_REQUIRED",
        "请输入仓库 URL",
        "Repository Browser 需要一个 SVN 仓库 URL。",
      );
      return;
    }
    if (listRunning) {
      return;
    }

    const requestedRevision = revisionInput.trim();
    if (requestedRevision && !/^\d+$/.test(requestedRevision)) {
      commandError = formError(
        "REPO_BROWSER_REVISION_INVALID",
        "Revision 无效",
        "Revision 必须是数字，留空则使用 HEAD。",
      );
      return;
    }

    clearPollTimer();
    commandError = null;
    detailError = null;
    statusMessage = "正在加载仓库目录...";
    selectedName = null;
    closeContextMenu();
    urlInput = target;
    listTask = null;

    try {
      const task = await createRepositoryListTask({
        url: target,
        revision: requestedRevision || undefined,
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (requestGeneration !== generation) {
        return;
      }
      listTask = task;
      if (seedTree || !treeRootUrl) {
        ensureTreeRoot(target);
      }
      markTreeLoading(target);
      schedulePoll(task.task_id, requestGeneration, "list", target);
    } catch (caught) {
      if (requestGeneration === generation) {
        commandError = normalizeCommandError(caught);
        statusMessage = null;
        markTreeError(target, commandError.message);
      }
    }
  }

  function ensureTreeRoot(url: string) {
    const root = repositoryRoot || deriveTreeRoot(url);
    treeRootUrl = root;
    if (!treeByUrl[root]) {
      treeByUrl = {
        ...treeByUrl,
        [root]: {
          url: root,
          label: rootLabel(root),
          expanded: true,
          loading: false,
          loaded: false,
          error: null,
          children: [],
        },
      };
    } else {
      treeByUrl = {
        ...treeByUrl,
        [root]: { ...treeByUrl[root], expanded: true },
      };
    }
  }

  function deriveTreeRoot(url: string): string {
    const crumbs = repositoryBreadcrumbs(url);
    if (crumbs.length === 0) {
      return url.replace(/\/+$/, "");
    }
    // 尽量把仓库根作为树根：取 authority 后的第一级路径或整个 authority。
    if (crumbs.length >= 2) {
      return crumbs[1].url;
    }
    return crumbs[0].url;
  }

  function rootLabel(url: string): string {
    const crumbs = repositoryBreadcrumbs(url);
    return crumbs[crumbs.length - 1]?.label || url;
  }

  function markTreeLoading(url: string) {
    const existing = treeByUrl[url];
    if (!existing) {
      return;
    }
    treeByUrl = {
      ...treeByUrl,
      [url]: { ...existing, loading: true, error: null },
    };
  }

  function markTreeError(url: string, message: string) {
    const existing = treeByUrl[url];
    if (!existing) {
      return;
    }
    treeByUrl = {
      ...treeByUrl,
      [url]: { ...existing, loading: false, error: message },
    };
  }

  function applyListToTree(result: RepositoryListResult) {
    const url = result.url.replace(/\/+$/, "");
    const children = result.entries
      .filter((entry) => entry.kind === "dir")
      .map((entry) => ({
        name: entry.name,
        url: joinRepositoryUrl(url, entry.name),
        kind: entry.kind,
      }));
    const existing = treeByUrl[url];
    treeByUrl = {
      ...treeByUrl,
      [url]: {
        url,
        label: existing?.label ?? rootLabel(url),
        expanded: true,
        loading: false,
        loaded: true,
        error: null,
        children,
      },
    };
    for (const child of children) {
      if (!treeByUrl[child.url]) {
        treeByUrl = {
          ...treeByUrl,
          [child.url]: {
            url: child.url,
            label: child.name,
            expanded: false,
            loading: false,
            loaded: false,
            error: null,
            children: [],
          },
        };
      }
    }
  }

  async function toggleTreeNode(url: string) {
    const node = treeByUrl[url];
    if (!node) {
      return;
    }
    if (node.expanded) {
      treeByUrl = {
        ...treeByUrl,
        [url]: { ...node, expanded: false },
      };
      return;
    }
    treeByUrl = {
      ...treeByUrl,
      [url]: { ...node, expanded: true },
    };
    if (!node.loaded && !node.loading) {
      await loadDirectory(url);
    }
  }

  async function selectTreeNode(url: string) {
    await loadDirectory(url);
  }

  function schedulePoll(
    taskId: string,
    requestGeneration: number,
    kind: "list" | "write" | "file",
    contextUrl?: string,
  ) {
    clearPollTimer();
    pollTimer = window.setTimeout(() => {
      void pollTask(taskId, requestGeneration, kind, contextUrl);
    }, pollIntervalMs);
  }

  async function pollTask(
    taskId: string,
    requestGeneration: number,
    kind: "list" | "write" | "file",
    contextUrl?: string,
  ) {
    if (requestGeneration !== generation) {
      return;
    }
    try {
      const task = await getTask(taskId);
      if (requestGeneration !== generation) {
        return;
      }
      if (kind === "list") {
        listTask = task;
      } else if (kind === "write") {
        writeTask = task;
      } else {
        fileTask = task;
      }

      if (!terminalStatuses.includes(task.status)) {
        schedulePoll(taskId, requestGeneration, kind, contextUrl);
        return;
      }

      clearPollTimer();
      statusMessage = null;

      if (task.status !== "success") {
        const message = task.error ?? "任务失败";
        commandError = formError("REPO_BROWSER_TASK_FAILED", message, task.error ?? undefined);
        if (kind === "list" && contextUrl) {
          markTreeError(contextUrl, message);
        }
        return;
      }

      if (kind === "list") {
        const result = task.result?.repository_list;
        if (!result) {
          commandError = formError(
            "REPO_BROWSER_LIST_EMPTY",
            "仓库目录任务没有返回结果",
            "请刷新后重试。",
          );
          return;
        }
        list = result;
        urlInput = result.url;
        applyListToTree(result);
        return;
      }

      if (kind === "file") {
        const result = task.result?.repository_file;
        if (!result?.file_path) {
          commandError = formError(
            "REPO_BROWSER_FILE_EMPTY",
            "仓库文件任务没有返回结果",
            "请重试打开文件。",
          );
          return;
        }
        await openRepositoryTempFile({ path: result.file_path });
        statusMessage = `已打开 ${result.file_name}`;
        return;
      }

      // write success: 切回 HEAD 并刷新父目录
      const refreshUrl = contextUrl || currentUrl;
      const finishedPanel = activePanel;
      const finishedLocalPath = formLocalPath.trim();
      revisionInput = "";
      activePanel = "none";
      statusMessage = "操作成功，正在刷新...";
      if (
        (finishedPanel === "checkout" || finishedPanel === "export") &&
        finishedLocalPath
      ) {
        try {
          await openLocalPathLocation({ path: finishedLocalPath });
        } catch {
          // 打开资源管理器失败不阻断刷新
        }
      }
      await loadDirectory(refreshUrl, requestGeneration);
    } catch (caught) {
      if (requestGeneration === generation) {
        commandError = normalizeCommandError(caught);
        statusMessage = null;
      }
    }
  }

  async function openEntry(entry: RepositoryListEntry) {
    if (!list) {
      return;
    }
    await openUrl(joinRepositoryUrl(list.url, entry.name), entry.kind, entry.name);
  }

  async function openUrl(entryUrl: string, kind: string, name: string) {
    if (kind === "dir") {
      await loadDirectory(entryUrl);
      return;
    }
    if (kind !== "file" || fileRunning) {
      return;
    }
    clearPollTimer();
    commandError = null;
    statusMessage = `正在打开 ${name}...`;
    const requestGeneration = generation;
    try {
      const task = await createRepositoryFileTask({
        url: entryUrl,
        revision: list?.revision ?? (revisionInput.trim() || undefined),
        svn_executable: svnExecutable?.trim() || undefined,
      });
      if (requestGeneration !== generation) {
        return;
      }
      fileTask = task;
      schedulePoll(task.task_id, requestGeneration, "file");
    } catch (caught) {
      if (requestGeneration === generation) {
        commandError = normalizeCommandError(caught);
        statusMessage = null;
      }
    }
  }

  function selectEntry(entry: RepositoryListEntry) {
    selectedName = entry.name;
  }

  function entryUrlFor(name: string): string {
    return list ? joinRepositoryUrl(list.url, name) : joinRepositoryUrl(urlInput, name);
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      statusMessage = "已复制到剪贴板";
    } catch {
      statusMessage = "复制失败";
    }
  }

  async function showLogForUrl(url: string) {
    const root = repositoryRoot || deriveTreeRoot(url);
    const revision = list?.revision || revisionInput.trim();
    if (!revision) {
      // 无 peg revision 时仍可打开 log 窗口，使用 HEAD 信息查询。
      detailLoading = true;
      detailError = null;
      activePanel = "log";
      try {
        fileLog = await getRepositoryFileLog({
          url,
          revision: undefined,
          svn_executable: svnExecutable?.trim() || undefined,
        });
      } catch (caught) {
        detailError = normalizeCommandError(caught);
        fileLog = null;
      } finally {
        detailLoading = false;
      }
      return;
    }
    try {
      await launchLogWindow({
        repository_url: url,
        repository_root: root,
        revision,
      });
      statusMessage = "已打开 Log 窗口";
    } catch {
      // 回退到内嵌 log
      detailLoading = true;
      detailError = null;
      activePanel = "log";
      try {
        fileLog = await getRepositoryFileLog({
          url,
          revision,
          svn_executable: svnExecutable?.trim() || undefined,
        });
      } catch (caught) {
        detailError = normalizeCommandError(caught);
        fileLog = null;
      } finally {
        detailLoading = false;
      }
    }
  }

  async function showBlameForUrl(url: string) {
    detailLoading = true;
    detailError = null;
    activePanel = "blame";
    fileBlame = null;
    try {
      fileBlame = await getRepositoryFileBlame({
        url,
        revision: list?.revision ?? (revisionInput.trim() || undefined),
        svn_executable: svnExecutable?.trim() || undefined,
      });
    } catch (caught) {
      detailError = normalizeCommandError(caught);
    } finally {
      detailLoading = false;
    }
  }

  async function showPropertiesForUrl(url: string) {
    detailLoading = true;
    detailError = null;
    activePanel = "properties";
    fileProperties = null;
    try {
      fileProperties = await getRepositoryFileProperties({
        url,
        revision: list?.revision ?? (revisionInput.trim() || undefined),
        svn_executable: svnExecutable?.trim() || undefined,
      });
    } catch (caught) {
      detailError = normalizeCommandError(caught);
    } finally {
      detailLoading = false;
    }
  }

  function prepareWrite(
    kind: WriteKind,
    options: { sourceUrl?: string; targetUrl?: string; name?: string } = {},
  ) {
    closeContextMenu();
    activePanel = kind;
    detailError = null;
    formMessage = "";
    formName = options.name ?? "";
    formSourceUrl = options.sourceUrl ?? currentUrl;
    formTargetUrl = options.targetUrl ?? "";
    formLocalPath = "";
    formRevision = list?.revision ?? revisionInput;
    if (kind === "mkdir") {
      formTargetUrl = options.targetUrl ?? currentUrl;
    }
    if (kind === "import") {
      formTargetUrl = options.targetUrl ?? currentUrl;
    }
    if (kind === "copy" && options.sourceUrl) {
      formTargetUrl = joinRepositoryUrl(parentRepositoryUrl(options.sourceUrl), `${options.name ?? "copy"}-copy`);
    }
    if (kind === "move" && options.sourceUrl) {
      formTargetUrl = options.sourceUrl;
    }
    if (kind === "rename" && options.sourceUrl) {
      formTargetUrl = options.sourceUrl;
      formName = options.name ?? "";
    }
    if (kind === "delete") {
      formTargetUrl = options.sourceUrl ?? currentUrl;
    }
    if (kind === "checkout" || kind === "export") {
      formSourceUrl = options.sourceUrl ?? currentUrl;
    }
  }

  async function chooseImportPath(directory: boolean) {
    const selected = await chooseImportSource(directory);
    if (selected) {
      formLocalPath = selected;
      if (!formTargetUrl.trim() && currentUrl) {
        const baseName = selected.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "import";
        formTargetUrl = joinRepositoryUrl(currentUrl, baseName);
      }
    }
  }

  async function chooseCheckoutPath() {
    const selected = await chooseCheckoutTargetDirectory();
    if (selected) {
      formLocalPath = selected;
    }
  }

  async function chooseExportPath() {
    const selected = await chooseExportDirectory();
    if (selected) {
      formLocalPath = selected;
    }
  }

  async function submitWrite() {
    if (writeRunning) {
      return;
    }
    const kind = activePanel;
    if (
      kind !== "mkdir" &&
      kind !== "import" &&
      kind !== "copy" &&
      kind !== "move" &&
      kind !== "rename" &&
      kind !== "delete" &&
      kind !== "checkout" &&
      kind !== "export"
    ) {
      return;
    }

    commandError = null;
    const message = formMessage.trim();
    const requestGeneration = generation;

    try {
      let task: Task;
      let refreshUrl = currentUrl;

      if (kind === "mkdir") {
        const name = formName.trim();
        if (!name) {
          commandError = formError("REPO_BROWSER_MKDIR_NAME", "请输入目录名");
          return;
        }
        if (!message) {
          commandError = formError("REPO_BROWSER_MESSAGE", "请输入提交信息");
          return;
        }
        const url = joinRepositoryUrl(formTargetUrl || currentUrl, name);
        if (!window.confirm(`确定创建远端目录吗？\n\n${url}\n提交信息：${message}`)) {
          return;
        }
        task = await createRepositoryMkdirTask({
          url,
          message,
          svn_executable: svnExecutable?.trim() || undefined,
        });
        refreshUrl = parentRepositoryUrl(url);
      } else if (kind === "import") {
        if (!formLocalPath.trim() || !formTargetUrl.trim()) {
          commandError = formError("REPO_BROWSER_IMPORT_PATH", "请选择本地源路径和目标 URL");
          return;
        }
        if (!message) {
          commandError = formError("REPO_BROWSER_MESSAGE", "请输入提交信息");
          return;
        }
        if (
          !window.confirm(
            `确定 Import 吗？\n\n源：${formLocalPath}\n目标：${formTargetUrl}\n提交信息：${message}`,
          )
        ) {
          return;
        }
        task = await createRepositoryImportTask({
          source_path: formLocalPath.trim(),
          target_url: formTargetUrl.trim(),
          message,
          svn_executable: svnExecutable?.trim() || undefined,
        });
        refreshUrl = parentRepositoryUrl(formTargetUrl.trim());
      } else if (kind === "copy") {
        if (!formSourceUrl.trim() || !formTargetUrl.trim()) {
          commandError = formError("REPO_BROWSER_COPY_URL", "请输入源 URL 和目标 URL");
          return;
        }
        if (!message) {
          commandError = formError("REPO_BROWSER_MESSAGE", "请输入提交信息");
          return;
        }
        if (
          !window.confirm(
            `确定复制吗？\n\n源：${formSourceUrl}\n目标：${formTargetUrl}\n提交信息：${message}`,
          )
        ) {
          return;
        }
        task = await createRepositoryCopyTask({
          kind: "entry",
          source_url: formSourceUrl.trim(),
          target_url: formTargetUrl.trim(),
          revision: formRevision.trim() || undefined,
          message,
          svn_executable: svnExecutable?.trim() || undefined,
        });
        refreshUrl = parentRepositoryUrl(formTargetUrl.trim());
      } else if (kind === "move" || kind === "rename") {
        let source = formSourceUrl.trim();
        let target = formTargetUrl.trim();
        if (kind === "rename") {
          const name = formName.trim();
          if (!name) {
            commandError = formError("REPO_BROWSER_RENAME_NAME", "请输入新名称");
            return;
          }
          source = formSourceUrl.trim() || formTargetUrl.trim();
          target = joinRepositoryUrl(parentRepositoryUrl(source), name);
        }
        if (!source || !target) {
          commandError = formError("REPO_BROWSER_MOVE_URL", "请输入源 URL 和目标 URL");
          return;
        }
        if (!message) {
          commandError = formError("REPO_BROWSER_MESSAGE", "请输入提交信息");
          return;
        }
        const label = kind === "rename" ? "重命名" : "移动";
        if (!window.confirm(`确定${label}吗？\n\n源：${source}\n目标：${target}\n提交信息：${message}`)) {
          return;
        }
        task = await createRepositoryMoveTask({
          kind: kind === "rename" ? "rename" : "move",
          source_url: source,
          target_url: target,
          message,
          svn_executable: svnExecutable?.trim() || undefined,
        });
        refreshUrl = parentRepositoryUrl(target);
      } else if (kind === "delete") {
        const url = formTargetUrl.trim();
        if (!url) {
          commandError = formError("REPO_BROWSER_DELETE_URL", "请输入要删除的 URL");
          return;
        }
        if (!message) {
          commandError = formError("REPO_BROWSER_MESSAGE", "请输入提交信息");
          return;
        }
        if (!window.confirm(`确定删除远端路径吗？此操作不可撤销。\n\n${url}\n提交信息：${message}`)) {
          return;
        }
        task = await createRepositoryDeleteTask({
          url,
          message,
          svn_executable: svnExecutable?.trim() || undefined,
        });
        refreshUrl = parentRepositoryUrl(url);
      } else if (kind === "checkout") {
        if (!formSourceUrl.trim() || !formLocalPath.trim()) {
          commandError = formError("REPO_BROWSER_CHECKOUT", "请输入仓库 URL 和本地目录");
          return;
        }
        task = await createRepositoryCheckoutTask({
          url: formSourceUrl.trim(),
          local_path: formLocalPath.trim(),
          revision: formRevision.trim() || undefined,
          svn_executable: svnExecutable?.trim() || undefined,
        });
        refreshUrl = currentUrl;
      } else {
        if (!formSourceUrl.trim() || !formLocalPath.trim()) {
          commandError = formError("REPO_BROWSER_EXPORT", "请输入仓库 URL 和本地目录");
          return;
        }
        task = await createRepositoryExportTask({
          url: formSourceUrl.trim(),
          local_path: formLocalPath.trim(),
          revision: formRevision.trim() || undefined,
          svn_executable: svnExecutable?.trim() || undefined,
        });
        refreshUrl = currentUrl;
      }

      if (requestGeneration !== generation) {
        return;
      }
      writeTask = task;
      statusMessage = "正在执行仓库操作...";
      schedulePoll(task.task_id, requestGeneration, "write", refreshUrl);

      // checkout/export 成功后额外打开本地位置
      if (kind === "checkout" || kind === "export") {
        // handled after success in a dedicated follow-up below via status message only;
        // open location when task succeeds by checking write kind through panel before reset
      }
    } catch (caught) {
      if (requestGeneration === generation) {
        commandError = normalizeCommandError(caught);
      }
    }
  }

  function openContextMenu(
    event: MouseEvent,
    entry: { name: string; kind: string; url?: string },
  ) {
    event.preventDefault();
    event.stopPropagation();
    selectedName = entry.name;
    contextMenu = {
      x: event.clientX,
      y: event.clientY,
      url: entry.url ?? entryUrlFor(entry.name),
      name: entry.name,
      kind: entry.kind,
    };
    void tick().then(() => {
      contextMenuElement?.querySelector<HTMLButtonElement>("button")?.focus();
    });
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function runContextAction(action: () => void | Promise<void>) {
    closeContextMenu();
    void action();
  }

  function handleOutsidePointer(event: PointerEvent) {
    if (!contextMenu) {
      return;
    }
    if (contextMenuElement && !contextMenuElement.contains(event.target as Node)) {
      closeContextMenu();
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (contextMenu) {
        event.preventDefault();
        closeContextMenu();
        return;
      }
      if (activePanel !== "none") {
        event.preventDefault();
        activePanel = "none";
        return;
      }
      if (busy) {
        return;
      }
      event.preventDefault();
      void getCurrentWindow().close();
      return;
    }
    if (event.key === "F5") {
      event.preventDefault();
      void loadDirectory(currentUrl || urlInput);
    }
  }

  function handleThemeChange(event: MediaQueryListEvent) {
    systemPrefersDark = event.matches;
  }

  function startTreeResize(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    treeResizeStart = { x: event.clientX, width: treePaneWidth };
    window.addEventListener("pointermove", handleTreeResizeMove);
    window.addEventListener("pointerup", handleTreeResizeEnd);
  }

  function handleTreeResizeMove(event: PointerEvent) {
    if (!treeResizeStart) {
      return;
    }
    const next = treeResizeStart.width + (event.clientX - treeResizeStart.x);
    treePaneWidth = Math.min(480, Math.max(180, next));
  }

  function handleTreeResizeEnd() {
    treeResizeStart = null;
    window.removeEventListener("pointermove", handleTreeResizeMove);
    window.removeEventListener("pointerup", handleTreeResizeEnd);
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function isTaskRunning(task: Task | null) {
    return Boolean(task && !terminalStatuses.includes(task.status));
  }

  function formError(code: string, message: string, detail?: string): CommandError {
    return {
      code,
      message,
      detail: detail ?? null,
      recoverable: true,
    };
  }

  function normalizeCommandError(value: unknown): CommandError {
    if (value && typeof value === "object" && "code" in value && "message" in value) {
      return value as CommandError;
    }
    return {
      code: "REPO_BROWSER_FAILED",
      message: "Repository Browser 操作失败",
      detail: String(value || "未知错误"),
      recoverable: true,
    };
  }

  function commandErrorText(value: CommandError | null) {
    return value ? [value.code, value.message, value.detail].filter(Boolean).join("\n") : null;
  }

  function formatDate(value: string | null | undefined) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  function useRepositoryRoot() {
    if (repositoryRoot) {
      void loadDirectory(repositoryRoot);
      return;
    }
    if (list?.url) {
      const root = deriveTreeRoot(list.url);
      void loadDirectory(root);
    }
  }

  function renderTreeNodes(url: string, depth: number): Array<{ node: TreeNodeState; depth: number }> {
    const node = treeByUrl[url];
    if (!node) {
      return [];
    }
    const rows = [{ node, depth }];
    if (node.expanded) {
      for (const child of node.children) {
        rows.push(...renderTreeNodes(child.url, depth + 1));
      }
    }
    return rows;
  }

  $: treeRows = treeRootUrl ? renderTreeNodes(treeRootUrl, 0) : [];
</script>

<main class="standalone-repo-browser" data-theme={resolvedTheme} aria-label="NovaSVN Repository Browser">
  <header class="browser-titlebar">
    <div class="browser-heading">
      <span class="browser-mark" aria-hidden="true">
        <FolderTree size={18} strokeWidth={2} />
      </span>
      <div>
        <h1>Repository Browser</h1>
        <p title={currentUrl || targetPath}>
          {currentUrl || targetPath || "浏览远端 SVN 仓库"}
        </p>
      </div>
    </div>
    <div class="browser-actions">
      <span data-status={listTask?.status ?? writeTask?.status ?? "idle"}>
        {busy ? "忙碌" : "就绪"}
      </span>
      <button type="button" on:click={useRepositoryRoot} disabled={!repositoryRoot && !list}>
        Root
      </button>
      <button
        type="button"
        class="primary"
        disabled={busy}
        on:click={() => loadDirectory(urlInput || currentUrl)}
      >
        {#if listRunning}
          <LoaderCircle class="spin" size={15} aria-hidden="true" />
        {:else}
          <RefreshCw size={15} aria-hidden="true" />
        {/if}
        {listRunning ? "加载中" : "浏览"}
      </button>
    </div>
  </header>

  <section class="browser-urlbar" aria-label="仓库地址">
    <input
      bind:this={urlInputElement}
      type="url"
      value={urlInput}
      placeholder="https://example.com/svn/project"
      aria-label="仓库 URL"
      disabled={listRunning}
      on:input={(event) => {
        urlInput = (event.currentTarget as HTMLInputElement).value;
      }}
      on:keydown={(event) => {
        if (event.key === "Enter") {
          void loadDirectory(urlInput);
        }
      }}
    />
    <label class="revision-field">
      <span>Revision</span>
      <input
        type="text"
        inputmode="numeric"
        value={revisionInput}
        placeholder="HEAD"
        aria-label="仓库 Revision"
        disabled={listRunning}
        on:input={(event) => {
          revisionInput = (event.currentTarget as HTMLInputElement).value;
        }}
        on:keydown={(event) => {
          if (event.key === "Enter") {
            void loadDirectory(urlInput);
          }
        }}
      />
    </label>
    <span class="revision-status" aria-live="polite">@{revisionLabel}</span>
  </section>

  <section class="browser-notices" class:has-notices={Boolean(commandError || listTask?.error || writeTask?.error || statusMessage)}>
    <ErrorNotice error={commandError} />
    {#if listTask?.error}
      <div class="inline-error" role="alert">{listTask.error}</div>
    {/if}
    {#if writeTask?.error}
      <div class="inline-error" role="alert">{writeTask.error}</div>
    {/if}
    {#if statusMessage}
      <div class="status-line" role="status">{statusMessage}</div>
    {/if}
  </section>

  <div class="browser-toolbar" role="toolbar" aria-label="仓库操作">
    <button type="button" disabled={!currentUrl} on:click={() => prepareWrite("mkdir", { targetUrl: currentUrl })}>
      创建目录
    </button>
    <button type="button" disabled={!currentUrl} on:click={() => prepareWrite("import", { targetUrl: currentUrl })}>
      Import
    </button>
    <button type="button" disabled={!selectedName || !list} on:click={() => {
      if (!selectedName || !list) return;
      const entry = entries.find((item) => item.name === selectedName);
      if (!entry) return;
      prepareWrite("copy", { sourceUrl: entryUrlFor(entry.name), name: entry.name });
    }}>
      Copy
    </button>
    <button type="button" disabled={!selectedName || !list} on:click={() => {
      if (!selectedName) return;
      prepareWrite("move", { sourceUrl: entryUrlFor(selectedName) });
    }}>
      Move
    </button>
    <button type="button" disabled={!selectedName || !list} on:click={() => {
      if (!selectedName) return;
      prepareWrite("rename", { sourceUrl: entryUrlFor(selectedName), name: selectedName });
    }}>
      Rename
    </button>
    <button type="button" disabled={!selectedName || !list} on:click={() => {
      if (!selectedName) return;
      prepareWrite("delete", { sourceUrl: entryUrlFor(selectedName) });
    }}>
      Delete
    </button>
    <button type="button" disabled={!currentUrl} on:click={() => prepareWrite("checkout", { sourceUrl: currentUrl })}>
      Checkout
    </button>
    <button type="button" disabled={!currentUrl} on:click={() => prepareWrite("export", { sourceUrl: currentUrl })}>
      Export
    </button>
  </div>

  <div class="browser-body">
    <aside class="tree-pane" style={`width: ${treePaneWidth}px`} aria-label="仓库目录树">
      {#if treeRows.length === 0}
        <div class="empty-state">加载目录后显示树</div>
      {:else}
        {#each treeRows as row (row.node.url)}
          <div
            class="tree-row"
            class:active={row.node.url === currentUrl}
            style={`padding-left: ${10 + row.depth * 14}px`}
          >
            <button
              type="button"
              class="tree-toggle"
              aria-label={row.node.expanded ? `折叠 ${row.node.label}` : `展开 ${row.node.label}`}
              on:click={() => toggleTreeNode(row.node.url)}
            >
              {#if row.node.loading}
                <LoaderCircle class="spin" size={13} aria-hidden="true" />
              {:else if row.node.expanded}
                <ChevronDown size={13} aria-hidden="true" />
              {:else}
                <ChevronRight size={13} aria-hidden="true" />
              {/if}
            </button>
            <button
              type="button"
              class="tree-label"
              title={row.node.url}
              on:click={() => selectTreeNode(row.node.url)}
              on:contextmenu={(event) =>
                openContextMenu(event, {
                  name: row.node.label,
                  kind: "dir",
                  url: row.node.url,
                })}
            >
              {row.node.label}
            </button>
          </div>
        {/each}
      {/if}
    </aside>
    <div
      class="tree-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整目录树宽度"
      on:pointerdown={startTreeResize}
    ></div>

    <section class="list-pane" aria-label="仓库目录内容">
      {#if breadcrumbs.length > 0}
        <nav class="breadcrumbs" aria-label="仓库路径">
          {#each breadcrumbs as crumb, index (crumb.url)}
            <button
              type="button"
              disabled={listRunning || crumb.url === currentUrl}
              on:click={() => loadDirectory(crumb.url)}
            >
              {crumb.label}
            </button>
            {#if index < breadcrumbs.length - 1}
              <span>/</span>
            {/if}
          {/each}
        </nav>
      {/if}

      <div class="repository-table" aria-label="仓库目录">
        <div class="table-head">
          <span>名称</span>
          <span>类型</span>
          <span>Last Revision</span>
          <span>作者</span>
          <span>日期</span>
        </div>
        {#if listRunning || resolvingInitial}
          <article class="empty-state">仓库目录加载中</article>
        {:else if list}
          <button
            type="button"
            class="repository-row"
            on:click={() => loadDirectory(parentRepositoryUrl(list.url))}
          >
            <strong>..</strong>
            <span>目录</span>
            <span>-</span>
            <span>-</span>
            <span>-</span>
          </button>
          {#each entries as entry (entry.kind + ":" + entry.name)}
            <button
              type="button"
              class="repository-row"
              class:selected={selectedName === entry.name}
              aria-label={entry.kind === "dir"
                ? `打开仓库目录 ${entry.name}`
                : `打开仓库文件 ${entry.name}`}
              on:click={() => selectEntry(entry)}
              on:dblclick={() => openEntry(entry)}
              on:contextmenu={(event) => openContextMenu(event, entry)}
              on:keydown={(event) => {
                if (event.key === "Enter") {
                  void openEntry(entry);
                }
              }}
            >
              <strong title={entry.name}>{entry.name || "/"}</strong>
              <span>{repositoryEntryKindLabel(entry.kind)}</span>
              <span>{entry.revision || "-"}</span>
              <span title={entry.author || undefined}>{entry.author || "-"}</span>
              <span title={entry.date || undefined}>{formatDate(entry.date)}</span>
            </button>
          {/each}
          {#if entries.length === 0}
            <article class="empty-state">当前目录为空</article>
          {/if}
        {:else}
          <article class="empty-state">输入仓库 URL 后开始浏览</article>
        {/if}
      </div>
    </section>
  </div>

  {#if activePanel !== "none"}
    <section class="detail-pane" aria-label="仓库操作面板">
      <header>
        <h2>
          {#if activePanel === "log"}
            文件 Log
          {:else if activePanel === "blame"}
            文件 Blame
          {:else if activePanel === "properties"}
            文件 Properties
          {:else if activePanel === "mkdir"}
            创建目录
          {:else if activePanel === "import"}
            Import
          {:else if activePanel === "copy"}
            Copy
          {:else if activePanel === "move"}
            Move
          {:else if activePanel === "rename"}
            Rename
          {:else if activePanel === "delete"}
            Delete
          {:else if activePanel === "checkout"}
            Checkout
          {:else}
            Export
          {/if}
        </h2>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭面板"
          on:click={() => {
            activePanel = "none";
          }}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <ErrorNotice error={detailError} />

      {#if activePanel === "log"}
        {#if detailLoading}
          <article class="empty-state">正在读取 Log</article>
        {:else if fileLog?.entries?.length}
          <div class="detail-list">
            {#each fileLog.entries as entry (entry.revision)}
              <article>
                <strong>r{entry.revision}</strong>
                <span>{entry.author || "-"}</span>
                <time>{formatDate(entry.date)}</time>
                <p>{entry.message || "无提交信息"}</p>
              </article>
            {/each}
          </div>
        {:else if fileLog}
          <article class="empty-state">没有日志</article>
        {/if}
      {:else if activePanel === "blame"}
        {#if detailLoading}
          <article class="empty-state">正在读取 Blame</article>
        {:else if fileBlame}
          <p class="detail-summary">{fileBlame.total_lines} 行</p>
          <div class="blame-table">
            {#each fileBlame.lines as line (line.line_number)}
              <div class="blame-row">
                <span>r{line.revision || "-"}</span>
                <span>{line.author || "-"}</span>
                <span>{line.line_number}</span>
                <span class="blame-content">
                  <SyntaxHighlightedCode
                    content={line.content}
                    language={fileBlame.language ?? "plaintext"}
                    theme={resolvedTheme}
                  />
                </span>
              </div>
            {/each}
          </div>
        {/if}
      {:else if activePanel === "properties"}
        {#if detailLoading}
          <article class="empty-state">正在读取 Properties</article>
        {:else if fileProperties?.properties?.length}
          <div class="detail-list">
            {#each fileProperties.properties as property (property.name)}
              <article>
                <strong>{property.name}</strong>
                <pre>{property.value || ""}</pre>
              </article>
            {/each}
          </div>
        {:else if fileProperties}
          <article class="empty-state">没有属性</article>
        {/if}
      {:else}
        <form class="write-form" on:submit|preventDefault={submitWrite}>
          {#if activePanel === "mkdir"}
            <label>
              <span>父目录 URL</span>
              <input aria-label="父目录 URL" bind:value={formTargetUrl} />
            </label>
            <label>
              <span>目录名</span>
              <input aria-label="目录名" bind:value={formName} />
            </label>
          {:else if activePanel === "import"}
            <label>
              <span>本地路径</span>
              <div class="path-control">
                <input aria-label="Import 本地路径" bind:value={formLocalPath} />
                <button type="button" on:click={() => chooseImportPath(false)}>文件</button>
                <button type="button" on:click={() => chooseImportPath(true)}>目录</button>
              </div>
            </label>
            <label>
              <span>目标 URL</span>
              <input aria-label="Import 目标 URL" bind:value={formTargetUrl} />
            </label>
          {:else if activePanel === "copy" || activePanel === "move"}
            <label>
              <span>源 URL</span>
              <input aria-label={`${activePanel} 源 URL`} bind:value={formSourceUrl} />
            </label>
            <label>
              <span>目标 URL</span>
              <input aria-label={`${activePanel} 目标 URL`} bind:value={formTargetUrl} />
            </label>
            {#if activePanel === "copy"}
              <label>
                <span>Revision</span>
                <input aria-label="Copy Revision" bind:value={formRevision} placeholder="HEAD" />
              </label>
            {/if}
          {:else if activePanel === "rename"}
            <label>
              <span>源 URL</span>
              <input aria-label="Rename 源 URL" bind:value={formSourceUrl} />
            </label>
            <label>
              <span>新名称</span>
              <input aria-label="新名称" bind:value={formName} />
            </label>
          {:else if activePanel === "delete"}
            <label>
              <span>目标 URL</span>
              <input aria-label="Delete 目标 URL" bind:value={formTargetUrl} />
            </label>
          {:else if activePanel === "checkout" || activePanel === "export"}
            <label>
              <span>仓库 URL</span>
              <input aria-label={`${activePanel} 仓库 URL`} bind:value={formSourceUrl} />
            </label>
            <label>
              <span>本地目录</span>
              <div class="path-control">
                <input aria-label={`${activePanel} 本地目录`} bind:value={formLocalPath} />
                <button
                  type="button"
                  on:click={activePanel === "checkout" ? chooseCheckoutPath : chooseExportPath}
                >
                  <FolderOpen size={15} aria-hidden="true" />
                </button>
              </div>
            </label>
            <label>
              <span>Revision</span>
              <input
                aria-label={`${activePanel} Revision`}
                bind:value={formRevision}
                placeholder="HEAD"
              />
            </label>
          {/if}

          {#if activePanel !== "checkout" && activePanel !== "export"}
            <label>
              <span>提交信息</span>
              <textarea aria-label="提交信息" bind:value={formMessage} rows="3"></textarea>
            </label>
          {/if}

          <button type="submit" class="primary" disabled={writeRunning}>
            {writeRunning ? "执行中..." : "执行"}
          </button>
        </form>
      {/if}
    </section>
  {/if}

  {#if contextMenu}
    <div
      bind:this={contextMenuElement}
      class="context-menu"
      style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px`}
      role="menu"
      aria-label="仓库条目菜单"
    >
      <button
        type="button"
        role="menuitem"
        on:click={() =>
          runContextAction(() =>
            openUrl(
              contextMenu?.url ?? "",
              contextMenu?.kind ?? "file",
              contextMenu?.name ?? "",
            ),
          )}
      >
        <ExternalLink size={14} aria-hidden="true" /> Open
      </button>
      <button
        type="button"
        role="menuitem"
        on:click={() => runContextAction(() => copyText(contextMenu?.url ?? ""))}
      >
        <Copy size={14} aria-hidden="true" /> 复制 URL
      </button>
      <button
        type="button"
        role="menuitem"
        on:click={() => runContextAction(() => showLogForUrl(contextMenu?.url ?? ""))}
      >
        <History size={14} aria-hidden="true" /> Show Log
      </button>
      {#if contextMenu.kind === "file"}
        <button
          type="button"
          role="menuitem"
          on:click={() => runContextAction(() => showBlameForUrl(contextMenu?.url ?? ""))}
        >
          <GitCommitHorizontal size={14} aria-hidden="true" /> Blame
        </button>
        <button
          type="button"
          role="menuitem"
          on:click={() => runContextAction(() => showPropertiesForUrl(contextMenu?.url ?? ""))}
        >
          <ListChecks size={14} aria-hidden="true" /> Properties
        </button>
      {/if}
      {#if contextMenu.kind === "dir"}
        <button
          type="button"
          role="menuitem"
          on:click={() =>
            runContextAction(() =>
              prepareWrite("mkdir", { targetUrl: contextMenu?.url }),
            )}
        >
          <FileText size={14} aria-hidden="true" /> 创建目录
        </button>
        <button
          type="button"
          role="menuitem"
          on:click={() =>
            runContextAction(() =>
              prepareWrite("import", { targetUrl: contextMenu?.url }),
            )}
        >
          <Download size={14} aria-hidden="true" /> Import
        </button>
      {/if}
      <button
        type="button"
        role="menuitem"
        on:click={() =>
          runContextAction(() =>
            prepareWrite("copy", {
              sourceUrl: contextMenu?.url,
              name: contextMenu?.name,
            }),
          )}
      >
        <Copy size={14} aria-hidden="true" /> Copy
      </button>
      <button
        type="button"
        role="menuitem"
        on:click={() =>
          runContextAction(() =>
            prepareWrite("move", { sourceUrl: contextMenu?.url }),
          )}
      >
        Move
      </button>
      <button
        type="button"
        role="menuitem"
        on:click={() =>
          runContextAction(() =>
            prepareWrite("rename", {
              sourceUrl: contextMenu?.url,
              name: contextMenu?.name,
            }),
          )}
      >
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        on:click={() =>
          runContextAction(() =>
            prepareWrite("delete", { sourceUrl: contextMenu?.url }),
          )}
      >
        <Trash2 size={14} aria-hidden="true" /> Delete
      </button>
      <button
        type="button"
        role="menuitem"
        on:click={() =>
          runContextAction(() =>
            prepareWrite("checkout", { sourceUrl: contextMenu?.url }),
          )}
      >
        <Download size={14} aria-hidden="true" /> Checkout
      </button>
      <button
        type="button"
        role="menuitem"
        on:click={() =>
          runContextAction(() =>
            prepareWrite("export", { sourceUrl: contextMenu?.url }),
          )}
      >
        Export
      </button>
    </div>
  {/if}

  <SvnAuthenticationDialog
    failure={authenticationFailure}
    savedUsername={svnAuthenticationUsername}
    rememberPassword={svnRememberPassword}
    loading={svnAuthenticationLoading}
    error={svnAuthenticationError}
    retry={null}
    onSubmit={onSvnAuthenticationSubmit}
  />
</main>

<style>
  .standalone-repo-browser {
    --background: #f5f6f7;
    --panel: #ffffff;
    --panel-subtle: #f0f2f4;
    --text: #17202a;
    --secondary: #687482;
    --border: #cfd6dd;
    --control: #ffffff;
    --accent: #2674b9;
    --selected: #dcecfc;
    --danger: #b42318;
    display: grid;
    grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--background);
    color: var(--text);
    user-select: none;
  }

  .standalone-repo-browser[data-theme="dark"] {
    --background: #1f1f21;
    --panel: #29292b;
    --panel-subtle: #242426;
    --text: #f2f2f4;
    --secondary: #aaaab0;
    --border: #3a3a3e;
    --control: #1f1f21;
    --accent: #4d9de0;
    --selected: #24384d;
    --danger: #f97066;
  }

  .browser-titlebar,
  .browser-urlbar,
  .browser-toolbar,
  .browser-notices,
  .detail-pane header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }

  .browser-heading {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .browser-mark {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }

  .browser-heading h1 {
    margin: 0;
    font-size: 15px;
  }

  .browser-heading p,
  .status-line {
    margin: 0;
    color: var(--secondary);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .browser-actions,
  .browser-toolbar,
  .path-control {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .browser-urlbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 10px;
  }

  .browser-urlbar input,
  .write-form input,
  .write-form textarea {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--control);
    color: var(--text);
    padding: 8px 10px;
    font: inherit;
  }

  .revision-field {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--secondary);
    font-size: 12px;
  }

  .revision-field input {
    width: 110px;
  }

  .revision-status {
    color: var(--secondary);
    font-size: 12px;
    white-space: nowrap;
  }

  button {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel-subtle);
    color: var(--text);
    padding: 6px 10px;
    font: inherit;
    cursor: pointer;
  }

  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .icon-button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
  }

  .browser-notices:not(.has-notices) {
    display: none;
  }

  .inline-error {
    color: var(--danger);
    font-size: 12px;
  }

  .browser-body {
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .tree-pane {
    flex: 0 0 auto;
    overflow: auto;
    border-right: 1px solid var(--border);
    background: var(--panel);
  }

  .tree-resizer {
    flex: 0 0 5px;
    cursor: col-resize;
    background: transparent;
  }

  .tree-resizer:hover {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 28px;
  }

  .tree-row.active {
    background: var(--selected);
  }

  .tree-toggle,
  .tree-label {
    border: 0;
    background: transparent;
    padding: 4px;
  }

  .tree-label {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .list-pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .breadcrumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-subtle);
  }

  .breadcrumbs button {
    border: 0;
    background: transparent;
    color: var(--accent);
    padding: 2px 4px;
  }

  .repository-table {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
  }

  .table-head,
  .repository-row {
    display: grid;
    grid-template-columns: minmax(180px, 2fr) 70px 110px 110px 160px;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: inherit;
    text-align: left;
    font: inherit;
  }

  .table-head {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--panel);
    color: var(--secondary);
    font-size: 12px;
  }

  .repository-row:hover,
  .repository-row.selected {
    background: var(--selected);
  }

  .repository-row strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    margin: 18px;
    color: var(--secondary);
    font-size: 13px;
  }

  .detail-pane {
    border-top: 1px solid var(--border);
    background: var(--panel);
    max-height: 42vh;
    overflow: auto;
  }

  .detail-pane header {
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .detail-pane h2 {
    margin: 0;
    font-size: 14px;
  }

  .write-form {
    display: grid;
    gap: 10px;
    padding: 12px 14px 16px;
  }

  .write-form label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--secondary);
  }

  .detail-list {
    display: grid;
    gap: 8px;
    padding: 12px 14px;
  }

  .detail-list article {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    background: var(--panel-subtle);
  }

  .detail-list pre {
    margin: 6px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
  }

  .detail-summary {
    margin: 0;
    padding: 8px 14px 0;
    color: var(--secondary);
    font-size: 12px;
  }

  .blame-table {
    display: grid;
    gap: 2px;
    padding: 8px 14px 14px;
    font-size: 12px;
  }

  .blame-row {
    display: grid;
    grid-template-columns: 70px 90px 50px minmax(0, 1fr);
    gap: 8px;
  }

  .blame-content {
    overflow: hidden;
  }

  .context-menu {
    position: fixed;
    z-index: 50;
    min-width: 180px;
    display: grid;
    gap: 2px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  }

  .context-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-start;
    border: 0;
    background: transparent;
    border-radius: 6px;
  }

  .context-menu button:hover,
  .context-menu button:focus-visible {
    background: var(--selected);
  }

  :global(.spin) {
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
