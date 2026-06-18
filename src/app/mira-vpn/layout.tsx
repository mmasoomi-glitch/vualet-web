import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "../mira/mira-theme.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-mira-display",
  display: "swap",
});
const interMira = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mira-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mira VPN — your private connection, by Vualet",
  description:
    "Smart, private internet. Mira picks the fastest server for you, every time. Free forever; paid when you want smooth video.",
  icons: {
    icon: [
      { url: "/mira/mira-logo-color.svg", type: "image/svg+xml" },
      { url: "/mira/mira-logo-color-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/mira/mira-logo-color-512.png",
  },
};

export default function MiraVpnLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mira-root ${fraunces.variable} ${interMira.variable}`}>
      {children}
    </div>
  );
}
