import { describe, expect, it } from 'vitest';
import { isPathAllowed, parseRobots } from './robots';

const UA = 'BaimarLeadIntelligenceBot/1.0 (+https://baimar.ir/bot)';

describe('robots.txt compliance', () => {
  it('honours a wildcard disallow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private/\n', UA);
    expect(isPathAllowed(rules, '/private/page')).toBe(false);
    expect(isPathAllowed(rules, '/public/page')).toBe(true);
  });

  it('prefers a rule block naming our agent over the wildcard block', () => {
    const rules = parseRobots(
      ['User-agent: *', 'Disallow: /', '', 'User-agent: BaimarLeadIntelligenceBot', 'Disallow: /admin/'].join('\n'),
      UA,
    );
    expect(isPathAllowed(rules, '/')).toBe(true);
    expect(isPathAllowed(rules, '/admin/x')).toBe(false);
  });

  it('treats a full-site disallow as blockAll', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /\n', UA);
    expect(rules.blockAll).toBe(true);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /files/\nAllow: /files/public/\n', UA);
    expect(isPathAllowed(rules, '/files/secret.pdf')).toBe(false);
    expect(isPathAllowed(rules, '/files/public/brochure.pdf')).toBe(true);
  });

  it('reads Crawl-delay and sitemaps', () => {
    const rules = parseRobots(
      'Sitemap: https://example.ir/sitemap.xml\nUser-agent: *\nCrawl-delay: 10\nDisallow:\n',
      UA,
    );
    expect(rules.crawlDelaySeconds).toBe(10);
    expect(rules.sitemaps).toContain('https://example.ir/sitemap.xml');
    // "Disallow:" with an empty value means everything is allowed.
    expect(isPathAllowed(rules, '/anything')).toBe(true);
  });

  it('supports wildcard patterns', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /*?sessionid=\n', UA);
    expect(isPathAllowed(rules, '/page?sessionid=1')).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    const rules = parseRobots('# comment\n\nUser-agent: *\n  Disallow: /x/   # trailing\n', UA);
    expect(isPathAllowed(rules, '/x/y')).toBe(false);
  });

  it('allows everything when no rules were published', () => {
    const rules = parseRobots('', UA);
    expect(isPathAllowed(rules, '/anything')).toBe(true);
  });

  it('ignores a block that names a different agent', () => {
    const rules = parseRobots('User-agent: SomeOtherBot\nDisallow: /\n', UA);
    expect(isPathAllowed(rules, '/anything')).toBe(true);
  });

  it('applies every directive in a group that lists several agents', () => {
    const rules = parseRobots(
      'User-agent: SomeOtherBot\nUser-agent: BaimarLeadIntelligenceBot\nDisallow: /private/\n',
      UA,
    );
    expect(isPathAllowed(rules, '/private/x')).toBe(false);
    expect(isPathAllowed(rules, '/public')).toBe(true);
  });
});
