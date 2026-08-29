'use strict';
/*
 * اجراکننده آزمون‌ها به صورت مستقل از نسخه Node.
 *
 * ماژول better-sqlite3 پس از اجرای `electron-builder install-app-deps`
 * برای Electron کامپایل می‌شود و دیگر با Node معمولی اجرا نمی‌شود.
 * این فایل ابتدا Node را امتحان می‌کند و در صورت ناسازگاری، همان آزمون را
 * با موتور Node داخلی Electron اجرا می‌کند تا `npm test` همیشه کار کند.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const target = path.join(__dirname, 'run-tests.js');

function tryNode() {
  const r = spawnSync(process.execPath, [target], { stdio: 'inherit' });
  return r.status;
}

function tryElectron() {
  let electronPath;
  try {
    electronPath = require('electron');
  } catch (e) {
    return null;
  }
  if (typeof electronPath !== 'string') return null;
  const r = spawnSync(electronPath, [target], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' })
  });
  return r.status;
}

// اگر ماژول بومی با Node فعلی سازگار نباشد، خودکار به Electron سوییچ می‌کنیم
// better-sqlite3 کتابخانه بومی را فقط هنگام ساخت اتصال بارگذاری می‌کند،
// بنابراین برای تشخیص سازگاری باید یک پایگاه داده موقت باز شود.
let compatible = true;
try {
  const Database = require('better-sqlite3');
  new Database(':memory:').close();
} catch (e) {
  compatible = false;
  if (String(e.message).indexOf('NODE_MODULE_VERSION') === -1) {
    console.error('بارگذاری موتور پایگاه داده ناموفق بود:\n' + e.message);
  }
}

let status;
if (compatible) {
  status = tryNode();
} else {
  console.log('ماژول پایگاه داده برای Electron کامپایل شده است؛ آزمون با موتور Electron اجرا می‌شود.\n');
  status = tryElectron();
  if (status === null) {
    console.error('نه Node و نه Electron نتوانستند آزمون‌ها را اجرا کنند.');
    console.error('برای اجرای آزمون با Node:      npm run rebuild:node');
    console.error('برای اجرای آزمون با Electron:  npx electron tests/run-tests.js');
    status = 1;
  }
}

process.exit(status === null ? 1 : status);
