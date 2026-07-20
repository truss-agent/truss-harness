import type { MetadataRoute } from "next";
import { brand } from "@truss-harness/branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.productName,
    short_name: brand.productName,
    description: "Local-first coding agents for the CLI, terminal UI, VS Code, and desktop.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f1",
    theme_color: "#0b7965",
    icons: [{ src: "/brand-logo.png", sizes: "512x512", type: "image/png" }]
  };
}
