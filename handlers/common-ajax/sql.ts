/** MySQL-backed actions of app_playtown/common-ajax.php. */
import { query, ident } from '@/lib/db';
import { constant, defined, img_url, vance_ai_api_token, vance_ai_api_upload, vance_ai_api_process, vance_ai_api_download, org_path } from '@/lib/config';
import { appPath, mkdirp, readJson, readText, writeFile, writeJson, fileExists } from '@/lib/files';
import { shortLinkMessage, fireAndForgetGet, selfieSmsLink, otpSmsLink } from '@/lib/external';
import {
  calculateLuckyNumber, eventlist, generateOTP, generateRandomImageName, generate_ai_carricature,
} from '@/lib/functions';
import { getSession } from '@/lib/session';
import {
  base64Decode, dateOf, intval, looseEq, rand, shuffle, sort, strPadLeft, strtotime, time, toStr, trim,
} from '@/lib/php';
import { type Ctx, json, nothing, req, reqOr, post, phpSql } from './context';

const T = (name: unknown) => ident(constant(name));

export async function common_update_point(ctx: Ctx) {
  const id = post(ctx, 'id');
  const successpoint = post(ctx, 'successPoint');
  const table = constant(ctx.R.tbl_action);
  const q = phpSql(`UPDATE ${table} SET percentage = '?',status='1' WHERE id = '?'`, [successpoint, id]);
  await query(q.sql.replace(table, ident(table)), q.values);
  return json(ctx, { status: 'success' + q.text, message: 'updated.' });
}

export async function common_insert_unique_id(ctx: Ctx) {
  const getStartno = 'user_';
  const table = T(ctx.R.tbl_action);
  const len = getStartno.length;
  const randomVideo = rand(1, 6);
  const last = await query(`SELECT * FROM ${table} where status='0' order by id desc limit 1`);
  if (!(last.rows.length > 0)) {
    const res = await query(
      `select if(max(CAST(SUBSTRING(unique_id, ${len}+1) as UNSIGNED)) is null , 0,max(CAST(SUBSTRING(unique_id, ${len}+1) as UNSIGNED))) as max_user_code from ${table}`,
    );
    if (res.rows.length > 0) {
      const maxUserCode = intval(res.rows[0].max_user_code) + 1;
      const uniqueId = getStartno + strPadLeft(maxUserCode, 12 - len, '0');
      const ins = await query(
        `INSERT INTO ${table} (unique_id,created_at,updated_at,random_video) VALUES (?,now(),now(),?)`,
        [uniqueId, String(randomVideo)],
      );
      return json(ctx, { status: 'success', message: 'Insereted successfully', lastinsertedid: ins.insertId, uniqueid: uniqueId });
    }
  }
  return nothing(ctx);
}

export async function save_common(ctx: Ctx) {
  const userPhone = post(ctx, 'user_phone');
  const table = constant(ctx.R.tbl_action);
  const uploadDir = appPath(table + '_images');
  const jsonFile = appPath('energymeter.json');

  if (!fileExists(uploadDir)) await mkdirp(uploadDir);
  // PHP called mkdir() on the JSON *file* path when it was missing.
  if (!fileExists(jsonFile)) await mkdirp(jsonFile);

  let existing: any = null;
  if (fileExists(jsonFile)) existing = await readJson(jsonFile);
  const list = Array.isArray(existing) ? existing : existing && typeof existing === 'object' ? Object.values(existing) : [];
  // $dataURL is undefined in the PHP source, so name/email are always null.
  list.push({ user_name: null, user_email: null, user_phone: userPhone, entry_type: 'new' });
  await writeJson(jsonFile, list);
  return json(ctx, { status: 'success', message: 'saved successfully' });
}

