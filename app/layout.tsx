import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IfyLoop — Live looper",
  description: "A focused, browser-based live looping instrument."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
