"use client";

/**
 * StoryboardSketchCanvas — 사용자가 마우스/터치로 구도를 스케치하는 캔버스
 *
 * 기능:
 *   - 펜 (자유 곡선) — 색상/두께 선택
 *   - 지우개
 *   - 실루엣 스탬프 (인물, 사물) — 원하는 위치에 배치
 *   - Rule-of-thirds 가이드 오버레이
 *   - 실행 취소
 *   - 리셋
 *   - PNG export (base64)
 *
 * 출력:
 *   onExport(base64: string) — 스케치 PNG를 base64로 반환
 *   onAnalyze(base64: string) — "구도 분석" 요청 트리거
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

type Tool = "pen" | "eraser" | "stamp";

interface StampDef {
  id: string;
  label: string;
  /** SVG path or emoji for preview */
  preview: string;
  /** Draw function — renders the stamp on canvas */
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void;
}

interface StoryboardSketchCanvasProps {
  /** Canvas width (px) */
  width?: number;
  /** Canvas height (px) */
  height?: number;
  /** 16:9 or 9:16 */
  aspectRatio?: "16:9" | "9:16";
  /** Called when user clicks "구도 분석" with the sketch as base64 PNG */
  onAnalyze?: (base64: string) => void;
  /** Called when sketch is exported as firstFrame */
  onUseAsFirstFrame?: (base64: string) => void;
  /** Loading state for analysis */
  analyzing?: boolean;
  /** Existing storyboard image to use as background */
  backgroundImage?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Stamp Definitions
// ═══════════════════════════════════════════════════════════════════

const STAMPS: StampDef[] = [
  {
    id: "person-standing",
    label: "인물 (서있는)",
    preview: "🧍",
    draw: (ctx, x, y, size) => {
      ctx.save();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      // Head
      ctx.beginPath();
      ctx.arc(x, y - size * 0.35, size * 0.1, 0, Math.PI * 2);
      ctx.stroke();
      // Body
      ctx.beginPath();
      ctx.moveTo(x, y - size * 0.25);
      ctx.lineTo(x, y + size * 0.1);
      ctx.stroke();
      // Arms
      ctx.beginPath();
      ctx.moveTo(x - size * 0.15, y - size * 0.1);
      ctx.lineTo(x, y - size * 0.15);
      ctx.lineTo(x + size * 0.15, y - size * 0.1);
      ctx.stroke();
      // Legs
      ctx.beginPath();
      ctx.moveTo(x, y + size * 0.1);
      ctx.lineTo(x - size * 0.12, y + size * 0.4);
      ctx.moveTo(x, y + size * 0.1);
      ctx.lineTo(x + size * 0.12, y + size * 0.4);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: "person-sitting",
    label: "인물 (앉은)",
    preview: "🪑",
    draw: (ctx, x, y, size) => {
      ctx.save();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      // Head
      ctx.beginPath();
      ctx.arc(x, y - size * 0.25, size * 0.1, 0, Math.PI * 2);
      ctx.stroke();
      // Body (seated — shorter torso)
      ctx.beginPath();
      ctx.moveTo(x, y - size * 0.15);
      ctx.lineTo(x, y + size * 0.05);
      ctx.stroke();
      // Arms resting
      ctx.beginPath();
      ctx.moveTo(x - size * 0.18, y + size * 0.05);
      ctx.lineTo(x, y - size * 0.05);
      ctx.lineTo(x + size * 0.18, y + size * 0.05);
      ctx.stroke();
      // Legs (bent)
      ctx.beginPath();
      ctx.moveTo(x, y + size * 0.05);
      ctx.lineTo(x - size * 0.15, y + size * 0.15);
      ctx.lineTo(x - size * 0.15, y + size * 0.35);
      ctx.moveTo(x, y + size * 0.05);
      ctx.lineTo(x + size * 0.15, y + size * 0.15);
      ctx.lineTo(x + size * 0.15, y + size * 0.35);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: "object-box",
    label: "사물 (박스)",
    preview: "📦",
    draw: (ctx, x, y, size) => {
      ctx.save();
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 2;
      const s = size * 0.3;
      ctx.strokeRect(x - s, y - s, s * 2, s * 2);
      // 3D hint
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x - s * 0.6, y - s * 1.3);
      ctx.lineTo(x + s * 1.4, y - s * 1.3);
      ctx.lineTo(x + s, y - s);
      ctx.moveTo(x + s * 1.4, y - s * 1.3);
      ctx.lineTo(x + s * 1.4, y + s * 0.7);
      ctx.lineTo(x + s, y + s);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    id: "camera-icon",
    label: "카메라 방향",
    preview: "🎥",
    draw: (ctx, x, y, size) => {
      ctx.save();
      ctx.strokeStyle = "#e85d04";
      ctx.lineWidth = 2;
      // Triangle (camera direction arrow)
      const s = size * 0.25;
      ctx.beginPath();
      ctx.moveTo(x + s * 1.5, y);
      ctx.lineTo(x - s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.closePath();
      ctx.stroke();
      // Circle
      ctx.beginPath();
      ctx.arc(x - s * 0.3, y, s * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },
  },
];

// ═══════════════════════════════════════════════════════════════════
// Pen Colors & Sizes
// ═══════════════════════════════════════════════════════════════════

const PEN_COLORS = [
  { color: "#222222", label: "검정" },
  { color: "#e63946", label: "빨강" },
  { color: "#457b9d", label: "파랑" },
  { color: "#2a9d8f", label: "초록" },
  { color: "#e9c46a", label: "노랑" },
  { color: "#f4a261", label: "주황" },
];

const PEN_SIZES = [2, 4, 6, 10];

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export default function StoryboardSketchCanvas({
  width: propWidth,
  height: propHeight,
  aspectRatio = "16:9",
  onAnalyze,
  onUseAsFirstFrame,
  analyzing = false,
  backgroundImage,
}: StoryboardSketchCanvasProps) {
  // Compute canvas dimensions from aspect ratio
  const baseWidth = propWidth ?? 480;
  const width = baseWidth;
  const height = propHeight ?? (aspectRatio === "16:9" ? Math.round(baseWidth * 9 / 16) : Math.round(baseWidth * 16 / 9));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [penColor, setPenColor] = useState("#222222");
  const [penSize, setPenSize] = useState(4);
  const [selectedStamp, setSelectedStamp] = useState<string>("person-standing");
  const [showGuides, setShowGuides] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [hasDrawn, setHasDrawn] = useState(false);

  // ── Initialize canvas ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Load background image if provided
    if (backgroundImage) {
      const img = new Image();
      img.onload = () => {
        ctx.globalAlpha = 0.3;
        ctx.drawImage(img, 0, 0, width, height);
        ctx.globalAlpha = 1.0;
        saveToHistory();
      };
      img.src = backgroundImage.startsWith("data:") ? backgroundImage : `data:image/png;base64,${backgroundImage}`;
    } else {
      saveToHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, backgroundImage]);

  // ── History for undo ──
  const saveToHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, width, height);
    setHistory(prev => [...prev.slice(-20), imageData]);
  }, [width, height]);

  const handleUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (history.length <= 1) return;
    const prev = history[history.length - 2];
    ctx.putImageData(prev, 0, 0);
    setHistory(h => h.slice(0, -1));
  }, [history]);

  const handleReset = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    setHistory([]);
    setHasDrawn(false);
    saveToHistory();
  }, [width, height, saveToHistory]);

  // ── Drawing handlers ──
  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (tool === "stamp") {
      // Place stamp at click position
      const { x, y } = getPos(e);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const stamp = STAMPS.find(s => s.id === selectedStamp);
      if (stamp) {
        stamp.draw(ctx, x, y, Math.min(width, height) * 0.4);
        saveToHistory();
        setHasDrawn(true);
      }
      return;
    }

    setIsDrawing(true);
    const { x, y } = getPos(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || tool === "stamp") return;
    const { x, y } = getPos(e);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = penSize * 3;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize;
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = "source-over";
    saveToHistory();
  };

  // ── Export ──
  const exportAsBase64 = useCallback((): string => {
    const canvas = canvasRef.current;
    if (!canvas) return "";
    return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  }, []);

  const handleAnalyze = () => {
    if (onAnalyze) onAnalyze(exportAsBase64());
  };

  const handleUseAsFirstFrame = () => {
    if (onUseAsFirstFrame) onUseAsFirstFrame(exportAsBase64());
  };

  // ── Render guide overlay ──
  const renderGuides = () => {
    if (!showGuides) return null;
    return (
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "100%" }}
      >
        {/* Rule of thirds */}
        <line x1={width / 3} y1={0} x2={width / 3} y2={height} stroke="#e85d04" strokeWidth="0.5" strokeDasharray="4 4" opacity={0.5} />
        <line x1={width * 2 / 3} y1={0} x2={width * 2 / 3} y2={height} stroke="#e85d04" strokeWidth="0.5" strokeDasharray="4 4" opacity={0.5} />
        <line x1={0} y1={height / 3} x2={width} y2={height / 3} stroke="#e85d04" strokeWidth="0.5" strokeDasharray="4 4" opacity={0.5} />
        <line x1={0} y1={height * 2 / 3} x2={width} y2={height * 2 / 3} stroke="#e85d04" strokeWidth="0.5" strokeDasharray="4 4" opacity={0.5} />
        {/* Center crosshair */}
        <circle cx={width / 2} cy={height / 2} r={3} fill="none" stroke="#e85d04" strokeWidth="0.5" opacity={0.3} />
        {/* Horizon line label */}
        <text x={4} y={height / 2 - 4} fill="#e85d04" fontSize={9} opacity={0.4}>수평선</text>
      </svg>
    );
  };

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1">
        {/* Tool selection */}
        <div className="flex gap-0.5 mr-2">
          <Button
            variant={tool === "pen" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setTool("pen")}
          >
            ✏️ 펜
          </Button>
          <Button
            variant={tool === "eraser" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setTool("eraser")}
          >
            🧹 지우개
          </Button>
          <Button
            variant={tool === "stamp" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => setTool("stamp")}
          >
            👤 스탬프
          </Button>
        </div>

        {/* Pen colors (only when pen tool) */}
        {tool === "pen" && (
          <div className="flex gap-0.5 mr-2">
            {PEN_COLORS.map(c => (
              <button
                key={c.color}
                className="w-5 h-5 rounded-full border-2 transition-transform"
                style={{
                  backgroundColor: c.color,
                  borderColor: penColor === c.color ? "#fff" : "transparent",
                  boxShadow: penColor === c.color ? `0 0 0 2px ${c.color}` : "none",
                  transform: penColor === c.color ? "scale(1.2)" : "scale(1)",
                }}
                title={c.label}
                onClick={() => setPenColor(c.color)}
              />
            ))}
          </div>
        )}

        {/* Pen size (pen/eraser) */}
        {(tool === "pen" || tool === "eraser") && (
          <div className="flex gap-0.5 mr-2">
            {PEN_SIZES.map(s => (
              <button
                key={s}
                className="flex items-center justify-center w-6 h-6 rounded border transition-colors"
                style={{
                  borderColor: penSize === s ? "#e85d04" : "#555",
                  backgroundColor: penSize === s ? "rgba(232,93,4,0.1)" : "transparent",
                }}
                onClick={() => setPenSize(s)}
              >
                <div
                  className="rounded-full bg-current"
                  style={{
                    width: Math.min(s + 1, 10),
                    height: Math.min(s + 1, 10),
                    color: tool === "pen" ? penColor : "#999",
                  }}
                />
              </button>
            ))}
          </div>
        )}

        {/* Stamp selection (only when stamp tool) */}
        {tool === "stamp" && (
          <div className="flex gap-0.5 mr-2">
            {STAMPS.map(s => (
              <Button
                key={s.id}
                variant={selectedStamp === s.id ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => setSelectedStamp(s.id)}
              >
                {s.preview} {s.label}
              </Button>
            ))}
          </div>
        )}

        {/* Guide toggle */}
        <Button
          variant={showGuides ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs px-2"
          onClick={() => setShowGuides(!showGuides)}
        >
          격자
        </Button>

        {/* Undo / Reset */}
        <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={handleUndo} disabled={history.length <= 1}>
          ↩ 되돌리기
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={handleReset}>
          🗑 초기화
        </Button>
      </div>

      {/* Canvas */}
      <div className="relative border border-zinc-700 rounded overflow-hidden" style={{ maxWidth: width }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="cursor-crosshair touch-none"
          style={{ width: "100%", height: "auto" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {renderGuides()}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          style={{ borderColor: "#e85d04", color: "#e85d04" }}
          onClick={handleAnalyze}
          disabled={!hasDrawn || analyzing}
        >
          {analyzing ? "분석 중..." : "🔍 구도 분석"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={handleUseAsFirstFrame}
          disabled={!hasDrawn}
        >
          🎬 시작 프레임으로 사용
        </Button>
      </div>

      {tool === "stamp" && (
        <p className="text-[10px] text-zinc-500">캔버스를 클릭하면 선택한 스탬프가 배치됩니다</p>
      )}
    </div>
  );
}
