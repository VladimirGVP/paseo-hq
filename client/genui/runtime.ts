// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import type { PluginTheme } from "@getpaseo/plugin";
import { createContext, useCallback, useContext, useState } from "react";
import type { Action, Value } from "../../shared/genui/core/types";
import type { Tone } from "../../shared/genui/logic/values";
import type { QueuedReply } from "./reply-queue";
import { readStorage, writeStorage } from "./web";

export type ImageUrl =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: string; readonly off?: boolean };

export type TextFile =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

export interface UiRuntime {
  setValue(name: string, value: Value): void;
  run(actions: readonly Action[]): Promise<void>;
  openFile: ((path: string, line?: number) => boolean | Promise<boolean>) | null;
  loadImage: ((src: string) => Promise<ImageUrl>) | null;
  readText: ((path: string) => Promise<TextFile>) | null;
  loadAudio: ((src: string) => Promise<ImageUrl>) | null;
  playAudio: ((dataUrl: string) => Promise<void>) | null;
  answer: string | null;
  /** The reply being built across this chat's UIs; the next send carries it. */
  queue: readonly QueuedReply[];
  /** Adds, replaces or (null) removes this block's queue entry `id`. */
  setQueued(id: string, text: string | null): void;
  /** The text of this block's queue entry `id`, or null. */
  queued(id: string): string | null;
  superseded: boolean;
  agentId: string | null;
  blockKey: string | null;
  theme: PluginTheme;
  compact: boolean;
  platform: "ios" | "android" | "web";
}

export const UiRuntimeContext = createContext<UiRuntime | null>(null);

export function useUiRuntime(): UiRuntime {
  const runtime = useContext(UiRuntimeContext);
  if (runtime === null) throw new Error("useUiRuntime used outside a rendered UI");
  return runtime;
}

export const CardDepthContext = createContext(0);
export const InTableContext = createContext(false);

export function toneColor(theme: PluginTheme, t: Tone): string {
  switch (t) {
    case "good":
      return theme.colors.statusSuccess;
    case "warn":
      return theme.colors.statusWarning;
    case "bad":
      return theme.colors.statusDanger;
    case "info":
      return theme.colors.accent;
    default:
      return theme.colors.foreground;
  }
}

export function toneMutedColor(theme: PluginTheme, t: Tone): string {
  if (t === "neutral") return theme.colors.foregroundMuted;
  return toneColor(theme, t);
}

export function propsKey(value: unknown): string {
  const json = JSON.stringify(value) ?? "";
  let hash = 0x811c9dc5;
  for (let index = 0; index < json.length; index++) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function usePersistedState<T>(
  id: string,
  initial: T,
  accept: (stored: unknown) => T | null,
): [T, (next: T | ((previous: T) => T)) => void] {
  const { blockKey } = useUiRuntime();
  const key = blockKey === null ? `genui:mem:${id}` : `${blockKey}:local:${id}`;
  const [value, setValue] = useState<T>(() => {
    const raw = readStorage(key);
    if (raw === null) return initial;
    try {
      const parsed: unknown = JSON.parse(raw);
      return accept(parsed) ?? initial;
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(previous) : next;
        writeStorage(key, JSON.stringify(resolved));
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}
