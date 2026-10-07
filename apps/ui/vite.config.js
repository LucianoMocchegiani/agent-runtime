import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const runtime = process.env.AGENT_RUNTIME_URL || 'http://localhost:3010';

export default defineConfig({
  plugins: [react()],
  base: '/',
  // En prod la UI la sirve agent-runtime (mismo origen). En dev, Vite proxea la API para no depender de CORS.
  server: {
    port: 3001,
    host: true,
    proxy: {
      '/v1': runtime,
      '/health': runtime,
    },
  },
});
