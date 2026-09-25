export function makeCapability() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function localRoomKey(roomId: string) {
  return `pentolive:room:${roomId}`;
}
