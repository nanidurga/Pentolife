import Link from "next/link";
import Logo, { LogoMark } from "@/components/Logo";

export default function Landing() {
  return <main className="landing paper">
    <header className="landing-nav"><Logo /></header>
    <section className="hero">
      <span className="live-pill"><span className="live-dot" />Live whiteboard</span>
      <h1>Think out loud,<br /> <span className="highlight">on paper</span> they can see.</h1>
      <p className="muted">Draw on your tablet. Your interviewer follows every stroke from one private link.</p>
      <div className="actions">
        <Link className="primary" href="/signup">Create account</Link>
        <Link className="button" href="/signin">Sign in</Link>
      </div>
    </section>
    <svg className="doodle doodle-ink" width="140" height="80" viewBox="0 0 140 80" aria-hidden="true">
      <path d="M8 60c16-40 36-44 48-20s28 28 44-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="104" cy="28" r="5" style={{ fill: "var(--accent)" }} />
    </svg>
    <LogoMark className="doodle doodle-tile" size={88} />
  </main>;
}
