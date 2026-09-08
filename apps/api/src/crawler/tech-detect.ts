import type { DetectedTechnology } from '@baimar/shared';

/**
 * Technology fingerprinting.
 *
 * Detection here is explicitly heuristic and is reported as such: each hit carries the
 * evidence string that produced it and a confidence level. The UI never says
 * "this site runs WordPress" — it says "WordPress (high confidence: /wp-content/ paths)".
 */

interface Rule {
  name: string;
  category: string;
  confidence: DetectedTechnology['confidence'];
  /** Matched against the raw HTML. */
  html?: RegExp[];
  /** Matched against response headers, as `name: value` lines. */
  headers?: RegExp[];
  /** Matched against script/link URLs. */
  urls?: RegExp[];
}

const RULES: Rule[] = [
  {
    name: 'WordPress',
    category: 'CMS',
    confidence: 'HIGH',
    html: [/\/wp-content\//i, /\/wp-includes\//i, /<meta name="generator" content="WordPress/i],
  },
  {
    name: 'WooCommerce',
    category: 'E-commerce',
    confidence: 'HIGH',
    html: [/woocommerce/i, /wc-ajax/i, /class="[^"]*woocommerce/i],
  },
  {
    name: 'Elementor',
    category: 'Page builder',
    confidence: 'HIGH',
    html: [/elementor-page/i, /\/elementor\//i, /data-elementor-type/i],
  },
  { name: 'Divi', category: 'Page builder', confidence: 'MEDIUM', html: [/et_pb_/i, /divi/i] },
  {
    name: 'Shopify',
    category: 'E-commerce',
    confidence: 'HIGH',
    html: [/cdn\.shopify\.com/i, /Shopify\.theme/i],
    headers: [/x-shopify/i],
  },
  {
    name: 'Next.js',
    category: 'Framework',
    confidence: 'HIGH',
    html: [/__NEXT_DATA__/i, /\/_next\/static\//i],
    headers: [/x-powered-by:\s*next\.js/i],
  },
  { name: 'Nuxt', category: 'Framework', confidence: 'HIGH', html: [/__NUXT__/i, /\/_nuxt\//i] },
  { name: 'React', category: 'JS library', confidence: 'MEDIUM', html: [/data-reactroot/i, /react(-dom)?[.@][\d.]+/i] },
  { name: 'Vue.js', category: 'JS library', confidence: 'MEDIUM', html: [/data-v-[0-9a-f]{8}/i, /vue(\.min)?\.js/i] },
  { name: 'Angular', category: 'Framework', confidence: 'MEDIUM', html: [/ng-version=/i, /\[ng-/i] },
  {
    name: 'Laravel',
    category: 'Framework',
    confidence: 'MEDIUM',
    html: [/laravel_session/i, /csrf-token/i],
    headers: [/set-cookie:[^\n]*laravel_session/i],
  },
  { name: 'Django', category: 'Framework', confidence: 'MEDIUM', headers: [/set-cookie:[^\n]*csrftoken/i] },
  { name: 'Joomla', category: 'CMS', confidence: 'HIGH', html: [/\/media\/jui\//i, /content="Joomla/i] },
  { name: 'Drupal', category: 'CMS', confidence: 'HIGH', html: [/\/sites\/default\/files\//i, /Drupal\.settings/i] },
  { name: 'Wix', category: 'Website builder', confidence: 'HIGH', html: [/static\.wixstatic\.com/i, /wix-code/i] },
  { name: 'Squarespace', category: 'Website builder', confidence: 'HIGH', html: [/squarespace\.com/i, /Static\.SQUARESPACE/i] },
  { name: 'Bootstrap', category: 'CSS framework', confidence: 'MEDIUM', html: [/bootstrap(\.min)?\.css/i, /class="[^"]*\b(col-md-|navbar-toggler)\b/i] },
  { name: 'Tailwind CSS', category: 'CSS framework', confidence: 'MEDIUM', html: [/tailwind(\.min)?\.css/i, /class="[^"]*\b(flex|grid)\b[^"]*\bgap-\d/i] },
  { name: 'jQuery', category: 'JS library', confidence: 'MEDIUM', html: [/jquery[.-][\d.]+(\.min)?\.js/i, /jQuery\.fn\.jquery/i] },
  { name: 'Cloudflare', category: 'CDN', confidence: 'HIGH', headers: [/server:\s*cloudflare/i, /cf-ray:/i] },
  { name: 'Arvan Cloud', category: 'CDN', confidence: 'HIGH', headers: [/server:\s*ArvanCloud/i, /ar-.*cache/i] },
  { name: 'Nginx', category: 'Web server', confidence: 'HIGH', headers: [/server:\s*nginx/i] },
  { name: 'Apache', category: 'Web server', confidence: 'HIGH', headers: [/server:\s*apache/i] },
  { name: 'LiteSpeed', category: 'Web server', confidence: 'HIGH', headers: [/server:\s*litespeed/i] },
  { name: 'PHP', category: 'Language', confidence: 'MEDIUM', headers: [/x-powered-by:\s*php/i] },
  { name: 'ASP.NET', category: 'Framework', confidence: 'MEDIUM', headers: [/x-aspnet-version/i, /x-powered-by:\s*asp\.net/i] },
  { name: 'Google Tag Manager', category: 'Analytics', confidence: 'HIGH', html: [/googletagmanager\.com\/gtm\.js/i] },
  { name: 'Google Analytics', category: 'Analytics', confidence: 'HIGH', html: [/google-analytics\.com\/analytics\.js/i, /gtag\('config'/i] },
  { name: 'Yektanet', category: 'Advertising', confidence: 'MEDIUM', html: [/yektanet/i] },
  { name: 'Goftino', category: 'Live chat', confidence: 'HIGH', html: [/goftino/i] },
  { name: 'Raychat', category: 'Live chat', confidence: 'HIGH', html: [/raychat/i] },
  { name: 'Zarinpal', category: 'Payment', confidence: 'MEDIUM', html: [/zarinpal/i] },
  { name: 'IDPay', category: 'Payment', confidence: 'MEDIUM', html: [/idpay\.ir/i] },
  { name: 'Digikala Mag', category: 'Marketplace', confidence: 'LOW', html: [/digikala\.com/i] },
  { name: 'Flash (obsolete)', category: 'Legacy', confidence: 'HIGH', html: [/\.swf\b/i, /application\/x-shockwave-flash/i] },
];

export function detectTechnologies(html: string, headers: Record<string, string>): DetectedTechnology[] {
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const found: DetectedTechnology[] = [];
  for (const rule of RULES) {
    const evidence: string[] = [];
    for (const re of rule.html ?? []) {
      const m = html.match(re);
      if (m) evidence.push(`markup matched ${re.source.slice(0, 40)}`);
    }
    for (const re of rule.headers ?? []) {
      const m = headerLines.match(re);
      if (m) evidence.push(`header "${m[0].slice(0, 60)}"`);
    }
    if (!evidence.length) continue;

    // Two independent hits raise confidence one notch.
    const confidence: DetectedTechnology['confidence'] =
      evidence.length >= 2 && rule.confidence === 'MEDIUM' ? 'HIGH' : rule.confidence;

    found.push({
      name: rule.name,
      category: rule.category,
      confidence,
      evidence: evidence.slice(0, 2).join('; '),
    });
  }
  return found;
}

/**
 * Rough age indicator, used only as an *input* to the "outdated website" signal —
 * never presented on its own as "this site was built in 2011".
 */
export function legacyIndicators(html: string, technologies: DetectedTechnology[]): string[] {
  const indicators: string[] = [];
  if (technologies.some((t) => t.name === 'Flash (obsolete)')) indicators.push('Uses Adobe Flash');
  if (/<frameset/i.test(html)) indicators.push('Uses HTML frames');
  if (/<font\b/i.test(html)) indicators.push('Uses <font> tags');
  if (/<center\b/i.test(html)) indicators.push('Uses <center> tags');
  if (/<marquee\b/i.test(html)) indicators.push('Uses <marquee>');
  if (/xhtml 1\.0|html 4\.01|<!DOCTYPE html PUBLIC/i.test(html)) indicators.push('Legacy DOCTYPE (XHTML/HTML4)');
  const jq = html.match(/jquery[.-](\d+)\.(\d+)/i);
  if (jq && Number(jq[1]) < 3) indicators.push(`jQuery ${jq[1]}.${jq[2]} (end of life)`);
  if (/bootstrap[.-]([23])\./i.test(html)) indicators.push('Bootstrap 2/3 (end of life)');
  return indicators;
}
