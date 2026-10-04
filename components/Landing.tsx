import Link from "next/link";

export default function Landing() {
  return <main className="landing"><div className="landing-inner">
    <span className="wordmark">PentoLive</span>
    <h1>A live whiteboard for technical interviews.</h1>
    <p className="muted">Draw on your tablet. Your interviewer follows along from one private link.</p>
    <div className="actions">
      <Link className="primary" href="/signup">Create account</Link>
      <Link className="button" href="/signin">Sign in</Link>
    </div>
  </div></main>;
}
