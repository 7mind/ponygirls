import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ cacheDir: '.cache/vite', plugins: [react()], server: { fs: { allow: ['..'] } } });
