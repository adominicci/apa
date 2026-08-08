// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";
// Deno's Windows resolver can mis-scope bare imports from lowercased drive URLs.
// Keep this explicit until https://github.com/denoland/deno/pull/35866 ships.
import { vitePreprocess } from "npm:@sveltejs/vite-plugin-svelte@^5.0.0";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    alias: {
      "@tesina/engine": "../../packages/apa-engine/src/index.ts",
      "@tesina/docx-export": "../../packages/docx-export/src/index.ts",
    },
  },
};

export default config;
