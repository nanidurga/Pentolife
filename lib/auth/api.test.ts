import { describe, expect, it } from "vitest";
import { errorCodeFrom } from "./api";

describe("errorCodeFrom", () => {
  it("reads the error code from the function's JSON response", async () => {
    const error = { context: new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 401 }) };
    expect(await errorCodeFrom(error)).toBe("invalid_credentials");
  });

  it("reports network when the request never got a response", async () => {
    expect(await errorCodeFrom({ context: new TypeError("Failed to fetch") })).toBe("network");
    expect(await errorCodeFrom(new Error("boom"))).toBe("network");
  });

  it("falls back to server_error when the body is not our JSON", async () => {
    expect(await errorCodeFrom({ context: new Response("<html>", { status: 502 }) })).toBe("server_error");
  });
});
