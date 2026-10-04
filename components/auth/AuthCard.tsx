import type { ReactNode } from "react";
import Logo from "@/components/Logo";

export default function AuthCard({ title, subtitle, footer, children }: { title: string; subtitle?: string; footer?: ReactNode; children?: ReactNode }) {
  return <main className="auth-page paper"><section className="auth-card">
    <Logo />
    <h1>{title}</h1>
    {subtitle && <p className="muted">{subtitle}</p>}
    {children}
    {footer && <p className="auth-footer">{footer}</p>}
  </section></main>;
}
