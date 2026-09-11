import crypto from "node:crypto";
import { config } from "../../config.js";
import { AiError, AI_ERROR_CODES } from "../errors.js";

/**
 * Image validation.
 *
 * The client-declared Content-Type is never believed: the format is decided by
 * the file's own bytes, and dimensions are read from the container header. A
 * file whose header does not parse is rejected rather than handed to a provider
 * or uploaded to the customer's WordPress.
 */

export const ALLOWED_IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

const MIN_DIMENSION = 64;
const MAX_DIMENSION = 12000;

/** Detects the real format from magic bytes. */
export function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function pngDimensions(buffer) {
  // IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte type.
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    // Start-of-frame markers carry the dimensions; skip everything else.
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (isSof) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function webpDimensions(buffer) {
  const format = buffer.subarray(12, 16).toString("ascii");
  if (format === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (format === "VP8 ") {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (format === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function readImageDimensions(buffer, mimeType) {
  try {
    if (mimeType === "image/png") return pngDimensions(buffer);
    if (mimeType === "image/jpeg") return jpegDimensions(buffer);
    if (mimeType === "image/webp") return webpDimensions(buffer);
  } catch {
    return null;
  }
  return null;
}

/**
 * Validates an uploaded or generated image.
 *
 * @param {Buffer} buffer
 * @param {object} options { maxBytes, declaredMimeType }
 * @returns {{ mimeType, byteSize, width, height, checksum, extension }}
 */
export function validateImageBuffer(buffer, { maxBytes = config.ai.maxImageBytes, declaredMimeType = "" } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new AiError(AI_ERROR_CODES.IMAGE_VALIDATION_ERROR, "Empty image payload", {
      safeMessage: "فایل تصویر خالی است.",
    });
  }
  if (buffer.length > maxBytes) {
    throw new AiError(
      AI_ERROR_CODES.IMAGE_VALIDATION_ERROR,
      `Image is ${buffer.length} bytes, limit is ${maxBytes}`,
      { safeMessage: `حجم تصویر بیش از حد مجاز است (حداکثر ${Math.round(maxBytes / 1024 / 1024)} مگابایت).` },
    );
  }

  const mimeType = sniffImageType(buffer);
  if (!mimeType) {
    throw new AiError(AI_ERROR_CODES.IMAGE_VALIDATION_ERROR, "Unrecognised image format", {
      safeMessage: "فرمت تصویر پشتیبانی نمی‌شود. از JPEG، PNG یا WebP استفاده کنید.",
    });
  }
  if (declaredMimeType && declaredMimeType.split(";")[0].trim() !== mimeType) {
    // Not fatal — the real type wins — but worth recording as a mismatch.
    // A deliberate mismatch is how polyglot files try to slip through.
    if (!ALLOWED_IMAGE_TYPES.includes(declaredMimeType.split(";")[0].trim())) {
      throw new AiError(
        AI_ERROR_CODES.IMAGE_VALIDATION_ERROR,
        `Declared type ${declaredMimeType} does not match sniffed ${mimeType}`,
        { safeMessage: "نوع فایل با محتوای آن هم‌خوانی ندارد." },
      );
    }
  }

  const dimensions = readImageDimensions(buffer, mimeType);
  if (!dimensions || !dimensions.width || !dimensions.height) {
    throw new AiError(AI_ERROR_CODES.IMAGE_VALIDATION_ERROR, `Corrupted ${mimeType} header`, {
      safeMessage: "فایل تصویر سالم نیست.",
    });
  }
  if (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION) {
    throw new AiError(
      AI_ERROR_CODES.IMAGE_VALIDATION_ERROR,
      `Image ${dimensions.width}x${dimensions.height} is below the minimum ${MIN_DIMENSION}px`,
      { safeMessage: `ابعاد تصویر بسیار کوچک است (حداقل ${MIN_DIMENSION} پیکسل).` },
    );
  }
  if (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
    throw new AiError(
      AI_ERROR_CODES.IMAGE_VALIDATION_ERROR,
      `Image ${dimensions.width}x${dimensions.height} exceeds ${MAX_DIMENSION}px`,
      { safeMessage: "ابعاد تصویر بیش از حد بزرگ است." },
    );
  }

  return {
    mimeType,
    byteSize: buffer.length,
    width: dimensions.width,
    height: dimensions.height,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
    extension: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType],
  };
}

/** Decodes a data URL or bare base64 string into a validated buffer. */
export function decodeBase64Image(value, options = {}) {
  const raw = String(value || "");
  const match = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  const base64 = match ? match[2] : raw;
  const declaredMimeType = match ? match[1] : options.declaredMimeType || "";

  let buffer;
  try {
    buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");
  } catch {
    throw new AiError(AI_ERROR_CODES.IMAGE_VALIDATION_ERROR, "Image payload is not valid base64", {
      safeMessage: "داده تصویر معتبر نیست.",
    });
  }
  return { buffer, meta: validateImageBuffer(buffer, { ...options, declaredMimeType }) };
}
