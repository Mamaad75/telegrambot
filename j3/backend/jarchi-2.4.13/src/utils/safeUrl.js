import dns from "node:dns/promises";
import net from "node:net";

/**
 * Outbound URL safety.
 *
 * Customers supply the address of their own store, so every request built from
 * that value is a potential SSRF vector. A URL is only usable when it is
 * http(s), has a real hostname, and does not resolve into the private address
 * space the backend itself sits in.
 */

export class UnsafeUrlError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback",
  "metadata", "metadata.google.internal", "instance-data",
]);

/** Ranges that must never be reachable from a customer-supplied URL. */
export function isPrivateAddress(address) {
  if (!address) return true;

  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;              // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;    // carrier-grade NAT
    if (a >= 224) return true;                            // multicast / reserved
    return false;
  }

  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    if (value === "::1" || value === "::") return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true;  // unique local
    if (value.startsWith("fe80")) return true;                          // link-local
    if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
    return false;
  }

  return true;
}

/**
 * Parses and vets a customer-supplied base URL.
 *
 * @param {string} value
 * @param {object} options
 *   - allowPrivateHosts: for staging deployments that really do use a LAN host
 *   - expectedHostname: pin the URL to a host already registered for the site
 */
export async function assertSafeUrl(value, { allowPrivateHosts = false, expectedHostname = "" } = {}) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new UnsafeUrlError("Address is not a valid URL", "invalid_url");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UnsafeUrlError("Only http and https addresses are allowed", "bad_protocol");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Credentials must not be embedded in the address", "embedded_credentials");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new UnsafeUrlError("Address has no hostname", "no_hostname");

  if (expectedHostname && hostname !== String(expectedHostname).toLowerCase()) {
    throw new UnsafeUrlError(
      "Address does not match the hostname registered for this site",
      "hostname_mismatch",
    );
  }

  if (!allowPrivateHosts) {
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      throw new UnsafeUrlError("Internal hostnames are not allowed", "blocked_hostname");
    }

    // Literal addresses are checked directly; names are resolved, because a
    // public name can point at 127.0.0.1 just as easily.
    if (net.isIP(hostname)) {
      if (isPrivateAddress(hostname)) throw new UnsafeUrlError("Private addresses are not allowed", "private_address");
    } else {
      let records = [];
      try {
        records = await dns.lookup(hostname, { all: true });
      } catch {
        throw new UnsafeUrlError("Address could not be resolved", "dns_failure");
      }
      if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
        throw new UnsafeUrlError("Address resolves to a private network", "private_address");
      }
    }
  }

  return url;
}

/** Joins a vetted base URL with a path without letting the path escape it. */
export function joinUrl(baseUrl, path) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const suffix = String(path).replace(/^\/+/, "").replace(/\.\.(\/|$)/g, "");
  return `${base}/${suffix}`;
}
