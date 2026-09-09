import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { loadEnv } from '../config/env';

/**
 * URL normalization and server-side request forgery (SSRF) protection.
 *
 * Every URL this platform fetches is attacker-influenced in some way: a website field
 * typed into a lead form, a column in an uploaded CSV, a link found on a crawled page,
 * a `Location` header returned by a third-party server. Without a guard, any of those
 * could point the crawler at the VPS's own network — `http://localhost:5432`, a Docker
 * service name, or the cloud metadata endpoint at 169.254.169.254 that hands out
 * credentials.
 *
 * The guard has three layers:
 *
 *   1. **Shape** — only http/https, only sane ports, no credentials in the URL.
 *   2. **Address** — the hostname is resolved and every resulting IP is checked against
 *      the blocked ranges. A literal IP is checked directly.
 *   3. **Connect time** — the same check runs again inside the socket's DNS lookup, so
 *      the address the kernel actually connects to is the address that was validated.
 *      This is what closes DNS rebinding: a name that resolves to 8.8.8.8 during the
 *      pre-check and to 127.0.0.1 a millisecond later is refused at connect time.
 *
 * Redirects are followed manually, one hop at a time, and each hop goes through the
 * whole guard again — a permitted URL that 302s to the metadata service is stopped.
 */

/* -------------------------------------------------------------------------- */
/*  Blocked address ranges                                                     */
/* -------------------------------------------------------------------------- */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

