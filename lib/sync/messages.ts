import type { SyncElement } from "./types";

export const SYNC_INTERVAL_MS = 80;
export const MAX_CHUNK_BYTES = 200_000;
export const SAVE_IDLE_MS = 2000;
export const SAVE_MAX_WAIT_MS = 10_000;
export const SYNC_REPLY_MIN_GAP_MS = 2000;
export const KEEPALIVE_MAX_BYTES = 60_000;

export const EVENTS = { elements: "elements", scene: "scene", syncRequest: "sync-request" } as const;

export const roomTopic = (roomId: string) => `room:${roomId}`;
export const interactTopic = (roomId: string) => `room:${roomId}:interact`;

export type ElementsPayload = { from: string; elements: SyncElement[] };
