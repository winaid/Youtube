/**
 * real-api-pipeline-trace.mjs — Gemini API 직접 호출로 시나리오→프롬프트 검증
 *
 * 실행: GEMINI_API_KEY=xxx node tests/real-api-pipeline-trace.mjs
 */

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error("GEMINI_API_KEY 필요"); process.exit(1); }

const MODEL = "gemini-2.5-flash";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

const SCENARIO = `현대의 임금과 자유는 흑사병 덕분에 탄생했을지도 모른다.
1347년, 유럽 인구의 3분의 1이 사라졌다.
어두운 중세 거리에는 시체가 쌓였고, 살아남은 자들은 공포에 떨었다.
그런데 이 재앙이 역설적으로 노동자에게 힘을 주었다.
노동력이 부족해지자, 영주들은 처음으로 농노에게 임금을 제안해야 했다.
떨리는 손으로 은화 한 닢을 받는 농부의 모습 — 이것이 자유의 시작이었다.
봉건제가 무너지기 시작했다. 더 나은 조건을 찾아 농노들이 이동했다.
임금 경쟁이 시작되었고, 노동의 가치가 처음으로 인정받았다.
수백 년 뒤, 이 변화는 산업혁명과 민주주의의 씨앗이 되었다.
죽음에서 태어난 자유 — 역사의 가장 잔인한 역설이다.`;

// ═══════════════════════════════════════════════════════
// Step1: 컷 아웃라인 생성 (generate-cuts.ts Step1 재현)
// ═══════════════════════════════════════════════════════

const STEP1_PROMPT = `You are a cinematic sequence planner for VEO video generation.

Director: David Fincher (데이비드 핀처)
Style: dark, moody, meticulous framing, Camera: smooth dolly/crane, anamorphic lens with shallow DOF
Animation mode: cinematic-realism

Story:
${SCENARIO}

Create exactly 5 cuts for an 8-second-per-cut VEO video sequence (total 40 seconds).

Output ONLY valid JSON, no markdown fences:
{
  "characterSeeds": [
    { "id": "char-1", "label": "string", "appearance": "≤20 words English physical description", "appearanceKo": "≤15 chars Korean" }
  ],
  "outlines": [
    {
      "cutNumber": 1,
      "sceneKo": "≤20 chars Korean scene title",
      "narrativeFunction": "≤8 words what this cut achieves in the story",
      "newInformation": "≤10 words what new thing viewer learns",
      "emotion": "single word",
      "emotionalDelta": "prev_emotion → this_emotion",
      "purpose": "establish|develop|climax|resolve",
      "shotType": "WS|MS|CU|OTS|MCU|LS|ECU|POV",
      "cameraMovement": "≤6 words",
      "subjectAction": "≤15 words concrete visible action (no abstractions)",
      "shotCategory": "character-driven|environment|object-detail|map-graphic|transition",
      "locationCue": "≤5 words identifying location objects",
      "situationCue": "≤5 words visual evidence of situation",
      "emotionalAnchor": "≤5 words body language / physical detail"
    }
  ]
}

Rules:
- Each cut must advance the narrative — no repeated information
- shotType must vary (no consecutive same shot type)
- subjectAction must be a CONCRETE VISIBLE action, not abstract concept
- emotionalDelta shows emotional progression between cuts
- 5 different cuts covering the full story arc`;

// ═══════════════════════════════════════════════════════
// Step2: 상세 프롬프트 생성 (generate-cuts.ts Step2 재현)
// ═══════════════════════════════════════════════════════

