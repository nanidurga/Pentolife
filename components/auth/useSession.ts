"use client";

import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { latestOnly, profileFrom, type Profile } from "@/lib/auth/session";
import { getSupabase } from "@/lib/supabase";

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: User; profile: Profile };

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
    const begin = latestOnly();
    // Auth events can overlap (a token refresh still fetching the profile when the user signs out);
    // only the newest event's result is applied.
    async function load(user: User | null) {
      const isLatest = begin();
      if (!user || user.is_anonymous) {
        if (!cancelled && isLatest()) setState({ status: "signed-out" });
        return;
      }
      const result = await supabase!.from("profiles").select("username").eq("id", user.id).maybeSingle();
      if (!cancelled && isLatest()) setState({ status: "signed-in", user, profile: profileFrom(result) });
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
