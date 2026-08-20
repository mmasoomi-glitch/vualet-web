"use client";

// Admin shell. Access control is enforced SERVER-SIDE in src/middleware.ts:
// every /admin request must carry the signed httpOnly `mira_admin` cookie
// (minted by /api/admin/login) or it is redirected to /admin-login before any
// admin HTML renders. This component only lays out the chrome.

import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";

export function AdminGate({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Sidebar />
      <div className="md:pl-60">
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
