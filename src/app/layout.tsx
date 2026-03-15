import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { cn } from "@/lib/utils";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
  weight: "100 900",
  preload: false,
});

export const metadata: Metadata = {
  title: "CineForge — Kling O3 Shortform Production",
  description:
    "Kling O3 기반 숏폼 시네마틱 프로덕션 시스템 — 멀티샷 리텐션 최적화 영상 설계 & 생성",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          geistSans.variable
        )}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
