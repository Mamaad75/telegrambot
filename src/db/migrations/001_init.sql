-- ===========================================================================
-- ساختار اولیه پایگاه داده حسابداری فروشگاهی
-- تمام مبالغ INTEGER در واحد پول پایه؛ مقادیر (تعداد) REAL
-- ===========================================================================

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- حساب‌ها --
CREATE TABLE IF NOT EXISTS accounts (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  normal_side TEXT NOT NULL CHECK (normal_side IN ('debit','credit')),
  is_system   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- حساب‌های بانکی و پایانه‌های فروشگاهی (معین حساب‌های ۱۰۲ و ۱۰۳)
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'bank' CHECK (kind IN ('bank','pos')),
  bank_name       TEXT,
  branch          TEXT,
  account_number  TEXT,
  card_number     TEXT,
  iban            TEXT,
  owner_name      TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  is_default      INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_kind ON bank_accounts(kind, active);

-- ------------------------------------------------------------ طرف‌حساب‌ها --
CREATE TABLE IF NOT EXISTS customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  phone           TEXT,
  national_id     TEXT,
  economic_code   TEXT,
  address         TEXT,
  note            TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,  -- مثبت = بدهکار به ما
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name  ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS suppliers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  phone           TEXT,
  national_id     TEXT,
  economic_code   TEXT,
  address         TEXT,
  note            TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,  -- مثبت = ما بدهکاریم
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name  ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_phone ON suppliers(phone);

-- ------------------------------------------------------------------ کالا --
CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT UNIQUE,
  barcode        TEXT,
  name           TEXT NOT NULL,
  category_id    INTEGER REFERENCES categories(id),
  unit           TEXT NOT NULL DEFAULT 'عدد',
  purchase_price INTEGER NOT NULL DEFAULT 0,
  sale_price     INTEGER NOT NULL DEFAULT 0,
  min_stock      REAL NOT NULL DEFAULT 0,
  stock_qty      REAL NOT NULL DEFAULT 0,
  stock_value    INTEGER NOT NULL DEFAULT 0,   -- ارزش موجودی به روش میانگین موزون
  description    TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_name    ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_active  ON products(active);

CREATE TABLE IF NOT EXISTS stock_moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  move_type     TEXT NOT NULL,
  qty           REAL NOT NULL,                 -- مثبت = ورود، منفی = خروج
  unit_cost     REAL NOT NULL DEFAULT 0,
  value         INTEGER NOT NULL DEFAULT 0,    -- تغییر ارزش موجودی (علامت‌دار)
  balance_qty   REAL NOT NULL DEFAULT 0,
  balance_value INTEGER NOT NULL DEFAULT 0,
  ref_type      TEXT,
  ref_id        INTEGER,
  ref_no        TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_moves(product_id, date);
CREATE INDEX IF NOT EXISTS idx_moves_date    ON stock_moves(date);
CREATE INDEX IF NOT EXISTS idx_moves_ref     ON stock_moves(ref_type, ref_id);

-- ------------------------------------------------------------- دفتر روزنامه --
CREATE TABLE IF NOT EXISTS journal_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no    INTEGER NOT NULL,
  date        TEXT NOT NULL,
  description TEXT,
  ref_type    TEXT,
  ref_id      INTEGER,
  ref_no      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_ref  ON journal_entries(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id        INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code    TEXT NOT NULL REFERENCES accounts(code),
  debit           INTEGER NOT NULL DEFAULT 0,
  credit          INTEGER NOT NULL DEFAULT 0,
  party_type      TEXT,
  party_id        INTEGER,
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  description     TEXT,
  CHECK (debit >= 0 AND credit >= 0)
);
CREATE INDEX IF NOT EXISTS idx_lines_entry   ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_code);
CREATE INDEX IF NOT EXISTS idx_lines_party   ON journal_lines(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_lines_bank    ON journal_lines(bank_account_id);

-- --------------------------------------------------------------- فاکتورها --
CREATE TABLE IF NOT EXISTS sales_invoices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no       TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL,
  customer_id      INTEGER REFERENCES customers(id),
  subtotal         INTEGER NOT NULL DEFAULT 0,  -- جمع کل قبل از تخفیف
  line_discount    INTEGER NOT NULL DEFAULT 0,
  invoice_discount INTEGER NOT NULL DEFAULT 0,
  taxable          INTEGER NOT NULL DEFAULT 0,  -- مبلغ مشمول مالیات
  vat_rate         REAL NOT NULL DEFAULT 0,
  vat_amount       INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL DEFAULT 0,
  cogs             INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_date     ON sales_invoices(date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales_invoices(customer_id);

CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  name_snapshot TEXT,
  unit          TEXT,
  qty           REAL NOT NULL,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  discount      INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  net_total     INTEGER NOT NULL DEFAULT 0,   -- پس از سرشکن‌کردن تخفیف کل فاکتور
  unit_cost     REAL NOT NULL DEFAULT 0,
  cogs          INTEGER NOT NULL DEFAULT 0,
  returned_qty  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sitems_invoice ON sales_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sitems_product ON sales_invoice_items(product_id);

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no       TEXT NOT NULL UNIQUE,
  supplier_ref_no  TEXT,
  date             TEXT NOT NULL,
  supplier_id      INTEGER REFERENCES suppliers(id),
  subtotal         INTEGER NOT NULL DEFAULT 0,
  line_discount    INTEGER NOT NULL DEFAULT 0,
  invoice_discount INTEGER NOT NULL DEFAULT 0,
  taxable          INTEGER NOT NULL DEFAULT 0,
  vat_rate         REAL NOT NULL DEFAULT 0,
  vat_amount       INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_purch_date     ON purchase_invoices(date);
CREATE INDEX IF NOT EXISTS idx_purch_supplier ON purchase_invoices(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  name_snapshot TEXT,
  unit          TEXT,
  qty           REAL NOT NULL,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  discount      INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  net_total     INTEGER NOT NULL DEFAULT 0,   -- پس از سرشکن‌کردن تخفیف کل فاکتور
  unit_cost     REAL NOT NULL DEFAULT 0,
  returned_qty  REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pitems_invoice ON purchase_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pitems_product ON purchase_invoice_items(product_id);

-- ------------------------------------------------------------- برگشتی‌ها --
CREATE TABLE IF NOT EXISTS sales_returns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no        TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL,
  invoice_id       INTEGER REFERENCES sales_invoices(id),
  customer_id      INTEGER REFERENCES customers(id),
  subtotal         INTEGER NOT NULL DEFAULT 0,
  vat_rate         REAL NOT NULL DEFAULT 0,
  vat_amount       INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL DEFAULT 0,
  cogs             INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sret_date ON sales_returns(date);

CREATE TABLE IF NOT EXISTS sales_return_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id     INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  item_id       INTEGER REFERENCES sales_invoice_items(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  name_snapshot TEXT,
  qty           REAL NOT NULL,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  unit_cost     REAL NOT NULL DEFAULT 0,
  cogs          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no        TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL,
  invoice_id       INTEGER REFERENCES purchase_invoices(id),
  supplier_id      INTEGER REFERENCES suppliers(id),
  subtotal         INTEGER NOT NULL DEFAULT 0,
  vat_rate         REAL NOT NULL DEFAULT 0,
  vat_amount       INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pret_date ON purchase_returns(date);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id     INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  item_id       INTEGER REFERENCES purchase_invoice_items(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  name_snapshot TEXT,
  qty           REAL NOT NULL,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  unit_cost     REAL NOT NULL DEFAULT 0
);

-- -------------------------------------------------- دریافت‌ها و پرداخت‌ها --
CREATE TABLE IF NOT EXISTS payments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no       TEXT NOT NULL UNIQUE,
  direction        TEXT NOT NULL CHECK (direction IN ('in','out')),
  date             TEXT NOT NULL,
  party_type       TEXT,                       -- customer | supplier
  party_id         INTEGER,
  ref_type         TEXT,                       -- sales_invoice | purchase_invoice | sales_return | purchase_return
  ref_id           INTEGER,
  ref_no           TEXT,
  total            INTEGER NOT NULL,
  note             TEXT,
  with_invoice     INTEGER NOT NULL DEFAULT 0, -- ۱ = همزمان با ثبت فاکتور
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pay_date  ON payments(date);
CREATE INDEX IF NOT EXISTS idx_pay_party ON payments(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_pay_ref   ON payments(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS payment_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id      INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  method          TEXT NOT NULL CHECK (method IN ('cash','pos','bank','card','check')),
  amount          INTEGER NOT NULL,
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  check_id        INTEGER REFERENCES checks(id),
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_payline_payment ON payment_lines(payment_id);
CREATE INDEX IF NOT EXISTS idx_payline_check   ON payment_lines(check_id);

-- ------------------------------------------------------------------ چک‌ها --
CREATE TABLE IF NOT EXISTS checks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  check_code      TEXT NOT NULL UNIQUE,        -- کد یکتای سیستمی چک
  direction       TEXT NOT NULL CHECK (direction IN ('received','issued')),
  check_number    TEXT,                        -- شماره چک روی برگه
  sayad_id        TEXT,                        -- شناسه صیادی
  bank_name       TEXT,
  branch          TEXT,
  holder_name     TEXT,                        -- نام دارنده / صادرکننده چک
  party_type      TEXT,
  party_id        INTEGER,
  amount          INTEGER NOT NULL,
  issue_date      TEXT,
  due_date        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  bank_account_id INTEGER REFERENCES bank_accounts(id),
  ref_type        TEXT,                        -- فاکتور مرتبط
  ref_id          INTEGER,
  ref_no          TEXT,
  payment_id      INTEGER,
  settled_at      TEXT,
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_code   ON checks(check_code);
CREATE INDEX IF NOT EXISTS idx_checks_holder ON checks(holder_name);
CREATE INDEX IF NOT EXISTS idx_checks_number ON checks(check_number);
CREATE INDEX IF NOT EXISTS idx_checks_due    ON checks(due_date, status);
CREATE INDEX IF NOT EXISTS idx_checks_ref    ON checks(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_checks_party  ON checks(party_type, party_id);

CREATE TABLE IF NOT EXISTS check_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id         INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  status           TEXT NOT NULL,
  description      TEXT,
  bank_account_id  INTEGER REFERENCES bank_accounts(id),
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_checkev_check ON check_events(check_id);

-- ------------------------------------------------------- هزینه و درآمد --
CREATE TABLE IF NOT EXISTS expense_categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS expenses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no           TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL,
  category_id      INTEGER REFERENCES expense_categories(id),
  amount           INTEGER NOT NULL,
  method           TEXT NOT NULL,
  bank_account_id  INTEGER REFERENCES bank_accounts(id),
  check_id         INTEGER REFERENCES checks(id),
  description      TEXT,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

CREATE TABLE IF NOT EXISTS income_categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS incomes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no           TEXT NOT NULL UNIQUE,
  date             TEXT NOT NULL,
  category_id      INTEGER REFERENCES income_categories(id),
  amount           INTEGER NOT NULL,
  method           TEXT NOT NULL,
  bank_account_id  INTEGER REFERENCES bank_accounts(id),
  description      TEXT,
  journal_entry_id INTEGER REFERENCES journal_entries(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_incomes_date ON incomes(date);

-- ---------------------------------------------------- انتقال بین حساب‌ها --
CREATE TABLE IF NOT EXISTS transfers (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no               TEXT NOT NULL UNIQUE,
  date                 TEXT NOT NULL,
  from_kind            TEXT NOT NULL,   -- cash | pos | bank
  from_bank_account_id INTEGER REFERENCES bank_accounts(id),
  to_kind              TEXT NOT NULL,
  to_bank_account_id   INTEGER REFERENCES bank_accounts(id),
  amount               INTEGER NOT NULL,
  fee                  INTEGER NOT NULL DEFAULT 0,
  description          TEXT,
  journal_entry_id     INTEGER REFERENCES journal_entries(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_transfers_date ON transfers(date);

-- --------------------------------------------------------------- رویدادها --
CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  action     TEXT NOT NULL,
  ref_type   TEXT,
  ref_id     INTEGER,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log(at);
