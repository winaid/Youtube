"use client";

import dynamic from "next/dynamic";

const AppShell = dynamic(
  () => import("@/components/app-shell/AppShell"),
  { ssr: false }
);

export default function Home() {
  return <AppShell />;
}
