import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// S3 + CloudFront serves the built assets from the bucket root (DESIGN §4.1).
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: true },
});
