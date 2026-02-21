import { defineConfig, normalizePath } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import react from '@vitejs/plugin-react-swc';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const webviewerPublicDir = normalizePath(
  resolve(__dirname, '../../node_modules/@pdftron/webviewer/public'),
);

export default defineConfig({
  root: __dirname,
  publicDir: false,
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: `${webviewerPublicDir}/**/*`,
          dest: 'webviewer',
        },
      ],
    }),
  ],
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, '../../dist/renderer'),
    emptyOutDir: true,
  },
});
