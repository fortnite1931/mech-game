import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  // относительные пути — чтобы работало и на GitHub Pages (/mech-game/), и локально
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        // редактор (для разработки, НЕ публикуется)
        editor: path.resolve(__dirname, "index.html"),
        // игра — публикуемый клиент (стартовая страница на платформах)
        game: path.resolve(__dirname, "game.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
