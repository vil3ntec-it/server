import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// خروجی build مستقیم داخل server/public می‌نشیند تا سرور همان را سرو کند
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5273,
    proxy: {
      '/api': 'http://localhost:4700',
      '/socket.io': { target: 'http://localhost:4700', ws: true },
    },
  },
});
