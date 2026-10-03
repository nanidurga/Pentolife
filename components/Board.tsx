"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import ShareDialog from "@/components/ShareDialog";
import StatusBar from "@/components/StatusBar";
import { localRoomKey, makeCapability } from "@/lib/room";
import { joinRoom, saveSnapshot, type Scene } from "@/lib/rooms/api";
import type { PresenceCounts } from "@/lib/realtime/presence";
import { openRoomConnection, type ConnectionStatus, type RoomConnection } from "@/lib/realtime/roomChannel";
import { ensureAnonymousSession, getSupabase } from "@/lib/supabase";
import { collectChanged, markSent, unmarkSent } from "@/lib/sync/diff";
import { mergeByVersion } from "@/lib/sync/merge";
import { SAVE_IDLE_MS, SAVE_MAX_WAIT_MS, SYNC_INTERVAL_MS, SYNC_REPLY_MIN_GAP_MS } from "@/lib/sync/messages";
import { createPendingSet } from "@/lib/sync/pending";
import { createSaver, type SaveState, type Saver } from "@/lib/sync/saver";
import { createFlusher, type Flusher } from "@/lib/sync/throttle";
import type { SyncElement } from "@/lib/sync/types";

const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((module) => module.Excalidraw), { ssr: false });

type Role = "editor" | "viewer";
type BoardProps = { roomId: string; role: Role; token: string; viewerToken: string; local: boolean };
// CaptureUpdateAction.NEVER — inlined so this file never imports the Excalidraw runtime during SSR.
const NEVER = "NEVER" as const;

const sceneOf = (api: ExcalidrawImperativeAPI): Scene => ({
  elements: api.getSceneElementsIncludingDeleted() as unknown as SyncElement[],
  appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor },
});

// Scene.appState has an optional background colour; Excalidraw's updateScene needs it defined or absent.
const appStateOf = (appState?: { viewBackgroundColor?: string }) =>
  appState?.viewBackgroundColor ? { viewBackgroundColor: appState.viewBackgroundColor } : undefined;

// Elements the local user is mid-gesture on must not be overwritten by remote updates.
function protectedIds(api: ExcalidrawImperativeAPI) {
  const state = api.getAppState();
  const ids = new Set<string>();
  for (const element of [state.newElement, state.editingTextElement, state.resizingElement]) if (element) ids.add(element.id);
  if (state.selectedElementsAreBeingDragged) for (const id of Object.keys(state.selectedElementIds)) ids.add(id);
  return ids;
}

function readBackup(roomId: string): Scene | null {
  try {
    const raw = window.localStorage.getItem(localRoomKey(roomId));
    return raw ? (JSON.parse(raw) as Scene) : null;
  } catch {
    return null;
  }
}

function writeBackup(roomId: string, scene: Scene) {
  try { window.localStorage.setItem(localRoomKey(roomId), JSON.stringify(scene)); } catch { /* storage full or blocked */ }
}