export async function update_common(ctx: Ctx) {
  const table = T(ctx.R.tbl_action);
  const userImage = post(ctx, 'user_image');
  const userName = post(ctx, 'user_name');
  const userPhone = post(ctx, 'user_phone');
  const lastinsertedId = post(ctx, 'lastinsertedId');
  const status = post(ctx, 'status');
  const check = await query(`SELECT COUNT(*) as count FROM ${table} WHERE id=?`, [toStr(lastinsertedId)]);
  if (check.rows.length > 0) {
    if (intval(check.rows[0].count) > 0) {
      await query(
        `UPDATE ${table} SET user_name = ?,user_phone=?, user_image = ?,status=?,updated_at=now() WHERE id = ?`,
        [toStr(userName), toStr(userPhone), toStr(userImage), toStr(status), toStr(lastinsertedId)],
      );
      return json(ctx, { status: 'success', message: 'Uploaded Successfully', lastInsertedId: lastinsertedId });
    }
    return nothing(ctx);
  }
  return json(ctx, { status: 'error', message: 'Error: Decoding of image data failed or resulted in empty data.' });
}

export async function common_send_sms(ctx: Ctx) {
  const smsId = ctx.R.sms_id;
  const type = req(ctx, 'type');
  const table = T(ctx.R.tbl_action);
  const res = await query(`SELECT * FROM ${table} where id=? and sms_send=0`, [toStr(smsId)]);
  if (res.rows.length > 0) {
    const row = res.rows[0];
    const link = toStr(type) !== ''
      ? `https://playtown.co.in/app_playtown/${toStr(row.transformed_image)}`
      : `https://playtown.co.in/x/?id='${toStr(row.id)}'`;
    const shortLink = await shortLinkMessage(link);
    const message = 'Shout out from playtown.co.in for nailing the selfie Podu Six Podu, follow us on Insta @playtowngames MEDPST. Download selfie: https://mpurl.in/' + shortLink;
    const smsLink = selfieSmsLink(toStr(row.user_phone), message);
    await fireAndForgetGet(smsLink);
    await writeFile(appPath('test.json'), shortLink);
    await query(`UPDATE ${table} SET sms_send = '1' WHERE id = ?`, [toStr(smsId)]);
    return json(ctx, { status: 'success', message: 'updated.', success_url: smsLink });
  }
  return json(ctx, { status: 'error', message: 'update Error.', success_url: '' });
}

export async function common_send_email(ctx: Ctx) {
  const commonId = ctx.R.common_id;
  const gameType = req(ctx, 'game_type');
  const table = T(ctx.R.tbl_action);
  const res = await query(`SELECT * FROM ${table} where id=? and email_send=0`, [toStr(commonId)]);
  if (res.rows.length > 0) {
    const id = res.rows[0].id;
    const emailLink = `https://app.playtown.co.in/gameemailsend/${toStr(gameType)}/${toStr(id)}`;
    const response = await fireAndForgetGet(emailLink);
    await writeFile(appPath('test.json'), response === false ? '' : response);
    await query(`UPDATE ${table} SET email_send = '1' WHERE id = ?`, [toStr(id)]);
    return json(ctx, { status: 'success', message: 'Updated', success_url: emailLink });
  }
  return json(ctx, { status: 'error', message: 'update Error.', success_url: '' });
}

export async function common_time_out(ctx: Ctx) {
  const table = constant(ctx.R.tbl_action);
  const teamId = toStr(reqOr(ctx, 'team_id', ''));
  const uniqueId = toStr(reqOr(ctx, 'unique_id', ''));
  let where = '';
  const vals: string[] = [];
  if (teamId !== '') {
    where += " team_id='?' and";
    vals.push(teamId);
  } else {
    where += " status='0' and";
  }
  if (uniqueId !== '') {
    where += "( unique_id='?' or  id='?') and ";
    vals.push(uniqueId, uniqueId);
  }
  where += ' 1';
  const q = phpSql(`update ${table} set status='2' where ${where}`, vals);
  await query(q.sql.replace(`update ${table} `, `update ${ident(table)} `), q.values);
  return json(ctx, { status: 'success', message: 'Updated successfully.' + q.text, success_url: '' });
}

