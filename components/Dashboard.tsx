"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Logo, { LogoMark } from "@/components/Logo";
import UsernameField, { type UsernameStatus } from "@/components/auth/UsernameField";
import BoardCard from "@/components/dashboard/BoardCard";
import BoardDetailsDialog from "@/components/dashboard/BoardDetailsDialog";
import FilterBar from "@/components/dashboard/FilterBar";
import { claimUsername, signOut } from "@/lib/auth/api";
import {
  applyFilters, DEFAULT_FILTERS, type DashboardBoard, type Filters, filtersToParams, hasActiveFilters, parseFilters,
} from "@/lib/dashboard/filter";
import { tagOptions } from "@/lib/dashboard/tags";
import { boardUrl, createBoard, type DetailsError, openOwnedBoard, updateBoardDetails } from "@/lib/rooms/boards";
import type { BoardDetails } from "@/lib/rooms/details";
import { getSupabase } from "@/lib/supabase";

type DialogState = { mode: "create" } | { mode: "edit"; board: DashboardBoard } | null;

// `username` is undefined when the profile could not be loaded; null when the account has none yet.
export default function Dashboard({ username, onProfileChange }: { username: string | null | undefined; onProfileChange: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  const [boards, setBoards] = useState<DashboardBoard[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    getSupabase()?.from("rooms").select("id,title,role,company,created_at,updated_at").order("updated_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setLoadFailed(true);
          setError("Couldn't load your boards. Refresh to try again.");
        }
        setBoards((data ?? []) as DashboardBoard[]);
      });
  }, []);

  const visible = useMemo(() => (boards ? applyFilters(boards, filters) : []), [boards, filters]);
  const roles = useMemo(() => tagOptions(boards ?? [], "role"), [boards]);
  const companies = useMemo(() => tagOptions(boards ?? [], "company"), [boards]);
  const filtering = hasActiveFilters(filters);

  function setFilters(next: Filters) {
    const query = filtersToParams(next).toString();
    // Native replaceState syncs useSearchParams without a server round trip, so quick changes don't overtake each other.
    window.history.replaceState(null, "", query ? `/?${query}` : "/");
  }

  function openDialog(state: DialogState) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog(state);
  }

  function closeDialog() {
    setDialog(null);
    openerRef.current?.focus();
  }

  async function openBoard(roomId: string) {
    const supabase = getSupabase();
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    const opened = await openOwnedBoard(supabase, roomId);
    if (opened) return router.push(boardUrl(opened));
    setBusy(false);
    setError("Couldn't open the board. Try again.");
  }

  async function submitDetails(details: BoardDetails): Promise<{ ok: true } | DetailsError> {
    const supabase = getSupabase();
    if (!supabase || !dialog) return { ok: false, message: "Couldn't reach PentoLive. Try again." };
    if (dialog.mode === "create") {
      const created = await createBoard(supabase, details);
      if (created.ok) router.push(boardUrl(created.board));
      return created;
    }
    const roomId = dialog.board.id;
    const saved = await updateBoardDetails(supabase, roomId, details);
    if (saved.ok) {
      setBoards((list) => list?.map((board) => (board.id === roomId ? { ...board, ...saved.details } : board)) ?? null);
      closeDialog();
    }
    return saved;
  }

  const now = new Date();

  return <div className="app-shell paper">
    <header className="app-header">
      <Logo />
      <span className="spacer" />
      <button className="primary" onClick={() => openDialog({ mode: "create" })} disabled={busy}>New board</button>
      <details className="menu">
        <summary className="button">{username ? `@${username}` : "Account"}</summary>
        <div className="menu-panel"><button className="menu-item" onClick={() => signOut()}>Sign out</button></div>
      </details>
    </header>
    <main className="dashboard">
      {username === null && <ClaimUsername onClaimed={onProfileChange} />}
      <div className="section-head">
        <h1>Boards</h1>
        {boards && boards.length > 0 && <span className="count">{filtering ? `${visible.length} of ${boards.length}` : boards.length}</span>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {boards && boards.length > 0 && !loadFailed && <FilterBar filters={filters} roles={roles} companies={companies} onChange={setFilters} />}
      {boards === null ? <p className="muted">Loading…</p>
        : boards.length === 0 ? <div className="empty-state">
          <LogoMark size={40} />
          <p className="muted">No boards yet. Create one, then share its link with your interviewer.</p>
          <button className="primary" onClick={() => openDialog({ mode: "create" })} disabled={busy}>New board</button>
        </div>
        : visible.length === 0 ? <div className="empty-state">
          <p className="muted">No boards match these filters.</p>
          <button className="button" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear filters</button>
        </div>
        : <ul className="board-list">{visible.map((board) => <BoardCard key={board.id} board={board} now={now} disabled={busy}
          onOpen={() => openBoard(board.id)} onEdit={() => openDialog({ mode: "edit", board })} />)}</ul>}
    </main>
    {dialog && <BoardDetailsDialog mode={dialog.mode} initial={dialog.mode === "edit" ? dialog.board : undefined}
      boards={boards ?? []} onSubmit={submitDetails} onClose={closeDialog} />}
  </div>;
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
    <h2>Choose a <span className="highlight">username</span></h2>
    <p className="muted">You can sign in with it instead of your email.</p>
    <form className="auth-form" onSubmit={submit}>
      <UsernameField value={value} onChange={setValue} onStatus={setStatus} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={pending || !ready}>{pending ? "Saving…" : "Save username"}</button>
    </form>
  </section>;
}
