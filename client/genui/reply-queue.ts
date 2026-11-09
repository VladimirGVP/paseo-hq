// The reply the user is building across every UI in one chat: Queue actions,
// item comments and edits, and Other boxes add to it; the next Send sends it all.
import { useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "./web";

export interface QueuedReply {
  /** Stable per source (a button, an item's comment), so a source replaces its own entry. */
  readonly id: string;
  readonly text: string;
}

const EMPTY: readonly QueuedReply[] = [];
const queues = new Map<string, readonly QueuedReply[]>();
const listeners = new Set<() => void>();

const storageKey = (agentId: string) => `genui:queue:${agentId}`;

export function queueOf(agentId: string): readonly QueuedReply[] {
  const cached = queues.get(agentId);
  if (cached !== undefined) return cached;
  let stored: readonly QueuedReply[] = EMPTY;
  try {
    const parsed: unknown = JSON.parse(readStorage(storageKey(agentId)) ?? "[]");
    if (Array.isArray(parsed)) {
      stored = parsed.filter(
        (item): item is QueuedReply => typeof item?.id === "string" && typeof item?.text === "string",
      );
    }
  } catch {
    // A corrupt entry starts an empty queue.
  }
  queues.set(agentId, stored);
  // A queue restored from storage still needs its composer pill.
  if (stored.length > 0) void Promise.resolve().then(notify);
  return stored;
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Agents whose queue has been read or written in this session. */
export function knownQueueAgents(): string[] {
  return [...queues.keys()];
}

function write(agentId: string, next: readonly QueuedReply[]): void {
  queues.set(agentId, next);
  writeStorage(storageKey(agentId), JSON.stringify(next));
  notify();
}

/** Adds, replaces (same id) or, with null text, removes one entry. */
export function setQueued(agentId: string, id: string, text: string | null): void {
  const current = queueOf(agentId);
  const without = current.filter((item) => item.id !== id);
  const index = current.findIndex((item) => item.id === id);
  if (text === null) {
    if (index !== -1) write(agentId, without);
    return;
  }
  const next = [...without];
  next.splice(index === -1 ? next.length : index, 0, { id, text });
  write(agentId, next);
}

export function clearQueue(agentId: string): void {
  if (queueOf(agentId).length > 0) write(agentId, EMPTY);
}

export function subscribeQueues(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReplyQueue(agentId: string | null): readonly QueuedReply[] {
  return useSyncExternalStore(
    subscribeQueues,
    () => (agentId === null ? EMPTY : queueOf(agentId)),
    () => EMPTY,
  );
}
