import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  site: "https://www.digitale-psm.de",
  base: "/",
  output: "static",
  build: {
    inlineStylesheets: "auto",
    assets: "_astro",
  },
  integrations: [
    sitemap(),
    {
      name: "legacy-script-loader",
      hooks: {
        "astro:config:setup"({ injectScript }) {
          injectScript("page", "import '@/scripts/main.ts';");
          injectScript("page", "import '@/scripts/components/shellClient.ts';");
          injectScript("page", "import '@/scripts/pages/indexClient.ts';");
        },
      },
    },
    {
      // Stempelt pro Build eine eindeutige CACHE_VERSION in dist/sw.js.
      // public/sw.js ist statisch; ohne dies ändern sich die SW-Bytes pro Deploy
      // nie -> der Browser installiert keinen neuen Service Worker, alte Caches
      // bleiben für immer und installierte PWA-Nutzer hängen auf altem Code.
      name: "sw-cache-version-stamp",
      hooks: {
        "astro:build:done": async ({ dir, logger }) => {
          const { readFile, writeFile } = await import("node:fs/promises");
          const swPath = fileURLToPath(new URL("sw.js", dir));
          try {
            const content = await readFile(swPath, "utf-8");
            const version = `v2.0.0-${Date.now()}`;
            const next = content.replace(
              /const CACHE_VERSION = ['"][^'"]+['"];/,
              `const CACHE_VERSION = '${version}';`
            );
            if (next !== content) {
              await writeFile(swPath, next, "utf-8");
              logger?.info?.(`Service Worker CACHE_VERSION: ${version}`);
            } else {
              logger?.warn?.(
                "CACHE_VERSION in sw.js nicht gefunden - Stamp übersprungen."
              );
            }
          } catch (err) {
            logger?.warn?.(`SW CACHE_VERSION-Stamp übersprungen: ${err}`);
          }
        },
      },
    },
  ],
  vite: {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@scripts": fileURLToPath(new URL("./src/scripts", import.meta.url)),
        "@components": fileURLToPath(
          new URL("./src/components", import.meta.url)
        ),
        "@styles": fileURLToPath(new URL("./src/styles", import.meta.url)),
        "@config": fileURLToPath(new URL("./src/config", import.meta.url)),
      },
    },
    build: {
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          manualChunks: {
            sqlite: ["./src/scripts/core/storage/sqlite"],
            bvl: [
              "./src/scripts/core/bvlSync",
              "./src/scripts/core/bvlDataset",
              "./src/scripts/core/bvlClient",
            ],
            vendor: ["./src/scripts/core/bootstrap"],
          },
        },
      },
    },
  },
});
