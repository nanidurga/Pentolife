"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  useEffect(() => {
    async function finish() {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) await getSupabase()?.auth.exchangeCodeForSession(code);
      router.replace("/dashboard");
    }
    finish();
  }, [router]);
  return <main className="auth-page"><p>Finishing sign-in…</p></main>;
}
