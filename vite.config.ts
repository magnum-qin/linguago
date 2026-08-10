import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import vuetify from 'vite-plugin-vuetify';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true }), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // If we need to proxy API requests to local wrangler backend in dev
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  }
});
