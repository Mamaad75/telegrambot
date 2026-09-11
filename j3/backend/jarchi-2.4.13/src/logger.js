import fs from "node:fs";
import path from "node:path";
import util from "node:util";

const levels = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const levelName = String(process.env.LOG_LEVEL || "info").toLowerCase();
const minLevel = levels[levelName] ?? levels.info;
const logDir = path.resolve(process.env.LOG_DIR || "./logs");
const logFile = path.join(logDir, process.env.LOG_FILE || "jarchi.log");
const maxBytes = Number(process.env.LOG_MAX_BYTES || 5 * 1024 * 1024);
const backups = Math.max(1, Number(process.env.LOG_BACKUPS || 5));
const queue = [];
let draining = false;
let fileDisabled = false;
let stream = null;
let currentSize = 0;
let rotateBusy = false;

function ensureStream() {
  if (fileDisabled || stream) return;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    if (fs.existsSync(logFile)) currentSize = fs.statSync(logFile).size;
    stream = fs.createWriteStream(logFile, { flags: "a", encoding: "utf8" });
    stream.on("error", () => { fileDisabled = true; try { stream?.destroy(); } catch {} stream = null; });
  } catch {
    fileDisabled = true;
  }
}

function rotateSyncIfNeeded(extraBytes = 0) {
  if (fileDisabled || rotateBusy) return;
  if (currentSize + extraBytes < maxBytes) return;
  rotateBusy = true;
  try {
    stream?.end();
    stream = null;
    for (let i = backups - 1; i >= 1; i -= 1) {
      const src = `${logFile}.${i}`;
      const dst = `${logFile}.${i + 1}`;
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
    if (fs.existsSync(logFile)) fs.renameSync(logFile, `${logFile}.1`);
    currentSize = 0;
  } catch {
    // never crash the app because log rotation failed
  } finally {
    rotateBusy = false;
  }
}

const SECRET_KEY = /(token|secret|password|authorization|api.?key|credential|merchant.?id|access.?token|webhook.?secret|cookie|session)/i;
const PHONE_KEY = /(^|[._-])(phone|phones|mobile|msisdn|tel)([._-]|$)/i;

function maskPhoneValue(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length < 7) return "[REDACTED]";
  return `${digits.slice(0, 4)}${"*".repeat(Math.max(0, digits.length - 8))}${digits.slice(-4)}`;
}

function redact(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (PHONE_KEY.test(key) && typeof value !== "boolean" && typeof value !== "number") {
    return value ? maskPhoneValue(value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  return value;
}

function normalizeError(error) {
  if (!error) return null;
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: util.format(error) };
}

function serialize(entry) { return JSON.stringify(redact(entry)); }

function drain() {
  if (draining) return;
  draining = true;
  setImmediate(() => {
    try {
      ensureStream();
      while (queue.length) {
        const item = queue.shift();
        rotateSyncIfNeeded(Buffer.byteLength(item, "utf8"));
        ensureStream();
        if (!stream) break;
        stream.write(item);
        currentSize += Buffer.byteLength(item, "utf8");
      }
    } finally {
      draining = false;
      if (queue.length) drain();
    }
  });
}

function write(level, message, context = {}) {
  if (levels[level] < minLevel) return;
  const entry = { ts: new Date().toISOString(), level, service: "jarchi", message, ...context };
  if (entry.error instanceof Error) entry.error = normalizeError(entry.error);
  const line = `${serialize(entry)}\n`;
  if (level === "error") console.error(line.trimEnd());
  else if (level === "warn") console.warn(line.trimEnd());
  else if (level === "debug") console.log(line.trimEnd());
  else console.log(line.trimEnd());
  if (!fileDisabled) { queue.push(line); if (queue.length > 5000) queue.splice(0, queue.length - 5000); drain(); }
}

export async function readLogTail({ lines = 200, level = "", queryText = "" } = {}) {
  const limit = Math.max(1, Math.min(1000, Number(lines) || 200));
  try {
    const text = await fs.promises.readFile(logFile, "utf8");
    let rows = text.split(/\r?\n/).filter(Boolean);
    if (level) rows = rows.filter((line) => line.includes(`"level":"${String(level).replaceAll('"','')}`));
    if (queryText) rows = rows.filter((line) => line.toLowerCase().includes(String(queryText).toLowerCase()));
    return rows.slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
  } catch (error) {
    return [];
  }
}


export async function flushLogs() {
  if (draining) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (queue.length) return flushLogs();
  }
  if (stream && typeof stream.once === "function") {
    await new Promise((resolve) => stream.write("", resolve));
  }
}

export const logger = {
  debug: (message, context) => write("debug", message, context),
  info: (message, context) => write("info", message, context),
  warn: (message, context) => write("warn", message, context),
  error: (message, context = {}) => write("error", message, context instanceof Error ? { error: context } : context),
  child: (base = {}) => ({
    debug: (message, context = {}) => write("debug", message, { ...base, ...context }),
    info: (message, context = {}) => write("info", message, { ...base, ...context }),
    warn: (message, context = {}) => write("warn", message, { ...base, ...context }),
    error: (message, context = {}) => write("error", message, { ...base, ...context }),
  }),
};
