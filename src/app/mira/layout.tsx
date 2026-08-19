import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./mira-theme.css";
import MiraNav from "./_components/MiraNav";
import MiraBot from "./_components/MiraBot";

const fraunces = Fraunces({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-mira-display", display: "swap" });
const interMira = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mira-ui", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://mira.vualet.com"),
  title: {
    default: "Mira — your assistant, by reflection",
    template: "%s · Mira",
  },
  description: "Your own AI assistant, in the chat you already use. No app to install. Mira talks, remembers you, and gets things done — on Telegram today, with WhatsApp coming soon.",
  openGraph: {
    title: "Mira — your assistant, by reflection",
    description: "Your own AI assistant, in the chat you already use. Mira talks, remembers you, and never makes anything up.",
    url: "https://mira.vualet.com",
    siteName: "Mira",
    type: "website",
    images: [{ url: "/mira/mira-logo-color-512.png", width: 512, height: 512, alt: "Mira" }],
  },
  twitter: {
    card: "summary",
    title: "Mira — your assistant, by reflection",
    description: "Your own AI assistant, in the chat you already use. Mira talks, remembers you, and never makes anything up.",
    images: ["/mira/mira-logo-color-512.png"],
  },
  icons: {
    icon: [
      { url: "/mira/mira-logo-color.svg", type: "image/svg+xml" },
      { url: "/mira/mira-logo-color-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/mira/mira-logo-color-512.png",
  },
};

export default function MiraLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mira-root ${fraunces.variable} ${interMira.variable}`}>
      <a href="#mira-main" className="mira-skip">Skip to content</a>
      <MiraNav />
      {children}
      <MiraBot />
    </div>
  );
}
