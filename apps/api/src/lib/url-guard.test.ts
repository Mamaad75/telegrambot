import { describe, expect, it } from 'vitest';
import { blockedAddressReason, canonicalDomain, guardUrl, guardedLookup, normalizeUrl } from './url-guard';

/**
 * These are the tests that matter most in this repository.
 *
 * Every URL the crawler fetches was influenced by somebody else — a website typed into
 * a lead form, a column in an uploaded spreadsheet, a link found on a crawled page, a
 * `Location` header from a third-party server. If the guard leaks, the crawler becomes
 * a proxy into the VPS's own network: Postgres on 5432, Redis on 6379, or the cloud
 * metadata endpoint that hands out credentials to anything that asks.
 *
 * A failure here is a security regression, not a style problem.
 */

describe('URL normalization (patch 10)', () => {
  it('adds a scheme to a bare domain, the way a directory listing writes it', () => {
    expect(normalizeUrl('baimar.ir')?.href).toBe('http://baimar.ir/');
  });

  it('lower-cases the host but leaves the path alone', () => {
    const n = normalizeUrl('HTTP://WWW.Baimar.IR/About-Us');
    expect(n?.href).toBe('http://www.baimar.ir/About-Us');
    expect(n?.hostname).toBe('www.baimar.ir');
  });

  it('drops the default port so :443 and no port are one key', () => {
    expect(normalizeUrl('https://baimar.ir:443/')?.href).toBe('https://baimar.ir/');
    expect(normalizeUrl('http://baimar.ir:80/')?.href).toBe('http://baimar.ir/');
  });

  it('drops the fragment, which never identifies a different page to the crawler', () => {
    expect(normalizeUrl('https://baimar.ir/pricing#plans')?.href).toBe('https://baimar.ir/pricing');
  });

  it('strips credentials embedded in the URL', () => {
    expect(normalizeUrl('http://user:pass@baimar.ir/')?.href).toBe('http://baimar.ir/');
  });

  it('converts an internationalized domain to punycode, so both spellings share a key', () => {
    const unicode = canonicalDomain('https://فروشگاه.ir/');
    expect(unicode).toBe('xn--mgbtj4c7ad63e.ir');
    expect(canonicalDomain('https://xn--mgbtj4c7ad63e.ir/')).toBe(unicode);
  });

  it('treats www and non-www as the same domain for deduplication', () => {
    expect(canonicalDomain('https://www.baimar.ir/x')).toBe('baimar.ir');
    expect(canonicalDomain('http://baimar.ir')).toBe('baimar.ir');
  });

  it('survives the punctuation a copy-paste leaves behind', () => {
    expect(canonicalDomain('  <https://baimar.ir/>,  ')).toBe('baimar.ir');
  });

  it('refuses schemes that are not web pages', () => {
    for (const raw of ['mailto:sales@baimar.ir', 'tel:+989121234567', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
      expect(normalizeUrl(raw)).toBeNull();
    }
  });

  it('refuses a bare hostname with no dot — a container or LAN name, never a website', () => {
    for (const raw of ['http://postgres', 'http://redis', 'http://localhost', 'intranet']) {
      expect(normalizeUrl(raw)).toBeNull();
    }
  });
});

describe('blocked address ranges (patch 44)', () => {
  const blocked: Array<[string, string]> = [
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback anywhere in 127/8'],
    ['0.0.0.0', 'this network'],
    ['10.1.2.3', 'RFC 1918'],
    ['172.16.5.4', 'RFC 1918'],
    ['172.31.255.255', 'top of the RFC 1918 /12'],
    ['192.168.0.1', 'RFC 1918'],
    ['169.254.169.254', 'cloud metadata'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 unique local'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata address'],
    // WHATWG URL rewrites ::ffff:127.0.0.1 to this hex spelling before the guard
    // ever sees it, so the hex form must be blocked in its own right.
    ['::ffff:7f00:1', 'IPv4-mapped loopback in hex form'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata address in hex form'],
    ['2002:7f00:1::1', '6to4 wrapping loopback'],
    ['64:ff9b::7f00:1', 'NAT64 wrapping loopback'],
    ['::127.0.0.1', 'IPv4-compatible loopback'],
  ];

  for (const [ip, why] of blocked) {
    it(`blocks ${ip} (${why})`, () => {
      expect(blockedAddressReason(ip)).toBeTruthy();
    });
  }

  const allowed = ['8.8.8.8', '1.1.1.1', '185.143.233.120', '2606:4700:4700::1111'];
  for (const ip of allowed) {
    it(`allows the public address ${ip}`, () => {
      expect(blockedAddressReason(ip)).toBeNull();
    });
  }

  it('does not mistake 172.32.x for the private /12', () => {
    expect(blockedAddressReason('172.32.0.1')).toBeNull();
  });

  it('does not mistake 100.128.x for the CGNAT /10', () => {
    expect(blockedAddressReason('100.128.0.1')).toBeNull();
  });
});

describe('guardUrl refuses every shape of internal target', () => {
  const attacks: Array<[string, string]> = [
    ['http://127.0.0.1/', 'loopback by literal address'],
    ['http://127.0.0.1:8080/', 'loopback on an allowed port'],
    ['http://2130706433/', 'loopback written as a decimal integer'],
    ['http://0x7f000001/', 'loopback written in hex'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped loopback'],
    ['http://169.254.169.254/latest/meta-data/', 'AWS/OpenStack metadata service'],
    ['http://metadata.google.internal/computeMetadata/v1/', 'Google metadata hostname'],
    ['http://10.0.0.5/admin', 'private network'],
    ['http://192.168.1.1/', 'home router'],
    ['http://172.16.0.1/', 'private network'],
    ['http://localhost:5432/', 'Postgres by name'],
    ['http://postgres:5432/', 'Postgres by container name'],
    ['http://redis:6379/', 'Redis by container name'],
    ['http://baimar.ir:22/', 'SSH port on a legitimate host'],
    ['http://baimar.ir:5432/', 'database port on a legitimate host'],
    ['file:///etc/passwd', 'local file'],
    ['gopher://127.0.0.1:6379/_INFO', 'protocol smuggling'],
    ['http://printer.local/', 'mDNS name'],
    ['http://service.internal/', 'internal TLD'],
  ];

  for (const [url, why] of attacks) {
    it(`refuses ${url} — ${why}`, async () => {
      const verdict = await guardUrl(url);
      expect(verdict.allowed).toBe(false);
      expect(verdict.code).toBeTruthy();
      // The reason is shown to a user, so it must say something, not just "invalid".
      expect(verdict.reason).toBeTruthy();
    });
  }
});

describe('guardUrl allows ordinary public websites', () => {
  // example.com is reserved by RFC 2606 and resolves to a public address.
  it('allows a normal https site', async () => {
    const verdict = await guardUrl('https://example.com/');
    expect(verdict.allowed).toBe(true);
    expect(verdict.url?.domain).toBe('example.com');
  });

  it('reports the addresses it validated, for the audit trail', async () => {
    const verdict = await guardUrl('https://example.com/');
    expect(verdict.addresses?.length).toBeGreaterThan(0);
  });

  it('refuses a name that does not resolve rather than assuming it is fine', async () => {
    const verdict = await guardUrl('https://this-host-does-not-exist.invalid/');
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe('dns-failure');
  });
});

describe('connect-time guard (DNS rebinding defence)', () => {
  // `guardUrl` checks the addresses a name resolved to a moment ago. This layer runs
  // inside the socket's own lookup, on the address the kernel is about to use, so
  // there is no window for the answer to change between check and connect.
  it('refuses to hand a loopback address to the socket', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      guardedLookup('localhost', { all: true } as never, (e) => resolve(e));
    });
    expect(err).toBeTruthy();
    expect(err?.code).toBe('EBLOCKEDADDRESS');
    expect(err?.message).toContain('SSRF protection');
  });

  it('passes a public address through unchanged', async () => {
    const result = await new Promise<{ err: NodeJS.ErrnoException | null; addr: unknown }>((resolve) => {
      guardedLookup('example.com', { all: true } as never, (err, addr) => resolve({ err, addr }));
    });
    expect(result.err).toBeNull();
    expect(Array.isArray(result.addr)).toBe(true);
  });
});
