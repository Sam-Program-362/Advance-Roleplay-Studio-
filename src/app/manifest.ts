import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Roleplay Studio — Advanced AI Character Studio",
    short_name: "Roleplay Studio",
    description:
      "Multi-model AI roleplay studio with character creation, lorebooks, memory summarisation and an AI Writer.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0e1b",
    theme_color: "#020617",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
