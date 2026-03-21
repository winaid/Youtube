"use client";

import { useState, useRef } from "react";
import {
  VideoGenerationConfig,
  VideoResolution,
  AspectRatio,
  PersonGeneration,
  VideoMode,
} from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { VEO_MODEL_REGISTRY } from "@/lib/veo-capability";
import { Separator } from "@/components/ui/separator";

interface VideoSettingsPanelProps {
  config: VideoGenerationConfig;
  onConfigChange: (config: VideoGenerationConfig) => void;
  storyboardImages?: Record<number, string>;
}

function ImageUploadSlot({
  index,
  imageBase64,
  onUpload,
  onRemove,
  label,
}: {
  index: number;
  imageBase64?: string;
  onUpload: (index: number, base64: string) => void;
  onRemove: (index: number) => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // base64 부분만 추출
      const base64 = result.split(",")[1];
      onUpload(index, base64);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="relative w-20 h-20 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden group"
      style={{ borderColor: imageBase64 ? "#22c55e" : "#ccc" }}
      onClick={() => !imageBase64 && inputRef.current?.click()}
    >
      {imageBase64 ? (
        <>
          <img
            src={`data:image/png;base64,${imageBase64}`}
            alt={label}
            className="w-full h-full object-cover"
          />
          <button
            className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-[10px] rounded-bl opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onRemove(index); }}
          >
            X
          </button>
        </>
      ) : (
        <div className="text-center">
          <span className="text-lg text-muted-foreground">+</span>
          <p className="text-[8px] text-muted-foreground">{label}</p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}

export default function VideoSettingsPanel({
  config,
  onConfigChange,
  storyboardImages,
}: VideoSettingsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const firstFrameRef = useRef<HTMLInputElement>(null);
  const lastFrameRef = useRef<HTMLInputElement>(null);

  const update = (partial: Partial<VideoGenerationConfig>) => {
    onConfigChange({ ...config, ...partial });
  };

  const handleFrameUpload = (type: "first" | "last", file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      if (type === "first") update({ firstFrameBase64: base64 });
      else update({ lastFrameBase64: base64 });
    };
    reader.readAsDataURL(file);
  };

  const handleRefImageUpload = (index: number, base64: string) => {
    const newImages = [...config.referenceImages];
    newImages[index] = base64;
    update({ referenceImages: newImages });
  };

  const handleRefImageRemove = (index: number) => {
    const newImages = config.referenceImages.filter((_, i) => i !== index);
    update({ referenceImages: newImages });
  };

  // 예상 비용 계산 (fast 모드, 8초 고정)
  const modelCap = VEO_MODEL_REGISTRY["veo-3.0-fast-generate-preview"];
  const pricePerSec = modelCap?.pricePerSecond720p ?? 0.15;
  const estimatedCost = pricePerSec * 8 * config.sampleCount;

  const modeLabels:   Record<VideoMode,   string> = { generate: "Generate", extend: "Extend" };

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#c4b80040" }}>
      <CardHeader
        className="pb-2 cursor-pointer"
        style={{ background: "linear-gradient(135deg, #c4b80015, #787fff10)" }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm" style={{ color: "#7a7000" }}>
            영상 생성 설정
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              className="text-[10px] text-white"
              style={{ background: "#4285f4" }}
            >
              VEO
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px]"
              style={{ borderColor: "#6b5ce7", color: "#6b5ce7" }}
            >
              {modeLabels[config.videoMode ?? "extend"]}
            </Badge>
            <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#c4b800" }}>
              8s | {config.resolution} | {config.aspectRatio}
            </Badge>
            <Badge variant="outline" className="text-[10px]" style={{ borderColor: "#787fff" }}>
              ~${estimatedCost.toFixed(2)}/clip
            </Badge>
            <span className="text-xs text-muted-foreground">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-4">

          {/* ── 생성 모드 ── */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">모드</Label>
            <div className="flex gap-2">
              {(["generate", "extend"] as VideoMode[]).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={config.videoMode === m ? "default" : "outline"}
                  className="h-7 text-xs flex-1"
                  style={config.videoMode === m
                    ? { background: "#6b5ce7", color: "#fff", border: "none" }
                    : { borderColor: "#6b5ce7", color: "#6b5ce7" }}
                  onClick={() => update({ videoMode: m })}
                >
                  {modeLabels[m]}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Generate: 각 장면 독립 생성. Extend: 이전 장면을 이어서 생성 (연속성 유지).
            </p>
          </div>

          <Separator />

          {/* 클립 길이 (VEO 정책: 8초 고정) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">클립 길이</Label>
              <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: "#4285f415", color: "#4285f4" }}>
                8초 (고정)
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              VEO는 8초 멀티샷 생성만 지원합니다. 더 긴 영상은 연장(extend)으로 이어붙입니다.
            </p>
          </div>

          {/* 해상도 */}
          <div className="space-y-1.5">
            <Label className="text-xs">해상도</Label>
            <div className="flex gap-2">
              {(["720p", "1080p", "4k"] as VideoResolution[]).map((r) => (
                <Button
                  key={r}
                  size="sm"
                  variant={config.resolution === r ? "default" : "outline"}
                  className="flex-1 text-xs"
                  style={config.resolution === r ? { background: "#787fff", color: "white" } : {}}
                  onClick={() => update({ resolution: r })}
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>

          {/* 화면 비율 */}
          <div className="space-y-1.5">
            <Label className="text-xs">화면 비율</Label>
            <div className="flex gap-2">
              {(["16:9", "9:16"] as AspectRatio[]).map((ar) => (
                <Button
                  key={ar}
                  size="sm"
                  variant={config.aspectRatio === ar ? "default" : "outline"}
                  className="flex-1 text-xs"
                  style={config.aspectRatio === ar ? { background: "#787fff", color: "white" } : {}}
                  onClick={() => update({ aspectRatio: ar })}
                >
                  {ar === "9:16" ? "세로 (쇼츠)" : ar === "16:9" ? "가로 (유튜브)" : "정사각형"}
                </Button>
              ))}
            </div>
          </div>

          <Separator style={{ background: "#c4b80030" }} />

          {/* 오디오 ON/OFF 토글 */}
          <div className="flex items-center justify-between">
            <Label className="text-xs">네이티브 오디오 생성</Label>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium" style={{ color: config.generateAudio ? "#22c55e" : "#888" }}>
                {config.generateAudio ? "ON" : "OFF"}
              </span>
              <button
                type="button"
                className="relative w-10 h-5 rounded-full transition-colors"
                style={{ background: config.generateAudio ? "#22c55e" : "#ccc" }}
                onClick={() => update({ generateAudio: !config.generateAudio })}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: config.generateAudio ? "22px" : "2px" }}
                />
              </button>
            </div>
          </div>

          {/* 사람 생성 정책 */}
          <div className="space-y-1.5">
            <Label className="text-xs">사람 생성 정책</Label>
            <div className="flex gap-2">
              {([
                { value: "allow_all", label: "전체 허용" },
                { value: "allow_adult", label: "성인만" },
                { value: "dont_allow", label: "금지" },
              ] as { value: PersonGeneration; label: string }[]).map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant={config.personGeneration === opt.value ? "default" : "outline"}
                  className="flex-1 text-[10px]"
                  style={config.personGeneration === opt.value ? { background: "#787fff", color: "white" } : {}}
                  onClick={() => update({ personGeneration: opt.value })}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 변형 수 (Sample Count) */}
          <div className="space-y-1.5">
            <Label className="text-xs">변형 생성 수 (같은 프롬프트로 여러 버전)</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={config.sampleCount === n ? "default" : "outline"}
                  className="flex-1 text-xs"
                  style={config.sampleCount === n ? { background: "#787fff", color: "white" } : {}}
                  onClick={() => update({ sampleCount: n })}
                >
                  {n}개
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              여러 변형을 생성하면 베스트를 선택할 수 있습니다 (비용 x{config.sampleCount})
            </p>
          </div>

          <Separator style={{ background: "#c4b80030" }} />

          {/* Negative Prompt */}
          <div className="space-y-1.5">
            <Label className="text-xs">Negative Prompt (제외할 요소)</Label>
            <textarea
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#787fff] resize-none"
              rows={2}
              value={config.negativePrompt}
              onChange={(e) => update({ negativePrompt: e.target.value })}
              placeholder="text overlay, watermark, logo, blurry..."
            />
            <p className="text-[10px] text-muted-foreground">
              &quot;no&quot;나 &quot;don&apos;t&quot; 대신 제외할 단어만 나열하세요
            </p>
          </div>

          {/* Seed */}
          <div className="space-y-1.5">
            <Label className="text-xs">Seed (동일 결과 재현)</Label>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                max={4294967295}
                value={config.seed ?? ""}
                onChange={(e) => {
                  const v = e.target.value ? parseInt(e.target.value) : undefined;
                  update({ seed: v });
                }}
                placeholder="비워두면 랜덤"
                className="flex h-8 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#787fff]"
              />
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => update({ seed: Math.floor(Math.random() * 4294967295) })}
              >
                랜덤
              </Button>
              {config.seed !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => update({ seed: undefined })}
                >
                  초기화
                </Button>
              )}
            </div>
          </div>

          <Separator style={{ background: "#c4b80030" }} />

          {/* Reference Images — VEO API 미지원으로 비활성화 */}
          <div className="space-y-1.5 opacity-50 pointer-events-none">
            <Label className="text-xs">참조 이미지 (준비 중)</Label>
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <ImageUploadSlot
                  key={i}
                  index={i}
                  imageBase64={config.referenceImages[i]}
                  onUpload={handleRefImageUpload}
                  onRemove={handleRefImageRemove}
                  label={`참조 ${i + 1}`}
                />
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              VEO에서 참조 이미지를 아직 지원하지 않습니다. 시작 프레임을 대신 활용하세요.
            </p>
          </div>

          {/* First / Last Frame */}
          <div className="space-y-1.5">
            <Label className="text-xs">시작/끝 프레임 지정</Label>
            <div className="flex gap-3">
              {/* First Frame */}
              <div className="flex-1 space-y-1">
                <p className="text-[10px] text-muted-foreground">시작 프레임</p>
                <div
                  className="relative w-full h-16 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden group"
                  style={{ borderColor: config.firstFrameBase64 ? "#22c55e" : "#ccc" }}
                  onClick={() => !config.firstFrameBase64 && firstFrameRef.current?.click()}
                >
                  {config.firstFrameBase64 ? (
                    <>
                      <img
                        src={`data:image/png;base64,${config.firstFrameBase64}`}
                        alt="First frame"
                        className="w-full h-full object-cover"
                      />
                      <button
                        className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-[10px] rounded-bl opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); update({ firstFrameBase64: undefined }); }}
                      >
                        X
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">+ 시작 프레임</span>
                  )}
                </div>
                <input
                  ref={firstFrameRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFrameUpload("first", file);
                  }}
                />
              </div>

              {/* Last Frame */}
              <div className="flex-1 space-y-1">
                <p className="text-[10px] text-muted-foreground">끝 프레임</p>
                <div
                  className="relative w-full h-16 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden group"
                  style={{ borderColor: config.lastFrameBase64 ? "#22c55e" : "#ccc" }}
                  onClick={() => !config.lastFrameBase64 && lastFrameRef.current?.click()}
                >
                  {config.lastFrameBase64 ? (
                    <>
                      <img
                        src={`data:image/png;base64,${config.lastFrameBase64}`}
                        alt="Last frame"
                        className="w-full h-full object-cover"
                      />
                      <button
                        className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-[10px] rounded-bl opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); update({ lastFrameBase64: undefined }); }}
                      >
                        X
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">+ 끝 프레임</span>
                  )}
                </div>
                <input
                  ref={lastFrameRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFrameUpload("last", file);
                  }}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              시작/끝 프레임을 지정하면 정확한 구도로 영상이 시작/종료됩니다
            </p>
            {/* 스토리보드에서 시작 프레임 가져오기 */}
            {storyboardImages && Object.keys(storyboardImages).length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-[10px] font-medium" style={{ color: "#787fff" }}>스토리보드에서 시작 프레임 선택:</p>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {Object.entries(storyboardImages).map(([cutNum, base64]) => (
                    <button
                      key={cutNum}
                      onClick={() => update({ firstFrameBase64: base64 })}
                      className="shrink-0 w-12 h-12 rounded-md overflow-hidden border transition-all hover:scale-105 hover:border-[#787fff] relative"
                      style={{ borderColor: config.firstFrameBase64 === base64 ? "#22c55e" : "#333" }}
                      title={`CUT ${cutNum} → 시작 프레임으로 설정`}
                    >
                      <img src={`data:image/png;base64,${base64}`} alt={`CUT ${cutNum}`} className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-white text-center">#{cutNum}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator style={{ background: "#c4b80030" }} />

          {/* Enhancement: AI 품질 고도화 */}
          <div className="space-y-3">
            <Label className="text-xs font-semibold" style={{ color: "#7c3aed" }}>AI 품질 고도화</Label>

            {/* 프롬프트 자동 검증 */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">프롬프트 자동 품질 검증</Label>
                <p className="text-[10px] text-muted-foreground">생성 전 Gemini가 프롬프트를 리뷰하고 개선</p>
              </div>
              <button
                className="relative w-10 h-5 rounded-full transition-colors"
                style={{ background: config.autoVerifyPrompts ? "#7c3aed" : "#ccc" }}
                onClick={() => update({ autoVerifyPrompts: !config.autoVerifyPrompts })}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ left: config.autoVerifyPrompts ? "22px" : "2px" }}
                />
              </button>
            </div>

            {/* 영어 네이티브 교정 */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">영어 네이티브 교정</Label>
                <p className="text-[10px] text-muted-foreground">영상 모델이 잘 이해하는 시네마틱 영어로 자동 변환</p>
              </div>
              <button
                className="relative w-10 h-5 rounded-full transition-colors"
                style={{ background: config.autoEnglishRefine ? "#7c3aed" : "#ccc" }}
                onClick={() => update({ autoEnglishRefine: !config.autoEnglishRefine })}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ left: config.autoEnglishRefine ? "22px" : "2px" }}
                />
              </button>
            </div>

            {/* 장면 연속성 자동 체인 + 스토리보드 → firstFrame 자동 연결 */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">장면 연속성 자동 체인</Label>
                <p className="text-[10px] text-muted-foreground">이전 영상의 마지막 프레임 → 다음 장면 시작 프레임으로 자동 연결</p>
              </div>
              <button
                className="relative w-10 h-5 rounded-full transition-colors"
                style={{ background: config.autoLinkFirstFrame ? "#22c55e" : "#ccc" }}
                onClick={() => update({ autoLinkFirstFrame: !config.autoLinkFirstFrame })}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ left: config.autoLinkFirstFrame ? "22px" : "2px" }}
                />
              </button>
            </div>

            {/* 실패 장면 자동 재시도 */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">실패 장면 자동 재시도</Label>
                <p className="text-[10px] text-muted-foreground">negativePrompt 강화 후 자동 재생성</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={config.maxRetryCount}
                  onChange={(e) => update({ maxRetryCount: parseInt(e.target.value) })}
                  className="h-7 rounded-md border text-[10px] px-1"
                >
                  <option value={1}>1회</option>
                  <option value={2}>2회</option>
                  <option value={3}>3회</option>
                </select>
                <button
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{ background: config.autoRetryOnFailure ? "#ef4444" : "#ccc" }}
                  onClick={() => update({ autoRetryOnFailure: !config.autoRetryOnFailure })}
                >
                  <div
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                    style={{ left: config.autoRetryOnFailure ? "22px" : "2px" }}
                  />
                </button>
              </div>
            </div>

            {/* 프롬프트 강도 조절 슬라이더 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">감독 스타일 강도</Label>
                <span className="text-[10px] font-mono" style={{ color: "#7c3aed" }}>{config.styleIntensity}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={10}
                value={config.styleIntensity}
                onChange={(e) => update({ styleIntensity: parseInt(e.target.value) })}
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #ccc 0%, #7c3aed ${config.styleIntensity}%, #e5e5e5 ${config.styleIntensity}%)`,
                }}
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>자연스러움</span>
                <span>균형</span>
                <span>스타일 극대화</span>
              </div>
            </div>
          </div>

          <Separator style={{ background: "#c4b80030" }} />

          {/* 비용 요약 */}
          <div className="p-2.5 rounded-lg" style={{ background: "#fff78710", border: "1px solid #c4b80020" }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium" style={{ color: "#7a7000" }}>예상 비용 (클립당)</span>
              <span className="text-sm font-bold" style={{ color: "#7a7000" }}>
                ${estimatedCost.toFixed(2)}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              $0.15/초 x 8초 x {config.sampleCount}변형
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
