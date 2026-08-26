/* صفحه فاکتور خرید و برگشت از خرید */
(function (global) {
  'use strict';
  global.Pages = global.Pages || {};

  global.Pages.purchase = {
    title: 'فاکتور خرید',
    render(view, params) {
      const ed = global.InvoiceEditor.create('purchase', view, {});
      if (params && params.refInvoiceId) ed.loadFromInvoice(params.refInvoiceId);
    },
  };

  global.Pages.purchase_return = {
    title: 'برگشت از خرید',
    render(view, params) {
      const ed = global.InvoiceEditor.create('purchase_return', view, {});
      if (params && params.refInvoiceId) ed.loadFromInvoice(params.refInvoiceId);
    },
  };
}(window));
