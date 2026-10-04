"use client";

import { useEffect, useState } from "react";
import Field, { type FieldMessage } from "@/components/auth/Field";
import { checkUsername } from "@/lib/auth/api";
import { USERNAME_MESSAGES } from "@/lib/auth/messages";
import { normalizeUsername, validateUsername } from "@/lib/auth/username";

export type UsernameStatus = "empty" | "invalid" | "checking" | "available" | "taken" | "unknown";

type Checked = { name: string; status: "available" | "taken" | "unknown" };

const CHECK_DELAY_MS = 400;

export default function UsernameField({ value, onChange, onStatus }: {
  value: string;
  onChange: (value: string) => void;
  onStatus: (status: UsernameStatus) => void;
}) {
  const name = normalizeUsername(value);
  const formatError = name ? validateUsername(name) : null;
  const [checked, setChecked] = useState<Checked | null>(null);

  useEffect(() => {
    if (!name || formatError) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const available = await checkUsername(name);
      if (!stale) setChecked({ name, status: available === null ? "unknown" : available ? "available" : "taken" });
    }, CHECK_DELAY_MS);
    return () => { stale = true; clearTimeout(timer); };
  }, [name, formatError]);

  // A result only counts for the exact name it was checked for, so a slow reply never labels newer input.
  const status: UsernameStatus = !name ? "empty" : formatError ? "invalid" : checked?.name === name ? checked.status : "checking";

  useEffect(() => { onStatus(status); }, [status, onStatus]);

  const message: FieldMessage =
    formatError ? { text: USERNAME_MESSAGES[formatError], tone: "danger" }
    : status === "checking" ? { text: "Checking…", tone: "muted" }
    : status === "available" ? { text: `@${name} is available`, tone: "success" }
    : status === "taken" ? { text: "That username is taken.", tone: "danger" }
    : status === "unknown" ? { text: "Couldn't check availability. You can still continue.", tone: "muted" }
    : { text: "3–20 characters: lowercase letters, numbers, underscores.", tone: "muted" };

  return <Field label="Username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required
    placeholder="yourname" value={value} onChange={(event) => onChange(event.target.value.toLowerCase())} message={message} />;
}
