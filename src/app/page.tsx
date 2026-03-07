import PromptGenerator from "@/components/prompt-generator/PromptGenerator";

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
          <h1 className="text-xl font-bold tracking-tight">
            AI 영상 프롬프트 생성기
          </h1>
          <p className="text-sm text-muted-foreground">
            감독 페르소나 기반 컷 리스트 &amp; 프롬프트 자동 생성
          </p>
        </div>
      </header>
      <PromptGenerator />
    </main>
  );
}
