import { NextRequest, NextResponse } from "next/server";
import { getAccessToken, LOCATION } from "@/lib/vertex-auth";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const operationName = searchParams.get("operation");
    if (!operationName) return NextResponse.json({ error: "operation is required" }, { status: 400 });

    const token = await getAccessToken();

    // operationName 형식: projects/{project}/locations/{location}/operations/{id}
    // 또는 전체 URL로 올 수도 있음
    const opPath = operationName.startsWith("projects/")
      ? operationName
      : operationName.replace(/^.*?(projects\/.*)$/, "$1");

    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/${opPath}`;

    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[check-video] error:", errText);
      return NextResponse.json({ error: "상태 확인 실패", detail: errText }, { status: 502 });
    }

    const data = await res.json();

    if (!data.done) {
      return NextResponse.json({ status: "polling" });
    }

    if (data.error) {
      return NextResponse.json({ status: "failed", error: data.error.message ?? "Unknown error" });
    }

    // Extract video URIs from response
    const predictions = data.response?.predictions ?? [];
    const videos: { videoUri: string; seed?: string }[] = [];

    for (const pred of predictions) {
      const uri = pred.bytesBase64Encoded
        ? `data:video/mp4;base64,${pred.bytesBase64Encoded}`
        : pred.videoUri ?? pred.gcsUri ?? null;

      if (uri) {
        videos.push({ videoUri: uri, seed: String(pred.seed ?? "") });
      }
    }

    if (videos.length === 0) {
      return NextResponse.json({ status: "failed", error: "영상 URI를 찾을 수 없습니다." });
    }

    return NextResponse.json({
      status: "completed",
      videoUri: videos[0].videoUri,
      seed: videos[0].seed,
      variants: videos,
    });
  } catch (err) {
    console.error("[check-video]", err);
    return NextResponse.json({ error: "상태 확인 실패", detail: String(err) }, { status: 500 });
  }
}
