import type { Metadata } from "next";
import { Manrope, Space_Mono } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-sans" });
const mono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "IfyLoop — Live looper",
  description: "A focused, browser-based live looping instrument."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
