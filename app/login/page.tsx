"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return setMessage("Supabase is not configured yet.");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setMessage(error ? error.message : "Check your email for a secure sign-in link.");
  }

  return <main className="auth-page"><section className="auth-card">
    <Link href="/" className="brand-link">← PentoLive</Link>
    <h1>Your boards, kept private.</h1>
    <p>Sign in with a magic link. No password to remember.</p>
    <form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
      <button className="primary" type="submit">Send sign-in link</button></form>
    {message && <p className="hint">{message}</p>}
  </section></main>;
}
