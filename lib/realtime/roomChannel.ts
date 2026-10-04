import type { SupabaseClient } from "@supabase/supabase-js";
import { byteSize, chunkBySize } from "@/lib/sync/chunk";
import { EVENTS, MAX_CHUNK_BYTES, interactTopic, roomTopic, type ElementsPayload } from "@/lib/sync/messages";
import type { SyncElement } from "@/lib/sync/types";
import { countPresence, type PresenceCounts } from "./presence";

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";
export type RoomRole = "editor" | "viewer";

export type RoomChannelHandlers = {
  onElements(elements: SyncElement[]): void;
  onSyncRequest(): void;
  onStatus(status: ConnectionStatus): void;
  onPresence(counts: PresenceCounts): void;
  onSubscribed(): void;
};

export type RoomConnection = {
  sendElements(kind: "elements" | "scene", elements: readonly SyncElement[]): Promise<boolean>;
  requestSync(): void;
  close(): void;
};

export function openRoomConnection(
  supabase: SupabaseClient,
  { roomId, clientId, role }: { roomId: string; clientId: string; role: RoomRole },
  handlers: RoomChannelHandlers,
): RoomConnection {
  let closed = false;
  let online = navigator.onLine;
  let channelStatus: Exclude<ConnectionStatus, "offline"> = "connecting";
  const emitStatus = () => handlers.onStatus(online ? channelStatus : "offline");

  const room = supabase.channel(roomTopic(roomId), { config: { private: true, broadcast: { self: false } } });
  const interact = supabase.channel(interactTopic(roomId), {
    config: { private: true, broadcast: { self: false }, presence: { key: clientId } },
  });

  const receive = (payload: ElementsPayload | undefined) => {
    if (closed || !payload || payload.from === clientId || !Array.isArray(payload.elements)) return;
    handlers.onElements(payload.elements);
  };

  room
    .on("broadcast", { event: EVENTS.elements }, ({ payload }) => receive(payload as ElementsPayload))
    .on("broadcast", { event: EVENTS.scene }, ({ payload }) => receive(payload as ElementsPayload))
    .subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        channelStatus = "live";
        emitStatus();
        handlers.onSubscribed();
      } else {
        channelStatus = "reconnecting";
        emitStatus();
      }
    });

  interact
    .on("broadcast", { event: EVENTS.syncRequest }, ({ payload }) => {
      if (!closed && (payload as { from?: string } | undefined)?.from !== clientId) handlers.onSyncRequest();
    })
    .on("presence", { event: "sync" }, () => {
      if (!closed) handlers.onPresence(countPresence(interact.presenceState(), clientId));
    })
    .subscribe((status) => {
      // Track once per (re)subscribe; free tier allows 5 presence calls per 30 s per client.
      if (!closed && status === "SUBSCRIBED") void interact.track({ role });
    });

  const onOnline = () => { online = true; emitStatus(); };
  const onOffline = () => { online = false; emitStatus(); };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  emitStatus();

  return {
    async sendElements(kind, elements) {
      let ok = true;
      for (const chunk of chunkBySize(elements, MAX_CHUNK_BYTES)) {
        if (chunk.length === 1 && byteSize(chunk) > MAX_CHUNK_BYTES) {
          console.warn("PentoLive: element exceeds broadcast size limit", chunk[0].id);
        }
        const payload: ElementsPayload = { from: clientId, elements: chunk };
        const result = await room.send({ type: "broadcast", event: EVENTS[kind], payload });
        if (result !== "ok") ok = false;
      }
      return ok;
    },
    requestSync() {
      void interact.send({ type: "broadcast", event: EVENTS.syncRequest, payload: { from: clientId } });
    },
    close() {
      closed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      void supabase.removeChannel(room);
      void supabase.removeChannel(interact);
    },
  };
}
