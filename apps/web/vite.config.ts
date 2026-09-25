import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.VITE_BASE || '/';

/** GitHub Pages serves 404.html for unknown paths: copy index.html so deep links work. */
function spaFallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist');
      const index = path.join(dist, 'index.html');
      if (fs.existsSync(index)) fs.copyFileSync(index, path.join(dist, '404.html'));
      if (process.env.PAGES_CNAME)
        fs.writeFileSync(path.join(dist, 'CNAME'), process.env.PAGES_CNAME.trim() + '\n');
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Sea Trader',
        short_name: 'Sea Trader',
        description: 'Real-time multiplayer shipping tycoon in the spirit of Ports of Call.',
        theme_color: '#1d3566',
        background_color: '#1d3566',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,woff,woff2,svg}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
    spaFallback(),
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { port: 5173 },
});
