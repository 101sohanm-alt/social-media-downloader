import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        main_interceptor: resolve(__dirname, 'src/content/main_interceptor.ts'),
        isolated_bridge: resolve(__dirname, 'src/content/isolated_bridge.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          if (chunkInfo.name === 'main_interceptor') return 'content/main_interceptor.js';
          if (chunkInfo.name === 'isolated_bridge') return 'content/isolated_bridge.js';
          if (chunkInfo.name === 'offscreen') return 'offscreen/offscreen.js';
          if (chunkInfo.name === 'popup') return 'popup/popup.js';
          return 'chunks/[name].js';
        },
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'styles.css') return 'content/ui/styles.css';
          if (assetInfo.name === 'popup.css') return 'popup/popup.css';
          return 'assets/[name][extname]';
        }
      }
    }
  },
  plugins: [
    {
      name: 'copy-extension-assets',
      writeBundle() {
        // Copy manifest.json
        fs.copyFileSync('src/manifest.json', 'dist/manifest.json');

        // Move popup.html and offscreen.html to clean directories
        if (fs.existsSync('dist/src/popup/popup.html')) {
          fs.mkdirSync('dist/popup', { recursive: true });
          fs.copyFileSync('dist/src/popup/popup.html', 'dist/popup/popup.html');
        }
        if (fs.existsSync('dist/src/offscreen/offscreen.html')) {
          fs.mkdirSync('dist/offscreen', { recursive: true });
          fs.copyFileSync('dist/src/offscreen/offscreen.html', 'dist/offscreen/offscreen.html');
        }
        if (fs.existsSync('dist/src')) {
          fs.rmSync('dist/src', { recursive: true, force: true });
        }

        // Copy styles.css to content/ui/
        fs.mkdirSync('dist/content/ui', { recursive: true });
        if (fs.existsSync('src/content/ui/styles.css')) {
          fs.copyFileSync('src/content/ui/styles.css', 'dist/content/ui/styles.css');
        }

        // Copy icons
        fs.mkdirSync('dist/icons', { recursive: true });
        ['icon16.png', 'icon48.png', 'icon128.png'].forEach((file) => {
          if (fs.existsSync(`src/icons/${file}`)) {
            fs.copyFileSync(`src/icons/${file}`, `dist/icons/${file}`);
          }
        });
      }
    }
  ]
});
