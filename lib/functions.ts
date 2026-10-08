/** Port of app_playtown/functions.php (only the functions the app calls). */
import { query, ident } from './db';
import { appPath, appendFile } from './files';
import { dst_path } from './config';
import { looseEq, strtolower, rand, uniqid, toStr, jsonDecode } from './php';

type Row = Record<string, any>;

export function calculateLuckyNumber(dob: unknown): number {
  const digits = toStr(dob).replace(/[^0-9]/g, '');
  const sum = digits.split('').reduce((a, c) => a + Number(c), 0);
  return (sum % 10) + 1;
}

export function generateOTP(length = 6): string {
  let otp = '';
  for (let i = 0; i < length; i++) otp += String(rand(0, 9));
  return otp;
}

/** SELECT * FROM tblgame_setup [WHERE game_id=?] */
export async function eventlist(gameId: unknown = ''): Promise<Row[]> {
  const id = toStr(gameId);
  const { rows } = id !== ''
    ? await query('SELECT * FROM tblgame_setup WHERE game_id=?', [id])
    : await query('SELECT * FROM tblgame_setup');
  return rows;
}

export async function gamelist(gameId: unknown = ''): Promise<Row[]> {
  const id = toStr(gameId);
  const { rows } = id !== ''
    ? await query("SELECT * FROM tblgamelist WHERE id=? AND status='1'", [id])
    : await query("SELECT * FROM tblgamelist WHERE status='1'");
  return rows;
}

async function listById(table: string, column: string, id: unknown): Promise<Row[]> {
  const v = toStr(id);
  const { rows } = v !== ''
    ? await query(`SELECT * FROM ${ident(table)} WHERE ${ident(column)}=?`, [v])
    : await query(`SELECT * FROM ${ident(table)}`);
  return rows;
}

export const paymentlist = (id: unknown = '') => listById('tblpayment', 'id', id);
export const planlist = (id: unknown = '') => listById('tblplans', 'id', id);
export const payment_history_list = (id: unknown = '') => listById('tblpayment_history', 'id', id);
export const user_list = (id: unknown = '') => listById('tblusers', 'id', id);
export const user_device_list = (id: unknown = '') => listById('tbluser_devices', 'user_id', id);

/** Replaces the first `length` digits with "x". */
export function display_hidden_values(value: unknown = '', length = 5): string {
  let counter = 0;
  return toStr(value).replace(/\d/g, (d) => (++counter <= length ? 'x' : d));
}

/** Masks the first `length` characters of the e-mail's local part. */
export function display_hidden_email(value: unknown = '', length = 5): string | null {
  const v = toStr(value);
  const at = v.indexOf('@');
  if (at === -1) return null;
  const username = v.slice(0, at);
  const n = Math.min(length, username.length);
  return 'x'.repeat(n) + username.slice(n) + v.slice(at);
}

/** uniqid(rand(), true) . '.' . $extension */
export function generateRandomImageName(extension = 'jpeg'): string {
  return uniqid(String(rand()), true) + '.' + extension;
}

/**
 * functions.php in_multidimensional_array(): case-insensitive match for
 * string/string pairs, strict (===) otherwise.
 */
export function in_multidimensional_array(needle: unknown, haystack: unknown): boolean {
  if (!haystack || typeof haystack !== 'object') return false;
  for (const item of Object.values(haystack as object)) {
    if (item !== null && typeof item === 'object') {
      if (in_multidimensional_array(needle, item)) return true;
    } else if (typeof item === 'string' && typeof needle === 'string') {
      if (strtolower(item) === strtolower(needle)) return true;
    } else if (item === needle) {
      return true;
    }
  }
  return false;
}

/**
 * The variant defined inside upload.php / uploadchain.php / dynamodb_upload.php:
 * strtolower() both sides and compare loosely.
 */
export function in_multidimensional_array_loose(needle: unknown, haystack: unknown): boolean {
  const n = strtolower(needle);
  const walk = (h: unknown): boolean => {
    if (!h || typeof h !== 'object') return false;
    for (const item of Object.values(h as object)) {
      if (item !== null && typeof item === 'object') {
        if (walk(item)) return true;
      } else if (looseEq(strtolower(item), n)) {
        return true;
      }
    }
    return false;
  };
  return walk(haystack);
}

/** Returns the index of the first element whose id == $id, or null. */
export function getIndexById(array: unknown, id: unknown): number | null {
  if (!Array.isArray(array)) return null;
  for (let i = 0; i < array.length; i++) {
    const el = array[i];
    if (el && typeof el === 'object' && el.id !== undefined && el.id !== null && looseEq(el.id, id)) return i;
  }
  return null;
}

/** Elements where isset($item[$var]) && $item[$var] == $value (re-indexed). */
export function get_filter_array_by_keys<T extends Row>(array: unknown, key: string, value: unknown): T[] {
  if (!Array.isArray(array)) return [];
  return array.filter((item) => item && item[key] !== undefined && item[key] !== null && looseEq(item[key], value));
}

export function get_filter_index_ids(array: unknown, key: string): any[] {
  if (!Array.isArray(array)) return [];
  return array.filter((item) => item && item[key] !== undefined && item[key] !== null).map((item) => item[key]);
}

/**
 * functions.php generate_ai_carricature(): POSTs to a VanceAI endpoint.
 *  - data with a `file` Buffer -> multipart (CURLFile)
 *  - httpBuild === '1'         -> application/x-www-form-urlencoded
 *  - downloadable              -> appends the body to dst_path/image_name and stores the path
 * Returns json_decode() of the response (null when it is not JSON).
 */
export async function generate_ai_carricature(
  url: string,
  data: Record<string, any> = {},
  _timeOut: unknown = '',
  httpBuild: unknown = '',
  downloadable: unknown = '',
  imageName = '',
  commonId: unknown = '',
  tableName = '',
): Promise<any> {
  let body: BodyInit | undefined;
  const keys = Object.keys(data);
  if (keys.length > 0) {
    if (toStr(httpBuild) === '1') {
      body = new URLSearchParams(Object.entries(data).map(([k, v]) => [k, toStr(v)]));
    } else {
      const form = new FormData();
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && 'buffer' in v && 'filename' in v) {
          form.append(k, new Blob([new Uint8Array(v.buffer as Buffer)]), v.filename as string);
        } else {
          form.append(k, toStr(v));
        }
      }
      body = form;
    }
  }

  let response = '';
  let responseBuf: Buffer = Buffer.alloc(0);
  try {
    const res = await fetch(url, { method: 'POST', body });
    responseBuf = Buffer.from(await res.arrayBuffer());
    response = responseBuf.toString('utf8');
  } catch {
    response = '';
  }

  if (looseEq(downloadable, '1')) {
    const newTransformedImage = dst_path + '/' + imageName;
    await appendFile(appPath(newTransformedImage), responseBuf);
    if (tableName !== '') {
      await query(`UPDATE ${ident(tableName)} SET transformed_image=? WHERE id = ?`, [newTransformedImage, toStr(commonId)]);
    }
    response = newTransformedImage;
  }
  return jsonDecode(response);
}
