import { writable } from "svelte/store";
import type { AppView } from "../types/app";

export const currentView = writable<AppView>("changes");

export function setCurrentView(view: AppView) {
  currentView.set(view);
}
