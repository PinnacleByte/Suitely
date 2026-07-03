import type { MetadataRoute } from "next";

// Served by Next at /manifest.webmanifest. Colors match app/globals.css
// (--background: #09090f) so the splash screen and OS chrome stay dark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Suitely — Hotel Management",
    short_name: "Suitely",
    description: "Manage reservations, staff, and rooms efficiently",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#09090f",
    theme_color: "#09090f",
    orientation: "portrait",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
