"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import Field from "@/components/auth/Field";
import { useRedirectWhenSignedIn } from "@/components/auth/useSession";
import { signIn } from "@/lib/auth/api";

export default function SignInPage() {
  useRedirectWhenSignedIn();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const result = await signIn(identifier, password);
    if (result.ok) return router.replace("/");
    setPending(false);
    setError(result.message);
  }

  return <AuthCard title="Sign in" subtitle="Welcome back."
    footer={<>New to PentoLive? <Link className="text-link" href="/signup">Create an account</Link></>}>
    <form className="auth-form" onSubmit={submit}>
      <Field label="Email or username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required
        value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
      <Field label="Password" type="password" name="password" autoComplete="current-password" required
        value={password} onChange={(event) => setPassword(event.target.value)}
        aside={<Link className="text-link small" href="/forgot-password">Forgot password?</Link>} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary block" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  </AuthCard>;
}
