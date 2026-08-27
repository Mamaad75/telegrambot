'use strict';
/**
 * مهاجرت‌های پایگاه داده.
 * نسخه ساختار در PRAGMA user_version نگهداری می‌شود و هر مهاجرت فقط یک بار اجرا می‌گردد.
 * هرگز مهاجرت قبلی را تغییر ندهید؛ برای تغییر ساختار، مهاجرت جدید اضافه کنید تا
 * داده‌های کاربران فعلی حفظ شود.
 */

const CHART_OF_ACCOUNTS = [
  // دارایی‌ها
  { code: '101', name: 'صندوق', type: 'asset', side: 'debit', cash: 1, order: 101 },
  { code: '102', name: 'کارتخوان (POS)', type: 'asset', side: 'debit', cash: 1, order: 102 },
  { code: '103', name: 'بانک', type: 'asset', side: 'debit', cash: 1, order: 103 },
  { code: '104', name: 'اسناد دریافتنی (چک‌های دریافتی)', type: 'asset', side: 'debit', cash: 0, order: 104 },
  { code: '105', name: 'حساب‌های دریافتنی (مشتریان)', type: 'asset', side: 'debit', cash: 0, order: 105 },
  { code: '106', name: 'موجودی کالا', type: 'asset', side: 'debit', cash: 0, order: 106 },
  // بدهی‌ها
  { code: '201', name: 'حساب‌های پرداختنی (تأمین‌کنندگان)', type: 'liability', side: 'credit', cash: 0, order: 201 },
  { code: '202', name: 'مالیات بر ارزش افزوده پرداختنی', type: 'liability', side: 'credit', cash: 0, order: 202 },
  { code: '203', name: 'اسناد پرداختنی (چک‌های پرداختی)', type: 'liability', side: 'credit', cash: 0, order: 203 },
  // سرمایه
  { code: '301', name: 'سرمایه مالک', type: 'equity', side: 'credit', cash: 0, order: 301 },
  { code: '302', name: 'برداشت مالک', type: 'equity', side: 'debit', cash: 0, order: 302 },
  // درآمدها
  { code: '401', name: 'فروش', type: 'income', side: 'credit', cash: 0, order: 401 },
  { code: '402', name: 'درآمد متفرقه', type: 'income', side: 'credit', cash: 0, order: 402 },
  { code: '403', name: 'برگشت از فروش', type: 'income', side: 'debit', cash: 0, order: 403 },
  { code: '404', name: 'تخفیفات فروش', type: 'income', side: 'debit', cash: 0, order: 404 },
  // هزینه‌ها
  { code: '501', name: 'خرید کالا', type: 'expense', side: 'debit', cash: 0, order: 501 },
  { code: '502', name: 'هزینه‌های عملیاتی', type: 'expense', side: 'debit', cash: 0, order: 502 },
  { code: '503', name: 'بهای تمام‌شده کالای فروش‌رفته', type: 'expense', side: 'debit', cash: 0, order: 503 },
];

const EXPENSE_CATEGORIES = [
  ['اجاره', '502-01'], ['برق', '502-02'], ['آب', '502-03'], ['اینترنت و تلفن', '502-04'],
  ['حقوق و دستمزد', '502-05'], ['حمل و نقل', '502-06'], ['تعمیرات', '502-07'],
  ['ملزومات مصرفی', '502-08'], ['تبلیغات', '502-09'], ['متفرقه', '502-10'],
];

const INCOME_CATEGORIES = [
  ['درآمد خدمات', '402-01'], ['درآمد متفرقه', '402-02'],
];

const DEFAULT_SETTINGS = {
  shop_name: 'فروشگاه من',
  shop_phone: '',
  shop_address: '',
  shop_logo: '',
  shop_economic_code: '',
  vat_rate: '10',
  vat_enabled: '1',
  purchase_vat_deductible: '1',
  currency: 'تومان',
  sale_prefix: 'S-',
  purchase_prefix: 'P-',
  sale_return_prefix: 'SR-',
  purchase_return_prefix: 'PR-',
  default_payment_method: 'cash',
  allow_negative_stock: '0',
  print_size: 'a4',
  print_footer: 'از خرید شما سپاسگزاریم',
  backup_dir: '',
  auto_backup: '1',
  auto_backup_days: '1',
  last_auto_backup: '',
  setup_done: '0',
  costing_method: 'weighted_average',
  low_stock_alert: '1',
  db_owner: 'myshop',
};

