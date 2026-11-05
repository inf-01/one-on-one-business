import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/* Multi-página: index (calendario), dashboard (métricas),
   data-room (documentos y minutas por proyecto). */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        dashboard: fileURLToPath(new URL('./dashboard.html', import.meta.url)),
        dataRoom: fileURLToPath(new URL('./data-room.html', import.meta.url))
      }
    }
  }
});
