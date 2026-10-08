/**
 * Small re-implementations of the PHP built-ins the legacy code relies on.
 * The goal is behavioural parity with PHP 8.1 (the production runtime), so
 * that ported handlers make exactly the same decisions as the PHP originals.
 */

export type PhpValue = unknown;

// ---------------------------------------------------------------------------
// Type juggling
// ---------------------------------------------------------------------------

const NUMERIC_RE = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/;

/** PHP is_numeric() for strings / numbers. */
export function isNumeric(v: PhpValue): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return NUMERIC_RE.test(v);
  return false;
}

/** PHP (bool) cast. */
export function toBool(v: PhpValue): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v !== '0';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/** PHP empty(). */
export function empty(v: PhpValue): boolean {
  return !toBool(v);
}

/** PHP (string) cast. */
export function toStr(v: PhpValue): string {
  if (v === null || v === undefined || v === false) return '';
  if (v === true) return '1';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }
  if (Array.isArray(v) || typeof v === 'object') return 'Array';
  return String(v);
}

/** PHP intval(). */
export function intval(v: PhpValue): number {
  if (v === null || v === undefined || v === false) return 0;
  if (v === true) return 1;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === 'string') {
    const m = /^[ \t\n\r\v\f]*([+-]?\d+(\.\d*)?([eE][+-]?\d+)?)/.exec(v);
    if (!m) return 0;
    return Math.trunc(Number(m[1])) || 0;
  }
  if (Array.isArray(v)) return v.length ? 1 : 0;
  return 1;
}

function toNumber(v: PhpValue): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') {
    const m = /^[ \t\n\r\v\f]*([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?)/.exec(v);
    return m ? Number(m[1]) : 0;
  }
  return 1;
}

/** PHP 8 loose comparison (==). */
export function looseEq(a: PhpValue, b: PhpValue): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (a === null && b === null) return true;
  if (typeof a === 'boolean' || typeof b === 'boolean' || a === null || b === null) {
    if (a === null && typeof b === 'string') return b === '';
    if (b === null && typeof a === 'string') return a === '';
    return toBool(a) === toBool(b);
  }
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'number' && typeof b === 'string') {
    return isNumeric(b) ? a === toNumber(b) : toStr(a) === b;
  }
  if (typeof a === 'string' && typeof b === 'number') return looseEq(b, a);
  if (typeof a === 'string' && typeof b === 'string') {
    if (isNumeric(a) && isNumeric(b)) return toNumber(a) === toNumber(b);
    return a === b;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => k in (b as object) && looseEq((a as any)[k], (b as any)[k]));
  }
  return false;
}

