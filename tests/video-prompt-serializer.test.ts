/**
 * video-prompt-serializer.test.ts — Kling 렌더러 + structuredSequence 의미 보존 테스트
 *
 * 테스트 대상:
 * 1. renderPromptFromJson: locationCue/situationCue/emotionalAnchor/timingBeat 반영
 * 2. shotPlan fallback: placeIdentityAnchors/naturalMotion/temporalBeats/cameraPlan/physicsRules
 * 3. 기존 기본 동작 회귀 없음
 */

import { describe, it, expect } from "vitest";
import {
  renderPromptFromJson,
  type VideoPromptJson,
} from "@/lib/video-prompt-json";

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

function makeBaseJson(overrides: Partial<VideoPromptJson> = {}): VideoPromptJson {
  return {
    shotSize: "WS",
    cameraAngle: "eye-level",
    cameraMovement: "slow push-in (revealing terrain)",
    subjectBlocking: "center-frame",
    subjectAction: "a barren landscape stretches to the horizon",
    actionBeat: "terrain reveals craters",
    bodySignal: "",
    revealed: "footprints on the surface",
    withheld: "source of footprints",
    timingBeat: "0s-3s: establishing. 3s-6s: push-in reveals detail",
    transitionFromPrev: "",
    characterRef: "",
    moodLighting: "harsh directional sunlight from upper-left, deep shadows in craters",
    styleSuffix: "cinematic realism, no text overlay, no watermark",
    locationCue: "",
    situationCue: "",
    emotionalAnchor: "",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. Kling renderer — structuredSequence field preservation
// ═══════════════════════════════════════════════════════════════════

describe("renderPromptFromJson — structuredSequence field preservation", () => {
  it("should include locationCue in Kling prompt", () => {
    const json = makeBaseJson({ locationCue: "lunar crater with scattered boulders" });
    const prompt = renderPromptFromJson(json);
    expect(prompt).toContain("lunar crater with scattered boulders");
  });

  it("should include situationCue in Kling prompt", () => {
    const json = makeBaseJson({ situationCue: "fresh bootprints leading to a flag pole" });
    const prompt = renderPromptFromJson(json);
    expect(prompt).toContain("fresh bootprints leading to a flag pole");
  });

  it("should include emotionalAnchor in Kling prompt", () => {
    const json = makeBaseJson({ emotionalAnchor: "solitary flag stands against infinite darkness" });
    const prompt = renderPromptFromJson(json);
    expect(prompt).toContain("solitary flag stands against infinite darkness");
  });

  it("should include timingBeat in Kling prompt", () => {
    const json = makeBaseJson({ timingBeat: "0s-3s: wide establishing. 3s-6s: slow push reveals craters" });
    const prompt = renderPromptFromJson(json);
    expect(prompt).toContain("0s-3s: wide establishing");
    expect(prompt).toContain("3s-6s: slow push reveals craters");
  });

  it("should include all three instant-readability pillars together", () => {
    const json = makeBaseJson({
      locationCue: "dental clinic waiting room",
      situationCue: "empty chairs, no patients",
      emotionalAnchor: "doctor slumps alone at reception desk",
    });
    const prompt = renderPromptFromJson(json);
    expect(prompt).toContain("dental clinic waiting room");
    expect(prompt).toContain("empty chairs, no patients");
    expect(prompt).toContain("doctor slumps alone at reception desk");
  });

  it("should include moodLighting in Kling prompt", () => {
    const json = makeBaseJson({ moodLighting: "warm golden hour light from the west, long shadows" });
    const prompt = renderPromptFromJson(json);
    expect(prompt).toContain("warm golden hour light from the west");
  });

  it("should strip audio suffix from Kling styleSuffix", () => {
    const json = makeBaseJson({
      styleSuffix: "cinematic realism, no text overlay, no watermark, with natural diegetic sound and ambient audio",
    });
    const prompt = renderPromptFromJson(json);
    expect(prompt).not.toContain("with natural diegetic sound and ambient audio");
    expect(prompt).toContain("cinematic realism");
  });

  it("should omit empty optional fields without artifacts", () => {
    const json = makeBaseJson({
      locationCue: "",
      situationCue: "",
      emotionalAnchor: "",
      timingBeat: "",
    });
    const prompt = renderPromptFromJson(json);
    // Should not have empty segments or double dots
    expect(prompt).not.toMatch(/\.\s*\.\s*\./);
    expect(prompt).not.toContain(". .");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Kling renderer parity — fields rendered correctly
// ═══════════════════════════════════════════════════════════════════

describe("Kling parity — same fields rendered", () => {
  it("renderer should include locationCue", () => {
    const json = makeBaseJson({ locationCue: "rustic farmhouse kitchen" });
    const rendered = renderPromptFromJson(json);
    expect(rendered).toContain("rustic farmhouse kitchen");
  });

  it("renderer should include timingBeat", () => {
    const json = makeBaseJson({ timingBeat: "0s-2s: start. 2s-5s: develop" });
    const rendered = renderPromptFromJson(json);
    expect(rendered).toContain("0s-2s: start");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Existing behavior regression — basic rendering still works
// ═══════════════════════════════════════════════════════════════════

describe("existing behavior regression", () => {
  it("should render basic shot/camera/subject/style", () => {
    const json = makeBaseJson();
    const prompt = renderPromptFromJson(json);
    expect(prompt).toContain("WS shot, eye-level");
    expect(prompt).toContain("slow push-in");
    expect(prompt).toContain("barren landscape");
    expect(prompt).toContain("cinematic realism");
    expect(prompt).toContain("no watermark");
  });

  it("should include character when characterRef is non-empty", () => {
    const json = makeBaseJson({
      characterRef: "Young woman, mid-20s, dark hair in a bun, wearing a white lab coat",
      subjectAction: "leans forward to examine a document",
    });
    const prompt = renderPromptFromJson(json);
    expect(prompt).toContain("Young woman");
    expect(prompt).toContain("white lab coat");
    expect(prompt).toContain("leans forward");
  });

  it("should handle static camera movement", () => {
    const json = makeBaseJson({ cameraMovement: "static" });
    const prompt = renderPromptFromJson(json);
    // "static" should not appear as a separate segment
    expect(prompt).not.toMatch(/\. static\./i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Lunar surface rendering — end-to-end
// ═══════════════════════════════════════════════════════════════════

describe("lunar surface — Kling prompt quality", () => {
  it("should produce a rich lunar scene prompt with all structure fields", () => {
    const json = makeBaseJson({
      shotSize: "WS",
      cameraAngle: "low-angle",
      cameraMovement: "slow crane up (revealing scale of desolation)",
      locationCue: "lunar crater rim with scattered boulders and regolith",
      situationCue: "fresh bootprints leading to a lone flag on a support bar",
      emotionalAnchor: "solitary flag held rigid by support bar against infinite black sky",
      subjectAction: "dust particles settle slowly in low gravity, leaving micro-craters",
      moodLighting: "harsh unfiltered sunlight from upper-left casting razor-sharp shadows, no atmospheric diffusion",
      timingBeat: "0s-3s: wide crater establishing. 3s-5s: crane reveals flag. 5s-8s: dust settles around base",
      styleSuffix: "cinematic realism, no text overlay, no watermark",
    });

    const prompt = renderPromptFromJson(json);

    // Key structural elements preserved
    expect(prompt).toContain("lunar crater rim");
    expect(prompt).toContain("bootprints");
    expect(prompt).toContain("support bar");
    expect(prompt).toContain("low gravity");
    expect(prompt).toContain("harsh unfiltered sunlight");
    expect(prompt).toContain("0s-3s");
    expect(prompt).toContain("5s-8s");

    // No wind-dependent language (this should have been cleaned upstream)
    expect(prompt).not.toContain("fluttering");
    expect(prompt).not.toContain("breeze");
  });
});
