import { ImageResponse } from "next/og";
import { getClientContent } from "../client-content";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { readonly params: Promise<{ readonly client: string }> }) {
  const { client: id } = await params;
  const client = getClientContent(id);
  const title = client?.eyebrow ?? "Truss";
  const description = client?.title ?? "Local-first coding agents";

  return new ImageResponse(<div style={{ alignItems: "stretch", background: "#0c1613", color: "#ecf5ef", display: "flex", fontFamily: "sans-serif", height: "100%", padding: 64, width: "100%" }}><div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "62%" }}><div style={{ color: "#8cddb6", display: "flex", fontSize: 24, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>{title}</div><div style={{ display: "flex", flexDirection: "column", gap: 18 }}><div style={{ display: "flex", fontSize: 78, fontWeight: 800, letterSpacing: -3, lineHeight: 1.02 }}>Truss</div><div style={{ color: "#bdd0c6", display: "flex", fontSize: 30, lineHeight: 1.25 }}>{description}</div></div><div style={{ color: "#8cddb6", display: "flex", fontSize: 21 }}>Local-first coding agents</div></div><div style={{ border: "2px solid #4c7764", borderRadius: 24, display: "flex", flex: 1, marginLeft: 42, padding: 30 }}><div style={{ border: "2px solid #78c69d", borderRadius: 14, display: "flex", flexDirection: "column", gap: 18, height: "100%", padding: 24, width: "100%" }}><div style={{ background: "#78c69d", borderRadius: 999, display: "flex", height: 12, width: "30%" }} /><div style={{ background: "#315849", borderRadius: 999, display: "flex", height: 12, width: "88%" }} /><div style={{ background: "#315849", borderRadius: 999, display: "flex", height: 12, width: "70%" }} /><div style={{ background: "#315849", borderRadius: 999, display: "flex", height: 12, width: "82%" }} /><div style={{ background: "#315849", borderRadius: 999, display: "flex", height: 12, width: "56%" }} /><div style={{ background: "#78c69d", borderRadius: 999, display: "flex", height: 12, marginTop: "auto", width: "44%" }} /></div></div></div>, size);
}
