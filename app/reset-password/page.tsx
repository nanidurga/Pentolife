"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import Field from "@/components/auth/Field";
import { finishEmailLink, updatePassword } from "@/lib/auth/api";
import { PASSWORD_MESSAGES } from "@/lib/auth/messages";
import { validatePassword } from "@/lib/auth/password";

type LinkState = { state: "checking" } | { state: "ready" } | { state: "failed"; message: string };

export default function ResetPasswordPage() {
  const router = useRouter();
  const [link, setLink] = useState<LinkState>({ state: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    finishEmailLink().then((result) => setLink(result.ok ? { state: "ready" } : { state: "failed", message: result.message }));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = validatePassword(password, confirm);
    if (problem) return setError(PASSWORD_MESSAGES[problem]);
    setPending(true);
    setError("");
    const result = await updatePassword(password);
    if (result.ok) return router.replace("/");
    setPending(false);
    setError(result.message);
  }

  if (link.state === "checking") return <AuthCard title="Reset your password" subtitle="Checking your link…" />;
  if (link.state === "failed") {
    return <AuthCard title="Link expired" subtitle={link.message}
      footer={<Link className="text-link" href="/forgot-password">Send a new link</Link>} />;
  }

  return <AuthCard title="Choose a new password">
    <form className="auth-form" onSubmit={submit}>
      <Field label="New password" type="password" autoComplete="new-password" required
        value={password} onChange={(event) => setPassword(event.target.value)} message={{ text: "At least 8 characters.", tone: "muted" }} />
      <Field label="Confirm new password" type="password" autoComplete="new-password" required
        value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary block" type="submit" disabled={pending}>{pending ? "Saving…" : "Update password"}</button>
    </form>
  </AuthCard>;
}
