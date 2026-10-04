"use client";

import Dashboard from "@/components/Dashboard";
import Landing from "@/components/Landing";
import { useSession } from "@/components/auth/useSession";

export default function Home() {
  const session = useSession();
  if (session.status === "loading") return <main className="blank" aria-busy="true" />;
  if (session.status === "signed-out") return <Landing />;
  return <Dashboard username={session.profile.username} onProfileChange={session.reload} />;
}
