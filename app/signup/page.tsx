"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import Field from "@/components/auth/Field";
import UsernameField, { type UsernameStatus } from "@/components/auth/UsernameField";
import { useRedirectWhenSignedIn } from "@/components/auth/useSession";
import { resendConfirmation, signUp } from "@/lib/auth/api";
import { PASSWORD_MESSAGES } from "@/lib/auth/messages";
import { validatePassword } from "@/lib/auth/password";

export default function SignUpPage() {
  useRedirectWhenSignedIn();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("empty");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const passwordError = validatePassword(password, confirm);
  const usernameOk = usernameStatus === "available" || usernameStatus === "unknown";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!usernameOk) return setError("Choose an available username.");
    if (passwordError) return setError(PASSWORD_MESSAGES[passwordError]);
    setPending(true);
    setError("");
    const result = await signUp({ email, username, password });
    setPending(false);
    if (result.ok) setSentTo(email.trim());
    else setError(result.message);
  }

  if (sentTo) {
    return <AuthCard title="Check your inbox" subtitle={`We sent a confirmation link to ${sentTo}. Open it to finish creating your account.`}
      footer={<Link className="text-link" href="/signin">Back to sign in</Link>}>
      <ResendButton email={sentTo} />
    </AuthCard>;
  }

  return <AuthCard title="Create your account" subtitle="Your boards are saved to your account."
    footer={<>Already have an account? <Link className="text-link" href="/signin">Sign in</Link></>}>
    <form className="auth-form" onSubmit={submit}>
      <Field label="Email" type="email" name="email" autoComplete="email" required placeholder="you@example.com"
        value={email} onChange={(event) => setEmail(event.target.value)} />
      <UsernameField value={username} onChange={setUsername} onStatus={setUsernameStatus} />
      <Field label="Password" type="password" autoComplete="new-password" required
        value={password} onChange={(event) => setPassword(event.target.value)}
        message={password && passwordError === "too_short" ? { text: PASSWORD_MESSAGES.too_short, tone: "danger" } : { text: "At least 8 characters.", tone: "muted" }} />
      <Field label="Confirm password" type="password" autoComplete="new-password" required
        value={confirm} onChange={(event) => setConfirm(event.target.value)}
        message={confirm && passwordError === "mismatch" ? { text: PASSWORD_MESSAGES.mismatch, tone: "danger" } : null} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary block" type="submit" disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
    </form>
  </AuthCard>;
}

function ResendButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function resend() {
    setState("sending");
    const result = await resendConfirmation(email);
    setState(result.ok ? "sent" : "failed");
  }

  return <div className="auth-form">
    <button className="button block" type="button" onClick={resend} disabled={state === "sending" || state === "sent"}>
      {state === "sending" ? "Sending…" : state === "sent" ? "Email sent again" : "Resend email"}
    </button>
    {state === "failed" && <p className="form-error" role="alert">Couldn&apos;t resend. Wait a minute and try again.</p>}
  </div>;
}
