import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['{apps,packages,scripts}/**/*.test.{ts,tsx,js,mjs}'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    exclude: ['**/node_modules/**', '**/.next/**', '**/e2e/**'],
  },
});
