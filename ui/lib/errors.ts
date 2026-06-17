// Turn raw backend/IPC error strings (pg driver, config validation, back-office
// API, etc.) into friendly, actionable messages. Unknown errors fall back to the
// original text so nothing is ever swallowed.
export function humanizeError(raw: string | null | undefined): string {
  const e = (raw ?? "").trim();
  const low = e.toLowerCase();
  if (!e) return "Something went wrong. Please try again.";

  // Profile not configured yet (parseConfig: "Missing required env vars: …")
  if (low.includes("missing required env"))
    return "This profile isn’t fully configured yet. Fill in the required Database and Stripe fields below, then Save and try again.";

  // Database connectivity (node-postgres)
  if (low.includes("enotfound") || low.includes("eai_again"))
    return "Couldn’t reach the database host. Check PGHOST (and your network/VPN), then try again.";
  if (low.includes("econnrefused"))
    return "The database refused the connection. Check PGHOST and PGPORT, then try again.";
  if (low.includes("etimedout") || low.includes("timeout"))
    return "The database didn’t respond in time. Check the host/port and your network, then try again.";
  if (low.includes("password authentication failed") || low.includes("no password supplied"))
    return "The database rejected your credentials. Check PGUSER and PGPASSWORD, then try again.";
  if (low.includes("database") && low.includes("does not exist"))
    return "That database doesn’t exist on the server. Check PGDATABASE, then try again.";
  if (low.includes("relation") && low.includes("does not exist"))
    return "A required table wasn’t found — the schema may be wrong. Check PGSCHEMA, then try again.";
  if (low.includes("self-signed") || low.includes("unable_to_verify") || low.includes("certificate"))
    return "Couldn’t verify the database’s SSL certificate. Try setting PGSSLMODE to “require”.";

  // Back-office API auth
  if (low.includes("401") || low.includes("unauthorized") || low.includes("authenticate"))
    return "Back-office sign-in failed. Check BO_BASE_URL, BO_EMAIL and BO_PASSWORD, then try again.";
  if (low.includes("403") || low.includes("forbidden"))
    return "The back-office account isn’t allowed to do that. Check its permissions and credentials.";

  // Lookups
  if (low.includes("no account") || (low.includes("account") && low.includes("not found")))
    return "No account found for that email. Double-check the address and try again.";
  if (low.includes("chrome") && (low.includes("not found") || low.includes("executable")))
    return "Google Chrome wasn’t found. Install Chrome and try again.";

  // Fallback: show the original message, just without a noisy "Error:" prefix.
  return e.replace(/^Error:\s*/i, "");
}