export default function Board({ roomId, role, token, viewerToken, local }: BoardProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const clientId = useMemo(() => makeCapability(), []);
  const connectionRef = useRef<RoomConnection | null>(null);
  const sentRef = useRef(new Map<string, number>());
  const pendingRef = useRef(createPendingSet<SyncElement>());
  const unsavedRef = useRef(createPendingSet<SyncElement>());
  const flusherRef = useRef<Flusher | null>(null);
  const saverRef = useRef<Saver | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | "local">(local ? "local" : "connecting");
  const [presence, setPresence] = useState<PresenceCounts>({ editors: 0, viewers: 0 });
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [share, setShare] = useState<{ editorUrl: string; viewerUrl: string } | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let connection: RoomConnection | null = null;
    let lastSceneReply = 0;
    const backup = readBackup(roomId);

    if (local) {
      if (backup) api.updateScene({ elements: backup.elements as never, appState: appStateOf(backup.appState), captureUpdate: NEVER });
      setReady(true);
      return;
    }

    const sendFullScene = () => {
      const elements = api.getSceneElementsIncludingDeleted() as unknown as SyncElement[];
      markSent(sentRef.current, elements);
      void connectionRef.current?.sendElements("scene", elements);
    };

    const flusher = createFlusher({
      intervalMs: SYNC_INTERVAL_MS,
      flush: () => {
        const batch = pendingRef.current.take();
        if (batch.length === 0) return;
        writeBackup(roomId, sceneOf(api));
        const current = connectionRef.current;
        // Not connected yet: keep the batch; the full-scene send on subscribe covers it.
        if (!current) { pendingRef.current.restore(batch); return; }
        markSent(sentRef.current, batch);
        void current.sendElements("elements", batch).then((ok) => {
          if (ok) return;
          unmarkSent(sentRef.current, batch);
          pendingRef.current.restore(batch);
        });
      },
    });

    async function persist(keepalive: boolean) {
      const supabase = getSupabase();
      if (!supabase || !api) return;
      const events = unsavedRef.current.take();
      try {
        await saveSnapshot(supabase, { roomId, token, scene: sceneOf(api), events, keepalive });
      } catch (error) {
        unsavedRef.current.restore(events);
        throw error;
      }
    }

    const saver = role === "editor"
      ? createSaver({ idleMs: SAVE_IDLE_MS, maxWaitMs: SAVE_MAX_WAIT_MS, onState: setSaveState, save: () => persist(false) })
      : null;
    flusherRef.current = flusher;
    saverRef.current = saver;

    const applyRemote = (remote: SyncElement[]) => {
      const localElements = api.getSceneElementsIncludingDeleted() as unknown as SyncElement[];
      const merged = mergeByVersion(localElements, remote, protectedIds(api));
      api.updateScene({ elements: merged as never, captureUpdate: NEVER });
      // Mark as sent so a second editor tab never echoes these back.
      if (role === "editor") markSent(sentRef.current, remote);
    };

    async function start() {
      const supabase = await ensureAnonymousSession().catch(() => null);
      if (cancelled) return;
      if (!supabase) { setStatus("offline"); setReady(true); return; }
      const joined = await joinRoom(supabase, { roomId, token, role });
      if (cancelled) return;
      if (!joined.ok && joined.reason === "invalid") { setLinkError(true); return; }

      const base = joined.ok ? joined.snapshot?.elements ?? [] : [];
      const elements = role === "editor" && backup ? mergeByVersion(base, backup.elements) : base;
      // Elements already in the DB snapshot are not new changes; only backup-only edits get re-sent and re-saved.
      markSent(sentRef.current, base);
      api!.updateScene({
        elements: elements as never,
        appState: appStateOf((joined.ok ? joined.snapshot?.appState : undefined) ?? backup?.appState),
        captureUpdate: NEVER,
      });
      setReady(true);
      if (!joined.ok) { setStatus("offline"); return; }

      connection = openRoomConnection(supabase, { roomId, clientId, role }, {
        onElements: applyRemote,
        onSyncRequest: () => {
          if (role !== "editor") return;
          const now = Date.now();
          if (now - lastSceneReply < SYNC_REPLY_MIN_GAP_MS) return;
          lastSceneReply = now;
          sendFullScene();
        },
        onStatus: setStatus,
        onPresence: setPresence,
        onSubscribed: () => {
          connection?.requestSync();
          if (role === "editor") sendFullScene();
        },
      });
      connectionRef.current = connection;
    }

    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      flusher.flushNow();
      void saver?.flushNow();
    };
    const onPageHide = () => {
      flusher.flushNow();
      if (role === "editor" && unsavedRef.current.size > 0) void persist(true).catch(() => {});
    };

    void start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      flusher.cancel();
      saver?.dispose();
      connection?.close();
      connectionRef.current = null;
      flusherRef.current = null;
      saverRef.current = null;
    };
  }, [api, clientId, local, role, roomId, token]);

  const onChange = useCallback((elements: readonly unknown[], appState: { viewBackgroundColor: string }) => {
    if (role === "viewer") return;
    if (local) {
      writeBackup(roomId, { elements: elements as SyncElement[], appState: { viewBackgroundColor: appState.viewBackgroundColor } });
      return;
    }
    const changed = collectChanged(elements as readonly SyncElement[], sentRef.current);
    if (changed.length === 0) return;
    pendingRef.current.add(changed);
    unsavedRef.current.add(changed);
    flusherRef.current?.schedule();
    saverRef.current?.notifyChange();
  }, [local, role, roomId]);

  const openShare = () => {
    const origin = window.location.origin;
    setShare({
      editorUrl: window.location.href,
      viewerUrl: `${origin}/room/${roomId}?role=viewer&token=${viewerToken}${local ? "&local=1" : ""}`,
    });
  };

  if (linkError) {
    return <main className="link-error">
      <h1>This board link is invalid or expired</h1>
      <p className="muted">Ask for a fresh link, or create a new board.</p>
      <Link className="primary" href="/">Go home</Link>
    </main>;
  }

  return <main className="room">
    <StatusBar role={role} status={status} presence={presence} saveState={saveState} onShare={role === "editor" ? openShare : undefined} />
    <section className="canvas">
      {!ready && <div className="loading">Opening board…</div>}
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onChange}
        viewModeEnabled={role === "viewer"}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      />
    </section>
    {share && <ShareDialog editorUrl={share.editorUrl} viewerUrl={share.viewerUrl} onClose={() => setShare(null)} />}
  </main>;
}
