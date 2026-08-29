'use strict';
/*
 * ساخت آیکون برنامه (build/icon.png) با رندر کردن یک طرح ساده.
 * اجرا:  npx electron tools/make-icon.js
 * electron-builder به‌طور خودکار از این PNG فایل ico ویندوز را می‌سازد.
 */
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', 'build');
const SIZE = 512;

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:transparent}
  .box{width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center}
  svg{display:block}
</style></head><body><div class="box">
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2b4d7c"/><stop offset="100%" stop-color="#16324f"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#14b8a6"/><stop offset="100%" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="104" fill="url(#g)"/>
  <rect x="96" y="88" width="320" height="336" rx="34" fill="#ffffff"/>
  <rect x="128" y="122" width="256" height="74" rx="16" fill="#eef3f9"/>
  <rect x="150" y="146" width="150" height="26" rx="9" fill="#c3d3e6"/>
  <circle cx="352" cy="159" r="14" fill="url(#acc)"/>
  <g fill="#1f3a5f">
    <rect x="128" y="222" width="70" height="56" rx="14"/>
    <rect x="215" y="222" width="70" height="56" rx="14"/>
    <rect x="302" y="222" width="82" height="56" rx="14" fill="url(#acc)"/>
    <rect x="128" y="294" width="70" height="56" rx="14"/>
    <rect x="215" y="294" width="70" height="56" rx="14"/>
    <rect x="128" y="366" width="157" height="56" rx="14"/>
    <rect x="302" y="294" width="82" height="128" rx="14" fill="url(#acc)"/>
  </g>
</svg></div></body></html>`;

app.disableHardwareAcceleration();

app.whenReady().then(async function () {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: false }
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await new Promise(function (r) { setTimeout(r, 500); });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'icon.png'), img.toPNG());
  const small = img.resize({ width: 256, height: 256 });
  fs.writeFileSync(path.join(OUT, 'icon-256.png'), small.toPNG());
  console.log('آیکون ساخته شد: ' + path.join(OUT, 'icon.png'));
  win.destroy();
  app.exit(0);
});
