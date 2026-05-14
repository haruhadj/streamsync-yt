import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StreamSync YT",
  description: "Real-time YouTube queue for streamers",
};

import { Providers } from "@/components/Providers";
import Navbar from "@/components/Navbar";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-[#0f1115] text-white min-h-screen selection:bg-orange-500/30">
        <Providers>
          <Navbar />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
