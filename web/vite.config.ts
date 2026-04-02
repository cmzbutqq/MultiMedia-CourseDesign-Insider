import { defineConfig } from 'vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const pagesBase = repoName ? `/${repoName}/` : '/';
const host = '0.0.0.0';
const port = 5174;

export default defineConfig({
  // Use repo-based base path in GitHub Actions for Pages.
  base: process.env.GITHUB_ACTIONS === 'true' ? pagesBase : '/',
  server: {
    host,
    port,
    strictPort: false,
    https: {
      key: './localhost-key.pem',
      cert: './localhost.pem',
    },
    hmr: {
      port,
      clientPort: port,
    },
    cors: true,
  },
  publicDir: 'public',
});