export async function common_status_update(ctx: Ctx) {
  const status = post(ctx, 'status');
  const commonId = post(ctx, 'common_id');
  const table = T(ctx.R.tbl_action);
  const res = toStr(commonId) !== ''
    ? await query(`SELECT id as max_id FROM ${table} where id=? order by id desc limit 1`, [toStr(commonId)])
    : await query(`SELECT MAX(id) AS max_id FROM ${table} where status='1' and updated_success='0' order by id desc limit 1`);
  if (res.rows.length > 0) {
    const lastInsertedId = res.rows[0].max_id;
    await query(`UPDATE ${table} SET status = ?, updated_success = '1' WHERE id = ?`, [toStr(status), toStr(lastInsertedId)]);
    return json(ctx, { status: 'success', message: 'updated.' });
  }
  return json(ctx, { status: 'error', message: 'update Error.' });
}

function idleSince(updatedAt: unknown): number {
  const t = strtotime(updatedAt);
  return time() - (t === false ? 0 : t);
}

export async function common_check_unique_id(ctx: Ctx) {
  const table = constant(ctx.R.tbl_action);
  let uniqueId: any = reqOr(ctx, 'unique_id', '');
  const start = toStr(reqOr(ctx, 'start', ''));
  let where = '';
  if (start === '') where += " updated_success='0' and ";
  where += ' 1';
  const sql = `SELECT * FROM ${table} where status='0' and ${where} order by id desc limit 1`;
  const res = await query(sql.replace(`FROM ${table} `, `FROM ${ident(table)} `));
  if (res.rows.length > 0) {
    const row = res.rows[0];
    uniqueId = row.unique_id;
    return json(ctx, { selfie_image: 'present', error: 1, sql, unique_id: uniqueId, selfie_started: 1, idle_time: idleSince(row.updated_at) });
  }
  return json(ctx, { selfie_image: 'not present', error: 1, sql, unique_id: uniqueId, selfie_started: 0, idle_time: '' });
}

export async function corporate_common_check_unique_id(ctx: Ctx) {
  const table = constant(ctx.R.tbl_action);
  let uniqueId: any = reqOr(ctx, 'unique_id', '');
  const teamId = toStr(reqOr(ctx, 'team_id', ''));
  const start = toStr(reqOr(ctx, 'start', ''));
  let where = '';
  const vals: string[] = [];
  if (start === '') where += " updated_success='0' and ";
  if (teamId !== '') {
    where += " team_id = '?' and ";
    vals.push(teamId);
  }
  where += ' 1';
  const q = phpSql(`SELECT * FROM ${table} where status='1' and ${where} order by id desc limit 1`, vals);
  const res = await query(q.sql.replace(`FROM ${table} `, `FROM ${ident(table)} `), q.values);
  if (res.rows.length > 0) {
    const row = res.rows[0];
    uniqueId = row.unique_id;
    if (row.user_image !== null && row.user_image !== undefined && row.user_image !== '' && row.user_image !== '0') {
      return json(ctx, { selfie_image: 'present', error: 1, sql: q.text, unique_id: uniqueId, selfie_started: 1, idle_time: idleSince(row.updated_at), user_image: row.user_image });
    }
    return json(ctx, { selfie_image: 'not present', error: 1, sql: q.text, unique_id: uniqueId, selfie_started: 1, idle_time: '', user_image: '' });
  }
  return json(ctx, { selfie_image: 'not present', error: 1, sql: q.text, unique_id: uniqueId, selfie_started: 0, idle_time: '', user_image: '' });
}

export async function checkselfie_common(ctx: Ctx) {
  const selfieId = ctx.R.selfie_id;
  const table = T(ctx.R.tbl_action);
  const res = await query(
    `SELECT * FROM ${table} where id=? and status='1' and updated_success='1' order by id desc limit 1`,
    [toStr(selfieId)],
  );
  if (res.rows.length > 0) {
    const smsLink = `https://playtown.co.in/x/?id=${toStr(selfieId)}&route=6&peid=1701170470384351589&DLTTemplateId=1707171406364580301`;
    return json(ctx, { status: 'success', message: 'updated.', success_url: smsLink });
  }
  return json(ctx, { status: 'error', message: 'update Error.', success_url: '' });
}

