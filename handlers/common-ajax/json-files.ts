/**
 * Actions of common-ajax.php that keep their state in assets/json/<game>.json.
 * Quirks of the PHP source are kept on purpose (and commented), because the
 * frontends were written against this exact behaviour.
 */
import path from 'node:path';
import { query } from '@/lib/db';
import { APP_DIR } from '@/lib/config';
import { appPath, fileExists, mkdirp, readJson, writeFile, writeJson } from '@/lib/files';
import {
  getIndexById, get_filter_array_by_keys, get_filter_index_ids, in_multidimensional_array, calculateLuckyNumber,
} from '@/lib/functions';
import { shortLinkMessage, fireAndForgetGet, selfieSmsLink } from '@/lib/external';
import { arrayMerge, base64Decode, date, dateOf, intval, jsonDecode, looseEq, max, strtotime, time, toBool, toStr, uniqid } from '@/lib/php';
import { type Ctx, json, req } from './context';
import { luckyArray } from './sql';

const JSON_DIR = 'assets/json/';

/** `$event_id && $event_id!='' && $event_id!==null && $event_id!=='null' && $event_id!=='undefined'` */
export function validEvent(e: unknown): boolean {
  return toBool(e) && !looseEq(e, '') && e !== null && e !== 'null' && e !== 'undefined';
}

/** `$jsonDir.'/'.$game_type.'.json'`, kept inside app_playtown. */
export function gameFile(gameType: unknown): string {
  const p = appPath(JSON_DIR + '/' + toStr(gameType) + '.json');
  if (!p.startsWith(APP_DIR + path.sep)) throw new Error('Invalid game_type');
  return p;
}

function teamFile(gameType: unknown): string {
  const p = appPath(JSON_DIR + toStr(gameType) + '_team.json');
  if (!p.startsWith(APP_DIR + path.sep)) throw new Error('Invalid game_type');
  return p;
}

async function ensureJsonDir() {
  const dir = appPath(JSON_DIR);
  if (!fileExists(dir)) await mkdirp(dir);
}

const DEFAULT_TEAMS = () => [
  { team_name: 'TeamA', last_inserted_team: 0 },
  { team_name: 'TeamB', last_inserted_team: 0 },
  { team_name: 'TeamC', last_inserted_team: 0 },
];

/** The repeated "load or create <game>_team.json" block. */
async function loadTeams(gameType: unknown): Promise<any[]> {
  const f = teamFile(gameType);
  if (fileExists(f)) return (await readJson(f)) ?? [];
  const teams = DEFAULT_TEAMS();
  await writeJson(f, teams);
  return teams;
}

/** `$existingData = []; if (file_exists($f)) $existingData = json_decode(file_get_contents($f), true);` */
async function loadGame(file: string): Promise<any> {
  if (fileExists(file)) return await readJson(file);
  return [];
}

const list = (v: any): any[] => (Array.isArray(v) ? v : []);

/** `$a[$k]` where $k may be null (PHP reads $a[""]). */
function at(arr: any, idx: number | null): any {
  if (idx === null || arr === null || typeof arr !== 'object') return null;
  return arr[idx] ?? null;
}

function idle(updatedAt: unknown): number {
  const now = strtotime(date('Y-m-d H:i:s'));
  const t = strtotime(updatedAt);
  return (now === false ? 0 : now) - (t === false ? 0 : t);
}

/** max_id selection shared by common_update_json / common_status_update_json. */
function pickMaxId(commonId: unknown, data: any[]): any {
  if (!looseEq(commonId, '') && in_multidimensional_array(commonId, data)) return commonId;
  const ids = data.filter((it) => it && looseEq(it.status, 1) && looseEq(it.updated_success, 0)).map((it) => it.id);
  return ids.length ? max(ids) : null;
}

