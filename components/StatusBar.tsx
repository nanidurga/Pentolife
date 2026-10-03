import type { PresenceCounts } from "@/lib/realtime/presence";
import type { ConnectionStatus, RoomRole } from "@/lib/realtime/roomChannel";
import type { SaveState } from "@/lib/sync/saver";
import { connectionLabel, presenceLabel, saveLabel } from "@/lib/ui/statusLabels";

type StatusBarProps = {
  role: RoomRole;
  status: ConnectionStatus | "local";
  presence: PresenceCounts;
  saveState: SaveState | null;
  onShare?: () => void;
};

export default function StatusBar({ role, status, presence, saveState, onShare }: StatusBarProps) {
  const warn = status === "offline" || status === "reconnecting";
  return <header className="topbar">
    <span className="brand">PentoLive</span>
    <span className={`status ${warn ? "offline" : ""}`} role="status">{connectionLabel(status)}</span>
    {status !== "local" && <span className="presence">{presenceLabel(role, presence)}</span>}
    {saveState && <span className={`save ${saveState === "retrying" || saveState === "failed" ? "warn" : ""}`}>{saveLabel(saveState)}</span>}
    {onShare && <button className="copy" onClick={onShare}>Share</button>}
  </header>;
}
