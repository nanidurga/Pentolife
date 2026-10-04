import Link from "next/link";

// The P pentomino: five tiles, one lit as "live". Tiles follow the text colour.
export function LogoMark({ size = 26, className }: { size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <g transform="translate(8 1.5)" fill="currentColor">
      <rect width="11" height="11" rx="2.5" />
      <rect x="13" width="11" height="11" rx="2.5" />
      <rect y="13" width="11" height="11" rx="2.5" />
      <rect x="13" y="13" width="11" height="11" rx="2.5" style={{ fill: "var(--accent)" }} />
      <rect y="26" width="11" height="11" rx="2.5" />
    </g>
  </svg>;
}

export default function Logo({ href = "/" }: { href?: string }) {
  return <Link href={href} className="logo" aria-label="PentoLive home">
    <LogoMark />
    <span>PentoLive</span>
  </Link>;
}
