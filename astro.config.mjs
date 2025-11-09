import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://abbas-hoseiny.github.io',
  base: '/pflanzenschutzliste',
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
    assets: '_astro'
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'sqlite': ['./src/scripts/core/storage/sqlite'],
            'bvl': ['./src/scripts/core/bvlSync', './src/scripts/core/bvlDataset', './src/scripts/core/bvlClient'],
            'vendor': ['./src/scripts/core/bootstrap']
          }
        }
      }
    }
  }
});
