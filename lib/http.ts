/**
 * PHP-style request superglobals and an output buffer, so ported handlers
 * can read $_GET / $_POST / $_REQUEST / php://input and "echo" exactly the
 * way the PHP originals did.
 */
import { toStr } from './php';

export type Params = Record<string, any>;

export interface PhpRequest {
  method: string;
  url: URL;
  headers: Headers;
  GET: Params;
  POST: Params;
  REQUEST: Params;
  FILES: Record<string, File>;
  /** Raw body (php://input). Empty for multipart requests, as in PHP. */
  input: string;
  raw: Request;
}

/** PHP converts "." and " " in top-level variable names to "_". */
function phpKey(name: string): string {
  return name.replace(/[. ]/g, '_');
}

/** Assigns a value using PHP's bracket syntax: a[b][]=v. */
function assign(target: Params, rawName: string, value: any) {
  const firstBracket = rawName.indexOf('[');
  if (firstBracket <= 0 || !rawName.endsWith(']')) {
    target[phpKey(rawName)] = value;
    return;
  }
  const base = phpKey(rawName.slice(0, firstBracket));
  const keys = rawName
    .slice(firstBracket + 1, -1)
    .split('][');
  let node: any = target;
  let key: string = base;
  for (const k of keys) {
    if (node[key] === undefined || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
    key = k === '' ? String(Object.keys(node).length) : k;
  }
  node[key] = value;
}

/** PHP turns objects whose keys are 0..n-1 into lists. */
function normalise(v: any): any {
  if (v === null || typeof v !== 'object' || v instanceof File) return v;
  const keys = Object.keys(v);
  for (const k of keys) v[k] = normalise(v[k]);
  if (keys.length && keys.every((k, i) => k === String(i))) return keys.map((k) => v[k]);
  return v;
}

export function parseQuery(qs: string): Params {
  const out: Params = {};
  for (const [k, v] of new URLSearchParams(qs)) assign(out, k, v);
  return normalise(out);
}

export async function readRequest(req: Request): Promise<PhpRequest> {
  const url = new URL(req.url);
  const GET = parseQuery(url.search);
  let POST: Params = {};
  const FILES: Record<string, File> = {};
  let input = '';
  const method = req.method.toUpperCase();
  const ctype = (req.headers.get('content-type') || '').toLowerCase();

  if (method !== 'GET' && method !== 'HEAD') {
    if (ctype.startsWith('multipart/form-data')) {
      const form = await req.formData();
      const tmp: Params = {};
      for (const [k, v] of form) {
        if (typeof v === 'string') assign(tmp, k, v);
        else FILES[phpKey(k)] = v;
      }
      POST = normalise(tmp);
    } else {
      input = await req.text();
      if (ctype.startsWith('application/x-www-form-urlencoded')) POST = parseQuery(input);
    }
  }

  // request_order = "GP": POST overrides GET.
  const REQUEST = { ...GET, ...POST };
  return { method, url, headers: req.headers, GET, POST, REQUEST, FILES, input, raw: req };
}

/** `@$_REQUEST['x']` – missing keys read as null. */
export function param(bag: Params, key: string): any {
  return bag[key] === undefined ? null : bag[key];
}

/** `isset($bag[$k]) ? $bag[$k] : $default` */
export function paramOr(bag: Params, key: string, dflt: any): any {
  return bag[key] === undefined || bag[key] === null ? dflt : bag[key];
}

/** String form of a request value, as PHP string interpolation would produce. */
export function pstr(bag: Params, key: string): string {
  return toStr(bag[key]);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const HTML = 'text/html; charset=UTF-8';
export const JSON_CT = 'application/json';

/** Accumulates echoed output and headers, like PHP's output buffer. */
export class Output {
  private chunks: (string | Uint8Array)[] = [];
  headers = new Headers({ 'Content-Type': HTML });
  status = 200;

  echo(...parts: (string | number | Uint8Array)[]) {
    for (const p of parts) this.chunks.push(typeof p === 'number' ? String(p) : p);
    return this;
  }

  header(name: string, value: string) {
    this.headers.set(name, value);
    return this;
  }

  redirect(location: string) {
    this.status = 302;
    this.headers.set('Location', location);
    return this;
  }

  send(): Response {
    const body = Buffer.concat(this.chunks.map((c) => (typeof c === 'string' ? Buffer.from(c, 'utf8') : Buffer.from(c))));
    return new Response(body, { status: this.status, headers: this.headers });
  }
}

/** Shortcut for handlers that echo a single string and exit. */
export function respond(body: string, contentType = HTML, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

/**
 * Mirrors what a PHP fatal error produces with display_errors=Off
 * (the production php.ini): an empty HTTP 500.
 */
export function fatal(err?: unknown): Response {
  if (err) console.error('[php-fatal]', err);
  return new Response('', { status: 500, headers: { 'Content-Type': HTML } });
}

/**
 * Scripts that called ini_set('display_errors', 1) answered a fatal error
 * with HTTP 200 and the error text in the body instead of a 500.
 */
export function displayedFatal(err: unknown): Response {
  console.error('[php-fatal]', err);
  const e = err as Error;
  const body = `<br />\n<b>Fatal error</b>:  Uncaught ${e?.name ?? 'Error'}: ${e?.message ?? String(err)}<br />\n`;
  return new Response(body, { status: 200, headers: { 'Content-Type': HTML } });
}
