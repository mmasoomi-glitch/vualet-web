import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "../mira/mira-theme.css";

const fraunces = Fraunces({
  subsets: ["latin"], weight: ["300", "400", "500"],
  variable: "--font-mira-display", display: "swap",
});
const inter = Inter({
  subsets: ["latin"], weight: ["400", "500", "600"],
  variable: "--font-mira-ui", display: "swap",
});

export const metadata: Metadata = {
  title: "Mira VPN — private, smart connection by Vualet",
  description: "Smart VPN that picks the fastest server for you. Free forever; paid when you want full speed. Pay with crypto or card.",
  metadataBase: new URL("https://vpn.mira.vualet.com"),
  icons: {
    icon: [
      { url: "/mira/mira-logo-color.svg", type: "image/svg+xml" },
      { url: "/mira/mira-logo-color-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/mira/mira-logo-color-512.png",
  },
  openGraph: {
    title: "Mira VPN — private, smart connection",
    description: "Free forever VPN. Smart server selection. No logs. Crypto or card payment.",
    url: "https://vpn.mira.vualet.com",
    siteName: "Mira VPN by Vualet",
    locale: "en_US",
    type: "website",
  },
};

export default function VpnLayout({ children }: { children: React.ReactNode }) {
  return <div className={`mira-root ${fraunces.variable} ${inter.variable}`}>{children}</div>;
}
