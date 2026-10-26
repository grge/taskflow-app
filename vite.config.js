import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { coreVersion } from './scripts/core-version.mjs';

export default defineConfig({
  base: '/taskflow-app/',
  // Compared with the backend's in /v1/info, so a device can say when the two
  // would apply operations differently.
  define: { __TASKFLOW_CORE_VERSION__: JSON.stringify(coreVersion()) },
  plugins: [
    svelte({
      onwarn(warning, handler) {
        if (warning.code.startsWith('a11y')) return;
        handler(warning);
      }
    })
  ]
});
