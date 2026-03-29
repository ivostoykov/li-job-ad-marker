import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    // Coverage is defined here for completeness but will show 0% because the
    // source files are plain browser scripts (no export statements) loaded via
    // indirect eval in tests/setup.js. V8 cannot instrument eval'd code.
    // Resolve by modularising source files if metrics become necessary.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/background.js'],
      reporter: ['text', 'html'],
    },
  },
});
