'use strict';
const fs = require('fs');
const path = require('path');

let logDir = '';
let logFile = '';

function init(dir) {
  logDir = dir;
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, 'app.log');
    rotate();
  } catch (_) { logFile = ''; }
}

function rotate() {
  try {
    if (logFile && fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
      fs.renameSync(logFile, logFile + '.1');
    }
  } catch (_) { /* بی‌اهمیت */ }
}

function write(level, message, detail) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`
    + (detail ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : '');
  if (level === 'error') console.error(line); else console.log(line);
  if (!logFile) return;
  try { fs.appendFileSync(logFile, line + '\n'); } catch (_) { /* بی‌اهمیت */ }
}

module.exports = {
  init,
  file: () => logFile,
  info: (m, d) => write('info', m, d),
  warn: (m, d) => write('warn', m, d),
  error: (m, d) => write('error', m, d && d.stack ? d.stack : d),
};
