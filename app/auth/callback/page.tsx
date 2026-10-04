"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AuthCard from "@/components/auth/AuthCard";
import { finishEmailLink } from "@/lib/auth/api";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    finishEmailLink().then((result) => {
      if (result.ok) router.replace("/");
      else setFailure(result.message);
    });
  }, [router]);

  if (failure) {
    return <AuthCard title="Link expired" subtitle={failure}
      footer={<Link className="text-link" href="/signin">Go to sign in</Link>} />;
  }
  return <AuthCard title="Signing you in…" />;
}
