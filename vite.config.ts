import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';

/** Short commit of the build, shown in the page footer; 'lokal' when git is not available. */
function buildCommit(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'lokal'; }
  catch { return 'lokal'; }
}

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  define: { __UANGKU_BUILD__: JSON.stringify(buildCommit()) },
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
});