export async function common_update_json(ctx: Ctx) {
  const eventId = req(ctx, 'event_id');
  const commonId = req(ctx, 'common_id');
  const gameType = req(ctx, 'game_type');
  const teamId = req(ctx, 'team_id');
  const userDescription = req(ctx, 'user_description');
  const userTitle = req(ctx, 'user_title');

  await ensureJsonDir();
  if (!looseEq(teamId, '')) await loadTeams(gameType);
  const file = gameFile(gameType);
  let data = await loadGame(file);
  if (validEvent(eventId)) data = get_filter_array_by_keys(data, 'event_id', eventId);
  data = list(data);

  const maxId = pickMaxId(commonId, data);
  if (!looseEq(maxId, '') && in_multidimensional_array(maxId, data)) {
    const idx = getIndexById(data, maxId);
    data[idx as number] = arrayMerge(at(data, idx), { updated_success: 1, user_title: userTitle, user_description: userDescription });
    await writeJson(file, data);
    return json(ctx, { status: 'success', message: 'Updated Successfully' });
  }
  return json(ctx, { status: 'error', message: 'update Error.' });
}

export async function common_status_update_json(ctx: Ctx) {
  const status = req(ctx, 'status');
  const eventId = req(ctx, 'event_id');
  const commonId = req(ctx, 'common_id');
  const gameType = req(ctx, 'game_type');
  const teamId = req(ctx, 'team_id');

  await ensureJsonDir();
  if (!looseEq(teamId, '')) await loadTeams(gameType);
  const file = gameFile(gameType);
  let data = await loadGame(file);
  if (validEvent(eventId)) data = get_filter_array_by_keys(data, 'event_id', eventId);
  data = list(data);

  const maxId = pickMaxId(commonId, data);
  if (!looseEq(maxId, '') && in_multidimensional_array(maxId, data)) {
    const idx = getIndexById(data, maxId);
    data[idx as number] = arrayMerge(at(data, idx), { updated_success: 1, status: intval(status) });
    await writeJson(file, data);
    return json(ctx, { status: 'success', message: 'Updated Successfully' });
  }
  return json(ctx, { status: 'error', message: 'update Error.' });
}

/** common_send_sms_json and common_send_email_json share identical code (both send the SMS). */
export async function common_send_sms_json(ctx: Ctx) {
  const smsId = req(ctx, 'sms_id');
  const type = req(ctx, 'type');
  const eventId = req(ctx, 'event_id');
  const gameType = req(ctx, 'game_type');

  await ensureJsonDir();
  const file = gameFile(gameType);
  let data = await loadGame(file);
  if (validEvent(eventId)) data = get_filter_array_by_keys(data, 'event_id', eventId);

  if (in_multidimensional_array(smsId, data)) {
    data = list(data);
    const idx = getIndexById(data, smsId);
    const entry = at(data, idx);
    let smsLink: string | null = null;
    if (entry?.sms_send === undefined || entry?.sms_send === null || looseEq(entry.sms_send, 0)) {
      const framedImage = '../' + toStr(entry?.framed_image);
      const link = toStr(type) !== ''
        ? `https://playtown.co.in/app_playtown/${framedImage}`
        : `https://playtown.co.in/x/?id='${toStr(entry?.id)}'`;
      const shortLink = await shortLinkMessage(link);
      const message = 'Shout out from playtown.co.in for nailing the selfie Podu Six Podu, follow us on Insta @playtowngames MEDPST. Download selfie: https://mpurl.in/' + shortLink;
      smsLink = selfieSmsLink(toStr(entry?.user_phone), message);
      await fireAndForgetGet(smsLink);
    }
    data[idx as number] = arrayMerge(entry, { sms_send: 1 });
    await writeJson(file, data);
    return json(ctx, { status: 'success', message: 'Updated Successfully', success_url: smsLink });
  }
  return json(ctx, { status: 'error', message: 'update Error.', success_url: '' });
}

export const common_send_email_json = common_send_sms_json;

