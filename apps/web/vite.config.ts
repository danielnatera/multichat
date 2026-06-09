import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          // Firebase is the heaviest browser dependency, so keep it cacheable outside the app bundle.
          if (id.includes("firebase")) {
            return "firebase";
          }

          if (id.includes("react") || id.includes("react-dom")) {
            return "react";
          }

          if (id.includes("lucide-react")) {
            return "icons";
          }

          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080"
    }
  }
});
