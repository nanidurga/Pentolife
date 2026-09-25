"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { makeCapability } from "@/lib/room";
import { ensureAnonymousSession } from "@/lib/supabase";

export default function Home() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function createBoard() {
    setCreating(true);
    try {
      const supabase = await ensureAnonymousSession();
      if (supabase) {
        const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "create" } });
        if (!error && data?.roomId && data?.editorToken && data?.viewerToken) {
          router.push(`/room/${data.roomId}?role=editor&token=${data.editorToken}&viewer=${data.viewerToken}`);
          return;
        }
      }
      const roomId = crypto.randomUUID();
      const localToken = makeCapability();
      router.push(`/room/${roomId}?role=editor&token=${localToken}&viewer=${localToken}&local=1`);
    } finally {
      setCreating(false);
    }
  }

  return <main className="landing"><section className="hero">
    <div className="eyebrow">PentoLive · personal beta</div>
    <h1>Your live interview thinking surface.</h1>
    <p>Write with your tablet, build architecture diagrams, and let an interviewer follow a single private link.</p>
    <button className="primary" onClick={createBoard} disabled={creating}>{creating ? "Creating…" : "Create a whiteboard"}</button>
    <p className="hint">No account required for the local prototype. Supabase rooms activate once environment variables are added.</p>
  </section></main>;
}
