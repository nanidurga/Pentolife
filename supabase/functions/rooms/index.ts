import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeDetails } from "../_shared/boardDetails.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_SCENE_BYTES = 2_000_000;
const MAX_EVENTS_BYTES = 512_000;
const ANONYMOUS_ROOM_DAYS = 30;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value ?? null)).length;

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return json({ error: "Sign in anonymously before calling this function." }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const body = await request.json();

  if (body.action === "create") {
    const checked = normalizeDetails(body);
    if (!checked.ok) return json({ error: checked.message, field: checked.field }, 400);
    const editorToken = randomToken();
    const viewerToken = randomToken();
    const owned = !user.is_anonymous;
    const { data: room, error } = await admin.from("rooms").insert({
      ...checked.details,
      editor_token_hash: await hash(editorToken),
      viewer_token_hash: await hash(viewerToken),
      viewer_token: viewerToken,
      owner_id: owned ? user.id : null,
      expires_at: owned ? null : new Date(Date.now() + ANONYMOUS_ROOM_DAYS * 86_400_000).toISOString(),
    }).select("id").single();
    if (error || !room) return json({ error: "Could not create room." }, 500);
    await admin.from("room_members").insert({ room_id: room.id, user_id: user.id, role: "editor" });
    return json({ roomId: room.id, editorToken, viewerToken });
  }

  if (body.action === "owner-access") {
    if (user.is_anonymous || !body.roomId) return json({ error: "Sign in with your personal account first." }, 403);
    const { data: ownedRoom } = await admin.from("rooms").select("id, viewer_token").eq("id", body.roomId).eq("owner_id", user.id).maybeSingle();
    if (!ownedRoom) return json({ error: "Board not found." }, 404);
    // Rotate only the editor capability; keep the viewer link stable so shared links keep working.
    const editorToken = randomToken();
    const viewerToken = ownedRoom.viewer_token ?? randomToken();
    const update: Record<string, string> = { editor_token_hash: await hash(editorToken), updated_at: new Date().toISOString() };
    if (!ownedRoom.viewer_token) {
      update.viewer_token = viewerToken;
      update.viewer_token_hash = await hash(viewerToken);
    }
    await admin.from("rooms").update(update).eq("id", body.roomId);
    return json({ roomId: body.roomId, editorToken, viewerToken });
  }

  if (body.action === "update-details") {
    if (user.is_anonymous || !body.roomId) return json({ error: "Sign in with your personal account first." }, 403);
    const checked = normalizeDetails(body);
    if (!checked.ok) return json({ error: checked.message, field: checked.field }, 400);
    // Leaves updated_at alone: "recently edited" means drawing, not renaming.
    const { data: board, error } = await admin.from("rooms").update(checked.details)
      .eq("id", body.roomId).eq("owner_id", user.id).select("id, title, role, company").maybeSingle();
    if (error) return json({ error: "Could not save details." }, 500);
    if (!board) return json({ error: "Board not found." }, 404);
    return json({ board });
  }

  const { roomId, token } = body;
  if (!roomId || !token) return json({ error: "A room and capability token are required." }, 400);
  const now = new Date().toISOString();
  const { data: room } = await admin.from("rooms").select("*").eq("id", roomId)
    .or(`expires_at.is.null,expires_at.gt."${now}"`).maybeSingle();
  if (!room) return json({ error: "Room not found or expired." }, 404);
  const requestedRole = body.role === "editor" ? "editor" : "viewer";
  const tokenMatches = await hash(token) === (requestedRole === "editor" ? room.editor_token_hash : room.viewer_token_hash);
  if (!tokenMatches) return json({ error: "Invalid room capability." }, 403);

  if (body.action === "join") {
    // Never downgrade: a viewer join only inserts when the user has no membership yet;
    // only a validated editor token may write role "editor".
    const member = { room_id: roomId, user_id: user.id, role: requestedRole };
    if (requestedRole === "editor") {
      await admin.from("room_members").upsert(member, { onConflict: "room_id,user_id" });
    } else {
      await admin.from("room_members").upsert(member, { onConflict: "room_id,user_id", ignoreDuplicates: true });
    }
    const { data: membership } = await admin.from("room_members").select("role")
      .eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
    return json({ role: membership?.role ?? requestedRole, snapshot: room.snapshot });
  }

  if (body.action === "snapshot") {
    if (requestedRole !== "editor") return json({ error: "Editor access required." }, 403);
    if (!Array.isArray(body.scene?.elements)) return json({ error: "Invalid scene." }, 400);
    if (byteSize(body.scene) > MAX_SCENE_BYTES || byteSize(body.events) > MAX_EVENTS_BYTES) {
      return json({ error: "Board too large." }, 413);
    }
    const { error } = await admin.from("rooms").update({ snapshot: body.scene, updated_at: now }).eq("id", roomId);
    if (error) return json({ error: "Could not save snapshot." }, 500);
    if (Array.isArray(body.events) && body.events.length > 0) {
      await admin.from("room_events").insert({ room_id: roomId, elements: body.events });
    }
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
