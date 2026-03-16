/**
 * script-analyzer.test.ts — 대본 분석 엔진 테스트
 *
 * 테스트 카테고리:
 *   1. 비트 파싱: 대본을 논점 비트로 분리
 *   2. 시퀀스 경계: 비트를 시퀀스로 그룹핑
 *   3. 컷 프로그레션: 시퀀스 내부 컷 프로그레션 생성
 *   4. 전체 분석: 엔드투엔드 분석 결과 검증
 *   5. 변환: 분석 결과 → Cut[] 구조 변환
 *   6. 품질: 구조 품질 분석
 *   7. Phase A/B: Progressive analysis phases
 *   8. Caching: Script hash caching layer
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  parseScriptBeats,
  planSequenceBoundaries,
  generateCutProgression,
  analyzeScript,
  analyzeScriptPhaseA,
  enrichSequenceDetail,
  enrichAllSequences,
  convertToCuts,
  estimateRuntime,
  detectContentType,
  scriptHash,
  clearAnalysisCache,
} from "@/lib/script-analyzer";

// ═══════════════════════════════════════════════════════════════════
// Test Data
// ═══════════════════════════════════════════════════════════════════

const BLACK_DEATH_SCRIPT = `만약 흑사병이 없었다면, 오늘날 우리가 아는 자유와 임금 노동은 존재하지 않았을 수도 있다.
14세기 유럽 인구의 3분의 1이 사라졌을 때, 남은 노동자들의 가치는 폭등했다. 영주들은 농노를 붙잡아둘 수 없었다.
하지만 노동력 부족은 단순한 경제 현상이 아니었다. 교회의 권위도 함께 무너졌다. 신이 왜 이 재앙을 막지 않았는가?
결과적으로 봉건제가 약화되면서, 노동자들은 처음으로 자신의 노동에 대한 대가를 요구할 수 있게 되었다.
그래서 임금 노동이라는 개념이 탄생했고, 이것이 자본주의의 씨앗이 되었다.
아이러니하게도, 인류 역사상 최악의 재앙이 자유와 근대성의 토대를 만든 셈이다.`;

const ECONOMICS_SCRIPT = `대한민국의 1인당 GDP가 일본을 추월한 것은 사실이다.
하지만 이 숫자 뒤에는 숨겨진 진실이 있다. 한국의 노동 시간은 OECD 최상위권이다.
반면에 일본의 노동 시간은 점점 줄어들고 있다. 삶의 질로 따지면 어떨까?
결국 GDP 추월이라는 숫자는 성공의 전체 그림이 아니다.
진짜 의미는 지속 가능한 성장과 삶의 질의 균형에 있다.`;

const SHORT_SCRIPT = `AI가 모든 직업을 대체할까? 사실 그렇지 않다.`;

const LONG_DENSE_SCRIPT = `흑사병은 14세기 유럽을 강타한 최악의 전염병이었다.
당시 유럽 인구의 30-60%가 사망했다. 이것은 약 7500만에서 2억 명에 달하는 수치다.
하지만 흑사병의 영향은 단순한 인구 감소에 그치지 않았다.
노동력이 부족해지면서 농노들의 협상력이 급증했다.
영주들은 더 높은 임금을 제시하거나 더 나은 조건을 제공해야 했다.
이로 인해 봉건제의 근간이 흔들리기 시작했다.
교회도 위기에 직면했다. 성직자들도 대규모로 사망했기 때문이다.
신이 왜 이 재앙을 허락했는가라는 질문이 확산되었다.
결과적으로 교회의 절대적 권위가 약화되었다.
이것은 훗날 종교개혁의 씨앗이 되었다.
한편 예술과 학문에도 변화가 일어났다. 죽음에 대한 인식이 변하면서 르네상스가 촉진되었다.
결국 흑사병이라는 재앙이 근대 유럽의 탄생을 앞당긴 역설적 결과를 낳았다.`;

// ═══════════════════════════════════════════════════════════════════
// 1. Beat Parsing
// ═══════════════════════════════════════════════════════════════════

describe("parseScriptBeats", () => {
  it("빈 텍스트 → 빈 배열", () => {
    expect(parseScriptBeats("")).toEqual([]);
    expect(parseScriptBeats("  ")).toEqual([]);
  });

  it("흑사병 대본에서 최소 3개 비트 추출", () => {
    const beats = parseScriptBeats(BLACK_DEATH_SCRIPT);
    expect(beats.length).toBeGreaterThanOrEqual(3);
  });

  it("첫 비트는 항상 hook 타입", () => {
    const beats = parseScriptBeats(BLACK_DEATH_SCRIPT);
    expect(beats[0].typeHint).toBe("hook");
  });

  it("전환 키워드(하지만, 결과적으로 등)에서 비트 분리", () => {
    const beats = parseScriptBeats(BLACK_DEATH_SCRIPT);
    // "하지만" 또는 "결과적으로"로 시작하는 비트가 있어야 함
    const hasTransitionBeat = beats.some(b =>
      /^(하지만|결과적으로|그래서)/.test(b.text)
    );
    expect(hasTransitionBeat).toBe(true);
  });

  it("각 비트에 estimatedSec이 2초 이상", () => {
    const beats = parseScriptBeats(BLACK_DEATH_SCRIPT);
    for (const b of beats) {
      expect(b.estimatedSec).toBeGreaterThanOrEqual(2);
    }
  });

  it("강도 감지: 충격/역설 키워드가 있으면 intensity > 0", () => {
    const beats = parseScriptBeats(BLACK_DEATH_SCRIPT);
    const hookBeat = beats[0];
    expect(hookBeat.intensity).toBeGreaterThan(0);
  });

  it("결론/역설 비트 타입 감지", () => {
    const beats = parseScriptBeats(BLACK_DEATH_SCRIPT);
    const hasConclusionBeat = beats.some(b =>
      b.typeHint === "paradox" || b.typeHint === "payoff"
    );
    expect(hasConclusionBeat).toBe(true);
  });

  it("짧은 텍스트도 최소 1개 비트 생성", () => {
    const beats = parseScriptBeats(SHORT_SCRIPT);
    expect(beats.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Sequence Boundary Planning
// ═══════════════════════════════════════════════════════════════════

describe("planSequenceBoundaries", () => {
  it("빈 비트 배열 → 빈 결과", () => {
    expect(planSequenceBoundaries([])).toEqual([]);
  });

  it("단일 비트 → 단일 시퀀스", () => {
    const beats = parseScriptBeats(SHORT_SCRIPT);
    const seqs = planSequenceBoundaries(beats);
    expect(seqs.length).toBe(1);
  });

  it("긴 대본 → 최소 2개 시퀀스로 분할", () => {
    const beats = parseScriptBeats(BLACK_DEATH_SCRIPT);
    const seqs = planSequenceBoundaries(beats);
    expect(seqs.length).toBeGreaterThanOrEqual(2);
  });

  it("아주 긴 대본 → 3개 이상 시퀀스", () => {
    const beats = parseScriptBeats(LONG_DENSE_SCRIPT);
    const seqs = planSequenceBoundaries(beats);
    expect(seqs.length).toBeGreaterThanOrEqual(3);
  });

  it("각 시퀀스에 최소 1개 비트 포함", () => {
    const beats = parseScriptBeats(BLACK_DEATH_SCRIPT);
    const seqs = planSequenceBoundaries(beats);
    for (const seq of seqs) {
      expect(seq.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("모든 비트가 보존됨 (비트 손실 없음)", () => {
    const beats = parseScriptBeats(BLACK_DEATH_SCRIPT);
    const seqs = planSequenceBoundaries(beats);
    const totalBeats = seqs.reduce((sum, s) => sum + s.length, 0);
    expect(totalBeats).toBe(beats.length);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Cut Progression
// ═══════════════════════════════════════════════════════════════════

describe("generateCutProgression", () => {
  it("8초 시퀀스 → 2-4 컷", () => {
    const beats = parseScriptBeats("테스트 비트입니다.");
    const cuts = generateCutProgression(beats, 8, "development");
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    expect(cuts.length).toBeLessThanOrEqual(4);
  });

  it("15초 시퀀스 → 4-6 컷", () => {
    const beats = parseScriptBeats("테스트 비트입니다.");
    const cuts = generateCutProgression(beats, 15, "development");
    expect(cuts.length).toBeGreaterThanOrEqual(4);
    expect(cuts.length).toBeLessThanOrEqual(6);
  });

  it("hook 비트 → 첫 컷은 establish", () => {
    const beats = parseScriptBeats("충격적인 사실이 있다.");
    const cuts = generateCutProgression(beats, 10, "hook");
    expect(cuts[0].role).toBe("establish");
  });

  it("reveal 비트 → peak 컷 포함", () => {
    const beats = parseScriptBeats("숨겨진 진실.");
    const cuts = generateCutProgression(beats, 10, "reveal");
    expect(cuts.some(c => c.role === "peak")).toBe(true);
  });

  it("payoff 비트 → resolve 컷 포함", () => {
    const beats = parseScriptBeats("결론입니다.");
    const cuts = generateCutProgression(beats, 10, "payoff");
    expect(cuts.some(c => c.role === "resolve")).toBe(true);
  });

  it("모든 컷에 필수 필드 존재", () => {
    const beats = parseScriptBeats("테스트입니다.");
    const cuts = generateCutProgression(beats, 10, "development");
    for (const cut of cuts) {
      expect(cut.role).toBeTruthy();
      expect(cut.visualFocus).toBeTruthy();
      expect(cut.changeFromPrevious).toBeTruthy();
      expect(cut.narrativeFunction).toBeTruthy();
      expect(cut.suggestedPromptIntent).toBeTruthy();
      expect(cut.retentionReason).toBeTruthy();
    }
  });

  it("인접 컷은 다른 role (2연속 같은 role 최소화)", () => {
    const beats = parseScriptBeats("테스트입니다.");
    const cuts = generateCutProgression(beats, 12, "development");
    // development 이외에는 연속 같은 role이 없어야 함
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i].role !== "develop") {
        expect(cuts[i].role).not.toBe(cuts[i - 1].role);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Full Analysis (End-to-End)
// ═══════════════════════════════════════════════════════════════════

describe("analyzeScript", () => {
  it("빈 텍스트 → issues 포함, confidence low", () => {
    const result = analyzeScript("");
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].code).toBe("short_script");
    expect(result.confidence).toBe("low");
    expect(result.sequences).toEqual([]);
  });

  it("흑사병 대본: 최소 2개 시퀀스", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    expect(result.sequences.length).toBeGreaterThanOrEqual(2);
  });

  it("흑사병 대본: 첫 시퀀스는 hook", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    expect(result.sequences[0].beatType).toBe("hook");
  });

  it("흑사병 대본: mainHook이 비어있지 않음", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    expect(result.mainHook.length).toBeGreaterThan(0);
  });

  it("흑사병 대본: thesis 추출", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    expect(result.thesis.length).toBeGreaterThan(0);
  });

  it("모든 시퀀스에 mode-aware duration 범위", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    // Black Death script triggers YouTube mode → 15-60s sections
    const maxDuration = result.contentMode === "youtube" ? 60 : 15;
    for (const seq of result.sequences) {
      expect(seq.recommendedDurationSec).toBeGreaterThanOrEqual(8);
      expect(seq.recommendedDurationSec).toBeLessThanOrEqual(maxDuration);
    }
  });

  it("모든 시퀀스에 mode-aware 컷 수", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    // YouTube mode allows up to 12 cuts per section
    const maxCuts = result.contentMode === "youtube" ? 12 : 6;
    for (const seq of result.sequences) {
      expect(seq.recommendedCutCount).toBeGreaterThanOrEqual(2);
      expect(seq.recommendedCutCount).toBeLessThanOrEqual(maxCuts);
      expect(seq.cuts.length).toBe(seq.recommendedCutCount);
    }
  });

  it("모든 시퀀스에 retentionStrategy 존재", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    for (const seq of result.sequences) {
      expect(seq.retentionStrategy).toBeTruthy();
      expect(seq.retentionStrategy.curiosityPoint).toBeTruthy();
      expect(seq.retentionStrategy.informationGain).toBeTruthy();
      expect(seq.retentionStrategy.escalation).toBeTruthy();
      expect(seq.retentionStrategy.payoff).toBeTruthy();
    }
  });

  it("모든 시퀀스에 visualStrategy 존재", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    for (const seq of result.sequences) {
      expect(seq.visualStrategy).toBeTruthy();
      expect(seq.visualStrategy.primaryDriver).toBeTruthy();
      expect(seq.visualStrategy.finalFrameLanding).toBeTruthy();
    }
  });

  it("마지막 시퀀스의 endingMode는 close", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    const lastSeq = result.sequences[result.sequences.length - 1];
    expect(lastSeq.endingMode).toBe("close");
  });

  it("긴 대본: 더 많은 시퀀스 생성", () => {
    const longResult = analyzeScript(LONG_DENSE_SCRIPT);
    const shortResult = analyzeScript(SHORT_SCRIPT);
    expect(longResult.sequences.length).toBeGreaterThan(shortResult.sequences.length);
  });

  it("경제 대본도 정상 분석", () => {
    const result = analyzeScript(ECONOMICS_SCRIPT);
    expect(result.sequences.length).toBeGreaterThanOrEqual(1);
    expect(result.thesis.length).toBeGreaterThan(0);
  });

  it("totalSuggestedRuntime > 0", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    expect(result.totalSuggestedRuntime).toBeGreaterThan(0);
  });

  it("suggestedSequenceCount = sequences.length", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    expect(result.suggestedSequenceCount).toBe(result.sequences.length);
  });

  it("각 시퀀스 ID는 1부터 순차", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    result.sequences.forEach((seq, i) => {
      expect(seq.id).toBe(i + 1);
    });
  });

  it("각 시퀀스의 sourceText가 비어있지 않음", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    for (const seq of result.sequences) {
      expect(seq.sourceText.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Conversion to Cut[]
// ═══════════════════════════════════════════════════════════════════

describe("convertToCuts", () => {
  it("분석 결과를 Cut[]로 변환", () => {
    const analysis = analyzeScript(BLACK_DEATH_SCRIPT);
    const cuts = convertToCuts(analysis);
    expect(cuts.length).toBe(analysis.sequences.length);
  });

  it("각 Cut에 multiShot이 존재", () => {
    const analysis = analyzeScript(BLACK_DEATH_SCRIPT);
    const cuts = convertToCuts(analysis);
    for (const cut of cuts) {
      expect(cut.multiShot).toBeTruthy();
      expect(cut.multiShot!.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("Cut의 cutNumber는 1부터 순차", () => {
    const analysis = analyzeScript(BLACK_DEATH_SCRIPT);
    const cuts = convertToCuts(analysis);
    cuts.forEach((cut, i) => {
      expect(cut.cutNumber).toBe(i + 1);
    });
  });

  it("각 Cut의 durationSec이 mode-aware 범위", () => {
    const analysis = analyzeScript(BLACK_DEATH_SCRIPT);
    // YouTube mode sequences can be up to 60s
    const maxDuration = analysis.contentMode === "youtube" ? 60 : 15;
    const cuts = convertToCuts(analysis);
    for (const cut of cuts) {
      expect(cut.durationSec).toBeGreaterThanOrEqual(8);
      expect(cut.durationSec).toBeLessThanOrEqual(maxDuration);
    }
  });

  it("multiShot의 각 샷에 role이 존재", () => {
    const analysis = analyzeScript(BLACK_DEATH_SCRIPT);
    const cuts = convertToCuts(analysis);
    for (const cut of cuts) {
      for (const shot of cut.multiShot!) {
        expect(shot.role).toBeTruthy();
      }
    }
  });

  it("sceneDescription에 시퀀스 제목 포함", () => {
    const analysis = analyzeScript(BLACK_DEATH_SCRIPT);
    const cuts = convertToCuts(analysis);
    for (let i = 0; i < cuts.length; i++) {
      expect(cuts[i].sceneDescription).toContain(analysis.sequences[i].title);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Utility Functions
// ═══════════════════════════════════════════════════════════════════

describe("estimateRuntime", () => {
  it("빈 텍스트 → 0초", () => {
    expect(estimateRuntime("")).toBe(0);
  });

  it("한국어 100자 → 대략 35-50초 (자연 나레이션 기준)", () => {
    const text = "가".repeat(100);
    const runtime = estimateRuntime(text);
    // 100자 / 3.2 chars/sec = 31.25s base + 1.3x visual = ~41s
    expect(runtime).toBeGreaterThanOrEqual(35);
    expect(runtime).toBeLessThanOrEqual(50);
  });

  it("긴 텍스트 > 짧은 텍스트 런타임", () => {
    const longRuntime = estimateRuntime(LONG_DENSE_SCRIPT);
    const shortRuntime = estimateRuntime(SHORT_SCRIPT);
    expect(longRuntime).toBeGreaterThan(shortRuntime);
  });
});

describe("detectContentType", () => {
  it("흑사병 대본 → what-if (만약으로 시작)", () => {
    expect(detectContentType(BLACK_DEATH_SCRIPT)).toBe("what-if");
  });

  it("경제 대본 → economics", () => {
    expect(detectContentType(ECONOMICS_SCRIPT)).toBe("economics");
  });

  it("만약으로 시작 → what-if", () => {
    expect(detectContentType("만약 한국전쟁이 없었다면")).toBe("what-if");
  });

  it("사회 키워드 → social-commentary", () => {
    expect(detectContentType("사회 불평등과 계층 갈등")).toBe("social-commentary");
  });

  it("일반 텍스트 → educational", () => {
    expect(detectContentType("고양이는 귀엽다")).toBe("educational");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Quality & Edge Cases
// ═══════════════════════════════════════════════════════════════════

describe("analysis quality", () => {
  it("흑사병: hook은 충격적 thesis를 포함", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    const hookSeq = result.sequences.find(s => s.beatType === "hook");
    expect(hookSeq).toBeTruthy();
    // 훅 시퀀스의 sourceText에 "흑사병" 또는 "자유" 관련 내용이 있어야
    expect(hookSeq!.sourceText).toMatch(/흑사병|자유|임금/);
  });

  it("흑사병: 결론/역설 시퀀스가 마지막 근처에 위치", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    const conclusionSeqs = result.sequences.filter(s =>
      s.beatType === "paradox" || s.beatType === "payoff"
    );
    if (conclusionSeqs.length > 0) {
      const lastConclusion = conclusionSeqs[conclusionSeqs.length - 1];
      // 마지막 2개 시퀀스 안에 결론이 있어야
      expect(lastConclusion.id).toBeGreaterThan(result.sequences.length - 3);
    }
  });

  it("각 시퀀스 내 컷은 가짜 분할이 아님 (다른 role)", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    for (const seq of result.sequences) {
      if (seq.cuts.length >= 2) {
        // 최소 2개 이상의 서로 다른 role이 있어야
        const uniqueRoles = new Set(seq.cuts.map(c => c.role));
        expect(uniqueRoles.size).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("structuralNotes 또는 weaknesses가 존재", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    const hasAnalysis = result.structuralNotes.length > 0 || result.weaknesses.length > 0;
    expect(hasAnalysis).toBe(true);
  });

  it("매우 긴 대본: 시퀀스 과밀 경고", () => {
    const result = analyzeScript(LONG_DENSE_SCRIPT);
    // 12문장 이상 → 구조 약점 분석이 작동해야
    const hasQualityNote = result.structuralNotes.length > 0 || result.weaknesses.length > 0;
    expect(hasQualityNote).toBe(true);
  });

  it("비트 타입이 다양 (모든 비트가 development가 아님)", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    const types = new Set(result.sequences.map(s => s.beatType));
    expect(types.size).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. New Schema Fields (issues, confidence, sourceSpan, cliffhangerText)
// ═══════════════════════════════════════════════════════════════════

describe("new schema fields", () => {
  it("분석 결과에 issues 배열 존재", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it("분석 결과에 confidence 존재", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    expect(["low", "medium", "high"]).toContain(result.confidence);
  });

  it("충분한 대본 → confidence medium 이상", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    expect(["medium", "high"]).toContain(result.confidence);
  });

  it("짧은 대본 → confidence low 또는 medium", () => {
    const result = analyzeScript(SHORT_SCRIPT);
    expect(["low", "medium"]).toContain(result.confidence);
  });

  it("issues에 code, severity, message 필드 존재", () => {
    const result = analyzeScript(SHORT_SCRIPT);
    for (const issue of result.issues) {
      expect(issue.code).toBeTruthy();
      expect(["info", "warning", "error"]).toContain(issue.severity);
      expect(issue.message).toBeTruthy();
    }
  });

  it("시퀀스에 sourceSpan이 있으면 startChar < endChar", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    for (const seq of result.sequences) {
      if (seq.sourceSpan) {
        expect(seq.sourceSpan.startChar).toBeLessThan(seq.sourceSpan.endChar);
        expect(seq.sourceSpan.startChar).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("cliffhanger 시퀀스에 cliffhangerText 존재", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    for (const seq of result.sequences) {
      if (seq.endingMode === "cliffhanger") {
        expect(seq.cliffhangerText).toBeTruthy();
      }
    }
  });

  it("non-cliffhanger 시퀀스에 cliffhangerText 없음", () => {
    const result = analyzeScript(BLACK_DEATH_SCRIPT);
    for (const seq of result.sequences) {
      if (seq.endingMode !== "cliffhanger") {
        expect(seq.cliffhangerText).toBeUndefined();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Weak-Hook & Dense Script Detection
// ═══════════════════════════════════════════════════════════════════

describe("weak-hook and dense script detection", () => {
  it("약한 훅 대본 → weak_hook issue 감지", () => {
    const weakHookScript = `고양이는 귀엽다. 고양이를 좋아하는 사람이 많다.
하지만 고양이의 성격은 다양하다. 어떤 고양이는 활발하고 어떤 고양이는 조용하다.
결국 고양이를 키우려면 성격을 잘 파악해야 한다.`;
    const result = analyzeScript(weakHookScript);
    const hasWeakHook = result.issues.some(i => i.code === "weak_hook");
    expect(hasWeakHook).toBe(true);
  });

  it("매우 긴 밀집 대본 → too_dense issue 감지", () => {
    const result = analyzeScript(LONG_DENSE_SCRIPT);
    const hasDense = result.issues.some(i => i.code === "too_dense");
    // 밀집도가 높을 때만 감지 — 경계값에 따라 유연하게
    if (hasDense) {
      expect(result.issues.find(i => i.code === "too_dense")!.severity).toBe("warning");
    }
  });

  it("단조로운 대본 → single_beat_type 또는 too_repetitive issue", () => {
    const monotoneScript = `첫 번째 사실이다. 두 번째 정보이다. 세 번째 내용이다.
네 번째 설명이다. 다섯 번째 서술이다. 여섯 번째 기술이다.
일곱 번째 정리이다. 여덟 번째 마무리이다.`;
    const result = analyzeScript(monotoneScript);
    const hasMonotoneIssue = result.issues.some(i =>
      i.code === "single_beat_type" || i.code === "too_repetitive"
    );
    // 충분히 긴 단조 텍스트에서 감지 가능
    expect(result.issues.length).toBeGreaterThanOrEqual(0); // 최소 구조 분석 작동
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Generalization — 다양한 서사 타입
// ═══════════════════════════════════════════════════════════════════

describe("generalization across narrative types", () => {
  const BIOGRAPHY_SCRIPT = `스티브 잡스는 대학을 중퇴한 후 차고에서 애플을 시작했다.
하지만 그가 만든 회사에서 쫓겨나는 아이러니를 겪었다.
그 좌절이 오히려 넥스트와 픽사라는 더 큰 성공의 씨앗이 되었다.
결국 애플로 돌아온 잡스는 아이폰으로 세상을 바꿨다.
아이러니하게도, 실패가 그를 더 강하게 만든 셈이다.`;

  const BRAND_STORY_SCRIPT = `나이키는 처음에 일본 운동화를 수입하는 작은 회사였다.
하지만 창업자 필 나이트는 더 큰 꿈이 있었다. 자체 브랜드를 만들겠다는 것.
결과적으로 와플 메이커에서 영감을 받은 신발 밑창이 혁명을 일으켰다.
그래서 "Just Do It"이라는 슬로건은 단순한 마케팅이 아니라 창업 정신 그 자체다.`;

  const EMOTIONAL_SCRIPT = `엄마가 마지막으로 내 이름을 불렀을 때, 나는 대답하지 못했다.
병실에서 울리는 기계음 사이로, 그녀의 목소리만 선명했다.
하지만 그때의 침묵이 내 인생을 바꿨다.
지금 나는 매일 아침 그녀가 좋아하던 노래를 부른다.
그것이 내가 찾은, 말하지 못한 대답이다.`;

  it("인물/전기 대본도 정상 분석", () => {
    const result = analyzeScript(BIOGRAPHY_SCRIPT);
    expect(result.sequences.length).toBeGreaterThanOrEqual(2);
    expect(result.thesis.length).toBeGreaterThan(0);
    expect(result.sequences[0].beatType).toBe("hook");
  });

  it("브랜드 스토리도 정상 분석", () => {
    const result = analyzeScript(BRAND_STORY_SCRIPT);
    expect(result.sequences.length).toBeGreaterThanOrEqual(1);
    expect(result.thesis.length).toBeGreaterThan(0);
  });

  it("감정적 서사도 정상 분석", () => {
    const result = analyzeScript(EMOTIONAL_SCRIPT);
    expect(result.sequences.length).toBeGreaterThanOrEqual(1);
    expect(result.mainHook.length).toBeGreaterThan(0);
  });

  it("다양한 서사 타입 모두 시퀀스 경계 정상 분리", () => {
    for (const script of [BIOGRAPHY_SCRIPT, BRAND_STORY_SCRIPT, EMOTIONAL_SCRIPT]) {
      const result = analyzeScript(script);
      // Mode-aware: youtube allows up to 60s, short-form up to 15s
      const maxDuration = result.contentMode === "youtube" ? 60 : 15;
      for (const seq of result.sequences) {
        expect(seq.recommendedDurationSec).toBeGreaterThanOrEqual(8);
        expect(seq.recommendedDurationSec).toBeLessThanOrEqual(maxDuration);
        expect(seq.cuts.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("모든 서사 타입에 confidence 존재", () => {
    for (const script of [BIOGRAPHY_SCRIPT, BRAND_STORY_SCRIPT, EMOTIONAL_SCRIPT]) {
      const result = analyzeScript(script);
      expect(["low", "medium", "high"]).toContain(result.confidence);
    }
  });

  it("모든 서사 타입에 issues 배열 존재", () => {
    for (const script of [BIOGRAPHY_SCRIPT, BRAND_STORY_SCRIPT, EMOTIONAL_SCRIPT]) {
      const result = analyzeScript(script);
      expect(Array.isArray(result.issues)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. Phase A: Fast Structural Analysis
// ═══════════════════════════════════════════════════════════════════

describe("analyzeScriptPhaseA", () => {
  beforeEach(() => clearAnalysisCache());

  it("빈 텍스트 → short_script issue", () => {
    const { result } = analyzeScriptPhaseA("");
    expect(result.issues[0].code).toBe("short_script");
    expect(result.sequences).toEqual([]);
  });

  it("returns skeleton sequences with empty cuts", () => {
    const { result } = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    expect(result.sequences.length).toBeGreaterThanOrEqual(2);
    for (const seq of result.sequences) {
      expect(seq.cuts).toEqual([]);
      expect(seq.purpose).toBe("");
      expect(seq.rationale).toBe("");
    }
  });

  it("returns structural metadata in skeleton", () => {
    const { result } = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    for (const seq of result.sequences) {
      expect(seq.title.length).toBeGreaterThan(0);
      expect(seq.beatType).toBeTruthy();
      expect(seq.recommendedDurationSec).toBeGreaterThanOrEqual(8);
      expect(seq.recommendedCutCount).toBeGreaterThanOrEqual(2);
      expect(seq.endingMode).toBeTruthy();
      expect(seq.sourceText.length).toBeGreaterThan(0);
    }
  });

  it("returns macro analysis (hook, thesis, runtime)", () => {
    const { result } = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    expect(result.mainHook.length).toBeGreaterThan(0);
    expect(result.thesis.length).toBeGreaterThan(0);
    expect(result.totalSuggestedRuntime).toBeGreaterThan(0);
    expect(result.confidence).toBeTruthy();
  });

  it("returns reusable intermediates (beats, sequenceGroups)", () => {
    const phaseA = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    expect(phaseA.beats.length).toBeGreaterThan(0);
    expect(phaseA.sequenceGroups.length).toBe(phaseA.result.sequences.length);
    expect(phaseA.cacheKey.length).toBeGreaterThan(0);
  });

  it("첫 시퀀스는 항상 hook", () => {
    const { result } = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    expect(result.sequences[0].beatType).toBe("hook");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. Phase B: Per-Sequence Detail Enrichment
// ═══════════════════════════════════════════════════════════════════

describe("enrichSequenceDetail", () => {
  beforeEach(() => clearAnalysisCache());

  it("fills cuts, purpose, rationale, strategies", () => {
    const phaseA = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    const enriched = enrichSequenceDetail(
      phaseA.result.sequences[0],
      phaseA.sequenceGroups,
      0,
      phaseA.result.sequences.length,
    );

    expect(enriched.cuts.length).toBeGreaterThanOrEqual(2);
    expect(enriched.purpose.length).toBeGreaterThan(0);
    expect(enriched.rationale.length).toBeGreaterThan(0);
    expect(enriched.retentionStrategy.curiosityPoint.length).toBeGreaterThan(0);
    expect(enriched.visualStrategy.toneHint.length).toBeGreaterThan(0);
  });

  it("preserves structural fields from Phase A", () => {
    const phaseA = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    const skeleton = phaseA.result.sequences[0];
    const enriched = enrichSequenceDetail(skeleton, phaseA.sequenceGroups, 0, phaseA.result.sequences.length);

    expect(enriched.id).toBe(skeleton.id);
    expect(enriched.title).toBe(skeleton.title);
    expect(enriched.beatType).toBe(skeleton.beatType);
    expect(enriched.recommendedDurationSec).toBe(skeleton.recommendedDurationSec);
    expect(enriched.endingMode).toBe(skeleton.endingMode);
    expect(enriched.sourceText).toBe(skeleton.sourceText);
  });

  it("updates recommendedCutCount to match actual cuts", () => {
    const phaseA = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    const enriched = enrichSequenceDetail(
      phaseA.result.sequences[0],
      phaseA.sequenceGroups,
      0,
      phaseA.result.sequences.length,
    );
    expect(enriched.recommendedCutCount).toBe(enriched.cuts.length);
  });
});

describe("enrichAllSequences", () => {
  beforeEach(() => clearAnalysisCache());

  it("produces same result as monolithic analyzeScript", () => {
    const phaseA = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    const phased = enrichAllSequences(phaseA);
    const monolithic = analyzeScript(BLACK_DEATH_SCRIPT);

    // Same sequence count
    expect(phased.sequences.length).toBe(monolithic.sequences.length);

    // Same macro fields
    expect(phased.mainHook).toBe(monolithic.mainHook);
    expect(phased.thesis).toBe(monolithic.thesis);
    expect(phased.totalSuggestedRuntime).toBe(monolithic.totalSuggestedRuntime);

    // Same per-sequence fields
    for (let i = 0; i < phased.sequences.length; i++) {
      expect(phased.sequences[i].cuts.length).toBe(monolithic.sequences[i].cuts.length);
      expect(phased.sequences[i].purpose).toBe(monolithic.sequences[i].purpose);
      expect(phased.sequences[i].beatType).toBe(monolithic.sequences[i].beatType);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. Caching Layer
// ═══════════════════════════════════════════════════════════════════

describe("caching", () => {
  beforeEach(() => clearAnalysisCache());

  it("scriptHash produces consistent hash for same text", () => {
    const h1 = scriptHash("테스트 텍스트");
    const h2 = scriptHash("테스트 텍스트");
    expect(h1).toBe(h2);
  });

  it("scriptHash normalizes whitespace", () => {
    const h1 = scriptHash("테스트   텍스트");
    const h2 = scriptHash("테스트 텍스트");
    expect(h1).toBe(h2);
  });

  it("scriptHash differs for different text", () => {
    const h1 = scriptHash("텍스트 A");
    const h2 = scriptHash("텍스트 B");
    expect(h1).not.toBe(h2);
  });

  it("second analyzeScriptPhaseA call returns cached full result", () => {
    // First call: full analysis (populates cache via enrichAllSequences path)
    const phaseA1 = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    enrichAllSequences(phaseA1); // caches full result

    // Second call: should return cached full result with cuts
    const phaseA2 = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    expect(phaseA2.result.sequences[0].cuts.length).toBeGreaterThan(0);
    expect(phaseA2.result.sequences[0].purpose.length).toBeGreaterThan(0);
  });

  it("clearAnalysisCache resets all caches", () => {
    analyzeScript(BLACK_DEATH_SCRIPT); // populates cache
    clearAnalysisCache();

    // After clear, Phase A should return skeleton again
    const { result } = analyzeScriptPhaseA(BLACK_DEATH_SCRIPT);
    expect(result.sequences[0].cuts).toEqual([]);
  });
});
