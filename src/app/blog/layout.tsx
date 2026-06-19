import type { Metadata } from "next";
export const metadata: Metadata = {
  title: { default: "Vualet Blog", template: "%s — Vualet Blog" },
  description: "AI, VPN, privacy, and the business of autonomous intelligence. Published by Vualet.",
};
export default function BlogLayout({ children }: { children: React.ReactNode }) { return children; }