/** PHP 8 spaceship (<=>) for scalars. */
export function compare(a: PhpValue, b: PhpValue): number {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  const cmp = (x: number, y: number) => (x < y ? -1 : x > y ? 1 : 0);
  if (typeof a === 'boolean' || typeof b === 'boolean' || a === null || b === null) {
    if (a === null && typeof b === 'string') return a === b ? 0 : cmpStr('', b);
    if (b === null && typeof a === 'string') return cmpStr(a, '');
    return cmp(toBool(a) ? 1 : 0, toBool(b) ? 1 : 0);
  }
  if (typeof a === 'number' && typeof b === 'number') return cmp(a, b);
  if (typeof a === 'number' && typeof b === 'string') {
    return isNumeric(b) ? cmp(a, toNumber(b)) : cmpStr(toStr(a), b);
  }
  if (typeof a === 'string' && typeof b === 'number') return -compare(b, a);
  if (typeof a === 'string' && typeof b === 'string') {
    if (isNumeric(a) && isNumeric(b)) return cmp(toNumber(a), toNumber(b));
    return cmpStr(a, b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return cmp(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      const c = compare(a[i], b[i]);
      if (c !== 0) return c;
    }
    return 0;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return cmp(ka.length, kb.length);
    for (const k of ka) {
      if (!(k in (b as object))) return 1;
      const c = compare((a as any)[k], (b as any)[k]);
      if (c !== 0) return c;
    }
    return 0;
  }
  return 0;
}

function cmpStr(a: string, b: string): number {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  const c = Buffer.compare(ba, bb);
  return c < 0 ? -1 : c > 0 ? 1 : 0;
}

/** PHP max() over a list. */
export function max<T>(values: T[]): T {
  let best = values[0];
  for (let i = 1; i < values.length; i++) if (compare(values[i], best) > 0) best = values[i];
  return best;
}

/** PHP sort() (default flags) – sorts a copy. */
export function sort<T>(values: T[]): T[] {
  return [...values].sort((x, y) => compare(x, y));
}

/** PHP strtolower() (ASCII only, as in PHP >= 8). */
export function strtolower(v: PhpValue): string {
  return toStr(v).replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** PHP ucwords(). */
export function ucwords(s: string): string {
  return s.replace(/(^|[ \t\r\n\f\v])([a-z])/g, (_m, sp, c) => sp + c.toUpperCase());
}

/** PHP trim() with an optional character list. */
export function trim(s: string, chars = ' \t\n\r\0\x0B'): string {
  const set = new Set(chars.split(''));
  let start = 0;
  let end = s.length;
  while (start < end && set.has(s[start])) start++;
  while (end > start && set.has(s[end - 1])) end--;
  return s.slice(start, end);
}

/** PHP str_pad(..., STR_PAD_LEFT). */
export function strPadLeft(v: PhpValue, length: number, pad: string): string {
  const s = toStr(v);
  if (s.length >= length) return s;
  return pad.repeat(length - s.length).slice(0, length - s.length) + s;
}

// ---------------------------------------------------------------------------
// Randomness / ids
// ---------------------------------------------------------------------------

/** PHP rand($min, $max) / mt_rand($min, $max), inclusive. */
export function rand(min = 0, maxInclusive = 2147483647): number {
  return min + Math.floor(Math.random() * (maxInclusive - min + 1));
}

/** PHP array_rand() for a single key. */
export function arrayRand<T>(arr: T[]): number {
  return rand(0, arr.length - 1);
}

/** PHP shuffle() – in place. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let lastUniq = 0n;
/** PHP uniqid(). */
export function uniqid(prefix = '', moreEntropy = false): string {
  // PHP guarantees uniqueness by spinning until the microsecond changes.
  let us = BigInt(Date.now()) * 1000n + BigInt(Math.floor((performance.now() % 1) * 1000));
  if (us <= lastUniq) us = lastUniq + 1n;
  lastUniq = us;
  const sec = us / 1000000n;
  const usec = us % 1000000n;
  let out = prefix + sec.toString(16).padStart(8, '0') + usec.toString(16).padStart(5, '0');
  if (moreEntropy) out += (Math.random() * 10).toFixed(8);
  return out;
}

/** PHP time(). */
export function time(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Dates – the PHP app runs with date_default_timezone_set('Asia/Kolkata').
// India has no DST, so a fixed +05:30 offset is exact.
// ---------------------------------------------------------------------------

const IST_OFFSET_SEC = 5.5 * 3600;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const p2 = (n: number) => String(n).padStart(2, '0');

/** PHP date($format, $timestamp) in Asia/Kolkata. Supports the format chars used by the app. */
export function date(format: string, ts: number = time()): string {
  const d = new Date((ts + IST_OFFSET_SEC) * 1000);
  const map: Record<string, () => string> = {
    Y: () => String(d.getUTCFullYear()),
    y: () => p2(d.getUTCFullYear() % 100),
    m: () => p2(d.getUTCMonth() + 1),
    n: () => String(d.getUTCMonth() + 1),
    d: () => p2(d.getUTCDate()),
    j: () => String(d.getUTCDate()),
    H: () => p2(d.getUTCHours()),
    G: () => String(d.getUTCHours()),
    i: () => p2(d.getUTCMinutes()),
    s: () => p2(d.getUTCSeconds()),
    M: () => MONTHS[d.getUTCMonth()],
    D: () => DAYS[d.getUTCDay()],
  };
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const c = format[i];
    if (c === '\\' && i + 1 < format.length) {
      out += format[++i];
    } else {
      out += map[c] ? map[c]() : c;
    }
  }
  return out;
}

function istToTs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s) / 1000 - IST_OFFSET_SEC;
}

