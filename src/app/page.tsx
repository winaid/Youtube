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
        <div className="relative max-w-7xl mx-auto px-4 md:px-6 py-6">
          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-sm">
            AI 영상 프롬프트 생성기
          </h1>
          <p className="text-sm text-white/80 mt-1">
            감독 페르소나 기반 장면 리스트 &amp; 프롬프트 자동 생성
          </p>
        </div>
      </header>
      <PromptGenerator />
    </main>
  );
}