const MIGRATIONS = [
  {
    version: 1,
    name: 'ساختار اولیه کامل',
    up(db) {
      db.exec(`
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE counters (
          name  TEXT PRIMARY KEY,
          value INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE accounts (
          code        TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
          normal_side TEXT NOT NULL CHECK (normal_side IN ('debit','credit')),
          parent_code TEXT REFERENCES accounts(code),
          is_system   INTEGER NOT NULL DEFAULT 1,
          cash_like   INTEGER NOT NULL DEFAULT 0,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          active      INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE journal_entries (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_no    TEXT NOT NULL,
          date        TEXT NOT NULL,
          ref_type    TEXT NOT NULL DEFAULT 'manual',
          ref_id      INTEGER,
          description TEXT NOT NULL DEFAULT '',
          reversed_of INTEGER REFERENCES journal_entries(id),
          created_at  TEXT NOT NULL
        );

        CREATE TABLE journal_lines (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          entry_id     INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
          account_code TEXT NOT NULL REFERENCES accounts(code),
          debit        INTEGER NOT NULL DEFAULT 0,
          credit       INTEGER NOT NULL DEFAULT 0,
          party_id     INTEGER,
          description  TEXT NOT NULL DEFAULT '',
          CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0) AND (debit + credit) > 0)
        );

        CREATE TABLE parties (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          type            TEXT NOT NULL CHECK (type IN ('customer','supplier')),
          name            TEXT NOT NULL,
          phone           TEXT NOT NULL DEFAULT '',
          national_id     TEXT NOT NULL DEFAULT '',
          address         TEXT NOT NULL DEFAULT '',
          notes           TEXT NOT NULL DEFAULT '',
          active          INTEGER NOT NULL DEFAULT 1,
          created_at      TEXT NOT NULL
        );

        CREATE TABLE categories (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          kind         TEXT NOT NULL CHECK (kind IN ('product','expense','income')),
          name         TEXT NOT NULL,
          account_code TEXT REFERENCES accounts(code),
          active       INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE products (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL,
          code        TEXT NOT NULL DEFAULT '',
          barcode     TEXT NOT NULL DEFAULT '',
          category_id INTEGER REFERENCES categories(id),
          unit        TEXT NOT NULL DEFAULT 'عدد',
          buy_price   INTEGER NOT NULL DEFAULT 0,
          sell_price  INTEGER NOT NULL DEFAULT 0,
          min_stock   REAL NOT NULL DEFAULT 0,
          stock       REAL NOT NULL DEFAULT 0,
          stock_value INTEGER NOT NULL DEFAULT 0,
          description TEXT NOT NULL DEFAULT '',
          active      INTEGER NOT NULL DEFAULT 1,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE TABLE inventory_movements (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          date          TEXT NOT NULL,
          product_id    INTEGER NOT NULL REFERENCES products(id),
          type          TEXT NOT NULL,
          qty           REAL NOT NULL,
          unit_cost     REAL NOT NULL DEFAULT 0,
          value         INTEGER NOT NULL DEFAULT 0,
          balance_qty   REAL NOT NULL DEFAULT 0,
          balance_value INTEGER NOT NULL DEFAULT 0,
          ref_type      TEXT NOT NULL DEFAULT '',
          ref_id        INTEGER,
          description   TEXT NOT NULL DEFAULT '',
          created_at    TEXT NOT NULL
        );

        CREATE TABLE invoices (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          type             TEXT NOT NULL CHECK (type IN ('sale','purchase','sale_return','purchase_return')),
          invoice_no       TEXT NOT NULL,
          date             TEXT NOT NULL,
          party_id         INTEGER REFERENCES parties(id),
          party_name       TEXT NOT NULL DEFAULT '',
          subtotal         INTEGER NOT NULL DEFAULT 0,
          discount_lines   INTEGER NOT NULL DEFAULT 0,
          discount_invoice INTEGER NOT NULL DEFAULT 0,
          discount_total   INTEGER NOT NULL DEFAULT 0,
          taxable          INTEGER NOT NULL DEFAULT 0,
          vat_rate         REAL NOT NULL DEFAULT 0,
          vat              INTEGER NOT NULL DEFAULT 0,
          total            INTEGER NOT NULL DEFAULT 0,
          paid             INTEGER NOT NULL DEFAULT 0,
          due              INTEGER NOT NULL DEFAULT 0,
          cogs             INTEGER NOT NULL DEFAULT 0,
          ref_invoice_id   INTEGER REFERENCES invoices(id),
          status           TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
          notes            TEXT NOT NULL DEFAULT '',
          entry_id         INTEGER REFERENCES journal_entries(id),
          created_at       TEXT NOT NULL
        );

        CREATE TABLE invoice_items (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          product_id   INTEGER REFERENCES products(id),
          product_name TEXT NOT NULL DEFAULT '',
          product_code TEXT NOT NULL DEFAULT '',
          unit         TEXT NOT NULL DEFAULT '',
          qty          REAL NOT NULL DEFAULT 0,
          unit_price   INTEGER NOT NULL DEFAULT 0,
          discount     INTEGER NOT NULL DEFAULT 0,
          line_total   INTEGER NOT NULL DEFAULT 0,
          unit_cost    REAL NOT NULL DEFAULT 0,
          cost_total   INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE payments (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          kind        TEXT NOT NULL CHECK (kind IN ('receipt','payment')),
          date        TEXT NOT NULL,
          party_id    INTEGER REFERENCES parties(id),
          party_name  TEXT NOT NULL DEFAULT '',
          amount      INTEGER NOT NULL DEFAULT 0,
          description TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
          entry_id    INTEGER REFERENCES journal_entries(id),
          created_at  TEXT NOT NULL
        );

        CREATE TABLE payment_lines (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_type     TEXT NOT NULL CHECK (doc_type IN ('invoice','payment')),
          doc_id       INTEGER NOT NULL,
          direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
          method       TEXT NOT NULL,
          account_code TEXT NOT NULL REFERENCES accounts(code),
          amount       INTEGER NOT NULL DEFAULT 0,
          check_id     INTEGER REFERENCES checks(id),
          date         TEXT NOT NULL,
          description  TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE checks (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          kind         TEXT NOT NULL CHECK (kind IN ('received','paid')),
          number       TEXT NOT NULL DEFAULT '',
          bank         TEXT NOT NULL DEFAULT '',
          branch       TEXT NOT NULL DEFAULT '',
          party_id     INTEGER REFERENCES parties(id),
          party_name   TEXT NOT NULL DEFAULT '',
          amount       INTEGER NOT NULL DEFAULT 0,
          issue_date   TEXT NOT NULL DEFAULT '',
          due_date     TEXT NOT NULL DEFAULT '',
          status       TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','deposited','cleared','returned','paid','cancelled')),
          doc_type     TEXT NOT NULL DEFAULT '',
          doc_id       INTEGER,
          settled_date TEXT NOT NULL DEFAULT '',
          notes        TEXT NOT NULL DEFAULT '',
          created_at   TEXT NOT NULL
        );

        CREATE TABLE check_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          check_id    INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
          date        TEXT NOT NULL,
          from_status TEXT NOT NULL DEFAULT '',
          to_status   TEXT NOT NULL DEFAULT '',
          entry_id    INTEGER REFERENCES journal_entries(id),
          notes       TEXT NOT NULL DEFAULT '',
          created_at  TEXT NOT NULL
        );

        CREATE TABLE expenses (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          date          TEXT NOT NULL,
          category_id   INTEGER REFERENCES categories(id),
          category_name TEXT NOT NULL DEFAULT '',
          account_code  TEXT NOT NULL REFERENCES accounts(code),
          amount        INTEGER NOT NULL DEFAULT 0,
          method        TEXT NOT NULL DEFAULT 'cash',
          pay_account   TEXT NOT NULL DEFAULT '101',
          description   TEXT NOT NULL DEFAULT '',
          status        TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
          entry_id      INTEGER REFERENCES journal_entries(id),
          created_at    TEXT NOT NULL
        );

        CREATE TABLE incomes (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          date          TEXT NOT NULL,
          category_id   INTEGER REFERENCES categories(id),
          category_name TEXT NOT NULL DEFAULT '',
          account_code  TEXT NOT NULL REFERENCES accounts(code),
          amount        INTEGER NOT NULL DEFAULT 0,
          method        TEXT NOT NULL DEFAULT 'cash',
          pay_account   TEXT NOT NULL DEFAULT '101',
          description   TEXT NOT NULL DEFAULT '',
          status        TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
          entry_id      INTEGER REFERENCES journal_entries(id),
          created_at    TEXT NOT NULL
        );

        CREATE TABLE transfers (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          date        TEXT NOT NULL,
          from_code   TEXT NOT NULL REFERENCES accounts(code),
          to_code     TEXT NOT NULL REFERENCES accounts(code),
          amount      INTEGER NOT NULL DEFAULT 0,
          description TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
          entry_id    INTEGER REFERENCES journal_entries(id),
          created_at  TEXT NOT NULL
        );

        CREATE TABLE legacy_documents (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          kind        TEXT NOT NULL DEFAULT '',
          invoice_no  TEXT NOT NULL DEFAULT '',
          date        TEXT NOT NULL DEFAULT '',
          party       TEXT NOT NULL DEFAULT '',
          subtotal    INTEGER NOT NULL DEFAULT 0,
          discount    INTEGER NOT NULL DEFAULT 0,
          vat         INTEGER NOT NULL DEFAULT 0,
          total       INTEGER NOT NULL DEFAULT 0,
          method      TEXT NOT NULL DEFAULT '',
          notes       TEXT NOT NULL DEFAULT '',
          items_json  TEXT NOT NULL DEFAULT '[]',
          imported_at TEXT NOT NULL
        );

        CREATE TABLE app_log (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          ts      TEXT NOT NULL,
          level   TEXT NOT NULL DEFAULT 'info',
          channel TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          detail  TEXT NOT NULL DEFAULT ''
        );

        CREATE INDEX idx_journal_entries_date ON journal_entries(date);
        CREATE INDEX idx_journal_entries_ref  ON journal_entries(ref_type, ref_id);
        CREATE INDEX idx_journal_lines_entry  ON journal_lines(entry_id);
        CREATE INDEX idx_journal_lines_acc    ON journal_lines(account_code);
        CREATE INDEX idx_journal_lines_party  ON journal_lines(party_id);
        CREATE INDEX idx_products_name        ON products(name);
        CREATE INDEX idx_products_code        ON products(code);
        CREATE INDEX idx_products_barcode     ON products(barcode);
        CREATE INDEX idx_parties_name         ON parties(type, name);
        CREATE INDEX idx_parties_phone        ON parties(phone);
        CREATE INDEX idx_invoices_type_date   ON invoices(type, date);
        CREATE INDEX idx_invoices_no          ON invoices(invoice_no);
        CREATE INDEX idx_invoices_party       ON invoices(party_id);
        CREATE INDEX idx_items_invoice        ON invoice_items(invoice_id);
        CREATE INDEX idx_items_product        ON invoice_items(product_id);
        CREATE INDEX idx_moves_product_date   ON inventory_movements(product_id, date);
        CREATE INDEX idx_moves_ref            ON inventory_movements(ref_type, ref_id);
        CREATE INDEX idx_paylines_doc         ON payment_lines(doc_type, doc_id);
        CREATE INDEX idx_paylines_date        ON payment_lines(date, method);
        CREATE INDEX idx_payments_party       ON payments(party_id, date);
        CREATE INDEX idx_checks_status        ON checks(status, due_date);
        CREATE INDEX idx_checks_party         ON checks(party_id);
        CREATE INDEX idx_expenses_date        ON expenses(date);
        CREATE INDEX idx_incomes_date         ON incomes(date);
        CREATE INDEX idx_transfers_date       ON transfers(date);
      `);

      const acc = db.prepare(`INSERT INTO accounts(code,name,type,normal_side,parent_code,is_system,cash_like,sort_order)
                              VALUES (?,?,?,?,?,1,?,?)`);
      for (const a of CHART_OF_ACCOUNTS) acc.run(a.code, a.name, a.type, a.side, null, a.cash, a.order);

      const sub = db.prepare(`INSERT INTO accounts(code,name,type,normal_side,parent_code,is_system,cash_like,sort_order)
                              VALUES (?,?,?,?,?,1,0,?)`);
      const cat = db.prepare('INSERT INTO categories(kind,name,account_code) VALUES (?,?,?)');
      // حساب‌های کمکی انبارگردانی (بدون دسته‌بندی کاربری)
      sub.run('502-90', 'کسری و ضایعات انبار', 'expense', 'debit', '502', 50290);
      sub.run('402-90', 'اضافات انبار', 'income', 'credit', '402', 40290);

      EXPENSE_CATEGORIES.forEach(([name, code], i) => {
        sub.run(code, name, 'expense', 'debit', '502', 50200 + i + 1);
        cat.run('expense', name, code);
      });
      INCOME_CATEGORIES.forEach(([name, code], i) => {
        sub.run(code, name, 'income', 'credit', '402', 40200 + i + 1);
        cat.run('income', name, code);
      });

      const st = db.prepare('INSERT INTO settings(key,value) VALUES (?,?)');
      for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) st.run(k, v);

      const ctr = db.prepare('INSERT INTO counters(name,value) VALUES (?,0)');
      for (const n of ['sale', 'purchase', 'sale_return', 'purchase_return', 'journal', 'payment']) ctr.run(n);

      const pcat = db.prepare('INSERT INTO categories(kind,name,account_code) VALUES (?,?,NULL)');
      for (const n of ['عمومی']) pcat.run('product', n);
    },
  },
  {
    version: 2,
    name: 'افزودن فهرست پیش‌فرض کالاها (لیست قیمت رسمی)',
    up(db) {
      const seed = require('./seed-products.json');
      const now = new Date().toISOString();

      // دسته‌بندی‌های کالا
      const catIds = {};
      const findCat = db.prepare(`SELECT id FROM categories WHERE kind='product' AND name=?`);
      const addCat = db.prepare(`INSERT INTO categories(kind,name,account_code) VALUES ('product',?,NULL)`);
      for (const name of seed.categories) {
        const found = findCat.get(name);
        catIds[name] = found ? found.id : Number(addCat.run(name).lastInsertRowid);
      }

      // کالاها؛ اگر کدی از قبل وجود داشته باشد دست‌نخورده باقی می‌ماند
      const exists = db.prepare(`SELECT id FROM products WHERE code=? AND code<>''`);
      const insert = db.prepare(`INSERT INTO products
        (name,code,barcode,category_id,unit,buy_price,sell_price,min_stock,stock,stock_value,
         description,active,created_at,updated_at)
        VALUES (@name,@code,'',@category_id,@unit,0,@sell_price,0,0,0,'',1,@now,@now)`);
      let added = 0;
      for (const p of seed.products) {
        if (exists.get(p.code)) continue;
        insert.run({
          name: p.name,
          code: p.code,
          category_id: catIds[p.category] || null,
          unit: p.unit || 'عدد',
          sell_price: Math.max(0, Math.round(p.sell_price || 0)),
          now,
        });
        added += 1;
      }
      db.prepare(`INSERT INTO settings(key,value) VALUES ('seed_products_version',?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(String(seed.version));
      db.prepare(`INSERT INTO settings(key,value) VALUES ('seed_products_added',?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .run(String(added));
    },
  },
];

function currentVersion(db) {
  return db.pragma('user_version', { simple: true });
}

function migrate(db) {
  const from = currentVersion(db);
  const applied = [];
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    const run = db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    });
    run();
    applied.push(m.version);
  }
  return { from, to: currentVersion(db), applied };
}

module.exports = {
  migrate, currentVersion, MIGRATIONS, CHART_OF_ACCOUNTS,
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, DEFAULT_SETTINGS,
  LATEST_VERSION: MIGRATIONS[MIGRATIONS.length - 1].version,
};
