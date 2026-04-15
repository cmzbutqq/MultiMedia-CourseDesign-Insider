import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const pagesBase = repoName ? `/${repoName}/` : '/';

export default defineConfig({
  // Use repo-based base path in GitHub Actions for Pages.
  base: process.env.GITHUB_ACTIONS === 'true' ? pagesBase : '/',
  server: {
    strictPort: false,
    https: (() => {
      const keyPath = resolve(__dirname, 'localhost-key.pem');
      const certPath = resolve(__dirname, 'localhost.pem');
      if (!existsSync(keyPath) || !existsSync(certPath)) {
        return undefined;
      }
      return {
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
      };
    })(),
    hmr: {
      port: 5174,
      clientPort: 5174,
    },
    cors: true,
  },
  publicDir: 'public',
});