/** ORDER BY id $filter_order – anything but asc/desc was a MySQL syntax error (fatal on PHP 8.1). */
function orderDirection(v: string): string {
  if (/^\s*(asc|desc)?\s*$/i.test(v)) return v;
  throw new Error(`Invalid ORDER BY direction: ${v}`);
}

export async function listallcommon_desc(ctx: Ctx) {
  const table = constant(ctx.R.tbl_action);
  const limit = ctx.R.limit !== undefined && ctx.R.limit !== null ? intval(ctx.R.limit) : 1;
  const offset = ctx.R.offset !== undefined && ctx.R.offset !== null ? intval(ctx.R.offset) : 0;
  const filterOrder = toStr(reqOr(ctx, 'order_by', 'desc'));
  const teamId = toStr(reqOr(ctx, 'team_id', ''));
  const start = toStr(reqOr(ctx, 'start', ''));
  const uniqueId = toStr(reqOr(ctx, 'unique_id', ''));

  let count: number | string = 0;
  let where = '';
  const vals: string[] = [];
  if (start === '') where += " and updated_success='0'";
  else if (looseEq(start, '2')) where += " and updated_success='1'";
  if (teamId !== '') {
    where += " and team_id='?'";
    vals.push(teamId);
  }
  if (uniqueId !== '') {
    where += " and (id='?' or unique_id='?')";
    vals.push(uniqueId, uniqueId);
  }

  const qc = phpSql(`SELECT COUNT(*) as common_count FROM ${table} where status='1' ${where}`, vals);
  const rc = await query(qc.sql.replace(`FROM ${table} `, `FROM ${ident(table)} `), qc.values);
  if (rc.rows.length > 0) count = rc.rows[0].common_count;

  let tmpl = `SELECT * FROM ${table} where status='1' ${where} ORDER BY id ${orderDirection(filterOrder)} LIMIT ${limit}`;
  if (start !== '') tmpl += ` OFFSET ${offset}`;
  const q = phpSql(tmpl, vals);
  const res = await query(q.sql.replace(`FROM ${table} `, `FROM ${ident(table)} `), q.values);
  let list = res.rows;
  if (list.length > 0 && filterOrder === 'desc') list = sort(list);
  return json(ctx, { list_common: list, error: 0, sql: q.text, common_list_data_count: list.length, latest_total_common_count: count });
}

export async function listallcommon_candid_desc(ctx: Ctx) {
  const table = constant(ctx.R.tbl_action);
  const where = 'where  1';
  let count: number | string = 0;
  const rc = await query(`SELECT COUNT(*) as common_count FROM ${ident(table)} ${where}`);
  if (rc.rows.length > 0) count = rc.rows[0].common_count;
  const sql = `SELECT * FROM ${table} ${where}`;
  const res = await query(`SELECT * FROM ${ident(table)} ${where}`);
  return json(ctx, { list_common: res.rows, error: 0, sql, common_list_data_count: res.rows.length, latest_total_common_count: count });
}

const EMPTY_GAME = {
  success_url: '', top_right_logo: '', bottom_left_logo: '', bottom_right_logo: '', top_left_logo: '',
  top_center_logo: '', tag_line: '', game_title: '', game_location: '', game_date: '', bg_music: '',
};

export async function common_game_setup(ctx: Ctx) {
  const gameType = ctx.R.game_type;
  const res = await query('SELECT * FROM tblgamelist where game_type=?', [toStr(gameType)]);
  if (res.rows.length > 0) {
    const setup = await eventlist(res.rows[0].id);
    if (setup.length > 0) {
      const g = setup[0];
      const logo = (k: string) => (toStr(g[k]) !== '' ? img_url + '/' + toStr(g[k]) : '');
      const val = (k: string) => (toStr(g[k]) !== '' ? g[k] : '');
      return json(ctx, {
        status: 'success', message: '', success_url: '',
        top_right_logo: logo('top_right_logo'),
        bottom_left_logo: logo('bottom_left_logo'),
        bottom_right_logo: logo('bottom_right_logo'),
        top_left_logo: logo('top_left_logo'),
        top_center_logo: logo('top_center_logo'),
        tag_line: val('tag_line'),
        game_title: val('game_title'),
        game_location: val('game_location'),
        game_date: toStr(g.game_date) !== '' ? dateOf('d-m-Y', g.game_date) : '',
        bg_music: logo('bg_music'),
      });
    }
  }
  return json(ctx, { status: 'error', message: 'Error.', ...EMPTY_GAME });
}

