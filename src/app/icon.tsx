import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Camera body */}
        <div
          style={{
            width: 18,
            height: 13,
            borderRadius: 3,
            background: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* Lens circle */}
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              border: "2px solid #6366f1",
              background: "transparent",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
