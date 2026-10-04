import { describe, expect, it } from "vitest";
import { buildSnapshotRequest, checkSnapshotResponse, classifyJoinError } from "./api";
import { PermanentSaveError } from "@/lib/sync/saver";

const base = { url: "https://p.supabase.co", publishableKey: "pk", accessToken: "jwt" };

describe("buildSnapshotRequest", () => {
  it("targets the rooms function with auth headers", () => {
    const { url, init } = buildSnapshotRequest({ ...base, body: { a: 1 }, keepalive: false });
    expect(url).toBe("https://p.supabase.co/functions/v1/rooms");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer jwt", apikey: "pk", "Content-Type": "application/json" });
    expect(init.body).toBe('{"a":1}');
  });

  it("uses keepalive for small bodies when asked", () => {
    expect(buildSnapshotRequest({ ...base, body: { a: 1 }, keepalive: true }).init.keepalive).toBe(true);
  });

  it("drops keepalive for bodies over 60 KB (browsers silently discard them)", () => {
    const body = { data: "x".repeat(70_000) };
    expect(buildSnapshotRequest({ ...base, body, keepalive: true }).init.keepalive).toBe(false);
  });
});

describe("checkSnapshotResponse", () => {
  it("accepts 2xx", () => {
    expect(() => checkSnapshotResponse(200)).not.toThrow();
  });

  it("treats 413 as permanent", () => {
    expect(() => checkSnapshotResponse(413)).toThrow(PermanentSaveError);
  });

  it("reports 413 as the too-large failure state", () => {
    let error: unknown;
    try { checkSnapshotResponse(413); } catch (e) { error = e; }
    expect((error as PermanentSaveError).state).toBe("failed");
  });

  it("treats 403 (editor link replaced) as permanent with its own state", () => {
    let error: unknown;
    try { checkSnapshotResponse(403); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(PermanentSaveError);
    expect((error as PermanentSaveError).state).toBe("replaced");
  });

  it("treats other failures as retryable", () => {
    let error: unknown;
    try { checkSnapshotResponse(500); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentSaveError);
  });
});

describe("classifyJoinError", () => {
  it.each([400, 403, 404])("treats %i as an invalid link", (status) => {
    expect(classifyJoinError(status)).toBe("invalid");
  });

  it.each([undefined, 500, 503])("treats %s as offline", (status) => {
    expect(classifyJoinError(status)).toBe("offline");
  });
});