export async function common_game_team_setting(ctx: Ctx) {
  const id = ctx.R.team_id;
  const teamTable = T(ctx.R.tbl_team_action);
  constant(ctx.R.tbl_action); // evaluated (and fatal when undefined) in PHP
  const res = await query(`SELECT * FROM ${teamTable} where id=?`, [toStr(id)]);
  if (res.rows.length > 0) {
    const row = res.rows[0];
    const v = (k: string) => (row[k] !== undefined && row[k] !== null && toStr(row[k]) !== '' ? row[k] : '');
    return json(ctx, { status: 'success', message: '', success_url: '', team_name: v('team_name'), team_link: v('team_link'), team_image: v('team_image') });
  }
  return json(ctx, { status: 'error', message: 'Error.', success_url: '', team_name: '', team_link: '', team_image: '' });
}

export async function getlatest_common(ctx: Ctx) {
  const table = T(ctx.R.tbl_action);
  const res = await query(`SELECT * FROM ${table} where entry_type='new' ORDER BY id DESC LIMIT 1`);
  return json(ctx, { latest_list_common: res.rows, error: 0, latest_list_common_data_count: res.rows.length });
}

export async function getlatest_common_list(ctx: Ctx) {
  const table = T(ctx.R.tbl_action);
  const res = await query(`SELECT * FROM ${table} where entry_type='new' ORDER BY id DESC LIMIT 12`);
  return json(ctx, { latest_list_common: res.rows, error: 0, latest_list_common_data_count: res.rows.length });
}

export async function updatelatest_common(ctx: Ctx) {
  const tblAction = toStr(reqOr(ctx, 'tbl_action', ''));
  const id = ctx.R.id !== undefined && ctx.R.id !== null ? intval(ctx.R.id) : 0;
  if (tblAction === '' || !defined(tblAction)) return json(ctx, { error: 1, msg: 'Invalid table action' });
  if (id <= 0) return json(ctx, { error: 1, msg: 'Invalid id' });
  const res = await query(`UPDATE ${T(tblAction)} SET entry_type='old' WHERE id=?`, [String(id)]);
  if (res.affectedRows > 0) return json(ctx, { error: 0, msg: 'Saved Successfully', id });
  return json(ctx, { error: 1, msg: 'No rows updated', id });
}

export async function shuffling(ctx: Ctx) {
  const table = T(ctx.R.tbl_action);
  if (ctx.P.name !== undefined && ctx.P.name !== null && ctx.P.dob !== undefined && ctx.P.dob !== null) {
    const name = ctx.P.name;
    const dob = ctx.P.dob;
    await query('INSERT INTO tblprediction_users (user_name, user_dob) VALUES (?, ?)', [toStr(name), toStr(dob)]);
    const day = dateOf('d', dob);
    const res = await query(`SELECT * FROM ${table} WHERE prediction_number=? ORDER BY id DESC LIMIT 1`, [Number(day)]);
    let data: any = [];
    for (const row of res.rows) data = row.description;
    const luckyNumber = calculateLuckyNumber(dob);
    const randArray = luckyArray(luckyNumber);
    return json(ctx, { status: 'success', message: 'Inserted successfully', prediction: data, username: name, randomarray: randArray, luckynumber: luckyNumber });
  }
  return json(ctx, { status: 'error', message: 'Name and dob parameters are required' });
}

/** The lucky number plus two other distinct numbers in 0..10, shuffled. */
export function luckyArray(luckyNumber: number): number[] {
  const arr = [luckyNumber];
  while (arr.length < 3) {
    const r = rand(0, 10);
    if (!arr.some((x) => looseEq(x, r))) arr.push(r);
  }
  return shuffle(arr);
}

