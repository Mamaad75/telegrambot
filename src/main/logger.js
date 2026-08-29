'use strict';
/* ثبت خطاهای فنی در فایل، جدا از پیام‌های کاربر */
const fs = require('fs');

let logFile = null;
const MAX_SIZE = 2 * 1024 * 1024;

function init(file) {
  logFile = file;
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_SIZE) {
      fs.renameSync(file, file + '.old');
    }
  } catch (e) { /* بی‌اهمیت */ }
}

function write(level, message, extra) {
  const line = '[' + new Date().toISOString() + '] ' + level + ' ' + message +
    (extra ? '\n' + (extra.stack || JSON.stringify(extra)) : '') + '\n';
  if (level === 'ERROR') process.stderr.write(line);
  if (!logFile) return;
  try { fs.appendFileSync(logFile, line); } catch (e) { /* بی‌اهمیت */ }
}

module.exports = {
  init: init,
  info: function (m, e) { write('INFO', m, e); },
  warn: function (m, e) { write('WARN', m, e); },
  error: function (m, e) { write('ERROR', m, e); }
};
