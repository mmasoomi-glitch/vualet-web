/**
 * Centralised secret resolution for the session and magic-link token systems.
 *
 * This keeps the two token systems from drifting apart on which env var to
 * read, when to read it, or which development fallback to use. The fallback is
 * deliberately shared so a dev-minted session and a dev-minted magic link can
 * verify against each other.
 *
 * Read at CALL TIME, never captured at import: the value must reflect the
 * environment as it is when a token is minted or verified.
 */
export function sessionSecret(artefact: string): string {
  const secret =
    process.env.MIRA_SESSION_SECRET || process.env.MIRA_TOKEN_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `MIRA_SESSION_SECRET/MIRA_TOKEN_SECRET unset in production — refusing to mint forgeable ${artefact}.`
    );
  }

  return "mira-dev-session-secret-not-for-production";
}
