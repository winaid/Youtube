"use client";

import { useState, useEffect } from "react";
import { Cut, CharacterSeed, VideoPromptJson, type ShotSnapshots, type ShotNarrationState } from "@/types";
import MultiShotEditor from "./MultiShotEditor";
import { getMaxShots } from "@/lib/kling-capability";
import { distributeEvenly, checkShotDensity, getRecommendedShotRange } from "@/lib/multishot-validation";
import { shouldForceMultiShot, buildDefaultMultiShot, planShotRoles } from "@/lib/multi-shot-planner";
import type { PlannerSceneType } from "@/lib/multi-shot-planner";
import { detectShotProgression, splitSingleShotSequence, type ShotBeatHint } from "@/lib/shot-splitting";
import ShotComparisonPanel from "./ShotComparisonPanel";
import StructureMetaBadges from "@/components/shared/StructureMetaBadges";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cameraPresets, categoryLabels, type CameraPreset } from "@/data/camera-presets";
import { motionLevels } from "@/data/motion-intensity-presets";

interface CutCardProps {
  cut: Cut;
  characterSeeds?: CharacterSeed[];
  onUpdate?: (updated: Cut) => void;
  storyboardImage?: string;
  storyboardCandidates?: string[];
  storyboardLoading?: boolean;
  onGenerateImage?: () => void;
  onSelectCandidate?: (base64: string) => void;
  storyboardEndImage?: string;
  storyboardEndLoading?: boolean;
  onGenerateEndImage?: () => void;
  sceneTtsUrl?: string;
  userVideoMode?: "fast";
  /** Kling 모델 ID — MultiShotEditor에서 capability 조회에 사용 */
  modelId?: string;
  sceneTtsLoading?: boolean;
  onGenerateSceneTts?: () => void;
  onFeedbackRefine?: (cutNumber: number, feedback: string) => Promise<void>;
  onEnglishRefine?: (cutNumber: number) => Promise<void>;
  shotSnapshots?: ShotSnapshots;
  /** narration dirty-state for this cut */
  narrationState?: ShotNarrationState;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-xs"
      onClick={handleCopy}
    >
      {copied ? "복사됨!" : `${label} 복사`}
    </Button>
  );
}

function EditableField({
  label,
  value,
  color,
  bgColor,
  onSave,
}: {
  label: string;
  value: string;
  color: string;
  bgColor: string;
  onSave: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color }}>{label}</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => { onSave(draft); setEditing(false); }}
              style={{ color: "#22c55e" }}
            >
              저장
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => { setDraft(value); setEditing(false); }}
            >
              취소
            </Button>
          </div>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="text-xs font-mono"
          style={{ background: bgColor }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color }}>{label}</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setEditing(true)}
          >
            수정
          </Button>
          <CopyButton text={value} label={label.split(" ")[0]} />
        </div>
      </div>
      <p
        className="text-xs p-2 rounded-md font-mono leading-relaxed break-all cursor-pointer hover:ring-1 hover:ring-offset-1 transition-all"
        style={{ background: bgColor, "--tw-ring-color": color } as React.CSSProperties}
        onClick={() => setEditing(true)}
      >
        {value}
      </p>
    </div>
  );
}

// ── JSON 구조화 프롬프트 뷰 ──────────────────────────────────────
const JSON_FIELD_LABELS: Record<string, string> = {
  shotSize: "샷 사이즈",
  cameraAngle: "카메라 앵글",
  cameraMovement: "카메라 움직임",
  subjectBlocking: "피사체 배치",
  subjectAction: "피사체 동작",
  actionBeat: "액션 비트",
  bodySignal: "바디 시그널",
  revealed: "공개 정보",
  withheld: "보류 정보",
  timingBeat: "타이밍 비트",
  transitionFromPrev: "전환",
  characterRef: "캐릭터 외형",
  moodLighting: "조명/무드",
  styleSuffix: "스타일",
  locationCue: "장소 단서",
  situationCue: "상황 단서",
  emotionalAnchor: "감정 앵커",
};

const JSON_FIELD_COLORS: Record<string, string> = {
  shotSize: "#787fff",
  cameraAngle: "#787fff",
  cameraMovement: "#787fff",
  subjectBlocking: "#e09900",
  subjectAction: "#e09900",
  actionBeat: "#e09900",
  bodySignal: "#c4b800",
  revealed: "#22c55e",
  withheld: "#ef4444",
  timingBeat: "#7c3aed",
  transitionFromPrev: "#6b5ce7",
  characterRef: "#e09900",
  moodLighting: "#c4b800",
  styleSuffix: "#787fff",
  locationCue: "#22c55e",
  situationCue: "#22c55e",
  emotionalAnchor: "#ef4444",
};

