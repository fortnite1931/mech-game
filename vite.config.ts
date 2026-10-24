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
        // редактор (локально по умолчанию; на GitHub главную заменит игра через workflow)
        main: path.resolve(__dirname, "index.html"),
        // редактор как отдельная страница /editor.html на GitHub Pages
        editor: path.resolve(__dirname, "editor.html"),
        // игра — публикуемый клиент (на платформах/Pages)
        game: path.resolve(__dirname, "game.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
