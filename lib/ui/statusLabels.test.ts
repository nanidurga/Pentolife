import { describe, expect, it } from "vitest";
import { connectionLabel, presenceLabel, saveLabel } from "./statusLabels";

describe("status labels", () => {
  it("labels connection states", () => {
    expect(connectionLabel("live")).toBe("LIVE");
    expect(connectionLabel("reconnecting")).toBe("Reconnecting…");
    expect(connectionLabel("offline")).toBe("Offline");
    expect(connectionLabel("connecting")).toBe("Connecting…");
    expect(connectionLabel("local")).toBe("Local prototype");
  });

  it("shows watching count to the editor", () => {
    expect(presenceLabel("editor", { editors: 0, viewers: 2 })).toBe("👁 2 watching");
  });

  it("shows candidate presence to the viewer", () => {
    expect(presenceLabel("viewer", { editors: 1, viewers: 0 })).toBe("Candidate online");
    expect(presenceLabel("viewer", { editors: 0, viewers: 3 })).toBe("Candidate offline");
  });

  it("labels save states", () => {
    expect(saveLabel("saved")).toBe("Saved");
    expect(saveLabel("saving")).toBe("Saving…");
    expect(saveLabel("retrying")).toBe("Not saved — retrying");
    expect(saveLabel("failed")).toBe("Too large to save — kept on this device");
  });
});
