// ============================================================================
// ADMIN AUTH — PLACEHOLDER ONLY. NOT SECURE.
// ============================================================================
// !!! WARNING !!!
// This is a CLIENT-SIDE placeholder gate so the internal dashboard can be
// previewed. It reads an `admin_session` value from localStorage/cookie and
// does NOT verify anything. Anyone can set the key in their browser.
//
// >>> BEFORE PRODUCTION, REPLACE WITH REAL SERVER-SIDE AUTH <<<
//   - Verify a signed, httpOnly session cookie in Next.js middleware
//     (middleware.ts) and/or a server component before rendering /admin.
//   - Gate on an admin role / allow-list, ideally behind SSO (Google Workspace).
//   - Never trust localStorage for authorization.
// ============================================================================

export const ADMIN_SESSION_KEY = "admin_session";

export function readAdminSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(ADMIN_SESSION_KEY)) return true;
    return document.cookie.split("; ").some((c) => c.startsWith(`${ADMIN_SESSION_KEY}=`));
  } catch {
    return false;
  }
}

export function setAdminSession(): void {
  if (typeof window === "undefined") return;
  // Placeholder token — a real flow would receive a signed token from the server.
  window.localStorage.setItem(ADMIN_SESSION_KEY, `stub-${Date.now()}`);
  document.cookie = `${ADMIN_SESSION_KEY}=stub; path=/admin; SameSite=Lax`;
}

export function clearAdminSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ADMIN_SESSION_KEY);
  document.cookie = `${ADMIN_SESSION_KEY}=; path=/admin; max-age=0`;
}
