import { defineConfig } from 'vite';

// The .env file lives at the repo root, shared with the indexing scripts.
export default defineConfig({ envDir: '..' });
