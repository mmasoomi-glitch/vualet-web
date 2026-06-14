import type { Metadata } from "next";
import { AdminGate } from "@/components/admin/admin-gate";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false }, // internal tool — never index
};

// The public site's <Nav>/<Footer> live in the ROOT layout and would normally
// wrap this too. We intentionally do NOT re-add them here; the admin gets its
// own chrome (sidebar) via <AdminGate>. The root <main> still wraps us, which
// is fine.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
