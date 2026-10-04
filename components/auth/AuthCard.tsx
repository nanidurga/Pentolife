import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthCard({ title, subtitle, footer, children }: { title: string; subtitle?: string; footer?: ReactNode; children?: ReactNode }) {
  return <main className="auth-page"><section className="auth-card">
    <Link href="/" className="wordmark">PentoLive</Link>
    <h1>{title}</h1>
    {subtitle && <p className="muted">{subtitle}</p>}
    {children}
    {footer && <p className="auth-footer">{footer}</p>}
  </section></main>;
}