/**
 * PHP strtotime() for the formats that appear in this app's data
 * (MySQL datetimes, HTML date inputs, d-m-Y, m/d/Y, ISO-8601).
 * Returns false when the string cannot be parsed, like PHP.
 */
export function strtotime(input: PhpValue): number | false {
  const s = toStr(input).trim();
  if (s === '') return false;
  let m: RegExpExecArray | null;
  // Y-m-d[ H:i[:s]] / Y-m-dTH:i:s[.fff][Z|±hh:mm]
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s))) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0', tz] = m;
    if (tz) {
      const iso = `${y}-${p2(+mo)}-${p2(+d)}T${p2(+h)}:${mi}:${p2(+sec)}${tz.toUpperCase() === 'Z' ? 'Z' : tz.length === 5 ? tz.slice(0, 3) + ':' + tz.slice(3) : tz}`;
      const t = Date.parse(iso);
      return Number.isNaN(t) ? false : Math.floor(t / 1000);
    }
    return istToTs(+y, +mo, +d, +h, +mi, +sec);
  }
  // d-m-Y or d.m.Y
  if ((m = /^(\d{1,2})[-.](\d{1,2})[-.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
    const [, d, mo, y, h = '0', mi = '0', sec = '0'] = m;
    return istToTs(+y, +mo, +d, +h, +mi, +sec);
  }
  // m/d/Y (American, as PHP interprets slashes)
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
    const [, mo, d, y, h = '0', mi = '0', sec = '0'] = m;
    return istToTs(+y, +mo, +d, +h, +mi, +sec);
  }
  // Y/m/d
  if ((m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s))) {
    return istToTs(+m[1], +m[2], +m[3]);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? false : Math.floor(t / 1000);
}

/** date($fmt, strtotime($s)) – PHP's strtotime() false becomes 0 (1970-01-01). */
export function dateOf(format: string, s: PhpValue): string {
  const ts = strtotime(s);
  return date(format, ts === false ? 0 : ts);
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export interface JsonFlags {
  unescapedSlashes?: boolean;
  unescapedUnicode?: boolean;
  prettyPrint?: boolean;
}

/**
 * PHP json_encode(). By default PHP escapes "/" as "\/" and every non-ASCII
 * character as \uXXXX; JSON_PRETTY_PRINT indents with four spaces.
 */
export function jsonEncode(value: PhpValue, flags: JsonFlags = {}): string {
  let out = JSON.stringify(value === undefined ? null : value, phpJsonReplacer, flags.prettyPrint ? 4 : undefined);
  if (out === undefined) out = 'null';
  if (!flags.unescapedSlashes) out = out.replace(/\//g, '\\/');
  if (!flags.unescapedUnicode) {
    out = out.replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  }
  return out;
}

function phpJsonReplacer(_key: string, v: unknown) {
  if (v === undefined) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return 0;
  if (typeof v === 'bigint') return Number(v);
  return v;
}

/** PHP json_decode($s, true). Returns null on invalid input, like PHP. */
export function jsonDecode<T = any>(s: PhpValue): T | null {
  if (typeof s !== 'string') return null;
  try {
    // PHP tolerates a UTF-8 BOM only after trim; plain JSON.parse is equivalent here.
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** PHP base64_decode() (non-strict: ignores characters outside the alphabet). */
export function base64Decode(s: PhpValue): Buffer {
  return Buffer.from(toStr(s).replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
}

/** PHP urlencode(). */
export function urlencode(s: PhpValue): string {
  return encodeURIComponent(toStr(s))
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

/** PHP htmlspecialchars() with the PHP 8.1 defaults (ENT_QUOTES | ENT_SUBSTITUTE). */
export function htmlspecialchars(v: PhpValue): string {
  return toStr(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** PHP array_merge() for two associative arrays. */
export function arrayMerge<T extends Record<string, any>>(a: T, b: Record<string, any>): T {
  if (a === null || a === undefined || typeof a !== 'object') {
    // PHP 8: array_merge(): Argument #1 ($array) must be of type array, null given
    throw new TypeError('array_merge(): Argument #1 ($array) must be of type array, null given');
  }
  return { ...a, ...b };
}
