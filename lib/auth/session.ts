// `undefined` means the profile could not be loaded, so the UI must not assume "no username".
export type Profile = { username: string | null | undefined };

export function profileFrom(result: { data: { username: string | null } | null; error: unknown }): Profile {
  if (result.error) return { username: undefined };
  return { username: result.data?.username ?? null };
}

// Each call to the returned function starts a load and gets back an `isLatest` check;
// only the most recently started load may apply its result.
export function latestOnly() {
  let latest = 0;
  return () => {
    const mine = ++latest;
    return () => mine === latest;
  };
}
