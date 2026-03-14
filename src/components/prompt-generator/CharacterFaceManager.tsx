"use client";

import { useState, useCallback, useRef } from "react";
import type { CharacterSeed, CharacterFaceRef, KlingElementAsset } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createKlingElement,
  createElementAsset,
  upsertElementAsset,
  pollElementUntilDone,
  canCreateElement,
  getElementUnavailableReason,
} from "@/lib/kling-element-store";

interface CharacterFaceManagerProps {
  characterSeeds: CharacterSeed[];
  storyboardImages: Record<number, string>;
  faceRefs: CharacterFaceRef[];
  onFaceRefsChange: (refs: CharacterFaceRef[]) => void;
  elementAssets: KlingElementAsset[];
  onElementAssetsChange: React.Dispatch<React.SetStateAction<KlingElementAsset[]>>;
}

export default function CharacterFaceManager({
  characterSeeds,
  storyboardImages,
  faceRefs,
  onFaceRefsChange,
  elementAssets,
  onElementAssetsChange,
}: CharacterFaceManagerProps) {
  const [extracting, setExtracting] = useState<number | null>(null);
  const [autoExtractingAll, setAutoExtractingAll] = useState(false);
  const [creatingElement, setCreatingElement] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 이미지에서 얼굴 영역 크롭
  const cropFace = useCallback(
    async (
      imageBase64: string,
      box: { x: number; y: number; width: number; height: number }
    ): Promise<string> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = canvasRef.current || document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve("");
            return;
          }

          // 바운딩 박스를 픽셀로 변환 (여백 10% 추가로 자연스러운 크롭)
          const margin = 0.1;
          const rawX = box.x - box.width * margin;
          const rawY = box.y - box.height * margin;
          const rawW = box.width * (1 + margin * 2);
          const rawH = box.height * (1 + margin * 2);

          // 정사각형으로 확장 (얼굴이 프레임 채우도록)
          const maxDim = Math.max(rawW * img.width, rawH * img.height);
          const centerX = (rawX + rawW / 2) * img.width;
          const centerY = (rawY + rawH / 2) * img.height;

          // 소스 정사각형 영역 (이미지 범위 클램핑)
          const sx = Math.max(0, Math.round(centerX - maxDim / 2));
          const sy = Math.max(0, Math.round(centerY - maxDim / 2));
          const sSize = Math.round(Math.min(maxDim, img.width - sx, img.height - sy));

          // 최소 크기 검증 (너무 작은 얼굴 방지)
          if (sSize < 64) {
            resolve("");
            return;
          }

          // 512px 정사각형으로 출력 (Veo reference image 최적)
          const outSize = 512;
          canvas.width = outSize;
          canvas.height = outSize;

          ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, outSize, outSize);

          const croppedBase64 = canvas.toDataURL("image/png").split(",")[1];
          resolve(croppedBase64);
        };
        img.src = `data:image/png;base64,${imageBase64}`;
      });
    },
    []
  );

  // 단일 장면에서 얼굴 추출
  const extractFromScene = useCallback(
    async (cutNumber: number) => {
      const imageBase64 = storyboardImages[cutNumber];
      if (!imageBase64) return;

      setExtracting(cutNumber);

      try {
        const res = await fetch("/api/extract-face", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64,
            characterSeeds: characterSeeds.map((s) => ({
              id: s.id,
              label: s.label,
              appearance: s.appearance,
            })),
          }),
        });

        if (!res.ok) throw new Error("API error");

        const data = await res.json();
        const faces = data.faces || [];

        const newRefs: CharacterFaceRef[] = [];

        for (const face of faces) {
          if (!face.boundingBox) continue;

          const faceBase64 = await cropFace(imageBase64, face.boundingBox);
          if (!faceBase64) continue;

          // 이미 같은 캐릭터의 레퍼런스가 있으면 교체
          const charId =
            face.characterId ||
            characterSeeds[newRefs.length]?.id ||
            `char-${newRefs.length + 1}`;

          newRefs.push({
            characterId: charId,
            faceBase64,
            sourceCutNumber: cutNumber,
            boundingBox: face.boundingBox,
          });
        }

        if (newRefs.length > 0) {
          // 기존 refs에서 같은 캐릭터 ID 제거하고 새로운 것 추가
          const existingFiltered = faceRefs.filter(
            (ref) => !newRefs.some((n) => n.characterId === ref.characterId)
          );
          onFaceRefsChange([...existingFiltered, ...newRefs]);
        }
      } catch (error) {
        console.error("Face extraction failed:", error);
      }

      setExtracting(null);
    },
    [storyboardImages, characterSeeds, faceRefs, onFaceRefsChange, cropFace]
  );

  // 모든 장면에서 자동 추출
  const autoExtractAll = useCallback(async () => {
    setAutoExtractingAll(true);
    const cutNumbers = Object.keys(storyboardImages).map(Number).sort((a, b) => a - b);

    // 첫 번째 스토리보드 이미지에서만 추출 (일관성 위해)
    if (cutNumbers.length > 0) {
      await extractFromScene(cutNumbers[0]);
    }

    setAutoExtractingAll(false);
  }, [storyboardImages, extractFromScene]);

  // 수동 업로드
  const handleManualUpload = useCallback(
    (characterId: string, e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        const existingFiltered = faceRefs.filter(
          (ref) => ref.characterId !== characterId
        );
        onFaceRefsChange([
          ...existingFiltered,
          {
            characterId,
            faceBase64: base64,
            sourceCutNumber: 0, // 수동 업로드
          },
        ]);
      };
      reader.readAsDataURL(file);
    },
    [faceRefs, onFaceRefsChange]
  );

  // 레퍼런스 삭제
  const removeFaceRef = useCallback(
    (characterId: string) => {
      onFaceRefsChange(faceRefs.filter((ref) => ref.characterId !== characterId));
    },
    [faceRefs, onFaceRefsChange]
  );

  // Kling Element 생성
  const handleCreateElement = useCallback(
    async (characterId: string) => {
      const faceRef = faceRefs.find((r) => r.characterId === characterId);
      if (!faceRef || !canCreateElement(faceRef.faceBase64)) return;

      const seed = characterSeeds.find((s) => s.id === characterId);
      setCreatingElement(characterId);

      try {
        const { taskId } = await createKlingElement({
          characterId,
          elementName: seed?.label || characterId,
          elementDescription: seed?.appearance,
          frontalImage: faceRef.faceBase64,
          referenceType: "image_refer",
        });

        // 즉시 pending asset 추가
        const newAsset = createElementAsset({
          characterId,
          taskId,
          elementName: seed?.label || characterId,
          elementDescription: seed?.appearance || "",
          sourceType: "image_refer",
        });
        onElementAssetsChange(upsertElementAsset(elementAssets, newAsset));

        // 백그라운드 폴링 시작
        pollElementUntilDone(taskId, (update) => {
          onElementAssetsChange((prev) => {
            const existing = prev.find((a) => a.taskId === taskId);
            if (!existing) return prev;
            const updated: KlingElementAsset = {
              ...existing,
              status: update.status,
              elementId: update.elementId,
              error: update.error ?? undefined,
              ...(update.status === "completed" ? { completedAt: Date.now() } : {}),
            };
            return upsertElementAsset(prev, updated);
          });
        }).catch((err) => {
          console.error("[CharacterFaceManager] element poll error:", err);
        });
      } catch (err) {
        console.error("[CharacterFaceManager] element create error:", err);
      } finally {
        setCreatingElement(null);
      }
    },
    [faceRefs, characterSeeds, elementAssets, onElementAssetsChange]
  );

  const hasStoryboards = Object.keys(storyboardImages).length > 0;

  // Element 상태 뱃지 렌더링
  const renderElementBadge = (characterId: string) => {
    const asset = elementAssets.find((a) => a.characterId === characterId);
    if (!asset) return null;

    const statusConfig: Record<string, { bg: string; color: string; label: string }> = {
      pending: { bg: "#fef3c720", color: "#d97706", label: "생성 대기" },
      processing: { bg: "#dbeafe20", color: "#2563eb", label: "생성 중..." },
      completed: { bg: "#dcfce720", color: "#16a34a", label: "Element 완료" },
      failed: { bg: "#fee2e220", color: "#dc2626", label: "생성 실패" },
    };
    const cfg = statusConfig[asset.status] || statusConfig.pending;

    return (
      <Badge
        className="text-[8px] py-0"
        style={{ background: cfg.bg, color: cfg.color }}
      >
        {(asset.status === "pending" || asset.status === "processing") && (
          <span className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent mr-1" />
        )}
        {cfg.label}
      </Badge>
    );
  };

  return (
    <Card className="overflow-hidden border-2" style={{ borderColor: "#ff6b6b40" }}>
      <CardHeader
        className="pb-2"
        style={{
          background: "linear-gradient(135deg, #ff6b6b15, #ee5a2415)",
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm" style={{ color: "#d63031" }}>
              캐릭터 얼굴 고정
            </CardTitle>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              스토리보드에서 얼굴을 추출하고 Kling Element를 생성하여 캐릭터 일관성을 유지합니다
            </p>
          </div>
          {hasStoryboards && (
            <Button
              size="sm"
              onClick={autoExtractAll}
              disabled={autoExtractingAll || extracting !== null}
              className="text-[11px] text-white"
              style={{ background: "#d63031" }}
            >
              {autoExtractingAll ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  추출 중...
                </span>
              ) : (
                "자동 얼굴 추출"
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-3">
        {/* 추출된 얼굴 레퍼런스 */}
        {faceRefs.length > 0 && (
          <div className="space-y-2">
            <p
              className="text-[10px] font-medium"
              style={{ color: "#d63031" }}
            >
              추출된 얼굴 ({faceRefs.length}명) — Kling Element 생성 후 영상에 자동 주입됩니다
            </p>
            <div className="flex gap-3 flex-wrap">
              {faceRefs.map((ref) => {
                const seed = characterSeeds.find(
                  (s) => s.id === ref.characterId
                );
                const asset = elementAssets.find(
                  (a) => a.characterId === ref.characterId
                );
                return (
                  <div key={ref.characterId} className="text-center group">
                    <div
                      className="relative w-20 h-20 rounded-xl overflow-hidden border-2 shadow-sm"
                      style={{ borderColor: asset?.status === "completed" ? "#22c55e60" : "#ff6b6b60" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:image/png;base64,${ref.faceBase64}`}
                        alt={seed?.label || ref.characterId}
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => removeFaceRef(ref.characterId)}
                        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        X
                      </button>
                      <Badge
                        className="absolute bottom-0.5 left-0.5 text-[8px] py-0 text-white"
                        style={{ background: asset?.status === "completed" ? "#16a34acc" : "#d63031cc" }}
                      >
                        {asset?.status === "completed" ? "ELM" : "REF"}
                      </Badge>
                    </div>
                    <p className="text-[10px] font-medium mt-1">
                      {seed?.label || ref.characterId}
                    </p>
                    {ref.sourceCutNumber > 0 && (
                      <p className="text-[9px] text-muted-foreground">
                        CUT {ref.sourceCutNumber}에서 추출
                      </p>
                    )}
                    {ref.sourceCutNumber === 0 && (
                      <p className="text-[9px] text-muted-foreground">
                        직접 업로드
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 캐릭터별 수동 업로드 / 장면에서 추출 / Element 생성 */}
        <div className="space-y-2">
          {characterSeeds.map((seed) => {
            const hasRef = faceRefs.some((r) => r.characterId === seed.id);
            const faceRef = faceRefs.find((r) => r.characterId === seed.id);
            const asset = elementAssets.find((a) => a.characterId === seed.id);
            const fileInputId = `face-upload-${seed.id}`;
            const unavailableReason = getElementUnavailableReason(faceRef?.faceBase64);
            const isCreating = creatingElement === seed.id;
            const isElementInProgress = asset?.status === "pending" || asset?.status === "processing";

            return (
              <div
                key={seed.id}
                className="flex items-center gap-2 p-2 rounded-lg"
                style={{
                  background: asset?.status === "completed" ? "#22c55e08" : hasRef ? "#ff6b6b08" : "#f8f8f8",
                  border: asset?.status === "completed"
                    ? "1px solid #22c55e20"
                    : hasRef
                    ? "1px solid #ff6b6b20"
                    : "1px dashed #ddd",
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge
                      className="text-[9px] text-white py-0"
                      style={{
                        background: asset?.status === "completed" ? "#16a34a" : hasRef ? "#d63031" : "#999",
                      }}
                    >
                      {seed.id}
                    </Badge>
                    <span className="text-xs font-medium">{seed.label}</span>
                    {hasRef && !asset && (
                      <Badge
                        className="text-[8px] py-0"
                        style={{
                          background: "#22c55e15",
                          color: "#16a34a",
                        }}
                      >
                        고정됨
                      </Badge>
                    )}
                    {renderElementBadge(seed.id)}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {seed.appearanceKo}
                  </p>
                  {asset?.status === "failed" && asset.error && (
                    <p className="text-[9px] text-red-500 mt-0.5">{asset.error}</p>
                  )}
                </div>

                <div className="flex gap-1.5 shrink-0">
                  {/* Kling Element 생성 */}
                  {hasRef && !asset?.elementId && (
                    <button
                      className="text-[10px] px-2 py-1 rounded-md"
                      style={{
                        background: unavailableReason ? "#99999910" : "#8b5cf610",
                        color: unavailableReason ? "#999" : "#7c3aed",
                        border: unavailableReason ? "1px solid #99999920" : "1px solid #8b5cf620",
                      }}
                      disabled={!!unavailableReason || isCreating || isElementInProgress}
                      onClick={() => handleCreateElement(seed.id)}
                      title={unavailableReason || "Kling Custom Element 생성"}
                    >
                      {isCreating || isElementInProgress ? (
                        <span className="flex items-center gap-1">
                          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                          생성 중
                        </span>
                      ) : asset?.status === "failed" ? (
                        "재시도"
                      ) : (
                        "Element 생성"
                      )}
                    </button>
                  )}

                  {/* Element 완료 표시 */}
                  {asset?.elementId && (
                    <span className="text-[9px] px-2 py-1 rounded-md" style={{ background: "#dcfce7", color: "#16a34a" }}>
                      ID: {asset.elementId.slice(0, 8)}...
                    </span>
                  )}

                  {/* 스토리보드에서 추출 */}
                  {hasStoryboards && (
                    <div className="relative group/dropdown">
                      <button
                        className="text-[10px] px-2 py-1 rounded-md"
                        style={{
                          background: "#ff6b6b10",
                          color: "#d63031",
                          border: "1px solid #ff6b6b20",
                        }}
                        disabled={extracting !== null}
                      >
                        장면에서 추출
                      </button>
                      <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border p-1 hidden group-hover/dropdown:block z-20 min-w-[100px]">
                        {Object.keys(storyboardImages)
                          .map(Number)
                          .sort((a, b) => a - b)
                          .map((cutNum) => (
                            <button
                              key={cutNum}
                              onClick={() => extractFromScene(cutNum)}
                              disabled={extracting === cutNum}
                              className="block w-full text-left px-2 py-1 text-[10px] rounded hover:bg-gray-50"
                            >
                              {extracting === cutNum
                                ? "추출 중..."
                                : `CUT ${cutNum}`}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* 직접 업로드 */}
                  <label
                    htmlFor={fileInputId}
                    className="text-[10px] px-2 py-1 rounded-md cursor-pointer"
                    style={{
                      background: "#787fff10",
                      color: "#787fff",
                      border: "1px solid #787fff20",
                    }}
                  >
                    업로드
                  </label>
                  <input
                    id={fileInputId}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleManualUpload(seed.id, e)}
                    className="hidden"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {!hasStoryboards && faceRefs.length === 0 && (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            스토리보드 이미지를 먼저 생성하면, 캐릭터 얼굴을 자동으로 추출할 수 있습니다.
            <br />
            또는 직접 캐릭터 얼굴 이미지를 업로드하세요.
          </p>
        )}

        {/* 히든 캔버스 */}
        <canvas ref={canvasRef} className="hidden" />
      </CardContent>
    </Card>
  );
}
