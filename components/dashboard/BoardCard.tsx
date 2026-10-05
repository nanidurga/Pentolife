"use client";

import type { MouseEvent } from "react";
import type { DashboardBoard } from "@/lib/dashboard/filter";
import { relativeTime } from "@/lib/ui/relativeTime";

type BoardCardProps = { board: DashboardBoard; now: Date; disabled: boolean; onOpen: () => void; onEdit: () => void };

export default function BoardCard({ board, now, disabled, onOpen, onEdit }: BoardCardProps) {
  function edit(event: MouseEvent<HTMLButtonElement>) {
    const menu = event.currentTarget.closest("details");
    menu?.removeAttribute("open");
    // Focus the menu button first so the dialog returns focus there when it closes.
    menu?.querySelector("summary")?.focus();
    onEdit();
  }

  return <li className="board-card">
    <button className="board-row" onClick={onOpen} disabled={disabled}>
      <span className="board-main">
        <strong>{board.title}</strong>
        {(board.role || board.company) && <span className="chips">
          {board.role && <span className="chip">{board.role}</span>}
          {board.company && <span className="chip company">{board.company}</span>}
        </span>}
      </span>
      <span className="board-time">Edited {relativeTime(new Date(board.updated_at), now)}</span>
    </button>
    <details className="menu board-menu">
      <summary className="icon-button" aria-label={`More actions for ${board.title}`}>⋯</summary>
      <div className="menu-panel"><button className="menu-item" onClick={edit}>Edit details</button></div>
    </details>
  </li>;
}
