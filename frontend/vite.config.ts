import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const backend = process.env.LOCUS_BACKEND ?? "http://localhost:8000";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false,
      registerType: "autoUpdate",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
      },
      manifest: {
        name: "Oukilé",
        short_name: "Oukilé",
        description: "The family’s devices, and the people who share their location, on one private map.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f2f2f7",
        theme_color: "#f2f2f7",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // Keep the browser's Host header so the backend's Origin check passes.
    proxy: { "/api": { target: backend, ws: true } },
  },
});
