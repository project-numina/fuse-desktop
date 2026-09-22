import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const rendererRoot = fileURLToPath(new URL('./src/renderer', import.meta.url));
const rendererSrc = fileURLToPath(new URL('./src/renderer/src', import.meta.url));
const sharedRoot = fileURLToPath(new URL('./src/shared', import.meta.url));
const mainSrc = fileURLToPath(new URL('./src/main', import.meta.url));

/** Fixed development port for the loopback backend (see src/main/index.ts). */
const DEV_API_PORT = process.env.FUSE_API_PORT ?? '8765';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': sharedRoot, '@main': mainSrc },
    },
    build: {
      rollupOptions: {
        // The MCP server the CLIs talk to is a second Node entry, spawned with
        // the Electron binary in Node mode (ELECTRON_RUN_AS_NODE=1).
        input: {
          index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
          'mcp-server': fileURLToPath(new URL('./src/mcp/server.ts', import.meta.url)),
          // Headless backend for tests and the screenshot harness (no Electron).
          standalone: fileURLToPath(new URL('./src/main/standalone.ts', import.meta.url)),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': sharedRoot },
    },
    build: {
      // Sandboxed preload scripts must be CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: rendererRoot,
    // Served over HTTP from the loopback backend (not file://). This base
    // applies to the dev server only: electron-vite forces `./` for
    // production builds, so the backend's static handler maps the relative
    // `./assets/x.js` requested from a deep BrowserRouter path such as
    // /repo/o/r back to /assets/x.js (see src/main/server/app.ts).
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rendererSrc,
        '@shared': sharedRoot,
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${DEV_API_PORT}`,
          changeOrigin: false,
        },
      },
    },
  },
});
