import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

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
    const editorToken = randomToken();
    const viewerToken = randomToken();
    const { data: room, error } = await admin.from("rooms").insert({
      editor_token_hash: await hash(editorToken),
      viewer_token_hash: await hash(viewerToken),
      owner_id: user.is_anonymous ? null : user.id,
    }).select("id").single();
    if (error || !room) return json({ error: "Could not create room." }, 500);
    await admin.from("room_members").insert({ room_id: room.id, user_id: user.id, role: "editor" });
    return json({ roomId: room.id, editorToken, viewerToken });
  }

  if (body.action === "owner-access") {
    if (user.is_anonymous || !body.roomId) return json({ error: "Sign in with your personal account first." }, 403);
    const { data: ownedRoom } = await admin.from("rooms").select("id").eq("id", body.roomId).eq("owner_id", user.id).maybeSingle();
    if (!ownedRoom) return json({ error: "Board not found." }, 404);
    const editorToken = randomToken();
    const viewerToken = randomToken();
    await admin.from("rooms").update({
      editor_token_hash: await hash(editorToken), viewer_token_hash: await hash(viewerToken), updated_at: new Date().toISOString(),
    }).eq("id", body.roomId);
    return json({ roomId: body.roomId, editorToken, viewerToken });
  }

  const { roomId, token } = body;
  if (!roomId || !token) return json({ error: "A room and capability token are required." }, 400);
  const { data: room } = await admin.from("rooms").select("*").eq("id", roomId).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!room) return json({ error: "Room not found or expired." }, 404);
  const requestedRole = body.role === "editor" ? "editor" : "viewer";
  const tokenMatches = await hash(token) === (requestedRole === "editor" ? room.editor_token_hash : room.viewer_token_hash);
  if (!tokenMatches) return json({ error: "Invalid room capability." }, 403);

  if (body.action === "join") {
    await admin.from("room_members").upsert({ room_id: roomId, user_id: user.id, role: requestedRole });
    return json({ role: requestedRole, snapshot: room.snapshot });
  }

  if (body.action === "snapshot") {
    if (requestedRole !== "editor") return json({ error: "Editor access required." }, 403);
    const { error } = await admin.from("rooms").update({ snapshot: body.scene, updated_at: new Date().toISOString() }).eq("id", roomId);
    return error ? json({ error: "Could not save snapshot." }, 500) : json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
