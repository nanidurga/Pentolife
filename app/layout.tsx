import type { Metadata } from "next";
import { JetBrains_Mono, Kalam, Nunito } from "next/font/google";
import "./globals.css";

// Kalam is not a variable font, so its weights are listed.
const display = Kalam({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-display" });
const sans = Nunito({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PentoLive",
  description: "A live whiteboard for technical interviews",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}><body>{children}</body></html>;
}
