import { build } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

async function runBuild() {
  console.log('🚀 Starting Chrome Extension build...');

  // 1. Build Background, Popup, and Offscreen
  console.log('📦 Bundling Background, Popup, and Offscreen...');
  await build({
    configFile: false,
    root,
    publicDir: resolve(root, 'public'),
    build: {
      outDir: dist,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(root, 'src/popup/popup.html'),
          offscreen: resolve(root, 'src/offscreen/offscreen.html'),
          background: resolve(root, 'src/background/index.ts'),
        },
        output: {
          entryFileNames: (chunk) => {
            if (chunk.name === 'background') return 'background.js';
            return '[name]/[name].js';
          },
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (asset) => {
            if (asset.name?.endsWith('.css') && asset.name.includes('popup')) {
              return 'popup/popup.css';
            }
            return 'assets/[name].[ext]';
          },
        },
      },
    },
  });

  // 2. Build Content Script: main_interceptor (IIFE, self-contained, NO ESM imports)
  console.log('📦 Bundling main_interceptor (MAIN world IIFE)...');
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      outDir: resolve(dist, 'content'),
      emptyOutDir: false,
      lib: {
        entry: resolve(root, 'src/content/main_interceptor.ts'),
        name: 'SocialDownloaderMainInterceptor',
        formats: ['iife'],
        fileName: () => 'main_interceptor.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 3. Build Content Script: isolated_bridge (IIFE, self-contained, NO ESM imports)
  console.log('📦 Bundling isolated_bridge (ISOLATED world IIFE)...');
  await build({
    configFile: false,
    root,
    publicDir: false,
    build: {
      outDir: resolve(dist, 'content'),
      emptyOutDir: false,
      lib: {
        entry: resolve(root, 'src/content/isolated_bridge.ts'),
        name: 'SocialDownloaderIsolatedBridge',
        formats: ['iife'],
        fileName: () => 'isolated_bridge.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  // 4. Organize HTML files: ensure popup.html & offscreen.html are in expected folders
  const popupSrc = resolve(dist, 'src/popup/popup.html');
  const popupDest = resolve(dist, 'popup/popup.html');
  if (fs.existsSync(popupSrc)) {
    fs.mkdirSync(resolve(dist, 'popup'), { recursive: true });
    fs.copyFileSync(popupSrc, popupDest);
  }

  const offscreenSrc = resolve(dist, 'src/offscreen/offscreen.html');
  const offscreenDest = resolve(dist, 'offscreen/offscreen.html');
  if (fs.existsSync(offscreenSrc)) {
    fs.mkdirSync(resolve(dist, 'offscreen'), { recursive: true });
    fs.copyFileSync(offscreenSrc, offscreenDest);
  }

  // Remove leftover dist/src directory if created
  const distSrc = resolve(dist, 'src');
  if (fs.existsSync(distSrc)) {
    fs.rmSync(distSrc, { recursive: true, force: true });
  }

  // 5. Ensure styles.css is present at dist/content/ui/styles.css and dist/content/styles.css
  const stylesSrc = resolve(root, 'src/content/ui/styles.css');
  const stylesDestUi = resolve(dist, 'content/ui/styles.css');
  const stylesDest = resolve(dist, 'content/styles.css');
  fs.mkdirSync(resolve(dist, 'content/ui'), { recursive: true });
  fs.copyFileSync(stylesSrc, stylesDestUi);
  fs.copyFileSync(stylesSrc, stylesDest);

  // 6. Ensure manifest.json is at dist/manifest.json
  const manifestSrc = resolve(root, 'public/manifest.json');
  const manifestDest = resolve(dist, 'manifest.json');
  fs.copyFileSync(manifestSrc, manifestDest);

  console.log('✅ Extension build completed successfully in dist/!');
}

runBuild().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
