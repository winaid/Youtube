"use client";

import { useState, useCallback, useRef } from "react";
import { CharacterSeed, CharacterFaceRef } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface CharacterFaceManagerProps {
  characterSeeds: CharacterSeed[];
  storyboardImages: Record<number, string>;
  faceRefs: CharacterFaceRef[];
  onFaceRefsChange: (refs: CharacterFaceRef[]) => void;
}

export default function CharacterFaceManager({
  characterSeeds,
  storyboardImages,
  faceRefs,
  onFaceRefsChange,
}: CharacterFaceManagerProps) {
  const [extracting, setExtracting] = useState<number | null>(null);
  const [autoExtractingAll, setAutoExtractingAll] = useState(false);
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

          // 바운딩 박스를 픽셀로 변환
          const sx = Math.round(box.x * img.width);
          const sy = Math.round(box.y * img.height);
          const sw = Math.round(box.width * img.width);
          const sh = Math.round(box.height * img.height);

          // 정사각형에 가깝게 크롭 (reference image 최적화)
          const size = Math.max(sw, sh);
          canvas.width = size;
          canvas.height = size;

          // 중앙 정렬
          const offsetX = (size - sw) / 2;
          const offsetY = (size - sh) / 2;

          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, sx, sy, sw, sh, offsetX, offsetY, sw, sh);

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

  const hasStoryboards = Object.keys(storyboardImages).length > 0;

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
              스토리보드에서 얼굴을 추출하여 모든 장면의 reference image로 자동 주입합니다
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
              추출된 얼굴 ({faceRefs.length}명) — 영상 생성 시 자동 주입됩니다
            </p>
            <div className="flex gap-3 flex-wrap">
              {faceRefs.map((ref) => {
                const seed = characterSeeds.find(
                  (s) => s.id === ref.characterId
                );
                return (
                  <div key={ref.characterId} className="text-center group">
                    <div
                      className="relative w-20 h-20 rounded-xl overflow-hidden border-2 shadow-sm"
                      style={{ borderColor: "#ff6b6b60" }}
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
                        style={{ background: "#d63031cc" }}
                      >
                        REF
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

        {/* 캐릭터별 수동 업로드 / 장면에서 추출 */}
        <div className="space-y-2">
          {characterSeeds.map((seed) => {
            const hasRef = faceRefs.some((r) => r.characterId === seed.id);
            const fileInputId = `face-upload-${seed.id}`;

            return (
              <div
                key={seed.id}
                className="flex items-center gap-2 p-2 rounded-lg"
                style={{
                  background: hasRef ? "#ff6b6b08" : "#f8f8f8",
                  border: hasRef
                    ? "1px solid #ff6b6b20"
                    : "1px dashed #ddd",
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge
                      className="text-[9px] text-white py-0"
                      style={{
                        background: hasRef ? "#d63031" : "#999",
                      }}
                    >
                      {seed.id}
                    </Badge>
                    <span className="text-xs font-medium">{seed.label}</span>
                    {hasRef && (
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
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {seed.appearanceKo}
                  </p>
                </div>

                <div className="flex gap-1.5 shrink-0">
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
