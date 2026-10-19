import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MonoPredict",
    short_name: "MonoPredict",
    description: "Play-money prediction markets for friends. Virtual Monos only — nothing here has real value.",
    start_url: "/",
    display: "standalone",
    background_color: "#141a16",
    theme_color: "#0f9d58",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
