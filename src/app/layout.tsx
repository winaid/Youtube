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
  title: "CineForge — Kling O3 Cinematic Production",
  description:
    "Kling O3 기반 세그먼트 시네마틱 프로덕션 시스템 — 장문 스크립트를 3-15초 생성 단위로 분할, 최대 5분 영상 조립",
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
