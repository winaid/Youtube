"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAudiobookPipeline, type AudiobookSceneInput, type AudiobookConfig, type AudiobookVoice } from "@/hooks/useAudiobookPipeline";
import { STYLE_CATALOG } from "@/data/style-catalog";
import {
  listAudiobookDrafts, saveAudiobookDraft, deleteAudiobookDraft,
  buildAudiobookDraft, formatRelativeTime,
  type AudiobookDraft,
} from "@/lib/audiobook-draft-store";

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

const RECOMMENDED_STYLES = [
  "ink-wash", "pencil-sketch", "watercolor-anime", "vintage-film",
  "oil-impasto", "charcoal-noir", "cinematic-realism", "storybook-gouache",
];

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function getAllStyles() {
  const allStyles = STYLE_CATALOG.flatMap((cat) =>
    cat.styles.map((s) => ({ ...s, categoryName: cat.nameKo, categoryColor: cat.color }))
  );
  const recommended = allStyles.filter((s) => RECOMMENDED_STYLES.includes(s.id));
  const rest = allStyles.filter((s) => !RECOMMENDED_STYLES.includes(s.id));
  return { recommended, rest };
}

function parseScenesFromText(text: string): AudiobookSceneInput[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
    .map((line) => ({ narration: line, imagePrompt: "" }));
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
  const [kenBurns, setKenBurns] = useState(true);
  const [bgmFile, setBgmFile] = useState<File | null>(null);
  const [bgmVolume, setBgmVolume] = useState(0.15);
  const [editMode, setEditMode] = useState<"bulk" | "individual">("bulk");
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [playingAudioIndex, setPlayingAudioIndex] = useState<number | null>(null);

  // ── Draft state ──
  const [drafts, setDrafts] = useState<AudiobookDraft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

  // ── Font upload for subtitle burn-in ──
  const [subtitleFontFile, setSubtitleFontFile] = useState<File | null>(null);

  // ── Hybrid mode: send image to VEO ──
  const [hybridSceneIndex, setHybridSceneIndex] = useState<number | null>(null);
  const [isCreatingVeoVideo, setIsCreatingVeoVideo] = useState(false);

  const bgmInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { recommended, rest } = getAllStyles();

  // ── Draft: load list on mount ──
  useEffect(() => {
    listAudiobookDrafts().then(setDrafts).catch(() => {});
  }, []);

  // ── Draft: save ──
  const handleSaveDraft = useCallback(async () => {
    const draft = buildAudiobookDraft(
      scenes,
      { voice, speed, imageStyle, resolution, fadeDuration, kenBurns, bgmVolume },
      title,
      activeDraftId || undefined,
    );
    if (activeDraftId) {
      draft.id = activeDraftId;
      draft.createdAt = drafts.find(d => d.id === activeDraftId)?.createdAt || Date.now();
    }
    // 생성된 이미지도 저장 (있으면)
    if (state.sceneStatuses.some(s => s.imageReady)) {
      draft.generatedImages = state.sceneStatuses
        .filter(s => s.imageReady && s.imageBase64)
        .map(s => ({ index: s.index, base64: s.imageBase64!, mimeType: s.imageMimeType || "image/png" }));
    }
    const ok = await saveAudiobookDraft(draft);
    if (ok) {
      setActiveDraftId(draft.id);
      setDrafts(await listAudiobookDrafts());
    }
  }, [scenes, voice, speed, imageStyle, resolution, fadeDuration, kenBurns, bgmVolume, title, activeDraftId, drafts, state.sceneStatuses]);

  // ── Draft: load ──
  const handleLoadDraft = useCallback((draft: AudiobookDraft) => {
    setTitle(draft.title);
    setScenes(draft.scenes);
    setVoice(draft.config.voice);
    setSpeed(draft.config.speed);
    setImageStyle(draft.config.imageStyle);
    setResolution(draft.config.resolution);
    setFadeDuration(draft.config.fadeDuration);
    setKenBurns(draft.config.kenBurns);
    setBgmVolume(draft.config.bgmVolume);
    setActiveDraftId(draft.id);
    setEditMode("individual");
    setShowDrafts(false);
    reset();
  }, [reset]);

  // ── Draft: delete ──
  const handleDeleteDraft = useCallback(async (id: string) => {
    await deleteAudiobookDraft(id);
    setDrafts(await listAudiobookDrafts());
    if (activeDraftId === id) setActiveDraftId(null);
  }, [activeDraftId]);

  // ── Hybrid: send image to VEO for image-to-video ──
  const handleCreateVeoVideo = useCallback(async (sceneIndex: number) => {
    const sceneStatus = state.sceneStatuses[sceneIndex];
    if (!sceneStatus?.imageReady || !sceneStatus.imageBase64) return;

    setIsCreatingVeoVideo(true);
    setHybridSceneIndex(sceneIndex);
    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: scenes[sceneIndex]?.imagePrompt || scenes[sceneIndex]?.narration || "Cinematic scene",
          firstFrameBase64: sceneStatus.imageBase64,
          workflowType: "image-to-video",
          aspectRatio: resolution === "portrait" ? "9:16" : "16:9",
          durationSeconds: 8,
          generateAudio: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        alert(`VEO 영상 생성 실패: ${(err as { error?: string }).error || res.status}`);
      } else {
        const data = await res.json() as { operationName?: string; taskId?: string };
        alert(`VEO 영상 생성 시작! Task: ${data.operationName || data.taskId}\n\n장면 설계 탭에서 진행 상태를 확인하세요.`);
      }
    } catch (err) {
      alert(`VEO 요청 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsCreatingVeoVideo(false);
      setHybridSceneIndex(null);
    }
  }, [state.sceneStatuses, scenes, resolution]);

  // ── Bulk → scenes ──
  const handleParseScenes = useCallback(() => {
    const parsed = parseScenesFromText(scenesText);
    setScenes(parsed);
    if (parsed.length > 0) setEditMode("individual");
  }, [scenesText]);

  // ── Scene editing ──
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

  const moveScene = useCallback((index: number, direction: "up" | "down") => {
    setScenes((prev) => {
      const next = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  // ── AI 이미지 프롬프트 자동 생성 ──
  const handleAutoGeneratePrompts = useCallback(async () => {
    const validScenes = scenes.filter((s) => s.narration.trim());
    if (validScenes.length === 0) return;

    setIsGeneratingPrompts(true);
    try {
      const res = await fetch("/api/generate-image-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenes: validScenes.map((s, i) => ({ index: i + 1, narration: s.narration })),
          themeHint: title,
        }),
      });

      if (!res.ok) throw new Error("AI 프롬프트 생성 실패");

      const data = await res.json() as { prompts: { index: number; imagePrompt: string }[] };
      if (data.prompts?.length) {
        setScenes((prev) => {
          const next = [...prev];
          let validIdx = 0;
          for (let i = 0; i < next.length; i++) {
            if (next[i].narration.trim() && validIdx < data.prompts.length) {
              next[i] = { ...next[i], imagePrompt: data.prompts[validIdx].imagePrompt };
              validIdx++;
            }
          }
          return next;
        });
      }
    } catch (err) {
      console.error("Auto-generate prompts error:", err);
    } finally {
      setIsGeneratingPrompts(false);
    }
  }, [scenes, title]);

  // ── 씬 오디오 미리듣기 ──
  const handlePreviewAudio = useCallback((index: number) => {
    const sceneStatus = state.sceneStatuses[index];
    if (!sceneStatus?.ttsReady || !sceneStatus.audioBase64) return;

    // 이미 재생 중이면 중지
    if (playingAudioIndex === index && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingAudioIndex(null);
      return;
    }

    // 이전 오디오 중지
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const mime = sceneStatus.audioMimeType || "audio/wav";
    const audio = new Audio(`data:${mime};base64,${sceneStatus.audioBase64}`);
    audio.onended = () => {
      setPlayingAudioIndex(null);
      audioRef.current = null;
    };
    audio.play();
    audioRef.current = audio;
    setPlayingAudioIndex(index);
  }, [state.sceneStatuses, playingAudioIndex]);

  // ── 생성 실행 ──
  const handleGenerate = useCallback(async () => {
    const finalScenes = scenes.map((s) => ({
      ...s,
      imagePrompt: s.imagePrompt.trim() || `Artistic illustration for: ${s.narration.slice(0, 100)}. Contemplative, philosophical mood.`,
    }));

    const config: AudiobookConfig = {
      title, voice, speed, imageStyle, resolution, fadeDuration, kenBurns,
      bgmFile: bgmFile || undefined, bgmVolume,
    };

    await generate(finalScenes, config);
  }, [scenes, title, voice, speed, imageStyle, resolution, fadeDuration, kenBurns, bgmFile, bgmVolume, generate]);

  const isRunning = state.phase !== "idle" && state.phase !== "done" && state.phase !== "error";
  const hasValidScenes = scenes.length > 0 && scenes.some((s) => s.narration.trim());

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
        {/* ═══ 좌측: 설정 패널 ═══ */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {/* 드래프트 관리 */}
          <div className="rounded-xl border bg-white p-3 space-y-2">
            <div className="flex items-center justify-between">
              <button onClick={() => setShowDrafts(!showDrafts)}
                className="text-xs font-medium text-gray-500 hover:text-purple-600">
                {showDrafts ? "닫기" : `저장된 프로젝트 (${drafts.length})`}
              </button>
              <button onClick={handleSaveDraft}
                disabled={scenes.length === 0}
                className="px-3 py-1 rounded-lg text-xs font-medium text-white disabled:opacity-40"
                style={{ background: "#787fff" }}>
                {activeDraftId ? "저장" : "새로 저장"}
              </button>
            </div>
            {showDrafts && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {drafts.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2 text-center">저장된 프로젝트 없음</p>
                ) : drafts.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-gray-50"
                    style={activeDraftId === d.id ? { background: "#787fff10", border: "1px solid #787fff40" } : {}}>
                    <button onClick={() => handleLoadDraft(d)} className="flex-1 text-left min-w-0">
                      <span className="text-xs font-medium text-gray-700 block truncate">{d.title}</span>
                      <span className="text-[10px] text-gray-400">{d.sceneCount}개 씬 · {formatRelativeTime(d.updatedAt)}</span>
                    </button>
                    <button onClick={() => handleDeleteDraft(d.id)} className="text-[10px] text-red-400 hover:text-red-600 shrink-0">삭제</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 프로젝트 설정 */}
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

            {/* 보이스 */}
            <div>
              <label className="text-xs text-gray-500 block mb-1">나레이션 보이스</label>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value as AudiobookVoice)}
                className="w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-purple-300 outline-none"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label} — {v.desc}</option>
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
                    style={speed === s ? { background: "#787fff", color: "white" } : { background: "#f3f4f6", color: "#6b7280" }}
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
                {(["landscape", "portrait"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setResolution(r)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={resolution === r ? { background: "#787fff", color: "white" } : { background: "#f3f4f6", color: "#6b7280" }}
                  >
                    {r === "landscape" ? "가로 (16:9)" : "세로 (9:16)"}
                  </button>
                ))}
              </div>
            </div>

            {/* 효과 */}
            <div className="space-y-2">
              <label className="text-xs text-gray-500 block">영상 효과</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={kenBurns}
                    onChange={(e) => setKenBurns(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-gray-700">Ken Burns (줌/패닝)</span>
                </label>
                <span className="text-xs text-gray-400">
                  페이드: {fadeDuration}s
                </span>
              </div>
              <input
                type="range" min="0" max="2" step="0.1"
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
              <p className="text-xs text-gray-400">추천</p>
              <div className="grid grid-cols-2 gap-1.5">
                {recommended.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setImageStyle(s.id)}
                    className="px-2 py-1.5 rounded-lg text-xs text-left transition-all truncate"
                    style={imageStyle === s.id
                      ? { background: "#787fff", color: "white" }
                      : { background: "#f9fafb", color: "#374151", border: "1px solid #e5e7eb" }}
                    title={s.descKo}
                  >
                    {s.nameKo}
                  </button>
                ))}
              </div>
              <details className="text-xs">
                <summary className="text-gray-400 cursor-pointer hover:text-gray-600">
                  전체 ({rest.length}개 더)
                </summary>
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  {rest.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setImageStyle(s.id)}
                      className="px-2 py-1.5 rounded-lg text-xs text-left transition-all truncate"
                      style={imageStyle === s.id
                        ? { background: "#787fff", color: "white" }
                        : { background: "#f9fafb", color: "#374151", border: "1px solid #e5e7eb" }}
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
            <input ref={bgmInputRef} type="file" accept="audio/*" className="hidden"
              onChange={(e) => setBgmFile(e.target.files?.[0] || null)} />
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
                  <button onClick={() => { setBgmFile(null); if (bgmInputRef.current) bgmInputRef.current.value = ""; }}
                    className="text-xs text-red-400 hover:text-red-600">제거</button>
                </div>
                <input type="range" min="0" max="0.5" step="0.01" value={bgmVolume}
                  onChange={(e) => setBgmVolume(parseFloat(e.target.value))} className="w-full" />
              </div>
            )}
          </div>

          {/* 자막 폰트 */}
          <div className="rounded-xl border bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">자막 폰트 (선택)</h3>
            <p className="text-xs text-gray-400">TTF/OTF 폰트를 업로드하면 자막이 영상에 번인됩니다.</p>
            <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden"
              onChange={(e) => setSubtitleFontFile(e.target.files?.[0] || null)} />
            <button
              onClick={() => fontInputRef.current?.click()}
              className="w-full px-3 py-2 rounded-lg border-2 border-dashed text-sm text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-all"
            >
              {subtitleFontFile ? subtitleFontFile.name : "폰트 파일 업로드 (TTF, OTF)"}
            </button>
            {subtitleFontFile && (
              <button onClick={() => { setSubtitleFontFile(null); if (fontInputRef.current) fontInputRef.current.value = ""; }}
                className="text-xs text-red-400 hover:text-red-600">제거</button>
            )}
          </div>
        </div>

        {/* ═══ 우측: 씬 편집 + 결과 ═══ */}
        <div className="space-y-4">
          {/* 씬 입력 */}
          <div className="rounded-xl border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">씬 구성</h3>
              <div className="flex gap-1">
                <button onClick={() => setEditMode("bulk")}
                  className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
                  style={editMode === "bulk" ? { background: "#787fff20", color: "#787fff" } : { color: "#9ca3af" }}>
                  일괄 입력
                </button>
                <button onClick={() => setEditMode("individual")}
                  className="px-3 py-1 rounded-lg text-xs font-medium transition-all"
                  style={editMode === "individual" ? { background: "#787fff20", color: "#787fff" } : { color: "#9ca3af" }}>
                  개별 편집
                </button>
              </div>
            </div>

            {editMode === "bulk" ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">한 줄에 하나의 씬(나레이션 텍스트)을 입력하세요.</p>
                <textarea
                  value={scenesText}
                  onChange={(e) => setScenesText(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 rounded-lg border text-sm font-mono focus:ring-2 focus:ring-purple-300 outline-none resize-y"
                  placeholder={`인생은 고통의 바다를 항해하는 것이다.\n행복이란 고통이 잠시 멈추는 순간에 불과하다.\n의지는 끝없이 욕망하고, 욕망은 끝없이 고통을 낳는다.`}
                />
                <button onClick={handleParseScenes}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all"
                  style={{ background: "#787fff" }}>
                  {scenes.length > 0 ? `${parseScenesFromText(scenesText).length}개 씬으로 업데이트` : "씬으로 분할"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* AI 프롬프트 자동 생성 버튼 */}
                {scenes.length > 0 && (
                  <button
                    onClick={handleAutoGeneratePrompts}
                    disabled={isGeneratingPrompts || !hasValidScenes}
                    className="w-full px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                    style={{ background: "#f0e6ff", color: "#7c3aed", border: "1px solid #ddd6fe" }}
                  >
                    {isGeneratingPrompts
                      ? "AI가 이미지 프롬프트 생성 중..."
                      : `AI로 이미지 프롬프트 자동 생성 (${scenes.filter(s => s.narration.trim()).length}개 씬)`}
                  </button>
                )}

                {scenes.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    일괄 입력에서 텍스트를 먼저 분할하거나, 아래 버튼으로 씬을 추가하세요.
                  </div>
                ) : (
                  scenes.map((scene, i) => (
                    <div key={i} className="rounded-lg border bg-gray-50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500">씬 {i + 1}</span>
                        <div className="flex gap-1">
                          <button onClick={() => moveScene(i, "up")} disabled={i === 0}
                            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 px-1">
                            &#9650;
                          </button>
                          <button onClick={() => moveScene(i, "down")} disabled={i === scenes.length - 1}
                            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 px-1">
                            &#9660;
                          </button>
                          <button onClick={() => removeScene(i)}
                            className="text-xs text-red-400 hover:text-red-600 ml-2">삭제</button>
                        </div>
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
                        placeholder="이미지 프롬프트 (비워두면 자동 생성, 또는 AI 버튼 클릭)"
                      />

                      {/* 씬 상태 + 미리보기 */}
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        {state.sceneStatuses[i] && (
                          <>
                            <span className={state.sceneStatuses[i].imageReady ? "text-green-500" : "text-gray-300"}>
                              {state.sceneStatuses[i].imageReady ? "이미지 완료" : "이미지 대기"}
                            </span>
                            <span className={state.sceneStatuses[i].ttsReady ? "text-green-500" : "text-gray-300"}>
                              {state.sceneStatuses[i].ttsReady ? "TTS 완료" : "TTS 대기"}
                            </span>
                            {/* 오디오 미리듣기 */}
                            {state.sceneStatuses[i].ttsReady && (
                              <button
                                onClick={() => handlePreviewAudio(i)}
                                className="px-2 py-0.5 rounded text-xs font-medium transition-all"
                                style={{
                                  background: playingAudioIndex === i ? "#ef4444" : "#787fff",
                                  color: "white",
                                }}
                              >
                                {playingAudioIndex === i ? "정지" : "미리듣기"}
                              </button>
                            )}
                            {state.sceneStatuses[i].error && (
                              <span className="text-red-500">{state.sceneStatuses[i].error}</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <button onClick={addScene}
                  className="w-full px-3 py-2 rounded-lg border-2 border-dashed text-sm text-gray-400 hover:text-purple-500 hover:border-purple-300 transition-all">
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
                    <div key={s.index} className="relative rounded-lg overflow-hidden border group">
                      <img
                        src={`data:${s.imageMimeType || "image/png"};base64,${s.imageBase64}`}
                        alt={`씬 ${s.index}`}
                        className="w-full aspect-video object-cover"
                      />
                      <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                        씬 {s.index}
                      </span>
                      {/* 오버레이 버튼들 */}
                      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {s.ttsReady && (
                          <button
                            onClick={() => handlePreviewAudio(s.index - 1)}
                            className="bg-black/50 text-white text-xs px-2 py-1 rounded"
                          >
                            {playingAudioIndex === s.index - 1 ? "||" : "&#9654;"}
                          </button>
                        )}
                        <button
                          onClick={() => handleCreateVeoVideo(s.index - 1)}
                          disabled={isCreatingVeoVideo}
                          className="bg-purple-600/80 text-white text-xs px-2 py-1 rounded disabled:opacity-50"
                          title="이 이미지로 VEO 영상 만들기"
                        >
                          {isCreatingVeoVideo && hybridSceneIndex === s.index - 1 ? "..." : "VEO"}
                        </button>
                      </div>
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
                <button onClick={abort} className="text-xs text-red-400 hover:text-red-600 font-medium">중단</button>
              </div>
              <div className="space-y-2">
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${state.overallPercent}%`, background: "linear-gradient(90deg, #787fff, #a8abff)" }} />
                </div>
                <p className="text-xs text-gray-500">{state.message}</p>
              </div>
            </div>
          )}

          {/* 에러 */}
          {state.phase === "error" && state.error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-600">{state.error}</p>
              <button onClick={reset} className="mt-2 text-xs text-red-500 underline hover:text-red-700">다시 시도</button>
            </div>
          )}

          {/* 완료 */}
          {state.phase === "done" && state.result && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-green-700">영상 생성 완료!</h3>
              <p className="text-xs text-green-600">{state.message}</p>
              <div className="flex gap-2">
                <a href={state.result.blobUrl} download={`${title || "audiobook"}_audiobook.mp4`}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-all"
                  style={{ background: "#22c55e" }}>
                  다시 다운로드
                </a>
                <button onClick={reset}
                  className="px-4 py-2 rounded-lg text-sm font-medium border transition-all hover:bg-gray-50">
                  새로 만들기
                </button>
              </div>
              <video src={state.result.blobUrl} controls className="w-full max-w-2xl rounded-lg border" />
            </div>
          )}

          {/* 생성 버튼 */}
          {!isRunning && state.phase !== "done" && (
            <button
              onClick={handleGenerate}
              disabled={!hasValidScenes}
              className="w-full px-6 py-3 rounded-xl text-base font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: hasValidScenes ? "linear-gradient(135deg, #787fff, #a855f7)" : "#d1d5db",
                boxShadow: hasValidScenes ? "0 4px 14px rgba(120, 127, 255, 0.4)" : "none",
              }}
            >
              {hasValidScenes
                ? `${scenes.filter(s => s.narration.trim()).length}개 씬 오디오북 영상 생성${kenBurns ? " (Ken Burns)" : ""}`
                : "씬을 먼저 추가하세요"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
