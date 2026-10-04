"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import Field from "@/components/auth/Field";
import { sendPasswordReset } from "@/lib/auth/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const result = await sendPasswordReset(email);
    setPending(false);
    if (result.ok) setSentTo(email.trim());
    else setError(result.message);
  }

  if (sentTo) {
    return <AuthCard title="Check your inbox" subtitle={`If an account uses ${sentTo}, we sent it a link to reset the password.`}
      footer={<Link className="text-link" href="/signin">Back to sign in</Link>} />;
  }

  return <AuthCard title="Reset your password" subtitle="Enter your account email and we'll send you a reset link."
    footer={<>Remembered it? <Link className="text-link" href="/signin">Sign in</Link></>}>
    <form className="auth-form" onSubmit={submit}>
      <Field label="Email" type="email" name="email" autoComplete="email" required placeholder="you@example.com"
        value={email} onChange={(event) => setEmail(event.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary block" type="submit" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  </AuthCard>;
}
