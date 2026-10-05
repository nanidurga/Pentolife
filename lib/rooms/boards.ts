import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardDetails, DetailField } from "@/lib/rooms/details";

export type OpenedBoard = { roomId: string; editorToken: string; viewerToken: string };
export type DetailsError = { ok: false; field?: DetailField; message: string };

const FIELDS: readonly string[] = ["title", "role", "company"];

// functions.invoke puts the HTTP Response on error.context for non-2xx replies.
export async function detailsErrorFrom(error: unknown, fallback: string): Promise<DetailsError> {
  const response = (error as { context?: unknown } | null)?.context;
  if (response instanceof Response && response.status === 400) {
    try {
      const body = await response.clone().json() as { error?: unknown; field?: unknown };
      if (typeof body.field === "string" && FIELDS.includes(body.field) && typeof body.error === "string") {
        return { ok: false, field: body.field as DetailField, message: body.error };
      }
    } catch {
      // Not JSON: use the fallback message.
    }
  }
  return { ok: false, message: fallback };
}

export function boardUrl(board: OpenedBoard) {
  return `/room/${board.roomId}?role=editor&token=${board.editorToken}&viewer=${board.viewerToken}`;
}

export async function openOwnedBoard(supabase: SupabaseClient, roomId: string): Promise<OpenedBoard | null> {
  const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "owner-access", roomId } });
  if (error || !data?.roomId) return null;
  return { roomId: data.roomId, editorToken: data.editorToken, viewerToken: data.viewerToken };
}

export async function createBoard(supabase: SupabaseClient, details: BoardDetails): Promise<{ ok: true; board: OpenedBoard } | DetailsError> {
  const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "create", ...details } });
  if (error || !data?.roomId) return detailsErrorFrom(error, "Couldn't create the board. Try again.");
  return { ok: true, board: { roomId: data.roomId, editorToken: data.editorToken, viewerToken: data.viewerToken } };
}

export async function updateBoardDetails(
  supabase: SupabaseClient,
  roomId: string,
  details: BoardDetails,
): Promise<{ ok: true; details: BoardDetails } | DetailsError> {
  const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "update-details", roomId, ...details } });
  if (error || !data?.board) return detailsErrorFrom(error, "Couldn't save the changes. Try again.");
  const { title, role, company } = data.board as BoardDetails;
  return { ok: true, details: { title, role, company } };
}
