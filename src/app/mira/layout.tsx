import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./mira-theme.css";
import MiraNav from "./_components/MiraNav";

const fraunces = Fraunces({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-mira-display", display: "swap" });
const interMira = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mira-ui", display: "swap" });

export const metadata: Metadata = {
  title: "Mira — your assistant, by reflection",
  description: "Your own AI assistant, in the chat you already use. No app to install. Mira talks, remembers you, and gets things done on Telegram or WhatsApp.",
};

export default function MiraLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mira-root ${fraunces.variable} ${interMira.variable}`}>
      <MiraNav />
      {children}
    </div>
  );
}
