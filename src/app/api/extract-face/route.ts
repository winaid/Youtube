import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, characterId } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });

    // 클라이언트 사이드에서 canvas로 처리하므로 여기서는 그대로 반환
    return NextResponse.json({ faceBase64: imageBase64, characterId });
  } catch (err) {
    console.error("[extract-face]", err);
    return NextResponse.json({ error: "얼굴 추출 실패" }, { status: 500 });
  }
}
