import { defineConfig } from 'vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const pagesBase = repoName ? `/${repoName}/` : '/';

export default defineConfig({
  // Use repo-based base path in GitHub Actions for Pages.
  base: process.env.GITHUB_ACTIONS === 'true' ? pagesBase : '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: {
      clientPort: 5173,
    },
  },
  publicDir: 'public',
});
