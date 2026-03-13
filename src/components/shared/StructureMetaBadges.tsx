"use client";

import type { StructureType, DurationClass } from "@/types";
import { Badge } from "@/components/ui/badge";

interface StructureMetaBadgesProps {
  structureType?: StructureType;
  durationClass?: DurationClass;
  groupId?: string;
  /** true면 현재 CutCard 수준의 작은 뱃지 */
  compact?: boolean;
  className?: string;
}

/**
 * 구조 보조 메타 읽기 전용 뱃지.
 * structureType/durationClass가 있을 때만 표시, 둘 다 없으면 null.
 */
export default function StructureMetaBadges({
  structureType,
  durationClass,
  compact = true,
  className,
}: StructureMetaBadgesProps) {
  if (!structureType && !durationClass) return null;

  const textSize = compact ? "text-[9px]" : "text-[10px]";
  const padding = compact ? "py-0 px-1.5" : "py-0.5 px-2";

  return (
    <>
      {structureType && (
        <Badge
          variant="outline"
          className={`${textSize} ${padding} ${className ?? ""}`}
          style={{ borderColor: "#9ca3af", color: "#6b7280" }}
          title="구조 단위 분류 (보조 메타)"
        >
          {structureType.toUpperCase()}
        </Badge>
      )}
      {durationClass && (
        <Badge
          variant="outline"
          className={`${textSize} ${padding} ${className ?? ""}`}
          style={{ borderColor: "#d1d5db", color: "#9ca3af" }}
          title="duration 기반 길이 분류 (보조 메타)"
        >
          {durationClass}
        </Badge>
      )}
    </>
  );
}
