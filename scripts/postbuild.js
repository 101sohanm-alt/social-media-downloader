import fs from 'fs';
import path from 'path';

const dist = path.resolve('dist');

// Move popup.html
const srcPopup = path.join(dist, 'src/popup/popup.html');
const destPopupDir = path.join(dist, 'popup');
const destPopup = path.join(destPopupDir, 'popup.html');
if (fs.existsSync(srcPopup)) {
  fs.mkdirSync(destPopupDir, { recursive: true });
  fs.copyFileSync(srcPopup, destPopup);
}

// Move offscreen.html
const srcOffscreen = path.join(dist, 'src/offscreen/offscreen.html');
const destOffscreenDir = path.join(dist, 'offscreen');
const destOffscreen = path.join(destOffscreenDir, 'offscreen.html');
if (fs.existsSync(srcOffscreen)) {
  fs.mkdirSync(destOffscreenDir, { recursive: true });
  fs.copyFileSync(srcOffscreen, destOffscreen);
}

// Clean up dist/src
const srcDir = path.join(dist, 'src');
if (fs.existsSync(srcDir)) {
  fs.rmSync(srcDir, { recursive: true, force: true });
}

console.log('Postbuild asset restructuring complete.');