function buildStep2Prompt(outlines, characterSeeds) {
  const outlinesText = outlines.map(o =>
    `Cut ${o.cutNumber}: [${o.shotType}] ${o.sceneKo} — ${o.narrativeFunction}. Action: ${o.subjectAction}. Emotion: ${o.emotion}. Location: ${o.locationCue || "N/A"}`
  ).join("\n");

  const charText = characterSeeds.map(c =>
    `${c.id}: ${c.appearance}`
  ).join("; ");

  return `You are a VEO video prompt engineer. David Fincher style: dark, moody, meticulous framing.

Characters: ${charText}

Sequence outline:
${outlinesText}

For EACH cut, generate a detailed VEO-ready prompt. Output ONLY valid JSON array, no markdown:
[
  {
    "cutNumber": 1,
    "videoPrompt": "Full 8-second video prompt in English. Must describe concrete visible scene, camera, action, lighting. ≤120 words, ≤400 chars.",
    "videoPromptJson": {
      "shotSize": "WS|MS|CU|etc",
      "cameraAngle": "eye-level|low-angle|high-angle|dutch",
      "cameraMovement": "specific motivated camera movement ≤10 words",
      "subjectAction": "concrete visible action ≤15 words",
      "actionBeat": "physical hesitation/follow-through detail ≤10 words",
      "bodySignal": "hand/gaze/posture detail, NOT emotion labels ≤10 words",
      "revealed": "what new visual element appears ≤10 words",
      "withheld": "what stays off-screen ≤10 words",
      "timingBeat": "0s-2s: X. 2s-5s: Y. 5s-8s: Z.",
      "characterRef": "character external appearance ≤15 words",
      "moodLighting": "lighting/mood description ≤15 words",
      "styleSuffix": "style constraints ≤10 words"
    },
    "multiShot": [
      { "index": 1, "prompt": "Shot 1 prompt for [00:00-00:02] establish role", "duration": "2", "role": "establish" },
      { "index": 2, "prompt": "Shot 2 prompt for [00:02-00:04] develop role", "duration": "2", "role": "develop" },
      { "index": 3, "prompt": "Shot 3 prompt for [00:04-00:06] peak role", "duration": "2", "role": "peak" },
      { "index": 4, "prompt": "Shot 4 prompt for [00:06-00:08] resolve role", "duration": "2", "role": "resolve" }
    ],
    "extendPrompt": "Continuation prompt from previous cut (empty for cut 1)"
  }
]

Rules:
- Each multiShot must describe a DIFFERENT framing/angle/action — no repetition
- establish=wide context, develop=new info medium, peak=emotional close-up, resolve=payoff wide
- Character appearance must be consistent across all cuts (use characterRef)
- No Korean text in prompts — English only
- No abstract emotion words in bodySignal (use physical descriptions)
- extendPrompt for cuts 2-5 must describe transition from previous cut's ending`;
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

async function callGemini(prompt, label) {
  console.log(`\n⏳ Calling Gemini (${label})...`);
  const start = Date.now();

  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
      },
    }),
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!res.ok) {
    const errText = await res.text();
    console.error(`❌ Gemini ${label} failed (${res.status}): ${errText.slice(0, 200)}`);
    return null;
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  console.log(`✅ Gemini ${label} responded in ${elapsed}s (${text.length} chars)`);

  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown fences
    const match = text.match(/```json?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) return JSON.parse(match[1]);
    console.error("JSON parse failed:", text.slice(0, 300));
    return null;
  }
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║  REAL API PIPELINE TRACE                             ║");
  console.log("║  시나리오 → Gemini → 컷 아웃라인 → 상세 프롬프트     ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(`\n시나리오 (${SCENARIO.length}자):`);
  console.log(`  "${SCENARIO.slice(0, 100)}..."`);

  // ── Step 1: 컷 아웃라인 ──
  const step1 = await callGemini(STEP1_PROMPT, "Step1-outline");
  if (!step1) { console.error("Step1 실패"); process.exit(1); }

  console.log("\n═══ STEP 1: 컷 아웃라인 ═══");
  console.log(`캐릭터 시드: ${(step1.characterSeeds || []).length}명`);
  for (const c of step1.characterSeeds || []) {
    console.log(`  ${c.id}: ${c.label} — ${c.appearance}`);
  }
  console.log(`\n컷 아웃라인: ${(step1.outlines || []).length}개`);
  for (const o of step1.outlines || []) {
    console.log(`  컷${o.cutNumber} [${o.shotType}] ${o.sceneKo}`);
    console.log(`    narrativeFunction: ${o.narrativeFunction}`);
    console.log(`    subjectAction: ${o.subjectAction}`);
    console.log(`    emotion: ${o.emotionalDelta}`);
    console.log(`    locationCue: ${o.locationCue}, situationCue: ${o.situationCue}`);
    console.log(`    emotionalAnchor: ${o.emotionalAnchor}`);
  }

  // ── Step 2: 상세 프롬프트 ──
  const step2Prompt = buildStep2Prompt(step1.outlines || [], step1.characterSeeds || []);
  const step2 = await callGemini(step2Prompt, "Step2-detail");
  if (!step2) { console.error("Step2 실패"); process.exit(1); }

  const cuts = Array.isArray(step2) ? step2 : step2.cuts || [];

  console.log("\n═══ STEP 2: 상세 프롬프트 (컷 바이 컷) ═══");

  // 서사 포인트 체크
  const NARRATIVE_CHECKPOINTS = [
    { label: "흑사병/역병", keywords: ["plague", "black death", "pestilence", "epidemic"] },
    { label: "1347/중세", keywords: ["1347", "medieval", "middle ages", "14th century"] },
    { label: "시체/죽음", keywords: ["bodies", "corpse", "dead", "death"] },
    { label: "노동력 부족", keywords: ["labor", "shortage", "scarc", "worker"] },
    { label: "영주/농노", keywords: ["lord", "serf", "peasant", "noble", "feudal"] },
    { label: "은화/임금", keywords: ["coin", "silver", "wage", "pay", "money"] },
    { label: "자유/이동", keywords: ["freedom", "free", "travel", "move", "migration"] },
    { label: "산업혁명", keywords: ["industrial", "revolution", "democracy"] },
  ];

  let allPromptText = "";

  for (const cut of cuts) {
    const cn = cut.cutNumber;
    const vj = cut.videoPromptJson || {};
    const ms = cut.multiShot || [];

    console.log(`\n┌─── CUT ${cn} ─────────────────────────────────────────`);
    console.log(`│ videoPrompt: ${(cut.videoPrompt || "").slice(0, 150)}`);
    console.log(`│`);
    console.log(`│ [JSON] shotSize: ${vj.shotSize || "?"}`);
    console.log(`│ [JSON] cameraMovement: ${vj.cameraMovement || "?"}`);
    console.log(`│ [JSON] subjectAction: ${vj.subjectAction || "?"}`);
    console.log(`│ [JSON] bodySignal: ${vj.bodySignal || "?"}`);
    console.log(`│ [JSON] revealed: ${vj.revealed || "?"}`);
    console.log(`│ [JSON] withheld: ${vj.withheld || "?"}`);
    console.log(`│ [JSON] timingBeat: ${vj.timingBeat || "?"}`);
    console.log(`│ [JSON] moodLighting: ${vj.moodLighting || "?"}`);
    console.log(`│`);

    if (ms.length > 0) {
      console.log(`│ multiShot (${ms.length} shots):`);
      for (const s of ms) {
        console.log(`│   [${s.index}] ${(s.role || "?").padEnd(10)} ${s.duration}s: ${(s.prompt || "").slice(0, 90)}`);
      }

      // role progression 확인
      const roles = ms.map(s => s.role);
      const expectedRoles = ["establish", "develop", "peak", "resolve"];
      const rolesMatch = JSON.stringify(roles) === JSON.stringify(expectedRoles);
      console.log(`│   role progression: ${roles.join("→")} ${rolesMatch ? "✅" : "⚠️ UNEXPECTED"}`);

      // duration 합 확인
      const totalDur = ms.reduce((s, m) => s + parseInt(m.duration || "0"), 0);
      console.log(`│   duration total: ${totalDur}s ${totalDur === 8 ? "✅" : "⚠️ NOT 8s"}`);
    }

    if (cut.extendPrompt) {
      console.log(`│ extendPrompt: ${cut.extendPrompt.slice(0, 100)}`);
    }
    console.log(`└───────────────────────────────────────────────────`);

    allPromptText += " " + (cut.videoPrompt || "") + " " + ms.map(s => s.prompt).join(" ");
  }

  // ── 서사 커버리지 ──
  console.log("\n═══ NARRATIVE COVERAGE CHECK ═══");
  let covered = 0;
  for (const cp of NARRATIVE_CHECKPOINTS) {
    const found = cp.keywords.some(kw => allPromptText.toLowerCase().includes(kw.toLowerCase()));
    console.log(`  ${found ? "✅" : "❌"} ${cp.label}: ${found ? "FOUND" : "MISSING"}`);
    if (found) covered++;
  }
  console.log(`\n  커버리지: ${covered}/${NARRATIVE_CHECKPOINTS.length} (${((covered/NARRATIVE_CHECKPOINTS.length)*100).toFixed(0)}%)`);

  // ── VEO 타임스탬프 시뮬레이션 ──
  console.log("\n═══ VEO TIMESTAMP SIMULATION ═══");
  for (const cut of cuts) {
    const ms = cut.multiShot || [];
    if (ms.length >= 2) {
      let currentSec = 0;
      console.log(`\nCut ${cut.cutNumber}:`);
      for (const s of ms) {
        const dur = parseInt(s.duration || "2");
        const start = String(currentSec).padStart(2, "0");
        const end = String(currentSec + dur).padStart(2, "0");
        console.log(`  [00:${start}-00:${end}] ${(s.prompt || "").slice(0, 80)}`);
        currentSec += dur;
      }
    }
  }

  console.log("\n✅ Pipeline trace complete.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
