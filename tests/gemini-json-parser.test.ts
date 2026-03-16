/**
 * Regression tests for Gemini response JSON parsing utilities.
 *
 * These parsers handle the messy reality of LLM JSON output:
 * trailing text, markdown fences, strings with braces, escaped quotes, etc.
 */
import { describe, it, expect } from "vitest";
import { parseFirstJsonObject, parseFirstJsonArray, sanitizeJsonText, repairTruncatedJson } from "../functions/api/_gemini-keys";

// ─── parseFirstJsonObject ───────────────────────────────────────────

describe("parseFirstJsonObject", () => {

  // === 1. Valid JSON followed by trailing text ===

  it("extracts JSON when followed by trailing commentary", () => {
    const input = '{"name": "Alice", "score": 95}\n\nHere is my analysis of the above...';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ name: "Alice", score: 95 });
  });

  it("extracts JSON when followed by trailing newlines and Korean text", () => {
    const input = '{"analysis": "역사적 분석", "localMatches": []}\n\n추가 설명입니다.';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ analysis: "역사적 분석", localMatches: [] });
  });

  it("extracts JSON followed by a second JSON object", () => {
    const input = '{"first": true}\n{"second": true}';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ first: true });
  });

  // === 2. Fenced JSON blocks (```json ... ```) ===

  it("extracts JSON from markdown fenced block", () => {
    const input = '```json\n{"title": "test", "items": [1, 2, 3]}\n```';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ title: "test", items: [1, 2, 3] });
  });

  it("extracts JSON from fenced block with trailing explanation", () => {
    const input = 'Here is the result:\n```\n{"score": 42}\n```\nThe score was computed using...';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ score: 42 });
  });

  // === 3. Strings containing braces ===

  it("handles string values containing curly braces", () => {
    const input = '{"template": "Hello {name}, welcome to {place}", "count": 1}';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ template: "Hello {name}, welcome to {place}", count: 1 });
  });

  it("handles string values containing nested JSON-like content", () => {
    const input = '{"code": "const x = {a: 1, b: {c: 2}}", "valid": true}';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ code: "const x = {a: 1, b: {c: 2}}", valid: true });
  });

  it("handles deeply nested objects", () => {
    const input = '{"a": {"b": {"c": {"d": "deep"}}}} trailing';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ a: { b: { c: { d: "deep" } } } });
  });

  // === 4. Escaped quotes inside strings ===

  it("handles escaped double quotes in string values", () => {
    const input = '{"message": "She said \\"hello\\" to them", "ok": true}';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ message: 'She said "hello" to them', ok: true });
  });

  it("handles escaped backslashes before closing quotes", () => {
    const input = '{"path": "C:\\\\Users\\\\test", "valid": true}';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ path: "C:\\Users\\test", valid: true });
  });

  it("handles escaped backslash followed by quote (tricky edge case)", () => {
    // The string value is: a backslash followed by a quote → \" in the actual value
    // In JSON source: "val": "a\\\""  means value = a\"
    const input = '{"val": "a\\\\\\"b", "x": 1}';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ val: 'a\\"b', x: 1 });
  });

  // === 5. Multiple JSON-like sections in one response ===

  it("returns only the first JSON object when multiple exist", () => {
    const input = 'Intro text {"first": 1} middle text {"second": 2} end text';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ first: 1 });
  });

  it("returns the first object even if second is larger", () => {
    const input = '{"small": true}\n\n{"large": true, "data": [1,2,3,4,5], "nested": {"a": "b"}}';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ small: true });
  });

  // === Edge cases ===

  it("returns null for empty string", () => {
    expect(parseFirstJsonObject("")).toBeNull();
  });

  it("returns null for text with no JSON", () => {
    expect(parseFirstJsonObject("No JSON here at all")).toBeNull();
  });

  it("returns null for unclosed JSON object", () => {
    expect(parseFirstJsonObject('{"unclosed": true')).toBeNull();
  });

  it("returns null for text with only array brackets", () => {
    expect(parseFirstJsonObject("[1, 2, 3]")).toBeNull();
  });

  it("handles empty JSON object", () => {
    expect(parseFirstJsonObject("{}")).toEqual({});
  });

  it("handles JSON with unicode content", () => {
    const input = '{"감독": "봉준호", "score": 98}';
    const result = parseFirstJsonObject(input);
    expect(result).toEqual({ "감독": "봉준호", score: 98 });
  });

  it("handles the exact Gemini trailing-content pattern from the original bug", () => {
    // Simulate: valid JSON at ~2500 chars, then Gemini appends a note
    const bigObj: Record<string, unknown> = {
      analysis: "이 시나리오는 역사적 다큐멘터리 장르로, 중세 유럽의 흑사병과 경제적 변화를 다루고 있습니다.",
      localMatches: [
        { id: "eu-tarkovsky", fitScore: 85, reason: "역사적 분위기와 시각적 스타일이 매우 적합합니다." },
        { id: "kr-park", fitScore: 72, reason: "긴장감 있는 연출이 효과적입니다." },
      ],
      webSuggestions: [
        {
          id: "eu-tarr",
          name: "Béla Tarr",
          nameKo: "벨라 타르",
          region: "유럽",
          style: "장편 숏, 흑백, 느린 템포, 실존주의, 미니멀",
          description: "헝가리의 거장으로, 극도로 긴 테이크와 흑백 촬영으로 유명합니다.",
          reason: "중세 유럽의 어두운 분위기를 잘 살릴 수 있습니다.",
          fitScore: 90,
          signatureTechniques: {
            cameraWork: "Long tracking shots",
            colorPalette: "Monochrome, desaturated",
            lighting: "Low-key, natural",
            editingStyle: "Minimal cuts",
            moodKeywords: "Bleak, contemplative",
          },
          notableWorks: ["사탄탱고", "토리노의 말", "베르크마이스터 하모니즈"],
        },
      ],
    };
    const jsonStr = JSON.stringify(bigObj);
    const input = jsonStr + "\n\n참고: 위 추천은 시나리오의 시각적 특성을 기반으로 합니다.";

    const result = parseFirstJsonObject(input);
    expect(result).toEqual(bigObj);
  });
});

