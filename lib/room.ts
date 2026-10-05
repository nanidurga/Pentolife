export function makeCapability() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function localRoomKey(roomId: string) {
  return `pentolive:room:${roomId}`;
}

// Query string for switching between the board and the visualizer without changing access.
export function roomQuery({ role, token, viewerToken, local }: { role: "editor" | "viewer"; token: string; viewerToken: string; local: boolean }) {
  const params = new URLSearchParams({ role, token });
  if (viewerToken) params.set("viewer", viewerToken);
  if (local) params.set("local", "1");
  return params.toString();
}
