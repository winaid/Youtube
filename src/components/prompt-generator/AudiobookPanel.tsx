"use client";

import { useState, useCallback, useRef } from "react";
import { useAudiobookPipeline, type AudiobookSceneInput, type AudiobookConfig, type AudiobookVoice } from "@/hooks/useAudiobookPipeline";
import { STYLE_CATALOG } from "@/data/style-catalog";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const VOICES: { id: AudiobookVoice; label: string; desc: string }[] = [
  { id: "Enceladus", label: "Enceladus", desc: "깊고 낮은 저음 — 명상/수면" },
  { id: "Charon", label: "Charon", desc: "진지하고 무게감 있는 톤" },
  { id: "Kore", label: "Kore", desc: "차분하고 부드러운 여성 음성" },
  { id: "Fenrir", label: "Fenrir", desc: "힘 있는 남성 음성" },
  { id: "Aoede", label: "Aoede", desc: "따뜻하고 서정적인 톤" },
  { id: "Puck", label: "Puck", desc: "밝고 경쾌한 톤" },
  { id: "Zephyr", label: "Zephyr", desc: "편안하고 자연스러운" },
];

// 오디오북에 적합한 스타일 추천 (기존 카탈로그에서 골라냄)
const RECOMMENDED_STYLES = [
  "ink-wash",
  "pencil-sketch",
  "watercolor-anime",
  "vintage-film",
  "oil-impasto",
  "charcoal-noir",
  "cinematic-realism",
  "storybook-gouache",
];

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function getAllStyles() {
  const allStyles = STYLE_CATALOG.flatMap((cat) =>
    cat.styles.map((s) => ({ ...s, categoryName: cat.nameKo, categoryColor: cat.color }))
  );
  // 추천 스타일을 먼저 보여줌
  const recommended = allStyles.filter((s) => RECOMMENDED_STYLES.includes(s.id));
  const rest = allStyles.filter((s) => !RECOMMENDED_STYLES.includes(s.id));
  return { recommended, rest };
}