// ─── parseFirstJsonArray ────────────────────────────────────────────

describe("parseFirstJsonArray", () => {

  it("extracts array followed by trailing text", () => {
    const input = '[{"name": "A"}, {"name": "B"}]\n\nAdditional notes here.';
    const result = parseFirstJsonArray(input);
    expect(result).toEqual([{ name: "A" }, { name: "B" }]);
  });

  it("extracts array from markdown fenced block", () => {
    const input = '```json\n[1, 2, 3]\n```';
    const result = parseFirstJsonArray(input);
    expect(result).toEqual([1, 2, 3]);
  });

  it("handles strings containing square brackets inside array", () => {
    const input = '[{"regex": "[a-z]+", "test": true}]';
    const result = parseFirstJsonArray(input);
    expect(result).toEqual([{ regex: "[a-z]+", test: true }]);
  });

  it("handles nested arrays", () => {
    const input = '[[1, 2], [3, 4]] trailing';
    const result = parseFirstJsonArray(input);
    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it("returns null for empty string", () => {
    expect(parseFirstJsonArray("")).toBeNull();
  });

  it("returns null for text with only objects", () => {
    expect(parseFirstJsonArray('{"a": 1}')).toBeNull();
  });

  it("returns only first array when multiple exist", () => {
    const input = '[1, 2] and [3, 4]';
    const result = parseFirstJsonArray(input);
    expect(result).toEqual([1, 2]);
  });

  it("handles empty array", () => {
    expect(parseFirstJsonArray("[]")).toEqual([]);
  });
});
