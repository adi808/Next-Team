import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Demo build: the same app with an in-browser sample backend, as one JS and one CSS file.
export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_DEMO': '"1"' },
  build: {
    outDir: 'dist-demo',
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'demo.js', assetFileNames: 'demo[extname]' } },
  },
});