export async function update_common_team_setting(ctx: Ctx) {
  const table = T(ctx.R.tbl_team_action);
  await query(`UPDATE ${table} SET status = '2' WHERE id = ?`, [toStr(ctx.R.team_id)]);
  return json(ctx, { status: 'success', message: 'updated.' });
}

export async function common_reset(ctx: Ctx) {
  const table = T(ctx.R.tbl_action);
  const res = await query(`SELECT * FROM ${table} where status=?`, [toStr(ctx.R.status)]);
  if (res.rows.length > 0) return json(ctx, { error: 0, common_status_type: 'reset' });
  // PHP: mysqli_num_rows($conn) -> TypeError (fatal)
  throw new TypeError('mysqli_num_rows(): Argument #1 ($result) must be of type mysqli_result, mysqli given');
}

export async function common_reset_disable(ctx: Ctx) {
  const table = T(ctx.R.tbl_action);
  await query(`update ${table} set status='0' where id!=''`);
  // PHP read ->num_rows on a boolean result, so this branch was always taken.
  return json(ctx, { error: 1, common_status_type: '' });
}

export async function reset_common_team_setting(ctx: Ctx) {
  const id = ctx.R.team_id;
  const teamTable = T(ctx.R.tbl_team_action);
  constant(ctx.R.tbl_action);
  await query(`SELECT * FROM ${teamTable} where id=?`, [toStr(id)]);
  // The PHP source updates the undefined $table_name ("UPDATE  SET ..."), a
  // MySQL syntax error that is fatal on PHP 8.1 – so the action always fails here.
  await query("UPDATE  SET status = '1',created_at=NOW() WHERE id = ?", [toStr(id)]);
  return nothing(ctx);
}

export async function generate_otp(ctx: Ctx) {
  const userPhone = ctx.R.user_phone;
  const res = await query('SELECT * FROM tblusers where mobileno=?', [toStr(userPhone)]);
  if (res.rows.length > 0) {
    const row = res.rows[0];
    const randOtp = generateOTP();
    const message = `${randOtp} is your One-Time Password for Mobile Number validation for BRAND POST. Please do not share this OTP with anyone. - MEDWRK`;
    const smsLink = otpSmsLink(toStr(row.mobileno), message);
    await fireAndForgetGet(smsLink);
    await query('UPDATE tblusers SET otp = ? WHERE id = ?', [randOtp, toStr(row.id)]);
    return json(ctx, { status: 'success', message: 'Updated.', success_url: smsLink });
  }
  return json(ctx, { status: 'error', message: 'Update Error.', success_url: '' });
}

export async function verify_otp(ctx: Ctx) {
  const userPhone = ctx.R.user_phone;
  const userOtp = ctx.R.user_otp;
  const res = await query('SELECT * FROM tblusers where mobileno=? and otp=?', [toStr(userPhone), toStr(userOtp)]);
  if (res.rows.length > 0) {
    const row = res.rows[0];
    const session = await getSession();
    session.id = row.id;
    session.user_name = row.user_name ?? null;
    session.user_phone = userPhone;
    await session.save();
    await query("UPDATE tblusers SET otp = '1' WHERE id = ?", [toStr(row.id)]);
    return json(ctx, { status: 'success', message: 'Verified.', success_url: '' });
  }
  return json(ctx, { status: 'error', message: 'update Error.', success_url: '' });
}

export async function set_user_session(ctx: Ctx) {
  const userPhone = ctx.R.user_phone;
  const res = await query('SELECT * FROM tblusers where mobileno=?', [toStr(userPhone)]);
  if (res.rows.length > 0) {
    const row = res.rows[0];
    const session = await getSession();
    session.id = row.id;
    session.user_name = row.user_name ?? null;
    session.user_phone = userPhone;
    await session.save();
    return json(ctx, { status: 'success', message: 'Verified.', success_url: '', user_id: row.id });
  }
  return json(ctx, { status: 'error', message: 'update Error.', success_url: '', user_id: '' });
}

