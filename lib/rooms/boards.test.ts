import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { boardUrl, createBoard, detailsErrorFrom, updateBoardDetails } from "@/lib/rooms/boards";

const details = { title: "LRU cache", role: "Backend SDE II", company: "Razorpay" };
const client = (result: { data: unknown; error: unknown }) => {
  const invoke = vi.fn().mockResolvedValue(result);
  return { supabase: { functions: { invoke } } as unknown as SupabaseClient, invoke };
};
const httpError = (status: number, body: unknown) => ({ context: new Response(JSON.stringify(body), { status }) });

describe("detailsErrorFrom", () => {
  it("returns the field error from a 400 response", async () => {
    expect(await detailsErrorFrom(httpError(400, { error: "Role can be at most 60 characters.", field: "role" }), "fallback"))
      .toEqual({ ok: false, field: "role", message: "Role can be at most 60 characters." });
  });

  it("falls back for other statuses, unknown fields and non-JSON bodies", async () => {
    expect(await detailsErrorFrom(httpError(500, { error: "x", field: "role" }), "fallback")).toEqual({ ok: false, message: "fallback" });
    expect(await detailsErrorFrom(httpError(400, { error: "x", field: "owner_id" }), "fallback")).toEqual({ ok: false, message: "fallback" });
    expect(await detailsErrorFrom({ context: new Response("oops", { status: 400 }) }, "fallback")).toEqual({ ok: false, message: "fallback" });
    expect(await detailsErrorFrom(new Error("network"), "fallback")).toEqual({ ok: false, message: "fallback" });
  });
});

describe("createBoard", () => {
  it("sends the details and returns the opened board", async () => {
    const { supabase, invoke } = client({ data: { roomId: "r1", editorToken: "e", viewerToken: "v" }, error: null });
    expect(await createBoard(supabase, details)).toEqual({ ok: true, board: { roomId: "r1", editorToken: "e", viewerToken: "v" } });
    expect(invoke).toHaveBeenCalledWith("rooms", { body: { action: "create", ...details } });
  });

  it("returns the create fallback message on failure", async () => {
    const { supabase } = client({ data: null, error: new Error("down") });
    expect(await createBoard(supabase, details)).toEqual({ ok: false, message: "Couldn't create the board. Try again." });
  });
});

describe("updateBoardDetails", () => {
  it("sends the room and details and returns the saved values", async () => {
    const { supabase, invoke } = client({ data: { board: { id: "r1", ...details } }, error: null });
    expect(await updateBoardDetails(supabase, "r1", details)).toEqual({ ok: true, details });
    expect(invoke).toHaveBeenCalledWith("rooms", { body: { action: "update-details", roomId: "r1", ...details } });
  });

  it("returns the save fallback message on failure", async () => {
    const { supabase } = client({ data: null, error: new Error("down") });
    expect(await updateBoardDetails(supabase, "r1", details)).toEqual({ ok: false, message: "Couldn't save the changes. Try again." });
  });
});

describe("boardUrl", () => {
  it("builds the editor link", () => {
    expect(boardUrl({ roomId: "r1", editorToken: "e", viewerToken: "v" })).toBe("/room/r1?role=editor&token=e&viewer=v");
  });
});
