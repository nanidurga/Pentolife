"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureAnonymousSession } from "@/lib/supabase";
import { localRoomKey, makeCapability } from "@/lib/room";

const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((module) => module.Excalidraw), { ssr: false });
type Role = "editor" | "viewer";
type BoardProps = { roomId: string; role: Role; token: string; viewerToken: string; local: boolean };

export default function Board({ roomId, role, token, viewerToken, local }: BoardProps) {
  const apiRef = useRef<any>(null);
  const channelRef = useRef<any>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientId = useMemo(() => makeCapability(), []);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(local ? "Local prototype" : "Connecting…");

  useEffect(() => {
    let cancelled = false;
    async function connect() {
      if (local) {
        const stored = window.localStorage.getItem(localRoomKey(roomId));
        if (stored && apiRef.current) apiRef.current.updateScene(JSON.parse(stored));
        if (!cancelled) { setReady(true); setConnected("Local prototype"); }
        return;
      }
      try {
        const supabase = await ensureAnonymousSession();
        if (!supabase) throw new Error("Supabase is not configured");
        const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "join", roomId, token, role } });
        if (error) throw error;
        if (data?.snapshot && apiRef.current) apiRef.current.updateScene(data.snapshot);
        const channel = supabase.channel(`room:${roomId}`, { config: { private: true } })
          .on("broadcast", { event: "scene" }, ({ payload }) => {
            if (payload?.origin !== clientId && payload?.scene) apiRef.current?.updateScene(payload.scene);
          })
          .subscribe((status) => setConnected(status === "SUBSCRIBED" ? "Live" : "Reconnecting…"));
        channelRef.current = channel;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) { setReady(true); setConnected("Offline — configure Supabase"); }
      }
    }
    const waitForApi = window.setInterval(() => { if (apiRef.current) { window.clearInterval(waitForApi); connect(); } }, 30);
    return () => { cancelled = true; window.clearInterval(waitForApi); channelRef.current?.unsubscribe(); };
  }, [clientId, local, role, roomId, token]);

  const onChange = useCallback((elements: readonly any[], appState: any) => {
    if (role === "viewer") return;
    const scene = { elements, appState: { viewBackgroundColor: appState.viewBackgroundColor } };
    if (local) window.localStorage.setItem(localRoomKey(roomId), JSON.stringify(scene));
    channelRef.current?.send({ type: "broadcast", event: "scene", payload: { origin: clientId, scene } });
    if (!local && saveTimer.current === null) {
      saveTimer.current = setTimeout(async () => {
        saveTimer.current = null;
        const supabase = await ensureAnonymousSession();
        await supabase?.functions.invoke("rooms", { body: { action: "snapshot", roomId, token, role, scene } });
      }, 1500);
    }
  }, [clientId, local, role, roomId, token]);

  const copyViewer = async () => {
    const link = `${window.location.origin}/room/${roomId}?role=viewer&token=${viewerToken}${local ? "&local=1" : ""}`;
    await navigator.clipboard.writeText(link);
    setConnected("Viewer link copied");
  };

  return <main className="room"><header className="topbar">
    <span className="brand">PentoLive</span><span className={`status ${connected.includes("Offline") ? "offline" : ""}`}>{connected}</span>
    {role === "editor" && <button className="copy" onClick={copyViewer}>Copy viewer link</button>}
  </header><section className="canvas">
    {!ready && <div className="loading">Opening board…</div>}
    <Excalidraw excalidrawAPI={(api) => { apiRef.current = api; }} onChange={onChange} viewModeEnabled={role === "viewer"} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }} />
  </section></main>;
}
