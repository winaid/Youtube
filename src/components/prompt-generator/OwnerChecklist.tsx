"use client";

/**
 * OwnerChecklist — 오너 반복 검증용 체크리스트 UI
 *
 * 접이식 패널. 하루 동안 여러 시나리오를 돌릴 때
 * 바로 체크/해제하며 품질을 추적.
 * localStorage에 상태 유지.
 */

import { useState, useEffect, useCallback } from "react";
import {
  OWNER_CHECKLIST,
  loadCheckState,
  saveCheckState,
  resetCheckState,
} from "@/data/owner-checklist";

export default function OwnerChecklist() {
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setChecks(loadCheckState());
  }, []);

  const toggle = useCallback((id: string) => {
    setChecks(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveCheckState(next);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    resetCheckState();
    setChecks({});
  }, []);

  const totalItems = OWNER_CHECKLIST.reduce((s, c) => s + c.items.length, 0);
  const checkedCount = Object.values(checks).filter(Boolean).length;

  return (
    <div className="border border-zinc-700 rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors text-zinc-300"
      >
        <span className="flex items-center gap-2">
          <span className="text-[10px]">{open ? "▼" : "▶"}</span>
          <span className="font-semibold tracking-wide">검증 체크리스트</span>
        </span>
        <span className="text-zinc-500">
          {checkedCount}/{totalItems}
          {checkedCount === totalItems && totalItems > 0 && (
            <span className="ml-1 text-green-400">완료</span>
          )}
        </span>
      </button>

      {open && (
        <div className="px-3 py-2 bg-zinc-900/90 space-y-3">
          {OWNER_CHECKLIST.map(cat => (
            <div key={cat.id}>
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1 font-semibold">
                {cat.title}
              </div>
              <div className="space-y-0.5 pl-1">
                {cat.items.map(item => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-zinc-800/50 rounded px-1 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={!!checks[item.id]}
                      onChange={() => toggle(item.id)}
                      className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className={checks[item.id] ? "text-zinc-500 line-through" : "text-zinc-300"}>
                      {item.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div className="pt-1 border-t border-zinc-800 flex justify-end">
            <button
              onClick={handleReset}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-500 text-[10px] transition-colors"
            >
              전체 초기화
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
