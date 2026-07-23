import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // node:sqlite still prints an experimental warning on some Node versions.
    silent: false,
  },
});
