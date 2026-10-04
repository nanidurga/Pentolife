import type { PresenceCounts } from "@/lib/realtime/presence";
import type { ConnectionStatus, RoomRole } from "@/lib/realtime/roomChannel";
import type { SaveState } from "@/lib/sync/saver";
import { LogoMark } from "@/components/Logo";
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
    <span className="brand"><LogoMark size={20} /><span className="brand-name">PentoLive</span></span>
    <span className={`status ${warn ? "offline" : ""}`} role="status">{status === "live" && <span className="live-dot pulse" />}{connectionLabel(status)}</span>
    {status !== "local" && <span className="presence">{presenceLabel(role, presence)}</span>}
    {saveState && <span className={`save ${saveState === "retrying" || saveState === "failed" || saveState === "replaced" ? "warn" : ""}`}>{saveLabel(saveState)}</span>}
    {onShare && <button className="copy" onClick={onShare}>Share</button>}
  </header>;
}