function JsonPromptView({
  json,
  label,
  color,
  onSaveField,
}: {
  json: VideoPromptJson;
  label: string;
  color: string;
  onSaveField?: (field: string, value: string) => void;
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const fields = Object.entries(json).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0
  ) as [string, string][];

  const handleCopyAll = async () => {
    const text = fields
      .map(([k, v]) => `${JSON_FIELD_LABELS[k] || k}: ${v}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color }}>{label}</span>
          <Badge
            variant="outline"
            className="text-[9px] py-0 px-1"
            style={{ borderColor: color, color }}
          >
            JSON
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleCopyAll}
        >
          {copied ? "복사됨!" : "전체 복사"}
        </Button>
      </div>
      <div
        className="rounded-lg p-2 space-y-1"
        style={{ background: `${color}08`, border: `1px solid ${color}20` }}
      >
        {fields.map(([key, value]) => {
          const fieldColor = JSON_FIELD_COLORS[key] || "#666";
          const fieldLabel = JSON_FIELD_LABELS[key] || key;

          if (editingField === key) {
            return (
              <div key={key} className="space-y-1">
                <span className="text-[10px] font-semibold" style={{ color: fieldColor }}>
                  {fieldLabel}
                </span>
                <Textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={2}
                  className="text-xs font-mono"
                  style={{ background: `${fieldColor}10` }}
                />
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px]"
                    style={{ color: "#22c55e" }}
                    onClick={() => {
                      onSaveField?.(key, editDraft);
                      setEditingField(null);
                    }}
                  >
                    저장
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px]"
                    onClick={() => setEditingField(null)}
                  >
                    취소
                  </Button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={key}
              className="flex gap-2 items-start group cursor-pointer hover:bg-white/50 rounded px-1 py-0.5 transition-colors"
              onClick={() => {
                if (onSaveField) {
                  setEditingField(key);
                  setEditDraft(value);
                }
              }}
            >
              <span
                className="text-[10px] font-semibold shrink-0 mt-0.5"
                style={{ color: fieldColor, minWidth: 72 }}
              >
                {fieldLabel}
              </span>
              <span className="text-[11px] font-mono leading-relaxed text-gray-700 break-all">
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CutCard({
  cut, characterSeeds, onUpdate,
  storyboardImage: _storyboardImage, storyboardCandidates: _storyboardCandidates, storyboardLoading: _storyboardLoading, onGenerateImage: _onGenerateImage, onSelectCandidate: _onSelectCandidate,
  storyboardEndImage: _storyboardEndImage, storyboardEndLoading: _storyboardEndLoading, onGenerateEndImage: _onGenerateEndImage,
  sceneTtsUrl, sceneTtsLoading, onGenerateSceneTts,
  onFeedbackRefine, onEnglishRefine,
  userVideoMode: _userVideoMode, modelId,
  shotSnapshots,
  narrationState,
}: CutCardProps) {
  const isEven = cut.cutNumber % 2 === 0;
  const [feedbackText, setFeedbackText] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [refining, setRefining] = useState(false);
  const [englishRefining, setEnglishRefining] = useState(false);
  const [showPresets, setShowPresets] = useState(false);

  // 멀티샷 자동 초기화 — useEffect로 안전하게 처리
  // Priority: progression-aware split > generic role-based split
  // 조건: modelId 있고, onUpdate 있고, multiShot 비어있고, 의도적 원테이크 아니고, eligible
  useEffect(() => {
    if (!modelId || !onUpdate) return;
    if (cut.multiShot && cut.multiShot.length > 0) return;
    if (cut.intentionalOneTake) return;

    const sceneType = (cut.shotCategory ?? "default") as PlannerSceneType;
    const maxShots = getMaxShots(modelId, cut.durationSec);
    const forced = shouldForceMultiShot(sceneType, cut.durationSec, modelId);

    if (forced || maxShots >= 2) {
      // ── Check for arrow/progression in content FIRST ──
      // If the cut's action/subject contains progression markers (A → B → C),
      // use content-aware split instead of generic role-based split.
      const action = cut.videoPrompt || cut.sceneDescription || "";
      const subject = cut.characterConsistency || "";
      const progression = detectShotProgression(action, subject);

      if (progression.hasProgression && cut.durationSec > 3) {
        // Content-aware split: use the actual progression segments
        const beatHint: ShotBeatHint = cut.cutNumber === 1 ? "hook" :
          /\[.*훅.*\]|hook|도입/i.test(cut.sceneDescription || "") ? "hook" : "default";
        const splitResult = splitSingleShotSequence({
          sceneType,
          subjectPrimary: subject,
          action,
          environment: cut.moodLighting || "",
          moodLighting: cut.moodLighting || "",
          durationSec: cut.durationSec,
          camera: {
            framing: cut.cameraDirection?.match(/\b(WS|MS|CU|MCU|ECU|LS)\b/i)?.[0] || "MS",
            angle: "eye_level",
            motion: cut.cameraDirection || "static",
          },
          beatHint,
        });
        if (splitResult.wasSplit && splitResult.shots.length >= 2) {
          const roles = planShotRoles(splitResult.shots.length, sceneType);
          const progressionMultiShot = splitResult.shots.map((shot, i) => {
            const framingLabel = shot.camera.framing === "WS" ? "Wide shot" :
              shot.camera.framing === "CU" ? "Close-up" :
              shot.camera.framing === "MCU" ? "Medium close-up" :
              `${shot.camera.framing} shot`;
            return {
              index: i + 1,
              prompt: `${framingLabel}. ${shot.action}. ${shot.environment}. ${shot.moodLighting}`.trim(),
              duration: String(Math.round(shot.endSec - shot.startSec)),
              role: roles[i] || ("develop" as const),
            };
          });
          onUpdate({ ...cut, multiShot: progressionMultiShot });
          return;
        }
      }

      // Fallback: generic role-based split
      const autoShots = buildDefaultMultiShot({
        durationSec: cut.durationSec,
        sceneType,
        basePrompt: cut.sceneDescription || "",
        modelId,
        styleSuffix: cut.videoPromptJson?.styleSuffix,
      });
      if (autoShots.length >= 2) {
        onUpdate({ ...cut, multiShot: autoShots });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, cut.cutNumber, cut.durationSec, cut.shotCategory]);

  const handleFieldSave = (field: keyof Cut, value: string) => {
    if (onUpdate) {
      onUpdate({ ...cut, [field]: value });
    }
  };



  // 이 장면에 등장하는 캐릭터들
  const charsInScene = characterSeeds?.filter(
    (s) => cut.charactersInScene?.includes(s.id)
  ) ?? [];

  return (
    <Card
      className="border-l-4 overflow-hidden"
      style={{ borderLeftColor: isEven ? "#fff787" : "#787fff" }}
    >
      <CardHeader className="pb-2 pt-4 px-4" style={{ background: isEven ? "#fff78708" : "#787fff08" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge
              className="text-xs text-white"
              style={{ background: isEven ? "#c4b800" : "#787fff" }}
            >
              장면 {cut.cutNumber}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {cut.durationSec}초
            </span>
            <Badge
              variant="outline"
              className="text-xs"
              style={{
                borderColor: "#22c55e",
                color: "#22c55e",
              }}
            >
              Fast
            </Badge>
            {cut.cutNumber === 1 ? (
              <Badge className="text-xs" style={{ background: "#787fff30", color: "#5a5ecc" }}>
                Video Prompt
              </Badge>
            ) : (
              <Badge className="text-xs" style={{ background: "#6b5ce720", color: "#6b5ce7" }}>
                Extend
              </Badge>
            )}
            {/* 구조 보조 메타 뱃지 — 값이 있을 때만 표시 */}
            <StructureMetaBadges
              structureType={cut.structureType}
              durationClass={cut.durationClass}
              compact
            />
          </div>
          <Badge variant="outline" className="text-xs" style={{ borderColor: isEven ? "#fff787" : "#787fff80" }}>
            {cut.transitionHint}
          </Badge>
        </div>

        {/* 등장 캐릭터 */}
        {charsInScene.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground">등장:</span>
            {charsInScene.map((ch) => (
              <Badge
                key={ch.id}
                variant="outline"
                className="text-[10px] py-0"
                style={{ borderColor: "#e09900", color: "#e09900" }}
                title={ch.appearance}
              >
                {ch.label}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {/* 장면 설명 */}
        <p className="text-sm">{cut.sceneDescription}</p>

        {/* 멀티샷 기본 에디터 — eligible 클립은 자동 초기화 */}
        {modelId && onUpdate && (() => {
          const maxShots = getMaxShots(modelId, cut.durationSec);
          const hasMultiShot = cut.multiShot && cut.multiShot.length > 0;
          const sceneType = (cut.shotCategory ?? "default") as PlannerSceneType;
          const forced = shouldForceMultiShot(sceneType, cut.durationSec, modelId);

          // 이미 멀티샷이 있으면 에디터 표시
          if (hasMultiShot) {
            return (
              <div className="space-y-1">
                <MultiShotEditor cut={cut} modelId={modelId} onUpdate={onUpdate} />
                {/* 의도적 원테이크 전환 — 강제 멀티샷 클립에서도 예외 허용 */}
                {forced && (
                  <button
                    onClick={() => onUpdate({ ...cut, multiShot: [], intentionalOneTake: true })}
                    className="text-[9px] px-2 py-0.5 rounded transition-colors"
                    style={{ color: "#6b7280", border: "1px solid #e5e7eb" }}
                  >
                    의도적 원테이크로 전환
                  </button>
                )}
              </div>
            );
          }

          // 의도적 원테이크 상태
          if (cut.intentionalOneTake) {
            return (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px]" style={{ borderColor: "#6b7280", color: "#6b7280" }}>
                    의도적 원테이크
                  </Badge>
                  <button
                    onClick={() => {
                      const initial = buildDefaultMultiShot({
                        durationSec: cut.durationSec,
                        sceneType,
                        basePrompt: cut.sceneDescription || "",
                        modelId,
                        styleSuffix: cut.videoPromptJson?.styleSuffix,
                      });
                      onUpdate({ ...cut, multiShot: initial, intentionalOneTake: undefined });
                    }}
                    className="text-[9px] px-2 py-0.5 rounded transition-colors"
                    style={{ color: "#e85d04", border: "1px solid #e85d0420" }}
                  >
                    멀티샷으로 전환
                  </button>
                </div>
              </div>
            );
          }

          // 강제 멀티샷 또는 eligible — useEffect가 자동 초기화 처리
          // 다음 렌더에서 multiShot이 채워지므로 대기 표시
          if (forced || maxShots >= 2) {
            return (
              <div className="text-[9px] py-2" style={{ color: "#6b7280" }}>
                {forced ? "멀티샷 필수" : "멀티샷 추천"} — 자동 생성 대기 중...
              </div>
            );
          }

          // maxShots > 0이지만 자동 생성 대상 아닌 경우 — 수동 시작 버튼
          if (maxShots > 0) {
            const rec = getRecommendedShotRange(cut.durationSec);
            const defaultShots = Math.min(rec.min, maxShots);
            return (
              <button
                onClick={() => {
                  const initial = distributeEvenly(modelId, Math.max(2, defaultShots), cut.durationSec);
                  onUpdate({ ...cut, multiShot: initial });
                }}
                className="text-[10px] px-2 py-1 rounded-md transition-colors"
                style={{ background: "#e85d0410", color: "#e85d04", border: "1px solid #e85d0420" }}
              >
                멀티샷 시작 ({rec.min}–{rec.max}샷 권장)
              </button>
            );
          }
          return null;
        })()}

        {/* 장면별 TTS */}
        {onGenerateSceneTts && (
          <div className="flex items-center gap-2">
            {sceneTtsUrl ? (
              <audio controls src={sceneTtsUrl} className="h-7 flex-1" style={{ maxWidth: 200 }} />
            ) : (
              <button
                onClick={onGenerateSceneTts}
                disabled={sceneTtsLoading}
                className="text-[10px] px-2 py-1 rounded-md transition-colors"
                style={{ background: "#7c3aed10", color: "#7c3aed", border: "1px solid #7c3aed20" }}
              >
                {sceneTtsLoading ? "생성 중..." : "나레이션 생성"}
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="font-medium" style={{ color: "#787fff" }}>카메라: </span>
            {cut.cameraDirection}
          </div>
          <div>
            <span className="font-medium" style={{ color: "#c4b800" }}>조명: </span>
            {cut.moodLighting}
          </div>
        </div>

        {/* Camera Preset Selector */}
        <div>
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="text-[10px] px-2 py-1 rounded-md transition-colors"
            style={{ background: "#787fff10", color: "#787fff", border: "1px solid #787fff20" }}
          >
            {showPresets ? "프리셋 닫기" : "카메라 프리셋 적용"}
          </button>
          {showPresets && (
            <div className="mt-2 p-2 rounded-lg space-y-2" style={{ background: "#787fff05", border: "1px solid #787fff15" }}>
              {Object.entries(
                cameraPresets.reduce<Record<string, CameraPreset[]>>((acc, p) => {
                  if (!acc[p.category]) acc[p.category] = [];
                  acc[p.category].push(p);
                  return acc;
                }, {})
              ).map(([cat, presets]) => (
                <div key={cat}>
                  <p className="text-[10px] font-medium mb-1" style={{ color: "#787fff" }}>
                    {categoryLabels[cat] || cat}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {presets.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => {
                          if (onUpdate) {
                            onUpdate({
                              ...cut,
                              cameraDirection: preset.cameraDirection,
                              videoPrompt: cut.videoPrompt.replace(
                                /Camera[^.]*\./i,
                                preset.cameraDirection + "."
                              ),
                            });
                          }
                          setShowPresets(false);
                        }}
                        className="text-[10px] px-2 py-1 rounded-md transition-all hover:scale-105"
                        style={{
                          background: "#fff",
                          border: "1px solid #787fff30",
                          color: "#333",
                        }}
                        title={`${preset.description}\n적합: ${preset.bestFor}\n\n${preset.cameraDirection}`}
                      >
                        {preset.nameKo}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 모션 강도 컨트롤 */}
        {onUpdate && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium" style={{ color: "#787fff" }}>모션:</span>
            <div className="flex gap-0.5">
              {motionLevels.map((ml) => (
                <button
                  key={ml.level}
                  onClick={() => {
                    const currentKeywords = motionLevels.find((m) =>
                      cut.cameraDirection.toLowerCase().includes(m.cameraKeywords.split(",")[0].trim().toLowerCase())
                    );
                    let newDirection = cut.cameraDirection;
                    if (currentKeywords) {
                      newDirection = newDirection.replace(
                        new RegExp(currentKeywords.cameraKeywords.split(",")[0].trim(), "i"),
                        ml.cameraKeywords.split(",")[0].trim()
                      );
                    }
                    onUpdate({ ...cut, cameraDirection: newDirection });
                  }}
                  className="text-[9px] px-1.5 py-0.5 rounded transition-all"
                  style={{
                    background: cut.cameraDirection.toLowerCase().includes(ml.cameraKeywords.split(",")[0].trim().toLowerCase().slice(0, 10))
                      ? "#787fff" : "#f5f5f5",
                    color: cut.cameraDirection.toLowerCase().includes(ml.cameraKeywords.split(",")[0].trim().toLowerCase().slice(0, 10))
                      ? "white" : "#666",
                  }}
                  title={ml.description}
                >
                  {ml.nameKo}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Enhancement 2: Feedback loop + Enhancement 3: English refine */}
        <div className="flex gap-1.5 flex-wrap">
          {onFeedbackRefine && (
            <button
              onClick={() => setShowFeedback(!showFeedback)}
              className="text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ background: "#787fff10", color: "#787fff", border: "1px solid #787fff20" }}
            >
              {showFeedback ? "피드백 닫기" : "장면 피드백"}
            </button>
          )}
          {onEnglishRefine && (
            <button
              onClick={async () => {
                setEnglishRefining(true);
                await onEnglishRefine(cut.cutNumber);
                setEnglishRefining(false);
              }}
              disabled={englishRefining}
              className="text-[10px] px-2 py-1 rounded-md transition-colors"
              style={{ background: "#7c3aed10", color: "#7c3aed", border: "1px solid #7c3aed20" }}
            >
              {englishRefining ? "교정 중..." : "영어 네이티브 교정"}
            </button>
          )}
        </div>

        {/* Enhancement 2: Feedback input */}
        {showFeedback && onFeedbackRefine && (
          <div className="space-y-1.5 p-2 rounded-lg" style={{ background: "#787fff08", border: "1px solid #787fff15" }}>
            <Textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={2}
              className="text-xs"
              placeholder="이 장면의 어떤 부분을 수정하고 싶으세요? (예: 카메라 앵글을 더 낮게, 표정을 더 밝게)"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="h-6 text-[10px] text-white"
                style={{ background: "#787fff" }}
                disabled={!feedbackText.trim() || refining}
                onClick={async () => {
                  setRefining(true);
                  await onFeedbackRefine(cut.cutNumber, feedbackText);
                  setRefining(false);
                  setFeedbackText("");
                  setShowFeedback(false);
                }}
              >
                {refining ? "개선 중..." : "프롬프트 개선"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => { setShowFeedback(false); setFeedbackText(""); }}
              >
                취소
              </Button>
            </div>
          </div>
        )}

        <Accordion type="single" collapsible className="w-full">
          {shotSnapshots && (
            <AccordionItem value="comparison" className="border-none">
              <AccordionTrigger className="text-xs py-1 hover:no-underline" style={{ color: "#6b5ce7" }}>
                3-way 비교 (Original / AutoFixed / Final)
              </AccordionTrigger>
              <AccordionContent className="pt-2">
                <ShotComparisonPanel snapshots={shotSnapshots} narrationState={narrationState} />
              </AccordionContent>
            </AccordionItem>
          )}
          <AccordionItem value="prompts" className="border-none">
            <AccordionTrigger className="text-xs py-1 hover:no-underline" style={{ color: "#787fff" }}>
              프롬프트 보기 / 수정하기
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <EditableField
                label="시작 프레임 Image Prompt"
                value={cut.imagePrompt}
                color="#787fff"
                bgColor="#787fff10"
                onSave={(v) => handleFieldSave("imagePrompt", v)}
              />
              <EditableField
                label="끝 프레임 End Image Prompt"
                value={cut.endImagePrompt || ""}
                color="#22c55e"
                bgColor="#22c55e10"
                onSave={(v) => handleFieldSave("endImagePrompt", v)}
              />
              {/* Video Prompt: JSON 뷰 (있으면) + raw string 토글 */}
              {cut.videoPromptJson ? (
                <>
                  <JsonPromptView
                    json={cut.videoPromptJson}
                    label={`Video Prompt (${cut.durationSec}초)`}
                    color="#c4b800"
                    onSaveField={(field, value) => {
                      if (onUpdate && cut.videoPromptJson) {
                        onUpdate({
                          ...cut,
                          videoPromptJson: { ...cut.videoPromptJson, [field]: value },
                        });
                      }
                    }}
                  />
                  {/* Multi-shot payload indicator — shows actual generation structure */}
                  {cut.multiShot && cut.multiShot.length >= 2 && (
                    <div
                      className="rounded-lg p-2 space-y-1"
                      style={{ background: "#e85d0408", border: "1px solid #e85d0420" }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold" style={{ color: "#e85d04" }}>
                          실제 생성 페이로드: {cut.multiShot.length}샷 멀티샷
                        </span>
                        <Badge variant="outline" className="text-[9px] py-0 px-1" style={{ borderColor: "#e85d04", color: "#e85d04" }}>
                          MULTI-SHOT
                        </Badge>
                      </div>
                      {cut.multiShot.map((shot) => (
                        <div key={shot.index} className="flex items-center gap-2 text-[9px]" style={{ color: "#6b7280" }}>
                          <span className="font-mono" style={{ color: "#e85d04", minWidth: 16 }}>#{shot.index}</span>
                          <span style={{ color: "#9ca3af" }}>{shot.duration}s</span>
                          <span className="truncate flex-1">{shot.prompt?.slice(0, 80)}{(shot.prompt?.length ?? 0) > 80 ? "…" : ""}</span>
                          {shot.role && <span className="text-[8px] px-1 rounded" style={{ background: "#e85d0410", color: "#e85d04" }}>{shot.role}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <EditableField
                  label={`Video Prompt (${cut.durationSec}초)`}
                  value={cut.videoPrompt}
                  color="#c4b800"
                  bgColor="#fff78720"
                  onSave={(v) => handleFieldSave("videoPrompt", v)}
                />
              )}
              {cut.cutNumber > 1 && (
                <EditableField
                  label="Extend Prompt (이전 클립 연장)"
                  value={cut.extendPrompt}
                  color="#6b5ce7"
                  bgColor="#6b5ce710"
                  onSave={(v) => handleFieldSave("extendPrompt", v)}
                />
              )}
              <div className="space-y-1">
                <span className="text-xs font-medium" style={{ color: "#e09900" }}>
                  캐릭터 일관성 지침
                </span>
                <p className="text-xs p-2 rounded-md leading-relaxed" style={{ background: "#fff78710", border: "1px dashed #fff78760" }}>
                  {cut.characterConsistency}
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
