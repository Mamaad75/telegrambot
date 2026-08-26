/* صفحه فاکتور فروش و برگشت از فروش */
(function (global) {
  'use strict';
  global.Pages = global.Pages || {};

  global.Pages.sale = {
    title: 'فاکتور فروش',
    render(view, params) {
      const ed = global.InvoiceEditor.create('sale', view, {});
      if (params && params.refInvoiceId) ed.loadFromInvoice(params.refInvoiceId);
    },
  };

  global.Pages.sale_return = {
    title: 'برگشت از فروش',
    render(view, params) {
      const ed = global.InvoiceEditor.create('sale_return', view, {});
      if (params && params.refInvoiceId) ed.loadFromInvoice(params.refInvoiceId);
    },
  };
}(window));
