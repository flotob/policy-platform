import { ImageResponse } from "next/og";

/** The home-screen icon (iOS): the two circles of the wordmark on the page's paper colour. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const circle = (left: number, color: string) => (
    <div
      style={{
        position: "absolute",
        left,
        top: 42,
        width: 96,
        height: 96,
        borderRadius: 48,
        border: `10px solid ${color}`,
        background: `${color}29`,
      }}
    />
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#f3f4f1" }}>
        {circle(24, "#3e6f94")}
        {circle(60, "#8e6aa3")}
      </div>
    ),
    size,
  );
}
