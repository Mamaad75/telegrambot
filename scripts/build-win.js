'use strict';
/**
 * ساخت نسخه ویندوز (نصب‌کننده NSIS و نسخه قابل حمل).
 * مراحل: تولید کتابخانه‌های رابط کاربری، نصب باینری بومی ویندوز،
 * اجرای electron-builder و بازگرداندن باینری محیط توسعه.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const native = require('./native-prebuild');
const { ELECTRON_ABI, electronMajor } = require('./electron-native');

function step(msg) { console.log('\n\x1b[1m▶ ' + msg + '\x1b[0m'); }
function run(cmd, args, opts) {
  return execFileSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
}

async function main() {
  const dirOnly = process.argv.includes('--dir');

  step('۱) تولید کتابخانه‌های مشترک رابط کاربری');
  run(process.execPath, [path.join(root, 'scripts', 'gen-renderer-libs.js')]);

  step('۲) آماده‌سازی باینری better-sqlite3 برای ویندوز');
  const abi = ELECTRON_ABI[electronMajor()];
  if (!abi) throw new Error('ABI ناشناخته برای Electron ' + electronMajor());
  const file = await native.fetchPrebuild({ platform: 'win32', arch: 'x64', abi });
  native.install(file);
  console.log('باینری ویندوز نصب شد:', path.basename(file));

  try {
    step('۳) اجرای electron-builder');
    const builderArgs = ['electron-builder', '--win', '--x64', '--config', 'electron-builder.yml'];
    if (dirOnly) builderArgs.push('--dir');
    run('npx', builderArgs, { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  } finally {
    step('۴) بازگرداندن باینری محیط توسعه (Node.js)');
    console.log(native.restore() ? 'انجام شد.' : 'نسخه پشتیبان موجود نبود.');
  }

  step('نتیجه');
  const dist = path.join(root, 'dist');
  if (fs.existsSync(dist)) {
    for (const f of fs.readdirSync(dist)) {
      const st = fs.statSync(path.join(dist, f));
      if (st.isFile()) console.log(` • ${f} — ${(st.size / 1024 / 1024).toFixed(1)} مگابایت`);
    }
  }
}

main().catch((e) => {
  console.error('\x1b[31mساخت ناموفق بود:\x1b[0m', e.message);
  try { native.restore(); } catch (_) { /* نادیده */ }
  process.exit(1);
});
