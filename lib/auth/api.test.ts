import { describe, expect, it } from "vitest";
import { emailLinkEvidence, errorCodeFrom, linkSessionMatches } from "./api";

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

describe("emailLinkEvidence", () => {
  it("takes the access token from an implicit-flow link", () => {
    expect(emailLinkEvidence("", "#access_token=abc&refresh_token=r&type=recovery")).toEqual({ kind: "token", accessToken: "abc" });
  });

  it("takes the code from a PKCE link", () => {
    expect(emailLinkEvidence("?code=xyz", "")).toEqual({ kind: "code", code: "xyz" });
  });

  it("finds nothing on a bare visit, so an existing session is never mistaken for a used link", () => {
    expect(emailLinkEvidence("", "")).toBeNull();
    expect(emailLinkEvidence("?next=/", "#section")).toBeNull();
  });
});

describe("linkSessionMatches", () => {
  it("accepts only the session created from this link's token", () => {
    const evidence = { kind: "token" as const, accessToken: "abc" };
    expect(linkSessionMatches(evidence, { access_token: "abc", user: { is_anonymous: false } })).toBe(true);
    expect(linkSessionMatches(evidence, { access_token: "other-account", user: { is_anonymous: false } })).toBe(false);
    expect(linkSessionMatches(evidence, null)).toBe(false);
  });
});
