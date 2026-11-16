import { defineConfig } from 'vite';

// The .env file lives at the repo root, shared with the indexing scripts.
// GitHub Pages serves the site under /<repo>/, so the workflow sets VITE_BASE; Vercel and local dev use '/'.
export default defineConfig({ envDir: '..', base: process.env.VITE_BASE ?? '/' });
