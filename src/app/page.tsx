"use client";

import dynamic from "next/dynamic";

const PromptGenerator = dynamic(
  () => import("@/components/prompt-generator/PromptGenerator"),
  { ssr: false }
);

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="relative overflow-hidden border-b" style={{ background: "linear-gradient(135deg, #787fff 0%, #a8abff 40%, #fff787 100%)" }}>
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, #fff787 0%, transparent 50%), radial-gradient(circle at 80% 50%, #787fff 0%, transparent 50%)" }} />
        <div className="relative max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white drop-shadow-sm">
            AI 영상 제작 스튜디오
          </h1>
          <p className="text-xs sm:text-sm text-white/80 mt-1 hidden sm:block">
            감독 페르소나로 장면을 연출하고, 컷과 멀티샷을 구조화한 뒤, 직접 수정해서 영상까지 생성하세요.
          </p>
        </div>
      </header>
      <PromptGenerator />
    </main>
  );
}
