import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PentoLive",
  description: "Your private live interview whiteboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
