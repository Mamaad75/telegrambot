'use strict';
/**
 * نویسنده فایل اکسل (xlsx) بدون هیچ وابستگی بیرونی.
 * خروجی یک بسته استاندارد OOXML است: چند شیت، سرستون‌های فارسی، راست‌به‌چپ،
 * قالب عدد سه‌رقمی و عرض ستون قابل تنظیم.
 */
const zlib = require('zlib');

// ── ابزار ZIP ────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i += 1) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))) & 0xFFFF;
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
}

/** ساخت آرشیو zip از فهرست فایل‌ها */
function zip(files) {
  const now = new Date();
  const time = dosTime(now); const date = dosDate(now);
  const chunks = []; const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const content = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const deflated = zlib.deflateRawSync(content, { level: 9 });
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // نام فایل با کدگذاری UTF-8
    local.writeUInt16LE(8, 8);      // فشرده‌سازی deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, deflated);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(content.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + deflated.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

// ── ابزار XML ────────────────────────────────────────────────────
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colName(index) {
  let n = index + 1; let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const STYLE = { DEFAULT: 0, HEADER: 1, TEXT: 2, MONEY: 3, QTY: 4, TOTAL_MONEY: 5, TOTAL_TEXT: 6, CENTER: 7, TITLE: 8 };

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.###"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Tahoma"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font>
<font><b/><sz val="11"/><name val="Tahoma"/></font>
<font><b/><sz val="14"/><name val="Tahoma"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3B57"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB6C2CE"/></left><right style="thin"><color rgb="FFB6C2CE"/></right><top style="thin"><color rgb="FFB6C2CE"/></top><bottom style="thin"><color rgb="FFB6C2CE"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sanitizeSheetName(name, used) {
  let n = String(name || 'شیت').replace(/[\\/?*[\]:]/g, '-').slice(0, 31).trim() || 'شیت';
  let i = 2;
  while (used.has(n)) { const suffix = ' ' + i; n = n.slice(0, 31 - suffix.length) + suffix; i += 1; }
  used.add(n);
  return n;
}

function cellXml(ref, value, styleId, type) {
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}" s="${styleId}"/>`;
  }
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${styleId}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(sheet) {
  const cols = sheet.columns || [];
  const colsXml = cols.length
    ? `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rows = [];
  let rowIndex = 1;

  if (sheet.title) {
    rows.push(`<row r="${rowIndex}" ht="22" customHeight="1">${cellXml('A' + rowIndex, sheet.title, STYLE.TITLE, 'text')}</row>`);
    rowIndex += 1;
    if (sheet.subtitle) {
      rows.push(`<row r="${rowIndex}">${cellXml('A' + rowIndex, sheet.subtitle, STYLE.DEFAULT, 'text')}</row>`);
      rowIndex += 1;
    }
    rows.push(`<row r="${rowIndex}"/>`);
    rowIndex += 1;
  }

  const headerRow = rowIndex;
  rows.push(`<row r="${rowIndex}" ht="26" customHeight="1">${
    cols.map((c, i) => cellXml(colName(i) + rowIndex, c.header, STYLE.HEADER, 'text')).join('')}</row>`);
  rowIndex += 1;

  for (const item of sheet.rows || []) {
    const cells = cols.map((c, i) => {
      const raw = typeof c.value === 'function' ? c.value(item) : item[c.key];
      let style = STYLE.TEXT; let type = 'text'; let val = raw;
      if (c.type === 'money') { style = STYLE.MONEY; type = 'number'; val = Number(raw) || 0; } else if (c.type === 'qty') { style = STYLE.QTY; type = 'number'; val = Number(raw) || 0; } else if (c.type === 'number') { style = STYLE.CENTER; type = 'number'; val = Number(raw) || 0; } else if (c.type === 'center') { style = STYLE.CENTER; }
      return cellXml(colName(i) + rowIndex, val, style, type);
    }).join('');
    rows.push(`<row r="${rowIndex}">${cells}</row>`);
    rowIndex += 1;
  }

  if (sheet.totals) {
    const cells = cols.map((c, i) => {
      const raw = sheet.totals[c.key];
      if (raw === undefined || raw === null) {
        return cellXml(colName(i) + rowIndex, i === 0 ? 'جمع کل' : '', STYLE.TOTAL_TEXT, 'text');
      }
      const isNum = c.type === 'money' || c.type === 'qty' || c.type === 'number';
      return cellXml(colName(i) + rowIndex, isNum ? Number(raw) || 0 : raw,
        isNum ? STYLE.TOTAL_MONEY : STYLE.TOTAL_TEXT, isNum ? 'number' : 'text');
    }).join('');
    rows.push(`<row r="${rowIndex}">${cells}</row>`);
    rowIndex += 1;
  }

  const lastCol = colName(Math.max(0, cols.length - 1));
  const dim = `A1:${lastCol}${Math.max(1, rowIndex - 1)}`;
  const freeze = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`;
  const autoFilter = cols.length && (sheet.rows || []).length
    ? `<autoFilter ref="A${headerRow}:${lastCol}${headerRow + (sheet.rows || []).length}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dim}"/>
<sheetViews><sheetView rightToLeft="1" workbookViewId="0" ${sheet.first ? 'tabSelected="1"' : ''}>${freeze}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${colsXml}
<sheetData>${rows.join('')}</sheetData>
${autoFilter}
<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
</worksheet>`;
}

/**
 * ساخت فایل اکسل.
 * @param {Array<{name:string,title?:string,subtitle?:string,columns:Array,rows:Array,totals?:object}>} sheets
 * @returns {Buffer}
 */
function build(sheets) {
  const used = new Set();
  const list = (sheets || []).filter(Boolean).map((s, i) => ({
    ...s, name: sanitizeSheetName(s.name, used), first: i === 0,
  }));
  if (!list.length) {
    list.push({ name: 'خالی', columns: [{ header: 'داده‌ای وجود ندارد', key: 'x', width: 30 }], rows: [], first: true });
  }

  const files = [];
  files.push({
    name: '[Content_Types].xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${list.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  });
  files.push({
    name: '_rels/.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  });
  files.push({
    name: 'docProps/core.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>گزارش حسابداری</dc:title><dc:creator>نرم‌افزار حسابداری فروشگاه</dc:creator>
<cp:lastModifiedBy>نرم‌افزار حسابداری فروشگاه</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`,
  });
  files.push({
    name: 'docProps/app.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>MyShop Accounting</Application></Properties>`,
  });
  files.push({
    name: 'xl/workbook.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/><bookViews><workbookView firstSheet="0" activeTab="0"/></bookViews>
<sheets>${list.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${list.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  });
  files.push({ name: 'xl/styles.xml', data: STYLES_XML });
  list.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
  return zip(files);
}

module.exports = { build, STYLE, colName, crc32, zip, esc };
