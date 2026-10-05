import type { SupabaseClient } from "@supabase/supabase-js";
import { countPresence, type PresenceCounts } from "@/lib/realtime/presence";
import type { ConnectionStatus, RoomRole } from "@/lib/realtime/roomChannel";
import { interactTopic } from "@/lib/sync/messages";
import { createTraceAssembler, parseChunk, parseCode, parseStep, splitByBytes, TRACE_PIECE_BYTES, VIZ_EVENTS, vizTopic, type CodePayload, type StepPayload } from "@/lib/viz/messages";
import type { Trace } from "@/lib/viz/trace";

export type VizHandlers = {
  onCode(payload: CodePayload): void;
  onTrace(runId: string, trace: Trace): void;
  onStep(payload: StepPayload): void;
  onSyncRequest(): void;
  onStatus(status: ConnectionStatus): void;
  onPresence(counts: PresenceCounts): void;
  onSubscribed(): void;
};

export type VizConnection = {
  sendCode(payload: Omit<CodePayload, "from">): void;
  sendTrace(runId: string, trace: Trace): Promise<boolean>;
  sendStep(payload: Omit<StepPayload, "from">): void;
  requestSync(): void;
  close(): void;
};

export function openVizConnection(
  supabase: SupabaseClient,
  { roomId, clientId, role }: { roomId: string; clientId: string; role: RoomRole },
  handlers: VizHandlers,
): VizConnection {
  let closed = false;
  let online = navigator.onLine;
  let channelStatus: Exclude<ConnectionStatus, "offline"> = "connecting";
  const emitStatus = () => handlers.onStatus(online ? channelStatus : "offline");
  const assembler = createTraceAssembler();

  const viz = supabase.channel(vizTopic(roomId), { config: { private: true, broadcast: { self: false } } });
  const interact = supabase.channel(interactTopic(roomId), { config: { private: true, broadcast: { self: false }, presence: { key: clientId } } });

  viz
    .on("broadcast", { event: VIZ_EVENTS.code }, ({ payload }) => {
      const code = parseCode(payload);
      if (!closed && code && code.from !== clientId) handlers.onCode(code);
    })
    .on("broadcast", { event: VIZ_EVENTS.trace }, ({ payload }) => {
      const chunk = parseChunk(payload);
      if (closed || !chunk || chunk.from === clientId) return;
      const done = assembler.add(chunk);
      if (done) handlers.onTrace(done.runId, done.trace);
    })
    .on("broadcast", { event: VIZ_EVENTS.step }, ({ payload }) => {
      const step = parseStep(payload);
      if (!closed && step && step.from !== clientId) handlers.onStep(step);
    })
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
    .on("broadcast", { event: VIZ_EVENTS.syncRequest }, ({ payload }) => {
      if (!closed && (payload as { from?: string } | undefined)?.from !== clientId) handlers.onSyncRequest();
    })
    .on("presence", { event: "sync" }, () => {
      if (!closed) handlers.onPresence(countPresence(interact.presenceState(), clientId));
    })
    .subscribe((status) => {
      if (!closed && status === "SUBSCRIBED") void interact.track({ role });
    });

  const onOnline = () => { online = true; emitStatus(); };
  const onOffline = () => { online = false; emitStatus(); };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  emitStatus();

  const broadcast = (event: string, payload: unknown) => viz.send({ type: "broadcast", event, payload });

  return {
    sendCode(payload) {
      void broadcast(VIZ_EVENTS.code, { ...payload, from: clientId });
    },
    async sendTrace(runId, trace) {
      const pieces = splitByBytes(JSON.stringify(trace), TRACE_PIECE_BYTES);
      let ok = true;
      for (let index = 0; index < pieces.length; index++) {
        const result = await broadcast(VIZ_EVENTS.trace, { from: clientId, runId, index, total: pieces.length, data: pieces[index] });
        if (result !== "ok") ok = false;
      }
      return ok;
    },
    sendStep(payload) {
      void broadcast(VIZ_EVENTS.step, { ...payload, from: clientId });
    },
    requestSync() {
      void interact.send({ type: "broadcast", event: VIZ_EVENTS.syncRequest, payload: { from: clientId } });
    },
    close() {
      closed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      void supabase.removeChannel(viz);
      void supabase.removeChannel(interact);
    },
  };
}
