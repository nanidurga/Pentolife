"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import UsernameField, { type UsernameStatus } from "@/components/auth/UsernameField";
import { claimUsername, signOut } from "@/lib/auth/api";
import { getSupabase } from "@/lib/supabase";
import { relativeTime } from "@/lib/ui/relativeTime";

type Board = { id: string; title: string; updated_at: string };
type RoomRequest = { action: "create" } | { action: "owner-access"; roomId: string };

export default function Dashboard({ username, onProfileChange }: { username: string | null; onProfileChange: () => void }) {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getSupabase()?.from("rooms").select("id,title,updated_at").order("updated_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError("Couldn't load your boards. Refresh to try again.");
        setBoards(data ?? []);
      });
  }, []);

  async function enter(body: RoomRequest) {
    const supabase = getSupabase();
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    const { data, error: openError } = await supabase.functions.invoke("rooms", { body });
    if (!openError && data?.roomId) {
      router.push(`/room/${data.roomId}?role=editor&token=${data.editorToken}&viewer=${data.viewerToken}`);
      return;
    }
    setBusy(false);
    setError("Couldn't open the board. Try again.");
  }

  const now = new Date();

  return <>
    <header className="app-header">
      <Link href="/" className="wordmark">PentoLive</Link>
      <span className="spacer" />
      <button className="primary" onClick={() => enter({ action: "create" })} disabled={busy}>New board</button>
      <details className="menu">
        <summary className="button">{username ? `@${username}` : "Account"}</summary>
        <div className="menu-panel"><button className="menu-item" onClick={() => signOut()}>Sign out</button></div>
      </details>
    </header>
    <main className="dashboard">
      {!username && <ClaimUsername onClaimed={onProfileChange} />}
      <div className="section-head"><h1>Boards</h1>{boards && boards.length > 0 && <span className="muted">{boards.length}</span>}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {boards === null ? <p className="muted">Loading…</p>
        : boards.length === 0 ? <div className="empty">
          <p className="muted">No boards yet.</p>
          <button className="primary" onClick={() => enter({ action: "create" })} disabled={busy}>New board</button>
        </div>
        : <ul className="board-list">{boards.map((board) => <li key={board.id}>
          <button className="board-row" onClick={() => enter({ action: "owner-access", roomId: board.id })} disabled={busy}>
            <strong>{board.title}</strong><span>Edited {relativeTime(new Date(board.updated_at), now)}</span>
          </button>
        </li>)}</ul>}
    </main>
  </>;
}

function ClaimUsername({ onClaimed }: { onClaimed: () => void }) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<UsernameStatus>("empty");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const ready = status === "available" || status === "unknown";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !ready) return;
    setPending(true);
    setError("");
    const result = await claimUsername(value);
    setPending(false);
    if (result.ok) onClaimed();
    else setError(result.message);
  }

  return <section className="notice">
    <h2>Choose a username</h2>
    <p className="muted">You can sign in with it instead of your email.</p>
    <form className="auth-form" onSubmit={submit}>
      <UsernameField value={value} onChange={setValue} onStatus={setStatus} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending || !ready}>{pending ? "Saving…" : "Save username"}</button>
    </form>
  </section>;
}
