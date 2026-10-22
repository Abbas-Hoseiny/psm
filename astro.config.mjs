import { fileURLToPath } from "node:url";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const APP_VERSION = "2.0.0";

/**
 * Sammelt alle gehashten Build-Assets, die der Service Worker beim Install
 * vorladen soll. Die Lookup-Datenbanken (EPPO/BBCH, *.sqlite) werden bewusst
 * ausgelassen: sie sind groß und werden erst bei Bedarf geladen (und dann über
 * die Cache-first-Regel im SW gecacht).
 */
async function collectPrecacheAssets(distDir) {
  const astroDir = new URL("_astro/", distDir);
  let entries = [];
  try {
    entries = await readdir(astroDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(js|mjs|css|wasm|woff2)$/.test(name))
    // Nicht benötigte Nebenprodukte des sqlite-wasm-Pakets (Worker1-API,
    // OPFS-Proxy ohne COOP/COEP) nicht vorladen – sie liegen weiterhin in dist.
    .filter(
      (name) =>
        !name.startsWith("sqlite3-worker1") &&
        !name.startsWith("sqlite3-opfs-async-proxy")
    )
    .sort()
    .map((name) => `/_astro/${name}`);
}

// https://astro.build/config
export default defineConfig({
  // Kanonischer Host ist die Apex-Domain; www.digitale-psm.de leitet per 301 dorthin.
  site: "https://digitale-psm.de",
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
      // Stempelt pro Build eine eindeutige CACHE_VERSION in dist/sw.js und
      // setzt die Liste der gehashten Assets für den Precache ein.
      // public/sw.js ist statisch; ohne dies ändern sich die SW-Bytes pro Deploy
      // nie -> der Browser installiert keinen neuen Service Worker, alte Caches
      // bleiben für immer und installierte PWA-Nutzer hängen auf altem Code.
      name: "sw-cache-version-stamp",
      hooks: {
        "astro:build:done": async ({ dir, logger }) => {
          const swPath = fileURLToPath(new URL("sw.js", dir));
          try {
            const content = await readFile(swPath, "utf-8");
            const version = `v${APP_VERSION}-${Date.now()}`;
            const precache = await collectPrecacheAssets(dir);
            let next = content.replace(
              /const CACHE_VERSION = ['"][^'"]+['"];/,
              `const CACHE_VERSION = '${version}';`
            );
            next = next.replace(
              /const PRECACHE_ASSETS = \/\* __PRECACHE_ASSETS__ \*\/ \[\];/,
              `const PRECACHE_ASSETS = ${JSON.stringify(precache)};`
            );
            if (next !== content) {
              await writeFile(swPath, next, "utf-8");
              logger?.info?.(
                `Service Worker CACHE_VERSION: ${version}, Precache: ${precache.length} Assets`
              );
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
    optimizeDeps: {
      // Emscripten-Modul nicht vorbündeln (import.meta.url-basierte Asset-Auflösung)
      exclude: ["@sqlite.org/sqlite-wasm"],
    },
    worker: {
      // Der SQLite-Worker wird als ES-Modul erzeugt (type: "module")
      format: "es",
    },
    build: {
      assetsInlineLimit: 0,
      // Chunk-Aufteilung erfolgt über dynamische Imports (Infos, GPS, BVL/
      // Zulassung); die frühere manualChunks-Konfiguration war wirkungslos,
      // weil relative Pfade nicht auf Modul-IDs aufgelöst wurden.
      chunkSizeWarningLimit: 600,
    },
  },
});