/** [network, prefix length, why it is blocked] */
const BLOCKED_V4: Array<[string, number, string]> = [
  ['0.0.0.0', 8, 'this network'],
  ['10.0.0.0', 8, 'private network (RFC 1918)'],
  ['100.64.0.0', 10, 'carrier-grade NAT (RFC 6598)'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local / cloud metadata service'],
  ['172.16.0.0', 12, 'private network (RFC 1918)'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'documentation range'],
  ['192.168.0.0', 16, 'private network (RFC 1918)'],
  ['198.18.0.0', 15, 'benchmarking range'],
  ['198.51.100.0', 24, 'documentation range'],
  ['203.0.113.0', 24, 'documentation range'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

function blockedReasonV4(ip: string): string | null {
  const value = ipv4ToInt(ip);
  if (value === null) return 'unparseable IPv4 address';
  for (const [network, bits, why] of BLOCKED_V4) {
    const base = ipv4ToInt(network);
    if (base === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (base & mask)) return why;
  }
  return null;
}

/**
 * Expand an IPv6 address into its eight 16-bit groups.
 *
 * Written out rather than pattern-matched on the text because the same address has many
 * spellings and the guard must recognise all of them. `::ffff:127.0.0.1` is the obvious
 * one, but WHATWG `URL` rewrites it to `::ffff:7f00:1` before any of our code sees it —
 * a text rule that only knew the dotted spelling would wave the hex one straight
 * through, which is exactly the bypass this function exists to close.
 */
function expandIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!text) return null;

  // A trailing dotted-quad ("::ffff:127.0.0.1") becomes two hex groups.
  const dotted = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const v4 = ipv4ToInt(dotted[1]);
    if (v4 === null) return null;
    text = text.slice(0, dotted.index) + ((v4 >>> 16) & 0xffff).toString(16) + ':' + (v4 & 0xffff).toString(16);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (head === null || tail === null) return null;

  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    return [...head, ...Array(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

function blockedReasonV6(ip: string): string | null {
  const groups = expandIpv6(ip);
  if (!groups) return 'unparseable IPv6 address';

  const isZeroPrefix = groups.slice(0, 5).every((g) => g === 0);

  // ::1 loopback and :: unspecified.
  if (isZeroPrefix && groups[5] === 0) {
    const low = (groups[6] << 16) | groups[7];
    if (low === 1) return 'IPv6 loopback';
    if (low === 0) return 'unspecified address';
    // ::a.b.c.d — the deprecated IPv4-compatible form still reaches an IPv4 host.
    return blockedReasonV4(intToIpv4(low >>> 0));
  }

  // ::ffff:a.b.c.d — IPv4-mapped. The embedded address decides, whichever way it
  // was spelled, because that is the address the socket will actually reach.
  if (isZeroPrefix && groups[5] === 0xffff) {
    return blockedReasonV4(intToIpv4((((groups[6] << 16) | groups[7]) >>> 0)));
  }

  const first = groups[0];
  // fc00::/7 — unique local addresses.
  if ((first & 0xfe00) === 0xfc00) return 'IPv6 unique local address';
  // fe80::/10 — link-local.
  if ((first & 0xffc0) === 0xfe80) return 'IPv6 link-local address';
  // ff00::/8 — multicast.
  if ((first & 0xff00) === 0xff00) return 'IPv6 multicast';
  // 2001:db8::/32 — documentation.
  if (first === 0x2001 && groups[1] === 0x0db8) return 'IPv6 documentation range';
  // 2002::/16 — 6to4, which embeds an IPv4 address in groups 1 and 2.
  if (first === 0x2002) {
    const embedded = blockedReasonV4(intToIpv4((((groups[1] << 16) | groups[2]) >>> 0)));
    if (embedded) return `6to4 address wrapping a ${embedded}`;
  }
  // 64:ff9b::/96 — NAT64, which likewise embeds an IPv4 address in the last 32 bits.
  if (first === 0x0064 && groups[1] === 0xff9b) {
    const embedded = blockedReasonV4(intToIpv4((((groups[6] << 16) | groups[7]) >>> 0)));
    if (embedded) return `NAT64 address wrapping a ${embedded}`;
  }

  return null;
}

function intToIpv4(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

/**
 * Why this IP address must not be fetched, or null when it is a normal public address.
 * Exported for the tests and for the `audit:url` command's explanation output.
 */
export function blockedAddressReason(ip: string): string | null {
  const family = isIP(ip);
  if (family === 4) return blockedReasonV4(ip);
  if (family === 6) return blockedReasonV6(ip);
  return 'not an IP address';
}

/* -------------------------------------------------------------------------- */
/*  Hostnames that must never be resolved at all                               */
/* -------------------------------------------------------------------------- */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // Cloud metadata services, which hand out credentials to anything that asks.
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** `.local`, `.internal`, `.localhost` and friends never point anywhere public. */
const BLOCKED_TLDS = ['.local', '.localdomain', '.internal', '.localhost', '.home.arpa', '.onion'];

/** Ports a website is plausibly served on. Anything else is another service. */
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

/* -------------------------------------------------------------------------- */
/*  Normalization (patch 10)                                                   */
/* -------------------------------------------------------------------------- */

export interface NormalizedUrl {
  /** Canonical absolute URL: lower-cased scheme and host, default port removed, no fragment. */
  href: string;
  /** Hostname in ASCII (punycode) form — `فروشگاه.ir` becomes `xn--...`. */
  hostname: string;
  /** Hostname without a leading `www.`, used as the deduplication key. */
  domain: string;
  protocol: 'http:' | 'https:';
  port: number;
}

/**
 * Turn whatever a source wrote into one canonical URL.
 *
 * Handles: a missing scheme, an uppercase host, `www.`, a trailing slash, a default
 * port, a fragment, and an internationalized domain name (WHATWG `URL` performs the
 * punycode conversion, so `فروشگاه.ir` and its `xn--` spelling produce the same key).
 * Returns null when the input cannot be a website address at all.
 */
export function normalizeUrl(raw: string | null | undefined): NormalizedUrl | null {
  if (!raw) return null;
  let text = String(raw).trim();
  if (!text) return null;

  // Strip characters that routinely survive a copy-paste but are not part of the URL.
  text = text.replace(/^[<"'\s]+|[>"'\s.,;]+$/g, '');
  if (!text) return null;

  // A bare domain ("baimar.ir", "www.baimar.ir/about") is the most common way a
  // website is written in a directory listing or a spreadsheet.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null; // mailto:, tel:, javascript:, data:
    text = `http://${text}`;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  // Credentials in a URL are a phishing/SSRF vector and never belong to a business site.
  url.username = '';
  url.password = '';
  url.hash = '';

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  // Drop the port when it is the protocol default, so :443 and no port share a key.
  if ((url.protocol === 'https:' && port === 443) || (url.protocol === 'http:' && port === 80)) {
    url.port = '';
  }

  // WHATWG URL keeps an IPv6 literal in brackets ("[::1]"). Unwrap it so the address
  // rules see a plain address, and so the rejection reason names the real problem.
  const hostname = url.hostname.toLowerCase();
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const isLiteralIp = isIP(bare) !== 0;

  // A hostname with no dot and no colon is a bare label ("localhost", "postgres",
  // "redis") — a container or LAN name, never a business website.
  if (!isLiteralIp && !hostname.includes('.')) return null;

  // Normalize the path: "/" and "" are the same page.
  if (url.pathname === '/') url.pathname = '/';

  const domain = bare.replace(/^www\./, '');

  return {
    href: url.toString(),
    hostname: bare,
    domain,
    protocol: url.protocol as 'http:' | 'https:',
    port,
  };
}

/** Canonical registrable-ish domain used for deduplication. Null when unparseable. */
export function canonicalDomain(raw: string | null | undefined): string | null {
  return normalizeUrl(raw)?.domain ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Validation (patches 11 and 44)                                             */
/* -------------------------------------------------------------------------- */

export interface UrlGuardResult {
  allowed: boolean;
  /** The canonical URL, present whenever the input parsed at all. */
  url?: NormalizedUrl;
  /** Machine-readable rejection code, for logs and tests. */
  code?:
    | 'unparseable'
    | 'unsupported-protocol'
    | 'blocked-hostname'
    | 'blocked-port'
    | 'dns-failure'
    | 'blocked-address';
  /** Human-readable explanation, safe to show in the UI. */
  reason?: string;
  /** Addresses the hostname resolved to, for the audit trail. */
  addresses?: string[];
}

function shapeCheck(raw: string, allowPrivate = false): UrlGuardResult {
  const url = normalizeUrl(raw);
  if (!url) return { allowed: false, code: 'unparseable', reason: 'Not a usable http(s) URL.' };

  if (!ALLOWED_PORTS.has(url.port)) {
    return {
      allowed: false,
      url,
      code: 'blocked-port',
      reason: `Port ${url.port} is not a website port. Only 80, 443, 8080 and 8443 are fetched.`,
    };
  }

  const host = url.hostname;

  // The escape hatch has to cover the name rules and the address rules alike: a local
  // test fixture is reached as http://127.0.0.1:8080 just as often as by name, and a
  // flag that only half works is worse than no flag at all.
  if (allowPrivate) return { allowed: true, url, addresses: isIP(host) ? [host] : undefined };

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { allowed: false, url, code: 'blocked-hostname', reason: `"${host}" is a local hostname.` };
  }
  if (BLOCKED_TLDS.some((tld) => host.endsWith(tld))) {
    return { allowed: false, url, code: 'blocked-hostname', reason: `"${host}" is not a public domain name.` };
  }

  // A literal IP address needs no DNS: check it directly.
  if (isIP(host)) {
    const why = blockedAddressReason(host);
    if (why) return { allowed: false, url, code: 'blocked-address', reason: `${host} is a ${why}.`, addresses: [host] };
  }

  return { allowed: true, url };
}

/**
 * Full check: shape, then DNS, then every resolved address.
 *
 * `CRAWLER_ALLOW_PRIVATE_HOSTS=true` skips the address layer. It exists so the test
 * suite can crawl a fixture server on 127.0.0.1; the production checklist fails the
 * deployment if it is ever on.
 */
export async function guardUrl(raw: string): Promise<UrlGuardResult> {
  const allowPrivate = loadEnv().CRAWLER_ALLOW_PRIVATE_HOSTS;
  const shape = shapeCheck(raw, allowPrivate);
  if (!shape.allowed || !shape.url) return shape;
  if (allowPrivate) return shape;

  const host = shape.url.hostname;
  if (isIP(host)) return shape; // already checked, no DNS needed

  let addresses: LookupAddress[];
  try {
    addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      dnsLookup(host, { all: true, verbatim: true }, (err, result) => (err ? reject(err) : resolve(result)));
    });
  } catch (err) {
    return {
      allowed: false,
      url: shape.url,
      code: 'dns-failure',
      reason: `"${host}" does not resolve (${err instanceof Error ? err.message : 'DNS error'}).`,
    };
  }

  if (addresses.length === 0) {
    return { allowed: false, url: shape.url, code: 'dns-failure', reason: `"${host}" resolved to no addresses.` };
  }

  // Every address must be public. One private answer among several is enough to refuse:
  // we cannot control which one the socket would pick.
  for (const { address } of addresses) {
    const why = blockedAddressReason(address);
    if (why) {
      return {
        allowed: false,
        url: shape.url,
        code: 'blocked-address',
        reason: `"${host}" resolves to ${address}, which is a ${why}.`,
        addresses: addresses.map((a) => a.address),
      };
    }
  }

  return { allowed: true, url: shape.url, addresses: addresses.map((a) => a.address) };
}

/* -------------------------------------------------------------------------- */
/*  Connect-time guard                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A DNS `lookup` implementation that refuses to hand a private address to the socket.
 *
 * This is the layer that actually stops DNS rebinding. `guardUrl` checks the addresses
 * a name resolved to a moment ago; this runs at the instant the connection is made, on
 * the very address the kernel is about to use, so there is no window between the check
 * and the connect for the answer to change.
 */
export function guardedLookup(
  hostname: string,
  options: Parameters<typeof dnsLookup>[1],
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  const allowPrivate = loadEnv().CRAWLER_ALLOW_PRIVATE_HOSTS;

  dnsLookup(hostname, { ...(options as object), all: true, verbatim: true } as never, (err, result) => {
    if (err) return callback(err, '');
    const list = (Array.isArray(result) ? result : [{ address: result as unknown as string, family: 4 }]) as LookupAddress[];

    if (!allowPrivate) {
      for (const entry of list) {
        const why = blockedAddressReason(entry.address);
        if (why) {
          const blocked: NodeJS.ErrnoException = new Error(
            `Refusing to connect to ${hostname} (${entry.address}): ${why}. This is SSRF protection, not a network fault.`,
          );
          blocked.code = 'EBLOCKEDADDRESS';
          return callback(blocked, '');
        }
      }
    }

    // Preserve the caller's expected shape: `all: true` wants the array.
    const wantsAll = Boolean((options as { all?: boolean } | undefined)?.all);
    if (wantsAll) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}
