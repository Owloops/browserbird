import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: '.',
  plugins: [svelte()],
  server: {
    port: 3000,
    proxy: {
      '/api/events': {
        target: 'http://127.0.0.1:18800',
        headers: { Connection: 'keep-alive' },
      },
      '/api': 'http://127.0.0.1:18800',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
