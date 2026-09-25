"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ensureAnonymousSession, getSupabase } from "@/lib/supabase";

type Board = { id: string; title: string; created_at: string; updated_at: string };

export default function DashboardPage() {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      if (!supabase) return router.replace("/login");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.is_anonymous) return router.replace("/login");
      const { data } = await supabase.from("rooms").select("id,title,created_at,updated_at").order("updated_at", { ascending: false });
      setBoards(data ?? []); setLoading(false);
    }
    load();
  }, [router]);

  async function createBoard() {
    const supabase = await ensureAnonymousSession();
    if (!supabase) return;
    const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "create" } });
    if (!error && data?.roomId) router.push(`/room/${data.roomId}?role=editor&token=${data.editorToken}&viewer=${data.viewerToken}`);
  }

  async function openBoard(roomId: string) {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "owner-access", roomId } });
    if (!error && data?.roomId) router.push(`/room/${data.roomId}?role=editor&token=${data.editorToken}&viewer=${data.viewerToken}`);
  }

  async function signOut() { await getSupabase()?.auth.signOut(); router.push("/"); }

  return <main className="dashboard"><header className="dashboard-header"><Link href="/" className="brand-link">PentoLive</Link><span />
    <button className="copy" onClick={signOut}>Sign out</button><button className="primary" onClick={createBoard}>New board</button></header>
    <section className="dashboard-content"><div><div className="eyebrow">Your workspace</div><h1>Saved canvases</h1><p className="muted">Private boards owned by your account.</p></div>
      {loading ? <p className="muted">Loading boards…</p> : boards.length === 0 ? <div className="empty"><h2>Your canvas shelf is empty.</h2><p>Create a board now; it will be saved here automatically.</p><button className="primary" onClick={createBoard}>Create your first board</button></div> :
        <div className="board-grid">{boards.map((board) => <button className="board-card" key={board.id} onClick={() => openBoard(board.id)}><strong>{board.title}</strong><span>Last edited {new Date(board.updated_at).toLocaleDateString()}</span></button>)}</div>}
    </section></main>;
}
