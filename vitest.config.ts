import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const alias = {
  '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
  '@mcp': fileURLToPath(new URL('./src/mcp', import.meta.url)),
  '@test': fileURLToPath(new URL('./tests', import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/main/**/*.ts', 'src/mcp/**/*.ts', 'src/preload/**/*.ts', 'src/renderer/src/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          environment: 'node',
          // Real Git subprocess integration tests take longer on Windows runners.
          testTimeout: process.platform === 'win32' ? 20_000 : 5_000,
          include: [
            'tests/main/**/*.test.ts',
            'tests/mcp/**/*.test.ts',
            'tests/preload/**/*.test.ts',
            'tests/shared/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          setupFiles: ['./tests/renderer/setup.ts'],
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
