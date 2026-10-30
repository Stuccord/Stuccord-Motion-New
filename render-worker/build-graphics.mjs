// Builds the Motion Explainer graphics bundle (graphics/index.tsx and the
// app's src/motion it draws with) into ./graphics-bundle, and fetches
// Remotion's headless Chrome, so a render needs no setup. Run at build time
// (npm run build). The app's files are read from ../src, so the build needs
// the whole repository (the Dockerfile copies what's needed).

import path from "path";
import { fileURLToPath } from "url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser } from "@remotion/renderer";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSrc = path.resolve(here, "..", "src");

const out = await bundle({
  entryPoint: path.join(here, "graphics", "index.tsx"),
  outDir: path.join(here, "graphics-bundle"),
  // The graphics fonts, served to the page as static files.
  publicDir: path.join(here, "fonts"),
  webpackOverride: (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      // The app's "@/..." imports, and its files finding the worker's packages.
      alias: { ...(config.resolve?.alias ?? {}), "@": appSrc },
      modules: [path.join(here, "node_modules"), "node_modules"],
    },
  }),
});
console.log(`[graphics] Bundled to ${out}`);

await ensureBrowser();
console.log("[graphics] Headless Chrome ready");
