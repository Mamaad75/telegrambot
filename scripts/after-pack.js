'use strict';
/**
 * پس از بسته‌بندی: درج آیکون و اطلاعات نسخه در فایل اجرایی ویندوز.
 * این کار با کتابخانه resedit (کاملاً جاوااسکریپتی) انجام می‌شود تا ساخت نسخه ویندوز
 * روی لینوکس و مک هم بدون نیاز به wine ممکن باشد.
 */
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exeName = (context.packager.appInfo.productFilename || 'app') + '.exe';
  const exePath = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exePath)) {
    console.warn('afterPack: فایل اجرایی یافت نشد:', exePath);
    return;
  }

  let ResEdit;
  try {
    ResEdit = require('resedit');
  } catch (_) {
    console.warn('afterPack: کتابخانه resedit نصب نیست؛ آیکون فایل اجرایی تغییر نکرد.');
    return;
  }

  const root = path.join(__dirname, '..');
  const iconFile = path.join(root, 'build', 'icon.ico');
  const pkg = require(path.join(root, 'package.json'));
  const version = context.packager.appInfo.version || pkg.version;

  const data = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(data);
  const res = ResEdit.NtExecutableResource.from(exe);

  // آیکون
  if (fs.existsSync(iconFile)) {
    const iconFileObj = ResEdit.Data.IconFile.from(fs.readFileSync(iconFile));
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries, 1, 1033,
      iconFileObj.icons.map((i) => i.data),
    );
  }

  // اطلاعات نسخه
  const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10) || 0);
  const vi = ResEdit.Resource.VersionInfo.createEmpty();
  vi.setFileVersion(major, minor, patch, 0, 1033);
  vi.setProductVersion(major, minor, patch, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: 'MyShop Accounting',
    FileDescription: 'MyShop Accounting - Shop Accounting Software',
    CompanyName: 'MyShop Accounting',
    LegalCopyright: 'MyShop Accounting',
    OriginalFilename: exeName,
    InternalName: path.basename(exeName, '.exe'),
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('afterPack: آیکون و اطلاعات نسخه در ' + exeName + ' درج شد.');
};
