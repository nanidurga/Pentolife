import type { PresenceCounts } from "@/lib/realtime/presence";
import type { ConnectionStatus, RoomRole } from "@/lib/realtime/roomChannel";
import type { SaveState } from "@/lib/sync/saver";

const CONNECTION: Record<ConnectionStatus | "local", string> = {
  connecting: "Connecting…",
  live: "LIVE",
  reconnecting: "Reconnecting…",
  offline: "Offline",
  local: "Local prototype",
};

const SAVE: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  retrying: "Not saved — retrying",
  failed: "Too large to save — kept on this device",
};

export const connectionLabel = (status: ConnectionStatus | "local") => CONNECTION[status];
export const saveLabel = (state: SaveState) => SAVE[state];

export function presenceLabel(role: RoomRole, counts: PresenceCounts) {
  if (role === "editor") return `👁 ${counts.viewers} watching`;
  return counts.editors > 0 ? "Candidate online" : "Candidate offline";
}
