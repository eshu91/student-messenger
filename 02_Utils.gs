/**
 * 02_Utils.gs — id/date/string/validation helpers, typed errors.
 */

// ---------- IDs ----------

function newId(prefix) {
  const raw = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  return (prefix ? prefix + '_' : '') + raw;
}

function sha256Short(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || ''), Utilities.Charset.UTF_8);
  return bytes.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('').slice(0, 12);
}

// ---------- Time ----------

function nowIso() { return new Date().toISOString(); }
function currentUserEmail() {
  const email = Session.getActiveUser().getEmail();
  return email || Session.getEffectiveUser().getEmail() || 'unknown';
}

function todayIsoDate(tz) {
  const z = tz || 'Asia/Kathmandu';
  return Utilities.formatDate(new Date(), z, 'yyyy-MM-dd');
}

function formatLocal(date, tz, pattern) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, tz || 'Asia/Kathmandu', pattern || 'yyyy-MM-dd HH:mm');
}

// ---------- Errors ----------

class AppError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code || 'INTERNAL';
    this.details = details || null;
  }
}
class ValidationError extends AppError { constructor(m, d) { super(m, 'VALIDATION', d); } }
class NotFoundError   extends AppError { constructor(m, d) { super(m, 'NOT_FOUND',  d); } }
class ConflictError   extends AppError { constructor(m, d) { super(m, 'CONFLICT',   d); } }
class LlmError        extends AppError { constructor(m, d) { super(m, 'LLM_ERROR',  d); } }

// ---------- Type coercion ----------

function coerceConfigValue(rawValue, type) {
  if (rawValue == null) return null;
  const s = String(rawValue);
  if (type === 'number')  return Number(s);
  if (type === 'boolean') return s === 'true' || s === 'TRUE' || s === '1';
  if (type === 'json')    { try { return JSON.parse(s); } catch (_) { return null; } }
  return s; // string, enum
}

function asBool(v) {
  if (v === true || v === false) return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

// ---------- Validation primitives ----------

function requireString(v, name) {
  if (typeof v !== 'string' || !v.trim()) {
    throw new ValidationError(name + ' is required');
  }
  return v.trim();
}

function isEmail(v) {
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim());
}

function requireEmail(v, name) {
  if (!isEmail(v)) throw new ValidationError(name + ' must be a valid email');
  return String(v).trim();
}

// ---------- Teams deep link ----------

function buildTeamsLink(email, message) {
  const e = encodeURIComponent(email || '');
  // Teams requires double-encoding pre-fill text per their deep-link spec.
  const m = encodeURIComponent(message == null ? '' : String(message));
  return 'https://teams.microsoft.com/l/chat/0/0?users=' + e + '&message=' + m;
}

// ---------- Template rendering ----------

const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function findPlaceholders(text) {
  if (!text) return [];
  const out = {};
  let m;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(text)) !== null) out[m[1]] = true;
  return Object.keys(out);
}

function renderTemplate(body, vars) {
  if (!body) return '';
  return String(body).replace(PLACEHOLDER_RE, function (_, key) {
    const v = vars[key];
    return (v == null) ? '' : String(v);
  });
}

// ---------- Misc ----------

function truncate(s, n) {
  if (s == null) return '';
  const str = String(s);
  return str.length <= n ? str : str.slice(0, n);
}

function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '••••' + s.slice(-4);
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch (_) { return fallback; }
}
