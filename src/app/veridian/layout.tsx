import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "../mira/mira-theme.css";

// Reuse the Mira brand kit — same fonts, same tokens, same .mira-root scope — so
// the Mira demo reads as one brand and invents no new palette.
const fraunces = Fraunces({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-mira-display", display: "swap" });
const interMira = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mira-ui", display: "swap" });

export const metadata: Metadata = {
  title: "Mira — sandboxed demo",
  description:
    "Ask Mira anything it knows about the product. A read-only demo: it answers from a curated knowledge base and cannot take actions — a small illustration of grounded, no-hallucination AI.",
};

export default function VeridianLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mira-root ${fraunces.variable} ${interMira.variable}`} style={{ minHeight: "100vh" }}>
      {children}
    </div>
  );
}
