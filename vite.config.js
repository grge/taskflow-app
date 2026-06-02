import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/taskflow-app/',
  plugins: [
    svelte({
      onwarn(warning, handler) {
        if (warning.code.startsWith('a11y')) return;
        handler(warning);
      }
    })
  ]
});
