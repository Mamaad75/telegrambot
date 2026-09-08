import { describe, expect, it } from 'vitest';
import { analyzePage, pickNextUrls } from './parse';
import { detectTechnologies, legacyIndicators } from './tech-detect';

function analyze(html: string, url = 'https://example.ir/') {
  return analyzePage({ url, finalUrl: url, status: 200, html, bytes: html.length, responseMs: 120, truncated: false });
}

const MODERN = `
<!doctype html><html lang="fa" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>کلینیک زیبایی نمونه — خدمات پوست و مو در اراک</title>
<meta name="description" content="کلینیک زیبایی نمونه در اراک با خدمات لیزر، مزوتراپی و پاکسازی پوست. برای رزرو نوبت تماس بگیرید.">
<link rel="canonical" href="https://example.ir/">
<link rel="icon" href="/favicon.ico">
<meta property="og:title" content="کلینیک نمونه">
<script type="application/ld+json">{"@type":"LocalBusiness","name":"کلینیک نمونه"}</script>
</head><body>
<header><img class="logo" src="/logo.png" alt="لوگو" width="120" height="40"></header>
<h1>کلینیک زیبایی نمونه</h1>
<h2>خدمات</h2><h2>درباره ما</h2>
<a href="tel:+989123456789">۰۹۱۲۳۴۵۶۷۸۹</a>
<a href="/contact">تماس با ما</a><a href="/about">درباره ما</a><a href="/services">خدمات</a>
<a href="https://instagram.com/example_clinic">اینستاگرام</a>
<a class="cta" href="/reserve">رزرو آنلاین نوبت</a>
<form action="/contact"><input type="tel"><textarea></textarea><button>ارسال</button></form>
<img src="/a.jpg" alt="لیزر" width="300" height="200" loading="lazy">
<p>${'متن نمونه '.repeat(200)}</p>
</body></html>`;

const LEGACY = `
<html><head><title>شرکت</title></head><body bgcolor="#fff">
<table width="800" border="1"><tr><td><font size="2"><center>خوش آمدید</center></font></td></tr></table>
<script src="/js/jquery-1.11.min.js"></script>
<object type="application/x-shockwave-flash" data="/intro.swf"></object>
</body></html>`;

describe('page analysis', () => {
  it('extracts the SEO fundamentals from a well-built page', () => {
    const page = analyze(MODERN);
    expect(page.title).toContain('کلینیک زیبایی نمونه');
    expect(page.metaDescriptionLength).toBeGreaterThan(50);
    expect(page.h1).toHaveLength(1);
    expect(page.h2.length).toBeGreaterThanOrEqual(2);
    expect(page.canonical).toBe('https://example.ir/');
    expect(page.structuredDataTypes).toContain('LocalBusiness');
    expect(page.hasViewport).toBe(true);
    expect(page.hasFavicon).toBe(true);
    expect(page.hasOpenGraph).toBe(true);
    expect(page.hasLogo).toBe(true);
    expect(page.lang).toBe('fa');
    expect(page.dir).toBe('rtl');
  });

  it('finds conversion signals: phone link, form, CTA and booking wording', () => {
    const page = analyze(MODERN);
    expect(page.hasPhoneLink).toBe(true);
    expect(page.hasContactForm).toBe(true);
    expect(page.ctaCount).toBeGreaterThan(0);
    expect(page.hasBookingSignals).toBe(true);
    expect(page.phones).toContain('+989123456789');
    expect(page.instagramUrl).toContain('instagram.com/example_clinic');
  });

  it('counts internal and external links separately', () => {
    const page = analyze(MODERN);
    expect(page.internalLinks).toBeGreaterThanOrEqual(3);
    expect(page.externalLinks).toBeGreaterThanOrEqual(1);
  });

  it('detects legacy construction without guessing', () => {
    const page = analyze(LEGACY);
    expect(page.hasViewport).toBe(false);
    expect(page.hasFlash).toBe(true);
    expect(page.legacyMarkup).toContain('<font>');
    expect(page.legacyMarkup).toContain('<center>');
    expect(page.tableLayoutScore).toBeGreaterThan(0);

    const indicators = legacyIndicators(LEGACY, detectTechnologies(LEGACY, {}));
    expect(indicators.join(' ')).toContain('jQuery 1.11');
    expect(indicators).toContain('Uses Adobe Flash');
  });

  it('classifies page roles from the URL and title', () => {
    expect(analyze(MODERN, 'https://example.ir/').role).toBe('home');
    expect(analyze('<title>تماس با ما</title>', 'https://example.ir/contact').role).toBe('contact');
    expect(analyze('<title>فروشگاه</title>', 'https://example.ir/shop').role).toBe('products');
  });

  it('prioritises the most informative internal links to crawl next', () => {
    const page = analyze(MODERN);
    const next = pickNextUrls(page, new Set(), 3);
    expect(next[0]).toContain('/contact');
    expect(next.some((u) => u.includes('.jpg'))).toBe(false);
  });
});

describe('technology detection', () => {
  it('reports the evidence alongside every detection', () => {
    const html = '<html><head><link href="/wp-content/themes/x/style.css"></head><body class="woocommerce"></body></html>';
    const found = detectTechnologies(html, { server: 'nginx' });
    const names = found.map((f) => f.name);

    expect(names).toContain('WordPress');
    expect(names).toContain('WooCommerce');
    expect(names).toContain('Nginx');
    for (const tech of found) {
      expect(tech.evidence.length).toBeGreaterThan(0);
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(tech.confidence);
    }
  });

  it('detects nothing on an empty page rather than guessing', () => {
    expect(detectTechnologies('<html><body></body></html>', {})).toHaveLength(0);
  });
});
