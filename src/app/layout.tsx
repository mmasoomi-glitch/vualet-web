import type { Metadata } from "next";
import { Inter, IBM_Plex_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { SiteChrome } from "@/components/site-chrome";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Mira brand display face — loaded site-wide so landing/signup match the Mira pages.
const fraunces = Fraunces({
  variable: "--font-mira-display",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Vualet — Software that runs your business for you.",
    template: "%s · Vualet",
  },
  description:
    "Vualet builds the operating software for modern businesses: WhatsApp AI agents, CRM automation, HR and people tools. One login. One bill.",
  metadataBase: new URL("https://vualet.com"),
  openGraph: {
    title: "Vualet — Software that runs your business for you.",
    description:
      "WhatsApp AI agents, CRM automation, HR and people tools — under one roof.",
    url: "https://vualet.com",
    siteName: "Vualet",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vualet — Software that runs your business for you.",
    description:
      "WhatsApp AI agents, CRM automation, HR and people tools — under one roof.",
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plexSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
