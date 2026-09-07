import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Oven Mitt - scoped wallets for AI agents on Cookie Chain",
  description:
    "Give an AI agent a capped, expiring, revocable wallet on Cookie Chain. Every action it takes writes an on-chain receipt in the same transaction as the spend.",
  openGraph: {
    title: "Oven Mitt",
    description: "Capped, expiring, revocable wallets for AI agents on Cookie Chain.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
