import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the dashboard runs on Vite's server and calls ToolWarden's admin API through this proxy.
// In production ToolWarden serves the built files itself, from the same origin as the API.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8090' } },
  build: { outDir: 'dist', sourcemap: true },
});