function parseScenesFromText(text: string): AudiobookSceneInput[] {
  // 각 줄을 하나의 씬으로 처리 (빈 줄 무시)
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      narration: line,
      imagePrompt: "", // 자동 생성 또는 사용자 입력
    }));
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function AudiobookPanel() {
  const { state, generate, reset, abort } = useAudiobookPipeline();

  // ── Form state ──
  const [title, setTitle] = useState("오디오북 영상");
  const [scenesText, setScenesText] = useState("");
  const [scenes, setScenes] = useState<AudiobookSceneInput[]>([]);
  const [voice, setVoice] = useState<AudiobookVoice>("Enceladus");
  const [speed, setSpeed] = useState<"slow" | "natural" | "fast">("slow");
  const [imageStyle, setImageStyle] = useState("ink-wash");
  const [resolution, setResolution] = useState<"landscape" | "portrait">("landscape");
  const [fadeDuration, setFadeDuration] = useState(0.5);
  const [bgmFile, setBgmFile] = useState<File | null>(null);
  const [bgmVolume, setBgmVolume] = useState(0.15);
  const [editMode, setEditMode] = useState<"bulk" | "individual">("bulk");

  const bgmInputRef = useRef<HTMLInputElement>(null);

  const { recommended, rest } = getAllStyles();

  // ── Bulk text → scenes 파싱 ──
  const handleParseScenes = useCallback(() => {
    const parsed = parseScenesFromText(scenesText);
    setScenes(parsed);
    if (parsed.length > 0) setEditMode("individual");
  }, [scenesText]);

  // ── 개별 씬 수정 ──
  const updateScene = useCallback((index: number, field: keyof AudiobookSceneInput, value: string) => {
    setScenes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const removeScene = useCallback((index: number) => {
    setScenes((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addScene = useCallback(() => {
    setScenes((prev) => [...prev, { narration: "", imagePrompt: "" }]);
  }, []);

  // ── 생성 실행 ──
  const handleGenerate = useCallback(async () => {
    // 이미지 프롬프트가 비어 있으면 나레이션에서 자동 생성
    const finalScenes = scenes.map((s) => ({
      ...s,
      imagePrompt: s.imagePrompt.trim() || `Artistic illustration for: ${s.narration.slice(0, 100)}. Contemplative, philosophical mood.`,
    }));

    const config: AudiobookConfig = {
      title,
      voice,
      speed,
      imageStyle,
      resolution,
      fadeDuration,
      bgmFile: bgmFile || undefined,
      bgmVolume,
    };

    await generate(finalScenes, config);
  }, [scenes, title, voice, speed, imageStyle, resolution, fadeDuration, bgmFile, bgmVolume, generate]);

  const isRunning = state.phase !== "idle" && state.phase !== "done" && state.phase !== "error";

  return (
    <div className="space-y-6">
      {/* ── 설정 영역 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
        {/* 좌측: 설정 패널 */}
        <div className="space-y-4">
          {/* 프로젝트 제목 */}
          <div className="rounded-xl border bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">프로젝트 설정</h3>
            <div>
              <label className="text-xs text-gray-500 block mb-1">제목</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400 outline-none"
                placeholder="오디오북 영상 제목"
              />
            </div>

            {/* 보이스 선택 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">나레이션 보이스</label>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value as AudiobookVoice)}
                className="w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-purple-300 outline-none"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} — {v.desc}
                  </option>
                ))}
              </select>
            </div>

            {/* 속도 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">나레이션 속도</label>
              <div className="flex gap-2">
                {(["slow", "natural", "fast"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={
                      speed === s
                        ? { background: "#787fff", color: "white" }
                        : { background: "#f3f4f6", color: "#6b7280" }
                    }
                  >
                    {s === "slow" ? "느리게" : s === "natural" ? "보통" : "빠르게"}
                  </button>
                ))}
              </div>
            </div>

            {/* 해상도 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">해상도</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setResolution("landscape")}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={
                    resolution === "landscape"
                      ? { background: "#787fff", color: "white" }
                      : { background: "#f3f4f6", color: "#6b7280" }
                  }
                >
                  가로 (16:9)
                </button>
                <button
                  onClick={() => setResolution("portrait")}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={
                    resolution === "portrait"
                      ? { background: "#787fff", color: "white" }
                      : { background: "#f3f4f6", color: "#6b7280" }
                  }
                >
                  세로 (9:16)
                </button>
              </div>
            </div>

            {/* 페이드 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                씬 전환 페이드: {fadeDuration}초
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={fadeDuration}
                onChange={(e) => setFadeDuration(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          {/* 이미지 스타일 */}
          <div className="rounded-xl border bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">이미지 스타일</h3>
            <div className="space-y-2">
              <p className="text-xs text-gray-400">추천 스타일</p>
              <div className="grid grid-cols-2 gap-1.5">
                {recommended.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setImageStyle(s.id)}
                    className="px-2 py-1.5 rounded-lg text-xs text-left transition-all truncate"
                    style={
                      imageStyle === s.id
                        ? { background: "#787fff", color: "white" }
                        : { background: "#f9fafb", color: "#374151", border: "1px solid #e5e7eb" }
                    }
                    title={s.descKo}
                  >
                    {s.nameKo}
                  </button>
                ))}
              </div>
              <details className="text-xs">
                <summary className="text-gray-400 cursor-pointer hover:text-gray-600">
                  전체 스타일 ({rest.length}개 더 보기)
                </summary>
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  {rest.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setImageStyle(s.id)}
                      className="px-2 py-1.5 rounded-lg text-xs text-left transition-all truncate"
                      style={
                        imageStyle === s.id
                          ? { background: "#787fff", color: "white" }
                          : { background: "#f9fafb", color: "#374151", border: "1px solid #e5e7eb" }
                      }
                      title={s.descKo}
                    >
                      {s.nameKo}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          </div>

          {/* BGM */}
          <div className="rounded-xl border bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">배경음악 (BGM)</h3>
            <input
              ref={bgmInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => setBgmFile(e.target.files?.[0] || null)}
            />
            <button
              onClick={() => bgmInputRef.current?.click()}
              className="w-full px-3 py-2 rounded-lg border-2 border-dashed text-sm text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-all"
            >
              {bgmFile ? bgmFile.name : "BGM 파일 업로드 (MP3, WAV)"}
            </button>
            {bgmFile && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-500">볼륨: {Math.round(bgmVolume * 100)}%</label>
                  <button
                    onClick={() => { setBgmFile(null); if (bgmInputRef.current) bgmInputRef.current.value = ""; }}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    제거
                  </button>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.01"
                  value={bgmVolume}
                  onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            )}
          </div>
        </div>

        {/* 우측: 씬 편집 */}
        <div className="space-y-4">
          {/* 씬 입력 모드 */}
          <div className="rounded-xl border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">씬 구성</h3>
              <div className="flex gap-1">
                <button
                  onClick={() => setEditMode("bulk")}
                  className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
                  style={
                    editMode === "bulk"
                      ? { background: "#787fff20", color: "#787fff" }
                      : { color: "#9ca3af" }
                  }
                >
                  일괄 입력
                </button>
                <button
                  onClick={() => setEditMode("individual")}
                  className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
                  style={
                    editMode === "individual"
                      ? { background: "#787fff20", color: "#787fff" }
                      : { color: "#9ca3af" }
                  }
                >
                  개별 편집
                </button>
              </div>
            </div>

            {editMode === "bulk" ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  한 줄에 하나의 씬(나레이션 텍스트)을 입력하세요.
                </p>
                <textarea
                  value={scenesText}
                  onChange={(e) => setScenesText(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-mono focus:ring-2 focus:ring-purple-300 outline-none resize-y"
                  placeholder={`인생은 고통의 바다를 항해하는 것이다.\n행복이란 고통이 잠시 멈추는 순간에 불과하다.\n의지는 끝없이 욕망하고, 욕망은 끝없이 고통을 낳는다.`}
                />
                <button
                  onClick={handleParseScenes}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all"
                  style={{ background: "#787fff" }}
                >
                  {scenes.length > 0 ? `${parseScenesFromText(scenesText).length}개 씬으로 업데이트` : "씬으로 분할"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {scenes.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    일괄 입력에서 텍스트를 먼저 분할하거나, 아래 버튼으로 씬을 추가하세요.
                  </div>
                ) : (
                  scenes.map((scene, i) => (
                    <div key={i} className="rounded-lg border bg-gray-50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500">씬 {i + 1}</span>
                        <button
                          onClick={() => removeScene(i)}
                          className="text-xs text-red-400 hover:text-red-600"
                        >
                          삭제
                        </button>
                      </div>
                      <textarea
                        value={scene.narration}
                        onChange={(e) => updateScene(i, "narration", e.target.value)}
                        rows={2}
                        className="w-full px-2 py-1.5 rounded border text-sm focus:ring-1 focus:ring-purple-300 outline-none resize-y"
                        placeholder="나레이션 텍스트"
                      />
                      <input
                        type="text"
                        value={scene.imagePrompt}
                        onChange={(e) => updateScene(i, "imagePrompt", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border text-xs focus:ring-1 focus:ring-purple-300 outline-none"
                        placeholder="이미지 프롬프트 (비워두면 자동 생성)"
                      />
                      {/* 씬 상태 표시 */}
                      {state.sceneStatuses[i] && (
                        <div className="flex gap-2 text-xs">
                          <span className={state.sceneStatuses[i].imageReady ? "text-green-500" : "text-gray-300"}>
                            {state.sceneStatuses[i].imageReady ? "이미지 완료" : "이미지 대기"}
                          </span>
                          <span className={state.sceneStatuses[i].ttsReady ? "text-green-500" : "text-gray-300"}>
                            {state.sceneStatuses[i].ttsReady ? "TTS 완료" : "TTS 대기"}
                          </span>
                          {state.sceneStatuses[i].error && (
                            <span className="text-red-500">{state.sceneStatuses[i].error}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <button
                  onClick={addScene}
                  className="w-full px-3 py-2 rounded-lg border-2 border-dashed text-sm text-gray-400 hover:text-purple-500 hover:border-purple-300 transition-all"
                >
                  + 씬 추가
                </button>
              </div>
            )}
          </div>

          {/* 미리보기: 생성된 이미지 */}
          {state.sceneStatuses.some((s) => s.imageReady) && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">생성된 이미지 미리보기</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {state.sceneStatuses.map((s) =>
                  s.imageReady && s.imageBase64 ? (
                    <div key={s.index} className="relative rounded-lg overflow-hidden border">
                      <img
                        src={`data:${s.imageMimeType || "image/png"};base64,${s.imageBase64}`}
                        alt={`씬 ${s.index}`}
                        className="w-full aspect-video object-cover"
                      />
                      <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                        씬 {s.index}
                      </span>
                    </div>
                  ) : null
                )}
              </div>
            </div>
          )}

          {/* 진행 상태 */}
          {isRunning && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">진행 상태</h3>
                <button
                  onClick={abort}
                  className="text-xs text-red-400 hover:text-red-600 font-medium"
                >
                  중단
                </button>
              </div>
              <div className="space-y-2">
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${state.overallPercent}%`,
                      background: "linear-gradient(90deg, #787fff, #a8abff)",
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500">{state.message}</p>
              </div>
            </div>
          )}

          {/* 에러 표시 */}
          {state.phase === "error" && state.error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-600">{state.error}</p>
              <button
                onClick={reset}
                className="mt-2 text-xs text-red-500 underline hover:text-red-700"
              >
                다시 시도
              </button>
            </div>
          )}

          {/* 완료 결과 */}
          {state.phase === "done" && state.result && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-green-700">
                영상 생성 완료!
              </h3>
              <p className="text-xs text-green-600">{state.message}</p>
              <div className="flex gap-2">
                <a
                  href={state.result.blobUrl}
                  download={`${title || "audiobook"}_audiobook.mp4`}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all"
                  style={{ background: "#22c55e" }}
                >
                  다시 다운로드
                </a>
                <button
                  onClick={reset}
                  className="px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:bg-gray-50"
                >
                  새로 만들기
                </button>
              </div>
              <video
                src={state.result.blobUrl}
                controls
                className="w-full max-w-2xl rounded-lg border"
              />
            </div>
          )}

          {/* 생성 버튼 */}
          {!isRunning && state.phase !== "done" && (
            <button
              onClick={handleGenerate}
              disabled={scenes.length === 0 || scenes.every((s) => !s.narration.trim())}
              className="w-full px-6 py-3 rounded-xl text-base font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: scenes.length > 0
                  ? "linear-gradient(135deg, #787fff, #a855f7)"
                  : "#d1d5db",
                boxShadow: scenes.length > 0 ? "0 4px 14px rgba(120, 127, 255, 0.4)" : "none",
              }}
            >
              {scenes.length > 0
                ? `${scenes.length}개 씬 오디오북 영상 생성`
                : "씬을 먼저 추가하세요"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
