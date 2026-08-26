'use strict';
/** خطای قابل نمایش به کاربر با پیام فارسی */
class AppError extends Error {
  constructor(message, code = 'APP_ERROR', detail = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
    this.userFacing = true;
  }
}
function assert(cond, message, code) {
  if (!cond) throw new AppError(message, code || 'VALIDATION');
  return true;
}
module.exports = { AppError, assert };
