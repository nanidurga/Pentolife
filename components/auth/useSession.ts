"use client";

import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: User; profile: { username: string | null } };

// Anonymous users (people who only opened a shared room link) count as signed out.
export function useSession(): SessionState & { reload: () => void } {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setState({ status: "signed-out" });
      return;
    }
    let cancelled = false;
    async function load(user: User | null) {
      if (!user || user.is_anonymous) {
        if (!cancelled) setState({ status: "signed-out" });
        return;
      }
      const { data } = await supabase!.from("profiles").select("username").eq("id", user.id).maybeSingle();
      if (!cancelled) setState({ status: "signed-in", user, profile: { username: data?.username ?? null } });
    }
    // Supabase must not be called from inside the auth callback itself (it can deadlock), so defer.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => void load(session?.user ?? null), 0);
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [version]);

  return { ...state, reload: () => setVersion((value) => value + 1) };
}

export function useRedirectWhenSignedIn() {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session.status === "signed-in") router.replace("/");
  }, [session.status, router]);
}
