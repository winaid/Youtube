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
  title: "CineForge — Long Script to Cinematic Video",
  description:
    "장문 스크립트를 3-15초 Kling O3 세그먼트로 분할하고, extend 체이닝으로 최대 5분 시네마틱 영상을 조립하는 프로덕션 시스템",
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
