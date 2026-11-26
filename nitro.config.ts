// Server settings for the built app (read by Nitro alongside vite.config.ts).
// Fonts, sounds and the cut-out model never change under the same name
// within a deploy, so browsers keep them for a day instead of asking again
// on every visit (each ask is a round trip to the server).
import { defineConfig } from "nitro/config";

export default defineConfig({
  routeRules: {
    "/fonts/**": {
      headers: { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" },
    },
    "/sounds/**": {
      headers: { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" },
    },
    "/models/**": {
      headers: { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" },
    },
  },
});
