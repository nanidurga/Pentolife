import type { SupabaseClient } from "@supabase/supabase-js";
import { KEEPALIVE_MAX_BYTES } from "@/lib/sync/messages";
import { PermanentSaveError } from "@/lib/sync/saver";
import type { SyncElement } from "@/lib/sync/types";

export type Scene = { elements: SyncElement[]; appState?: { viewBackgroundColor?: string } };
export type JoinResult = { ok: true; snapshot: Scene | null } | { ok: false; reason: "invalid" | "offline" };

export function classifyJoinError(status: number | undefined): "invalid" | "offline" {
  return status === 400 || status === 403 || status === 404 ? "invalid" : "offline";
}

export function buildSnapshotRequest(input: {
  url: string;
  publishableKey: string;
  accessToken: string;
  body: unknown;
  keepalive: boolean;
}): { url: string; init: RequestInit } {
  const body = JSON.stringify(input.body);
  const small = new TextEncoder().encode(body).length < KEEPALIVE_MAX_BYTES;
  return {
    url: `${input.url}/functions/v1/rooms`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, apikey: input.publishableKey, "Content-Type": "application/json" },
      body,
      keepalive: input.keepalive && small,
    },
  };
}

export function checkSnapshotResponse(status: number) {
  if (status === 413) throw new PermanentSaveError("Board too large to save", "failed");
  // The editor token was rotated (owner re-entered); this tab's link can never save again.
  if (status === 403) throw new PermanentSaveError("Editor link replaced", "replaced");
  if (status < 200 || status >= 300) throw new Error(`Snapshot save failed with ${status}`);
}

export async function joinRoom(
  supabase: SupabaseClient,
  params: { roomId: string; token: string; role: "editor" | "viewer" },
): Promise<JoinResult> {
  const { data, error } = await supabase.functions.invoke("rooms", { body: { action: "join", ...params } });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    return { ok: false, reason: classifyJoinError(status) };
  }
  return { ok: true, snapshot: (data?.snapshot as Scene | undefined) ?? null };
}

// Uses fetch directly (not functions.invoke) so it can set `keepalive` on page hide.
export async function saveSnapshot(
  supabase: SupabaseClient,
  params: { roomId: string; token: string; scene: Scene; events: SyncElement[]; keepalive?: boolean },
) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("No Supabase session");
  const { url, init } = buildSnapshotRequest({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    accessToken: session.access_token,
    body: { action: "snapshot", roomId: params.roomId, token: params.token, role: "editor", scene: params.scene, events: params.events },
    keepalive: params.keepalive ?? false,
  });
  const response = await fetch(url, init);
  checkSnapshotResponse(response.status);
}
