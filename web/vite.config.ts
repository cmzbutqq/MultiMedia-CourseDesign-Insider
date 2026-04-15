import { defineConfig } from 'vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const pagesBase = repoName ? `/${repoName}/` : '/';

export default defineConfig({
  // Use repo-based base path in GitHub Actions for Pages.
  base: process.env.GITHUB_ACTIONS === 'true' ? pagesBase : '/',
  server: {
    strictPort: false,
    https: {
      key: './localhost-key.pem',
      cert: './localhost.pem',
    },
    hmr: {
      port: 5174,
      clientPort: 5174,
    },
    cors: true,
  },
  publicDir: 'public',
});
