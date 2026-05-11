import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vite config.
 *
 * Notes:
 * - We inject COOP/COEP headers in dev so that SharedArrayBuffer works for v86.
 *   (Without them, v86 falls back to a slower, single-threaded path.)
 * - v86 ships as plain JS/WASM in /public/v86 — we don't bundle it, Vite just serves it.
 * - The Linux disk image is a large (~30 MB) flat file in /public/images; excluded from
 *   the JS bundle and streamed by the emulator on demand.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
    fs: {
      // Allow serving large image files from /public
      allow: ['.'],
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // v86 files are already in /public; don't try to process them.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          'xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@/emulator/v86-loader'],
  },
});
