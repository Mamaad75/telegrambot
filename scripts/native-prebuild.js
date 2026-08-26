'use strict';
/**
 * دریافت و نصب باینری آماده better-sqlite3 برای یک پلتفرم/نسخه Electron مشخص.
 * برای ساخت نسخه ویندوز روی لینوکس و همچنین اجرای برنامه در محیط توسعه لازم است.
 *
 * استفاده:
 *   node scripts/native-prebuild.js --platform win32 --arch x64 --abi 136 [--install]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const VERSION = (pkg.dependencies['better-sqlite3'] || '').replace(/^[^0-9]*/, '');
const CACHE = path.join(root, '.native-cache');

function parseArgs() {
  const out = { platform: process.platform, arch: process.arch, abi: null, install: false, restore: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--platform') out.platform = argv[i + 1];
    else if (argv[i] === '--arch') out.arch = argv[i + 1];
    else if (argv[i] === '--abi') out.abi = argv[i + 1];
    else if (argv[i] === '--install') out.install = true;
    else if (argv[i] === '--restore') out.restore = true;
  }
  return out;
}

function downloadWithCurl(url, dest) {
  execFileSync('curl', ['-sSL', '--fail', '--connect-timeout', '20', '--max-time', '180', '-o', dest, url], { stdio: 'pipe' });
  return dest;
}

function downloadWithHttps(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'myshop-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        downloadWithHttps(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`دانلود ناموفق (${res.statusCode}): ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    });
    req.setTimeout(120000, () => req.destroy(new Error('زمان دانلود به پایان رسید')));
    req.on('error', reject);
  });
}

/** دانلود با curl (در صورت وجود) و در غیر این صورت با ماژول https */
async function download(url, dest) {
  try {
    return downloadWithCurl(url, dest);
  } catch (e) {
    return downloadWithHttps(url, dest);
  }
}

/** استخراج فایل .node از آرشیو tar.gz بدون وابستگی بیرونی */
function extractNode(tgz, outFile) {
  const buf = zlib.gunzipSync(fs.readFileSync(tgz));
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.slice(offset, offset + 512);
    const name = header.slice(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const sizeField = header.slice(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeField, 8) || 0;
    const dataStart = offset + 512;
    if (name.endsWith('.node')) {
      fs.writeFileSync(outFile, buf.slice(dataStart, dataStart + size));
      return true;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return false;
}

async function fetchPrebuild({ platform, arch, abi }) {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  const key = `better-sqlite3-v${VERSION}-electron-v${abi}-${platform}-${arch}`;
  const target = path.join(CACHE, key + '.node');
  if (fs.existsSync(target)) return target;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${VERSION}/${key}.tar.gz`;
  const tgz = path.join(CACHE, key + '.tar.gz');
  process.stdout.write(`دریافت باینری ${key} ...\n`);
  await download(url, tgz);
  if (!extractNode(tgz, target)) throw new Error('فایل .node در آرشیو یافت نشد: ' + key);
  fs.unlinkSync(tgz);
  return target;
}

function nodeModulePath() {
  return path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
}

function backupPath() {
  return path.join(CACHE, 'better_sqlite3.node.original');
}

/** نصب باینری در node_modules با نگهداری نسخه اصلی */
function install(file) {
  const dest = nodeModulePath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(backupPath()) && fs.existsSync(dest)) {
    if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
    fs.copyFileSync(dest, backupPath());
  }
  fs.copyFileSync(file, dest);
  return dest;
}

/** بازگرداندن باینری اصلی (نسخه Node.js) */
function restore() {
  if (fs.existsSync(backupPath())) {
    fs.copyFileSync(backupPath(), nodeModulePath());
    return true;
  }
  return false;
}

async function main() {
  const args = parseArgs();
  if (args.restore) {
    console.log(restore() ? 'باینری اصلی (Node.js) بازگردانده شد.' : 'نسخه پشتیبانی برای بازگردانی وجود ندارد.');
    return;
  }
  if (!args.abi) throw new Error('پارامتر --abi الزامی است.');
  const file = await fetchPrebuild(args);
  console.log('باینری آماده:', file);
  if (args.install) {
    console.log('نصب شد در:', install(file));
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('خطا:', e.message); process.exit(1); });
}

module.exports = { fetchPrebuild, install, restore, nodeModulePath, backupPath, VERSION, CACHE };
