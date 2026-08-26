/* ساخت اسناد قابل چاپ: فاکتور، صورت‌حساب و گزارش */
(function (global) {
  'use strict';
  const esc = (v) => global.U.esc(v);
  const money = (v) => global.Money.formatNumberFa(Math.round(Number(v) || 0));
  const jdate = (v) => global.Money.toPersianDigits(global.Jalali.isoToJalali(v)) || '';
  const qty = (v) => global.Money.formatNumberFa(Number(v) || 0);

  function shopBlock(s) {
    const logo = s.shop_logo
      ? `<img class="logo" src="${esc(s.shop_logo)}" alt="">`
      : `<div class="logo placeholder">${esc((s.shop_name || 'ف').trim().charAt(0))}</div>`;
    return `<div class="shop">
      ${logo}
      <div class="shop-info">
        <b>${esc(s.shop_name || 'فروشگاه')}</b>
        ${s.shop_phone ? `<span>تلفن: ${esc(s.shop_phone)}</span>` : ''}
        ${s.shop_address ? `<span>${esc(s.shop_address)}</span>` : ''}
        ${s.shop_economic_code ? `<span>کد اقتصادی: ${esc(s.shop_economic_code)}</span>` : ''}
      </div>
    </div>`;
  }

  /**
   * فاکتور قابل چاپ.
   * @param {object} data {invoice, items, paymentLines, party}
   * @param {object} s تنظیمات فروشگاه
   * @param {object} opts {size:'a4'|'thermal', copyLabel}
   */
  function invoice(data, s, opts) {
    const o = opts || {};
    const inv = data.invoice;
    const items = data.items || [];
    const pays = data.paymentLines || [];
    const party = data.party;
    const currency = s.currency || 'تومان';
    const title = global.U.label('invoiceType', inv.type);
    const isThermal = o.size === 'thermal';

    const rows = items.map((it, i) => `<tr>
      <td class="c">${global.Money.toPersianDigits(i + 1)}</td>
      <td>${esc(it.product_name)}${it.product_code ? `<small> (${esc(it.product_code)})</small>` : ''}</td>
      <td class="c">${qty(it.qty)}</td>
      ${isThermal ? '' : `<td class="c">${esc(it.unit || '')}</td>`}
      <td class="n">${money(it.unit_price)}</td>
      ${isThermal ? '' : `<td class="n">${money(it.discount)}</td>`}
      <td class="n">${money(it.line_total)}</td>
    </tr>`).join('');

    const payRows = pays.length ? pays.map((p) => `<div class="pay">
        <span>${esc(global.U.label('method', p.method))}${p.check_number ? ` — چک ${esc(p.check_number)} ${p.check_bank ? esc(p.check_bank) : ''} سررسید ${esc(jdate(p.check_due))}` : ''}</span>
        <b>${money(p.amount)}</b>
      </div>`).join('') : '';

    const summary = `
      <div class="sum-row"><span>جمع کالاها</span><b>${money(inv.subtotal)}</b></div>
      ${inv.discount_total ? `<div class="sum-row"><span>تخفیف</span><b>${money(inv.discount_total)}</b></div>` : ''}
      <div class="sum-row"><span>مبلغ مشمول</span><b>${money(inv.taxable)}</b></div>
      ${inv.vat ? `<div class="sum-row"><span>ارزش افزوده (${global.Money.formatNumberFa(inv.vat_rate)}٪)</span><b>${money(inv.vat)}</b></div>` : ''}
      <div class="sum-row grand"><span>مبلغ قابل پرداخت</span><b>${money(inv.total)} ${esc(currency)}</b></div>
      ${inv.paid ? `<div class="sum-row"><span>پرداخت‌شده</span><b>${money(inv.paid)}</b></div>` : ''}
      ${inv.due ? `<div class="sum-row due"><span>مانده (نسیه)</span><b>${money(inv.due)}</b></div>` : ''}`;

    return `<article class="doc ${isThermal ? 'thermal' : 'a4'}">
      <header class="doc-head">
        ${shopBlock(s)}
        <div class="doc-title">
          <h1>${esc(title)}</h1>
          <div class="meta"><span>شماره:</span><b>${esc(inv.invoice_no)}</b></div>
          <div class="meta"><span>تاریخ:</span><b>${esc(jdate(inv.date))}</b></div>
          ${o.copyLabel ? `<div class="copy">${esc(o.copyLabel)}</div>` : ''}
          ${inv.status === 'void' ? '<div class="void-mark">ابطال‌شده</div>' : ''}
        </div>
      </header>

      <section class="party">
        <div><span>${inv.type === 'sale' || inv.type === 'sale_return' ? 'خریدار' : 'فروشنده'}:</span> <b>${esc(inv.party_name || 'مشتری متفرقه')}</b></div>
        ${party && party.phone ? `<div><span>تلفن:</span> ${esc(party.phone)}</div>` : ''}
        ${party && party.national_id ? `<div><span>کد/شناسه ملی:</span> ${esc(party.national_id)}</div>` : ''}
        ${party && party.address ? `<div class="addr"><span>نشانی:</span> ${esc(party.address)}</div>` : ''}
      </section>

      <table class="items">
        <thead><tr>
          <th class="c">ردیف</th><th>شرح کالا</th><th class="c">تعداد</th>
          ${isThermal ? '' : '<th class="c">واحد</th>'}
          <th class="n">مبلغ واحد</th>
          ${isThermal ? '' : '<th class="n">تخفیف</th>'}
          <th class="n">مبلغ کل</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <section class="totals">
        <div class="words">
          <div><b>مبلغ به حروف:</b> ${esc(global.Money.numberToPersianWords(inv.total))} ${esc(currency)}</div>
          ${payRows ? `<div class="pays"><b>نحوه تسویه:</b>${payRows}</div>` : ''}
          ${inv.notes ? `<div class="notes"><b>توضیحات:</b> ${esc(inv.notes)}</div>` : ''}
        </div>
        <div class="sum">${summary}</div>
      </section>

      ${isThermal ? '' : `<section class="signs">
        <div><span>مهر و امضای فروشنده</span></div>
        <div><span>امضای خریدار</span></div>
      </section>`}

      <footer class="doc-foot">${esc(s.print_footer || '')}</footer>
    </article>`;
  }

  /** صورت‌حساب طرف حساب */
  function statement(profile, s, opts) {
    const o = opts || {};
    const p = profile.party;
    const st = profile.statement;
    const currency = s.currency || 'تومان';
    const rows = st.rows.map((r, i) => `<tr>
      <td class="c">${global.Money.toPersianDigits(i + 1)}</td>
      <td class="c">${esc(jdate(r.date))}</td>
      <td>${esc(r.description)}</td>
      <td class="n">${r.debit ? money(r.debit) : '—'}</td>
      <td class="n">${r.credit ? money(r.credit) : '—'}</td>
      <td class="n">${money(r.balance)}</td>
    </tr>`).join('');
    return `<article class="doc a4">
      <header class="doc-head">
        ${shopBlock(s)}
        <div class="doc-title">
          <h1>صورت‌حساب ${p.type === 'customer' ? 'مشتری' : 'تأمین‌کننده'}</h1>
          <div class="meta"><span>طرف حساب:</span><b>${esc(p.name)}</b></div>
          ${o.from ? `<div class="meta"><span>از تاریخ:</span><b>${esc(jdate(o.from))}</b></div>` : ''}
          ${o.to ? `<div class="meta"><span>تا تاریخ:</span><b>${esc(jdate(o.to))}</b></div>` : ''}
          <div class="meta"><span>تاریخ چاپ:</span><b>${esc(jdate(global.Jalali.todayIso()))}</b></div>
        </div>
      </header>
      <section class="party">
        ${p.phone ? `<div><span>تلفن:</span> ${esc(p.phone)}</div>` : ''}
        ${p.address ? `<div class="addr"><span>نشانی:</span> ${esc(p.address)}</div>` : ''}
      </section>
      <table class="items">
        <thead><tr><th class="c">ردیف</th><th class="c">تاریخ</th><th>شرح</th>
          <th class="n">${p.type === 'customer' ? 'بدهکار (فروش)' : 'بدهکار (پرداخت)'}</th>
          <th class="n">${p.type === 'customer' ? 'بستانکار (دریافت)' : 'بستانکار (خرید)'}</th>
          <th class="n">مانده</th></tr></thead>
        <tbody>
          ${st.opening ? `<tr><td class="c">—</td><td class="c">—</td><td>مانده اول دوره</td><td class="n">—</td><td class="n">—</td><td class="n">${money(st.opening)}</td></tr>` : ''}
          ${rows}
        </tbody>
      </table>
      <section class="totals">
        <div class="words"><div><b>مانده نهایی به حروف:</b> ${esc(global.Money.numberToPersianWords(Math.abs(st.closing)))} ${esc(currency)}</div></div>
        <div class="sum">
          <div class="sum-row"><span>جمع ${p.type === 'customer' ? 'فروش' : 'خرید'}</span><b>${money(profile.totals.invoiced)}</b></div>
          <div class="sum-row"><span>جمع برگشتی</span><b>${money(profile.totals.returned)}</b></div>
          <div class="sum-row"><span>جمع ${p.type === 'customer' ? 'دریافت' : 'پرداخت'}</span><b>${money(profile.totals.payments)}</b></div>
          <div class="sum-row grand"><span>${st.closing >= 0 ? (p.type === 'customer' ? 'مانده بدهکاری' : 'مانده بستانکاری') : 'مانده به نفع طرف حساب'}</span><b>${money(Math.abs(st.closing))} ${esc(currency)}</b></div>
        </div>
      </section>
      <section class="signs"><div><span>مهر و امضای فروشگاه</span></div><div><span>امضای طرف حساب</span></div></section>
      <footer class="doc-foot">${esc(s.print_footer || '')}</footer>
    </article>`;
  }

  /** گزارش عمومی قابل چاپ */
  function report(spec, s) {
    const cols = spec.columns || [];
    const rows = (spec.rows || []).map((r, i) => `<tr>
      <td class="c">${global.Money.toPersianDigits(i + 1)}</td>
      ${cols.map((c) => {
    const v = c.render ? c.render(r) : r[c.key];
    const cls = c.type === 'money' || c.type === 'qty' ? 'n' : (c.type === 'center' || c.type === 'date' ? 'c' : '');
    const text = c.type === 'money' ? money(v)
      : c.type === 'qty' ? qty(v)
        : c.type === 'date' ? jdate(v) : (v === null || v === undefined ? '' : v);
    return `<td class="${cls}">${esc(text)}</td>`;
  }).join('')}
    </tr>`).join('');
    const footer = spec.totals ? `<tfoot><tr><td class="c">—</td>${cols.map((c) => {
      const v = spec.totals[c.key];
      const cls = c.type === 'money' || c.type === 'qty' ? 'n' : '';
      const text = v === undefined || v === null ? ''
        : (c.type === 'money' ? money(v) : (c.type === 'qty' ? qty(v) : v));
      return `<td class="${cls}"><b>${esc(text)}</b></td>`;
    }).join('')}</tr></tfoot>` : '';

    return `<article class="doc a4">
      <header class="doc-head">
        ${shopBlock(s)}
        <div class="doc-title">
          <h1>${esc(spec.title)}</h1>
          ${spec.subtitle ? `<div class="meta"><b>${esc(spec.subtitle)}</b></div>` : ''}
          <div class="meta"><span>تاریخ چاپ:</span><b>${esc(jdate(global.Jalali.todayIso()))}</b></div>
        </div>
      </header>
      ${spec.summaryHtml || ''}
      <table class="items">
        <thead><tr><th class="c">ردیف</th>${cols.map((c) => `<th class="${c.type === 'money' || c.type === 'qty' ? 'n' : (c.type === 'center' || c.type === 'date' ? 'c' : '')}">${esc(c.title)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
        ${footer}
      </table>
      <footer class="doc-foot">${esc(s.print_footer || '')}</footer>
    </article>`;
  }

  /** ارسال سند به پنجره چاپ */
  async function print(html, title, size) {
    await global.U.call('print.document', { html, title, size: size || 'a4' });
  }

  global.Documents = { invoice, statement, report, print, shopBlock };
}(window));