export async function common_check_unique_id_json(ctx: Ctx) {
  const gameType = req(ctx, 'game_type');
  const eventId = req(ctx, 'event_id');
  let uniqueId = req(ctx, 'unique_id');
  const teamId = req(ctx, 'team_id');
  const start = req(ctx, 'start');

  await ensureJsonDir();
  if (!looseEq(teamId, '')) await loadTeams(gameType);
  const file = gameFile(gameType);
  let data = await loadGame(file);
  // Note: this action only checks `$event_id!='' && $event_id!==null`.
  if (!looseEq(eventId, '') && eventId !== null) data = get_filter_array_by_keys(data, 'event_id', eventId);

  let filtered = data;
  if (!looseEq(teamId, '')) filtered = get_filter_array_by_keys(filtered, 'team_id', teamId);
  if (looseEq(start, '')) filtered = get_filter_array_by_keys(filtered, 'updated_success', 0);
  filtered = get_filter_array_by_keys(filtered, 'status', 0);
  const ids = get_filter_index_ids(filtered, 'id');
  const maxId = ids.length ? max(ids) : null;

  if (!looseEq(maxId, '') && in_multidimensional_array(maxId, data)) {
    const entry = at(data, getIndexById(data, maxId));
    uniqueId = entry?.unique_id ?? null;
    return json(ctx, { selfie_image: 'present', error: 0, sql: null, unique_id: uniqueId, selfie_started: 1, idle_time: idle(entry?.updated_at) });
  }
  return json(ctx, { selfie_image: 'not present', error: 1, sql: null, unique_id: uniqueId, selfie_started: 0, idle_time: '' });
}

export async function image_download_common_json(ctx: Ctx) {
  const gameType = req(ctx, 'game_type');
  const eventId = req(ctx, 'event_id');
  const selfieId = req(ctx, 'selfie_id');
  const teamId = req(ctx, 'team_id');

  await ensureJsonDir();
  if (!looseEq(teamId, '')) await loadTeams(gameType);
  const file = gameFile(gameType);
  let data = await loadGame(file);
  if (!looseEq(eventId, '') && eventId !== null) data = get_filter_array_by_keys(data, 'event_id', eventId);

  let filtered = data;
  if (!looseEq(teamId, '')) filtered = get_filter_array_by_keys(filtered, 'team_id', teamId);
  if (!looseEq(selfieId, '')) filtered = get_filter_array_by_keys(filtered, 'unique_image_code', selfieId);
  const ids = get_filter_index_ids(filtered, 'id');
  const maxId = ids.length ? max(ids) : null;

  if (!looseEq(maxId, '') && in_multidimensional_array(maxId, data)) {
    const entry = at(data, getIndexById(data, maxId));
    const imagePath = entry?.user_image !== undefined && entry?.user_image !== null ? toStr(entry.user_image) : '';
    const downloadLink = imagePath && fileExists(appPath(imagePath)) ? imagePath : '';
    return json(ctx, {
      status: 'success', selfie_image: 'present', error: 0, unique_id: entry?.unique_id ?? null,
      selfie_started: 1, idle_time: idle(entry?.updated_at), download_link: downloadLink,
    });
  }
  return json(ctx, { status: 'error', selfie_image: 'not present', error: 1, unique_id: '', selfie_started: 0, idle_time: '', download_link: '' });
}

export async function common_time_out_json(ctx: Ctx) {
  const gameType = req(ctx, 'game_type');
  const eventId = req(ctx, 'event_id');
  const uniqueId = req(ctx, 'unique_id');
  const teamId = req(ctx, 'team_id');

  await ensureJsonDir();
  if (!looseEq(teamId, '')) await loadTeams(gameType);
  const file = gameFile(gameType);
  let data = await loadGame(file);
  if (validEvent(eventId)) data = get_filter_array_by_keys(data, 'event_id', eventId);
  data = list(data);

  let filtered = data;
  if (!looseEq(teamId, '')) filtered = get_filter_array_by_keys(filtered, 'team_id', teamId);
  else filtered = get_filter_array_by_keys(filtered, 'status', 0);
  if (!looseEq(uniqueId, '')) {
    filtered = get_filter_array_by_keys(filtered, 'unique_id', uniqueId);
    filtered = get_filter_array_by_keys(filtered, 'id', uniqueId);
  }
  const ids = get_filter_index_ids(filtered, 'id');
  if (ids.length > 0) {
    for (const fid of ids) {
      const idx = getIndexById(data, fid);
      data[idx as number] = arrayMerge(at(data, idx), { status: 2 });
    }
    await writeJson(file, data);
    return json(ctx, { status: 'success', message: 'Updated Successfully', success_url: '' });
  }
  return json(ctx, { status: 'error', message: 'Failed.', success_url: '' });
}

