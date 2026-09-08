import { cacheGet, cacheSet } from '../../lib/cache';
import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import { sha256 } from '../../lib/crypto';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Exchange a long-lived OAuth refresh token for a short-lived access token.
 *
 * Shared by the Google Ads and Search Console adapters. Access tokens are cached in Redis
 * until shortly before they expire; the refresh token itself never leaves the server.
 */
export async function getGoogleAccessToken(
  providerKey: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const cacheKey = `google-oauth:${providerKey}:${sha256(`${clientId}:${refreshToken}`).slice(0, 24)}`;
  const cachedToken = await cacheGet<string>(cacheKey);
  if (cachedToken) return cachedToken;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  try {
    const { data } = await httpJson<TokenResponse>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      timeoutMs: 20000,
      retries: 1,
      providerKey,
    });
    // Refresh a minute early so an in-flight request never uses an expiring token.
    await cacheSet(cacheKey, data.access_token, Math.max(60, (data.expires_in ?? 3600) - 60));
    return data.access_token;
  } catch (err) {
    throw new ProviderError(
      providerKey,
      `OAuth token refresh failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      { retryable: false },
    );
  }
}
