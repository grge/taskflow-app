// This build's core version (see scripts/core-version.mjs), injected by Vite.
// Outside a Vite build (node tests) it is 'dev'; the backend computes its own.
/* global __TASKFLOW_CORE_VERSION__ */
export const CORE_VERSION = typeof __TASKFLOW_CORE_VERSION__ === 'string' ? __TASKFLOW_CORE_VERSION__ : 'dev';