export async function reset_common_team_setting_json(ctx: Ctx) {
  const teamId = req(ctx, 'team_id');
  const gameType = req(ctx, 'game_type');
  const eventId = req(ctx, 'event_id');
  const tblTeamJson = ctx.R.team_json;

  await ensureJsonDir();
  let newData: any = null;
  if (!looseEq(teamId, '')) {
    const tf = teamFile(gameType);
    if (fileExists(tf)) {
      const teams = list(await readJson(tf));
      const ti = getIndexById(teams, teamId);
      newData = arrayMerge(at(teams, ti), { status: 1, created_at: date('Y-m-d H:i:s') });
      teams[ti as number] = newData;
      await writeJson(tf, teams);
    } else {
      await writeJson(tf, [
        { team_id: 1, team_name: 'TeamA', last_inserted_team: 0 },
        { team_id: 2, team_name: 'TeamB', last_inserted_team: 0 },
        { team_id: 3, team_name: 'TeamC', last_inserted_team: 0 },
      ]);
    }
  }
  const file = gameFile(gameType);
  let all: any = fileExists(file) ? await readJson(file) : [];
  if (validEvent(eventId)) all = get_filter_array_by_keys(all, 'event_id', eventId);

  let filtered = all;
  if (!looseEq(teamId, '')) filtered = get_filter_array_by_keys(filtered, 'team_id', teamId);
  const ids = get_filter_index_ids(filtered, 'id');

  if (ids.length > 0) {
    // Mirrors the PHP loop literally: it overwrites the list with one element
    // and then writes the merged team row back into it.
    for (const fid of ids) {
      const idx = Array.isArray(all) ? getIndexById(all, fid) : null;
      all = at(all, idx);
      newData = arrayMerge(newData, { status: 2 });
      if (all === null || typeof all !== 'object') all = {};
      all[idx === null ? '' : idx] = newData;
    }
    const dir = appPath(toStr(tblTeamJson) + '/json/');
    const out = path.join(dir, '.json'); // $tbl_name is undefined in the PHP source
    let history: any[];
    if (fileExists(out)) history = list(await readJson(out));
    else {
      history = [];
      await mkdirp(dir).catch(() => undefined);
    }
    history.push({ team_id: teamId, team_name: null, friendship_lists: all, team_date: null });
    await writeJson(out, history, { prettyPrint: true });
    await writeJson(file, []);
    return json(ctx, { status: 'success', message: 'updated' });
  }
  return json(ctx, { status: 'error', message: 'Error.' });
}

export async function update_common_team_setting_json(ctx: Ctx) {
  const teamId = req(ctx, 'team_id');
  const gameType = req(ctx, 'game_type');
  const eventId = req(ctx, 'event_id');

  await ensureJsonDir();
  if (!looseEq(teamId, '')) {
    const tf = teamFile(gameType);
    if (fileExists(tf)) {
      let teams: any = await readJson(tf);
      if (validEvent(eventId)) teams = get_filter_array_by_keys(teams, 'event_id', eventId);
      teams = list(teams);
      const ti = getIndexById(teams, teamId);
      teams[ti as number] = arrayMerge(at(teams, ti), { status: 2, updated_at: date('Y-m-d H:i:s') });
      await writeJson(tf, teams);
      return json(ctx, { status: 'success', message: null }); // $response is undefined here in PHP
    }
  }
  return json(ctx, { status: 'error', message: 'Error.' });
}

export async function updatelatest_common_json(ctx: Ctx) {
  const gameType = req(ctx, 'game_type');
  const eventId = req(ctx, 'event_id');
  const id = req(ctx, 'id');

  await ensureJsonDir();
  const file = gameFile(gameType);
  let data = await loadGame(file);
  if (validEvent(eventId)) data = get_filter_array_by_keys(data, 'event_id', eventId);
  data = list(data);

  let filtered = data;
  if (!looseEq(id, '')) filtered = get_filter_array_by_keys(filtered, 'id', id);
  const ids = get_filter_index_ids(filtered, 'id');
  if (ids.length > 0) {
    for (const fid of ids) {
      const idx = getIndexById(data, fid);
      data[idx as number] = arrayMerge(at(data, idx), { entry_type: 'old' });
    }
    await writeJson(file, data);
    return json(ctx, { error: 0, msg: 'Saved Successfully', data: ids });
  }
  return json(ctx, { error: '1', msg: 'Failed.' });
}

