import { config } from "../config.js";
import {
  PlatformError, ERROR_CATEGORIES, fetchJson, categorizeHttpStatus, retryAfterMsFromHeaders,
} from "./errors.js";

/**
 * WhatsApp Cloud API adapter.
 *
 * Credentials belong to the client and are stored encrypted in
 * platform_connections; they are passed in per call and never logged.
 */
export async function sendWhatsAppText({ accessToken, phoneNumberId, to, text }) {
  if (!config.whatsapp.enabled) {
    throw new PlatformError("WhatsApp is disabled", { platform: "whatsapp", category: ERROR_CATEGORIES.CONFIG });
  }
  if (!accessToken || !phoneNumberId || !to) {
    throw new PlatformError("WhatsApp credentials/recipient are missing", {
      platform: "whatsapp", category: ERROR_CATEGORIES.CONFIG,
    });
  }

  const { response, data } = await fetchJson(
    `https://graph.facebook.com/${config.whatsapp.graphVersion}/${phoneNumberId}/messages`,
    {
      platform: "whatsapp",
      timeoutMs: config.whatsapp.apiTimeoutMs,
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: String(text), preview_url: true },
      }),
    },
  );

  if (!response.ok) {
    const description = data?.error?.message || "WhatsApp API error";
    throw new PlatformError(description, {
      platform: "whatsapp",
      category: categorizeHttpStatus(response.status, description),
      status: response.status,
      retryAfterMs: retryAfterMsFromHeaders(response, data),
    });
  }
  return { message_ids: (data.messages || []).map((message) => message.id).filter(Boolean) };
}

/** Verifies a client's credentials against the phone number node. */
export async function testWhatsApp({ accessToken, phoneNumberId }) {
  if (!accessToken || !phoneNumberId) {
    throw new PlatformError("WhatsApp credentials are missing", {
      platform: "whatsapp", category: ERROR_CATEGORIES.CONFIG,
    });
  }

  const { response, data } = await fetchJson(
    `https://graph.facebook.com/${config.whatsapp.graphVersion}/${phoneNumberId}`,
    {
      platform: "whatsapp",
      timeoutMs: config.whatsapp.apiTimeoutMs,
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!response.ok) {
    const description = data?.error?.message || "WhatsApp connection failed";
    throw new PlatformError(description, {
      platform: "whatsapp",
      category: categorizeHttpStatus(response.status, description),
      status: response.status,
    });
  }

  return {
    ok: true,
    phone_number_id: data?.id || phoneNumberId,
    display_phone_number: data?.display_phone_number || "",
    verified_name: data?.verified_name || "",
    quality_rating: data?.quality_rating || "",
  };
}

/** WhatsApp cannot recall a delivered message through the Cloud API. */
export const supportsDeletion = false;
