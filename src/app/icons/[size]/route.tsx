import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

const SIZES = { "180": 180, "192": 192, "512": 512, maskable: 512 } as const;

export const dynamic = "force-static";
export const generateStaticParams = () => Object.keys(SIZES).map((size) => ({ size }));

export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = SIZES[size as keyof typeof SIZES];
  if (!px) return new Response("Not found", { status: 404 });
  const font = await readFile(join(process.cwd(), "src/app/icons/inter-700.woff"));
  // Maskable icons need their glyphs inside the central 80% safe zone.
  const fontSize = size === "maskable" ? px * 0.4 : px * 0.5;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0063d6", // datui --dt-primary
          color: "#ffffff",
          fontFamily: "Inter",
          fontWeight: 700,
          fontSize,
          letterSpacing: -fontSize * 0.06,
          // Optical centering: lowercase "ds" sits low in its line box.
          paddingBottom: fontSize * 0.08,
        }}
      >
        ds
      </div>
    ),
    { width: px, height: px, fonts: [{ name: "Inter", data: font, weight: 700, style: "normal" }] },
  );
}