export async function checkselfie_common_json(ctx: Ctx) {
  const selfieId = req(ctx, 'selfie_id');
  const teamId = req(ctx, 'team_id');
  const eventId = req(ctx, 'event_id');
  const gameType = req(ctx, 'game_type');

  await ensureJsonDir();
  let data = await loadGame(gameFile(gameType));
  if (validEvent(eventId)) data = get_filter_array_by_keys(data, 'event_id', eventId);

  let filtered = data;
  if (!looseEq(selfieId, '')) filtered = get_filter_array_by_keys(filtered, 'id', selfieId);
  if (toBool(teamId) && teamId !== '' && teamId !== 'null') filtered = get_filter_array_by_keys(filtered, 'team_id', teamId);
  filtered = get_filter_array_by_keys(filtered, 'status', 1);
  filtered = get_filter_array_by_keys(filtered, 'updated_success', 1);

  if (filtered.length > 0) {
    const downloadLink = `download.html?game_type=${toStr(gameType)}&id=${toStr(selfieId)}`;
    const smsLink = `https://playtown.co.in/x/?id=${toStr(selfieId)}&route=6&peid=1701170470384351589&DLTTemplateId=1707171406364580301`;
    return json(ctx, { status: 'success', message: 'updated.', success_url: smsLink, download_link: downloadLink });
  }
  return json(ctx, { status: 'error', message: 'update Error.', success_url: '', download_link: '', dataas: filtered });
}

export async function generate_ai_carricature_pencil_json(ctx: Ctx) {
  const commonId = req(ctx, 'common_id');
  const eventId = req(ctx, 'event_id');
  const gameType = req(ctx, 'game_type');
  const image = req(ctx, 'common_transformed_image');

  await ensureJsonDir();
  const file = gameFile(gameType);
  let data = await loadGame(file);
  if (validEvent(eventId)) data = get_filter_array_by_keys(data, 'event_id', eventId);
  data = list(data);

  let filtered = data;
  if (!looseEq(commonId, '')) filtered = get_filter_array_by_keys(filtered, 'id', commonId);
  if (filtered.length > 0) {
    const idx = getIndexById(data, commonId);
    data[idx as number] = arrayMerge(at(data, idx), { transformed_image: image });
    await writeJson(file, data);
    return json(ctx, { status: 'success', message: 'Transformed Sucessful', image });
  }
  return json(ctx, { status: 'error', message: 'Error', image: '' });
}

export async function shuffling_json(ctx: Ctx) {
  if (ctx.P.name !== undefined && ctx.P.name !== null && ctx.P.dob !== undefined && ctx.P.dob !== null) {
    await ensureJsonDir();
    const day = dateOf('d', ctx.P.dob);
    // $table_name is undefined in this branch of the PHP source, so the query
    // is "SELECT * FROM  WHERE ..." – a fatal SQL error before the file is written.
    await query(`SELECT * FROM  WHERE prediction_number=${Number(day)} ORDER BY id DESC LIMIT 1`);
    const lucky = calculateLuckyNumber(ctx.P.dob);
    return json(ctx, { status: 'success', message: 'Inserted successfully', prediction: [], username: ctx.P.name, randomarray: luckyArray(lucky), luckynumber: lucky });
  }
  return json(ctx, { status: 'error', message: 'Name and dob parameters are required' });
}

export async function save_single_user_unique_id_json(ctx: Ctx) {
  const gameType = req(ctx, 'game_type');
  const eventId = req(ctx, 'event_id');
  const teamId = req(ctx, 'team_id');

  await ensureJsonDir();
  if (!looseEq(teamId, '')) await loadTeams(gameType);
  const file = gameFile(gameType);
  let data = await loadGame(file);
  if (validEvent(eventId)) data = get_filter_array_by_keys(data, 'event_id', eventId);
  data = list(data);

  // $user_device_id is undefined in the PHP source, so the duplicate check never fires.
  const id = data.length + 1;
  const now = date('Y-m-d H:i:s');
  data.push({ id, entry_type: 'new', team_id: teamId, unique_id: id, status: 0, updated_success: 0, created_at: now, updated_at: now });
  await writeJson(file, data);
  return json(ctx, { status: 'success', message: 'Saved successfully', id, data, file: JSON_DIR + '/' + toStr(gameType) + '.json' });
}