export async function common_logo_setup(ctx: Ctx) {
  const gameType = ctx.R.game_type;
  let gameTable = '';
  if (looseEq(gameType, 'souvenir_wall')) gameTable = 'tbl_souvenir_wall_logo';
  else if (looseEq(gameType, 'candid_live')) gameTable = 'tbl_candid_live_logo';
  // An unknown game_type produced "SELECT * FROM  " – a fatal SQL error.
  const res = await query(`SELECT * FROM ${gameTable ? ident(gameTable) : ''} `);
  if (res.rows.length > 0) {
    const row = res.rows[0];
    return json(ctx, {
      status: 'success', message: '', success_url: '',
      wall_logo: toStr(row.file) !== '' ? row.file : '',
      wall_name: toStr(row.name) !== '' ? row.name : '',
    });
  }
  return json(ctx, { status: 'error', message: 'Error.', success_url: '', wall_logo: '', wall_name: '' });
}

export async function generate_ai_carricature_action(ctx: Ctx) {
  const commonId = ctx.R.common_id;
  const tableName = constant(ctx.R.tbl_action);
  const res = await query(`SELECT * FROM ${ident(tableName)} where id=? order by id desc limit 1`, [toStr(commonId)]);
  if (res.rows.length === 0) return nothing(ctx);

  const row = res.rows[0];
  const userName = row.user_name ? toStr(row.user_name) : '';
  const parts = toStr(row.user_image).split(';base64,');
  const imageData = base64Decode(parts[1] ?? '');
  await writeFile(appPath(org_path), imageData);

  const upload = await generate_ai_carricature(vance_ai_api_upload, {
    api_token: vance_ai_api_token,
    file: { buffer: imageData, filename: 'orginal.jpeg' },
  });
  const setFailed = () => query(`UPDATE ${ident(tableName)} SET ai_process_status = 'failed' WHERE id = ?`, [toStr(commonId)]);

  if (looseEq(upload?.code, '200') && upload?.data?.uid !== undefined && upload?.data?.uid !== null && toStr(upload.data.uid) !== '') {
    const uid = toStr(upload.data.uid);
    await query(`UPDATE ${ident(tableName)} SET ai_uid = ? WHERE id = ?`, [uid, toStr(commonId)]);
    const jsonString = trim((await readText(appPath('ai_caricature/assets/json/lineart.json'))) ?? '', '﻿ï»¿');
    const processed = await generate_ai_carricature(vance_ai_api_process, { api_token: vance_ai_api_token, uid, jconfig: jsonString }, '', 1);
    if (looseEq(processed?.code, '200') && processed?.data?.trans_id !== undefined && processed?.data?.trans_id !== null && toStr(processed.data.trans_id) !== '') {
      const transId = toStr(processed.data.trans_id);
      await query(`UPDATE ${ident(tableName)} SET ai_trans_id = ?,ai_process_status=? WHERE id = ?`, [transId, toStr(processed.data.status), toStr(commonId)]);
      const downloadUrl = `${vance_ai_api_download}?trans_id=${transId}&api_token=${vance_ai_api_token}`;
      const imageName = userName + '_' + generateRandomImageName();
      await generate_ai_carricature(downloadUrl, {}, 60, '', true, imageName, commonId, tableName);
    } else {
      await setFailed();
    }
  } else {
    await setFailed();
  }
  return nothing(ctx);
}

export async function generate_ai_carricature_pencil(ctx: Ctx) {
  const commonId = ctx.R.common_id;
  const table = T(ctx.R.tbl_action);
  const image = ctx.R.common_transformed_image;
  const res = await query(`SELECT * FROM ${table} where id=? order by id desc limit 1`, [toStr(commonId)]);
  if (res.rows.length > 0) {
    await query(`UPDATE ${table} SET transformed_image = ? WHERE id = ?`, [toStr(image), toStr(commonId)]);
  }
  return json(ctx, { status: 'success', message: 'Transformed Sucessful', image: image === undefined ? null : image });
}
