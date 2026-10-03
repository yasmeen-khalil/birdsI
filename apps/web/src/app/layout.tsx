import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const serif = Newsreader({
  subsets: ["latin"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "birdsI", template: "%s | birdsI" },
  description: "The operations layer for coding agents. It maps your code and the services it runs on, with plans, limits and spend, audits it against current docs, and asks you only what it cannot know.",
  metadataBase: new URL(process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: "#f1f2f4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable} h-full`}>
        <body className="min-h-full">{children}</body>
      </html>
    </ClerkProvider>
  );
}
