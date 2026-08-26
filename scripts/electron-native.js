'use strict';
/** نصب باینری better-sqlite3 متناسب با نسخه Electron نصب‌شده در این پروژه */
const { execFileSync } = require('child_process');
const path = require('path');

const ELECTRON_ABI = { 32: 128, 33: 130, 34: 132, 35: 133, 36: 135, 37: 136, 38: 139 };

function electronMajor() {
  const v = require(path.join(__dirname, '..', 'node_modules', 'electron', 'package.json')).version;
  return parseInt(v.split('.')[0], 10);
}

function main() {
  const major = electronMajor();
  const abi = ELECTRON_ABI[major];
  if (!abi) throw new Error(`نسخه ABI برای Electron ${major} شناخته‌شده نیست؛ scripts/electron-native.js را به‌روزرسانی کنید.`);
  const platform = process.argv.includes('--win') ? 'win32' : process.platform;
  execFileSync(process.execPath, [
    path.join(__dirname, 'native-prebuild.js'),
    '--platform', platform, '--arch', 'x64', '--abi', String(abi), '--install',
  ], { stdio: 'inherit' });
}

if (require.main === module) main();
module.exports = { electronMajor, ELECTRON_ABI };
