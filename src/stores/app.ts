import { writable } from "svelte/store";
import {
  cancelTask,
  createMockTask,
  detectSvn,
  getTask,
  listTasks,
} from "../lib/api";
import type { AppView } from "../types/app";
import type {
  CommandError,
  MockTaskOutcome,
  SvnDetection,
  Task,
  TaskSnapshot,
} from "../types/api";

export const currentView = writable<AppView>("changes");

export function setCurrentView(view: AppView) {
  currentView.set(view);
}

export interface TaskStoreState {
  snapshot: TaskSnapshot;
  selectedTask: Task | null;
  loading: boolean;
  error: CommandError | null;
}

const initialTaskState: TaskStoreState = {
  snapshot: {
    tasks: [],
    running_task_id: null,
  },
  selectedTask: null,
  loading: false,
  error: null,
};

function createTaskStore() {
  const { subscribe, update } = writable<TaskStoreState>(initialTaskState);
  let selectedTaskId: string | null = null;
  let pollTimer: number | null = null;

  async function refresh() {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const snapshot = await listTasks();
      selectedTaskId =
        selectedTaskId ?? snapshot.running_task_id ?? snapshot.tasks[0]?.task_id ?? null;

      let selectedTask: Task | null = null;
      if (selectedTaskId) {
        const exists = snapshot.tasks.some((task) => task.task_id === selectedTaskId);
        if (exists) {
          selectedTask = await getTask(selectedTaskId);
        } else {
          selectedTaskId = snapshot.running_task_id ?? snapshot.tasks[0]?.task_id ?? null;
          selectedTask = selectedTaskId ? await getTask(selectedTaskId) : null;
        }
      }

      update((state) => ({
        ...state,
        snapshot,
        selectedTask,
        loading: false,
        error: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  async function create(outcome: MockTaskOutcome) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const task = await createMockTask({
        outcome,
        title: outcome === "success" ? "模拟成功任务" : "模拟失败任务",
      });
      selectedTaskId = task.task_id;
      await refresh();
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  async function select(taskId: string) {
    selectedTaskId = taskId;
    await refresh();
  }

  async function cancel(taskId: string) {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      await cancelTask(taskId);
      await refresh();
    } catch (error) {
      update((state) => ({
        ...state,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  function startPolling() {
    if (pollTimer !== null) {
      return;
    }

    void refresh();
    pollTimer = window.setInterval(() => {
      void refresh();
    }, 900);
  }

  function stopPolling() {
    if (pollTimer === null) {
      return;
    }

    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  return {
    subscribe,
    refresh,
    create,
    select,
    cancel,
    startPolling,
    stopPolling,
  };
}

export const taskStore = createTaskStore();

export interface SvnStoreState {
  detection: SvnDetection | null;
  executableInput: string;
  loading: boolean;
  error: CommandError | null;
}

const initialSvnState: SvnStoreState = {
  detection: null,
  executableInput: "",
  loading: false,
  error: null,
};

function createSvnStore() {
  const { subscribe, update } = writable<SvnStoreState>(initialSvnState);

  async function detect() {
    update((state) => ({ ...state, loading: true, error: null }));

    try {
      const detection = await detectSvn();
      update((state) => ({
        ...state,
        detection,
        executableInput: state.executableInput || detection.resolved_path || detection.executable,
        loading: false,
        error: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        detection: null,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  async function detectWithInput() {
    update((state) => ({ ...state, loading: true, error: null }));

    let executable = "";
    update((state) => {
      executable = state.executableInput.trim();
      return state;
    });

    try {
      const detection = await detectSvn({ executable });
      update((state) => ({
        ...state,
        detection,
        executableInput: executable || detection.resolved_path || detection.executable,
        loading: false,
        error: null,
      }));
    } catch (error) {
      update((state) => ({
        ...state,
        detection: null,
        loading: false,
        error: error as CommandError,
      }));
    }
  }

  function setExecutableInput(value: string) {
    update((state) => ({
      ...state,
      executableInput: value,
    }));
  }

  return {
    subscribe,
    detect,
    detectWithInput,
    setExecutableInput,
  };
}

export const svnStore = createSvnStore();