export async function common_reset_json(ctx: Ctx) {
  const gameType = req(ctx, 'game_type');
  const status = req(ctx, 'status');
  const eventId = req(ctx, 'event_id');

  await ensureJsonDir();
  let data = await loadGame(gameFile(gameType));
  if (validEvent(eventId)) data = get_filter_array_by_keys(data, 'event_id', eventId);
  let filtered = data;
  if (!looseEq(status, '')) filtered = get_filter_array_by_keys(filtered, 'status', status);
  if (get_filter_index_ids(filtered, 'id').length > 0) return json(ctx, { error: 0, common_status_type: 'reset' });
  return json(ctx, { error: '1', msg: 'Failed.' });
}

export async function common_reset_disable_json(ctx: Ctx) {
  // $jsonDir and $status are undefined in this branch of the PHP source; the
  // file looked up is "/<game_type>.json" at the filesystem root, which does
  // not exist, so the action always reports failure.
  return json(ctx, { error: '1', msg: 'Failed.', common_status_type: '' });
}

/**
 * upload_framed_image: saves a framed PNG (data URL) and records it.
 * Greenverse rows live in MySQL; every other game in assets/json/<game>.json.
 */
export async function upload_framed_image(ctx: Ctx) {
  const body = jsonDecode<any>(ctx.req.input);
  if (!body || !Array.isArray(body.images)) {
    return json(ctx, { status: 'error', message: 'Invalid data', framed_image_url: '', framed_image_short_link: '' });
  }
  const first = body.images[0] ?? {};
  const teamId = first.team_id !== undefined && first.team_id !== null ? first.team_id : '';
  const id = first.id !== undefined && first.id !== null ? first.id : '';
  const gameType = first.game_type !== undefined && first.game_type !== null ? first.game_type : 'common';

  if (looseEq(gameType, 'greenverse') && !looseEq(id, '')) {
    const uploadDir = 'assets/images/greenverse/framed_images';
    if (!fileExists(appPath(uploadDir))) await mkdirp(appPath(uploadDir));
    let url = '';
    for (const item of body.images) {
      const parts = toStr(item?.converted_image).split(',');
      if (parts.length === 2 && parts[0].startsWith('data:image/png')) {
        const filename = `${uploadDir}/img_${time()}_${uniqid()}.webp`;
        if (await writeFile(appPath(filename), base64Decode(parts[1]))) {
          url = 'https://demo.playtown.co.in/app_playtown/' + filename;
          await query('UPDATE tblgreenverse SET framed_image=?, updated_at=NOW() WHERE id=?', [filename.replace(/\\/g, '/'), String(intval(id))]);
        } else {
          return json(ctx, { status: 'error', message: 'Upload Failed', framed_image_url: '', framed_image_short_link: '' });
        }
      }
    }
    return json(ctx, { status: 'success', message: 'Saved successfully', framed_image_url: url, framed_image_short_link: url });
  }

  await ensureJsonDir();
  if (teamId !== '' && teamId !== null && teamId !== 'null') await loadTeams(gameType);
  const file = gameFile(gameType);
  const data = list(await loadGame(file));
  let url = '';
  for (const item of body.images) {
    const parts = toStr(item?.converted_image).split(',');
    if (!looseEq(id, '') && in_multidimensional_array(intval(id), data)) {
      if (parts.length === 2 && parts[0].startsWith('data:image/png')) {
        // $uploadDir is undefined in this branch of the PHP source, so the image
        // path resolved to "/img_<time>_<id>.webp" at the filesystem root and the
        // write failed on the production host.
        return json(ctx, { status: 'error', message: 'Upload Failed' });
      }
    }
  }
  await writeJson(file, data);
  return json(ctx, { status: 'success', message: 'Saved successfully', framed_image_url: url, framed_image_short_link: url });
}
