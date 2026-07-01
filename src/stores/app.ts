import { writable } from "svelte/store";
import type { AppView } from "../types/app";

export const currentView = writable<AppView>("workspace");

export function setCurrentView(view: AppView) {
  currentView.set(view);
}
