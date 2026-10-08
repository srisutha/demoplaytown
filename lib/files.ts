/**
 * Filesystem helpers. PHP resolved relative paths against the executing
 * script's directory; here every path is resolved against APP_DIR (or a
 * sub-directory of it for scripts that lived in sub-folders).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { APP_DIR } from './config';
import { jsonDecode, jsonEncode, type JsonFlags } from './php';

/** Resolves a PHP-relative path. `base` is the script's folder relative to app_playtown. */
export function appPath(rel: string, base = ''): string {
  return path.resolve(APP_DIR, base, rel);
}

export function fileExists(abs: string): boolean {
  return fs.existsSync(abs);
}

/** mkdir($dir, 0777, true) */
export async function mkdirp(abs: string) {
  await fsp.mkdir(abs, { recursive: true });
}

/** file_get_contents(); returns null when the file cannot be read (PHP returns false). */
export async function readText(abs: string): Promise<string | null> {
  try {
    return await fsp.readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

/** json_decode(file_get_contents($f), true) */
export async function readJson<T = any>(abs: string): Promise<T | null> {
  const s = await readText(abs);
  return s === null ? null : jsonDecode<T>(s);
}

/** file_put_contents(); returns bytes written, or false (PHP semantics) on failure. */
export async function writeFile(abs: string, data: string | Buffer): Promise<number | false> {
  try {
    await fsp.writeFile(abs, data);
    return typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  } catch {
    return false;
  }
}

/** file_put_contents($f, json_encode($v, $flags)) */
export function writeJson(abs: string, value: unknown, flags: JsonFlags = { unescapedSlashes: true }) {
  return writeFile(abs, jsonEncode(value, flags));
}

/** fopen($f, 'a') + fwrite() */
export async function appendFile(abs: string, data: Buffer | string) {
  try {
    await fsp.appendFile(abs, data);
  } catch {
    /* PHP suppressed this with @ */
  }
}

/**
 * The PHP `count()` of a decoded JSON file: json_decode() may return null for
 * a missing/corrupt file, and later code iterates it as an array.
 */
export function asList<T = any>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') return Object.values(v) as T[];
  return [];
}
