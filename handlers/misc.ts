/** Ports of the smaller PHP endpoints in app_playtown sub-folders. */
import { ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { query, execute, humanchainPool } from '@/lib/db';
import { dynamodbLegacy, errMessage } from '@/lib/aws';
import { appPath, fileExists, mkdirp, readJson, readText, writeFile, writeJson } from '@/lib/files';
import { in_multidimensional_array_loose } from '@/lib/functions';
import { type PhpRequest, Output, JSON_CT, HTML, respond } from '@/lib/http';
import { arrayRand, base64Decode, date, dateOf, empty, intval, jsonDecode, jsonEncode, looseEq, rand, strPadLeft, time, toStr, uniqid } from '@/lib/php';
import { pdoMessage } from './uploads';

const isAwsServiceError = (e: unknown) => !!e && typeof e === 'object' && '$metadata' in (e as object) && '$fault' in (e as object);

// ---------------------------------------------------------------------------
// candid_live/upload.php and souvenir-wall-upload/upload.php
// ---------------------------------------------------------------------------

export async function candidLiveUpload(req: PhpRequest): Promise<Response> {
  if (req.method !== 'POST') return respond(jsonEncode({ status: 'error', message: 'Invalid request method' }));
  const data = jsonDecode<any>(req.input);
  if (!data || !Array.isArray(data.images)) return respond(jsonEncode({ status: 'error', message: 'Invalid data' }));

  const base = 'candid_live';
  const uploadDir = 'uploaded_images';
  const jsonFile = appPath('images.json', base);
  if (!fileExists(appPath(uploadDir, base))) await mkdirp(appPath(uploadDir, base));
  let existing: any = fileExists(jsonFile) ? await readJson(jsonFile) : [];
  if (!Array.isArray(existing)) existing = existing && typeof existing === 'object' ? Object.values(existing) : [];

  for (const [index, dataURL] of data.images.entries()) {
    const parts = toStr(dataURL).split(',');
    if (parts.length === 2 && parts[0].startsWith('data:image/jpeg')) {
      const filename = `${uploadDir}/img_${time()}_${index}.webp`;
      await writeFile(appPath(filename, base), base64Decode(parts[1]));
      existing.push(filename.replace(/\\/g, '/'));
    }
  }
  await writeJson(jsonFile, existing);
  return respond(jsonEncode({ status: 'success', message: 'Images saved successfully' }));
}

export async function souvenirWallUpload(req: PhpRequest): Promise<Response> {
  if (req.method !== 'POST') return respond(jsonEncode({ status: 'error', message: 'Invalid request method' }));
  const data = jsonDecode<any>(req.input);
  if (!data || !Array.isArray(data.images)) return respond(jsonEncode({ status: 'error', message: 'Invalid data' }));

  const base = 'souvenir-wall-upload';
  const uploadDir = 'uploaded_images';
  const jsonFile = appPath('souvenir_wall.json', base);
  if (!fileExists(appPath(uploadDir, base))) await mkdirp(appPath(uploadDir, base));
  let existing: any = fileExists(jsonFile) ? await readJson(jsonFile) : [];
  if (!Array.isArray(existing)) existing = [];

  const usedCodes: string[] = [];
  for (const [index, dataURL] of data.images.entries()) {
    const parts = toStr(dataURL).split(',');
    if (parts.length === 2 && parts[0].startsWith('data:image/jpeg')) {
      let code: string;
      do {
        code = strPadLeft(rand(0, 999), 3, '0');
      } while (usedCodes.includes(code));
      usedCodes.push(code);
      const filename = `${uploadDir}/img_${time()}_${code}_${index}.webp`;
      await writeFile(appPath(filename, base), base64Decode(parts[1]));
      existing.push({ user_image: filename.replace(/\\/g, '/'), created_at: date('Y-m-d'), unique_code: code, description: '' });
    }
  }
  await writeJson(jsonFile, existing);
  return respond(jsonEncode({ status: 'success', message: 'Saved successfully' }));
}

// ---------------------------------------------------------------------------
// human_chain_employee/upload.php
// ---------------------------------------------------------------------------

export async function humanChainEmployeeUpload(req: PhpRequest): Promise<Response> {
  if (req.method !== 'POST') return respond(jsonEncode({ status: 'error', message: 'Invalid request method' }));
  const data = jsonDecode<any>(req.input);
  if (!data || !Array.isArray(data.images)) return respond(jsonEncode({ status: 'error', message: 'Invalid data' }));

  const base = 'human_chain_employee';
  const uploadDir = 'uploaded_images';
  const teamFile = appPath('human_chain_team.json', base);
  if (!fileExists(appPath(uploadDir, base))) await mkdirp(appPath(uploadDir, base));

  let teams: any[];
  if (fileExists(teamFile)) teams = (await readJson(teamFile)) ?? [];
  else {
    teams = [
      { team_name: 'TeamA', last_inserted_team: 0 },
      { team_name: 'TeamB', last_inserted_team: 0 },
      { team_name: 'TeamC', last_inserted_team: 0 },
    ];
    await writeJson(teamFile, teams);
  }
  if (data.images.length === 0) return respond('');

  let existing: any = [];
  for (const team of Array.isArray(teams) ? teams : []) {
    if (team?.team_name === 'TeamC') {
      const file = appPath(`human_chain_${team.team_name}.json`, base);
      if (fileExists(file)) existing = await readJson(file);
      for (const item of data.images) {
        const phone = item?.user_phone ?? null;
        const parts = toStr(item?.user_image).split(',');
        if (in_multidimensional_array_loose(phone, existing)) {
          return respond(jsonEncode({ status: 'error', message: 'Phone Number Already Exist' }));
        }
        if (parts.length === 2 && parts[0].startsWith('data:image/jpeg')) {
          const filename = `${uploadDir}/img_${time()}_${uniqid()}.webp`;
          await writeFile(appPath(filename, base), base64Decode(parts[1]));
          if (!Array.isArray(existing)) existing = existing && typeof existing === 'object' ? Object.values(existing) : [];
          existing.push({
            user_image: filename.replace(/\\/g, '/'),
            user_name: item?.user_name ?? null,
            user_phone: phone,
            user_gender: item?.user_gender ?? null,
            entry_type: 'new',
            user_color: arrayRand(['1', '2']),
          });
        }
      }
      await writeJson(file, existing);
    } else {
      const file = appPath(`human_chain_${toStr(team?.team_name)}.json`, base);
      const phone = data.images[0]?.user_phone ?? '';
      if (fileExists(file)) {
        const teamData = await readJson(file);
        if (in_multidimensional_array_loose(phone, teamData)) {
          return respond(jsonEncode({ status: 'error', message: 'Phone Number Already Exist' }));
        }
      }
    }
  }
  return respond(jsonEncode({ status: 'success', message: 'Saved successfully' }));
}

// ---------------------------------------------------------------------------
// human_chain_new_sql/fetch_humanchainusers.php
// ---------------------------------------------------------------------------

export async function fetchHumanchainUsersSql(req: PhpRequest): Promise<Response> {
  const pool = humanchainPool();
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    return respond(jsonEncode({ status: 'error', message: 'Database connection failed: ' + pdoMessage(e) }));
  }
  try {
    const eventId = req.GET.event_id ?? null;
    const conditions: string[] = [];
    const params: any[] = [];
    if (!empty(eventId)) {
      conditions.push('event_id = ?');
      params.push(eventId);
    }
    conditions.push('updated_success = ?');
    params.push(1);
    // Kept verbatim: the PHP builds "SELECT ... WHERE  WHERE ...".
    const sql = 'SELECT * FROM humanchainusers WHERE ' + ' WHERE ' + conditions.join(' AND ');
    const { rows } = await execute(sql, params, pool);
    return respond(jsonEncode(rows), JSON_CT);
  } catch (e) {
    if (!(e as any)?.sqlState) throw e;
    return respond(jsonEncode({ error: pdoMessage(e) }), JSON_CT);
  }
}

// ---------------------------------------------------------------------------
// humanchain_dynamodb/fetch_humanchainusers.php
// ---------------------------------------------------------------------------

export async function fetchHumanchainUsersDynamo(req: PhpRequest): Promise<Response> {
  try {
    const eventId = req.GET.event_id ?? null;
    const teamId = req.GET.team_id ?? null;
    let filter = 'updated_success = :updated_success';
    const values: Record<string, any> = { ':updated_success': { S: '0' } };
    if (!empty(teamId) && teamId !== 'null') {
      filter += ' AND team_id = :team_id';
      values[':team_id'] = { S: teamId };
    }
    if (!empty(eventId) && eventId !== 'null' && eventId !== 'undefined') {
      filter += ' AND event_id = :event_id';
      values[':event_id'] = { S: eventId };
    }
    const res = await dynamodbLegacy().send(new ScanCommand({ TableName: 'human_chain', FilterExpression: filter, ExpressionAttributeValues: values }));
    const items = (res.Items ?? []).map((i) => unmarshall(i));
    return respond(jsonEncode(items));
  } catch (e) {
    if (!isAwsServiceError(e)) throw e;
    return respond(jsonEncode({ error: 'DynamoDB Error: ' + errMessage(e) }));
  }
}

// ---------------------------------------------------------------------------
// virtual_wish_pod/get_wishes.php
// ---------------------------------------------------------------------------

export async function getWishes(): Promise<Response> {
  const file = appPath('wishes.json', 'virtual_wish_pod');
  const out = new Output().header('Content-Type', JSON_CT);
  let raw: string | null = null;
  if (!fileExists(file)) out.echo('File not found.');
  else {
    raw = await readText(file);
    out.echo(raw ?? '');
  }
  const data = raw === null ? null : jsonDecode<any>(raw);
  const newWishes: any[] = [];
  if (data && typeof data === 'object') {
    for (const entry of Object.values<any>(data)) {
      if (entry && entry.entryType === 'new') {
        newWishes.push({ ...entry });
        entry.entryType = 'old';
      }
    }
  }
  await writeJson(file, data, { prettyPrint: true });
  out.echo(jsonEncode(newWishes));
  return out.send();
}

// ---------------------------------------------------------------------------
// ai_caricature/list.php
// ---------------------------------------------------------------------------

export async function aiCaricatureList(): Promise<Response> {
  const { rows } = await query('SELECT * FROM tblai_caricature order by id desc ');
  let html = '\n<table>\n    <thead>\n        <tr>\n            <th>Id</th>\n            <th>Name</th>\n            <th>User Image</th>\n            <th>Tranformed Image</th>\n        </tr>\n    </thead>\n    <tbody>\n';
  for (const row of rows) {
    html += `        <tr>
            <td>${toStr(row.id)}</td>
            <td>${toStr(row.user_name)}</td>
            <td><img src="${toStr(row.user_image)}" style="width:100px"/></td>
            <td><img src="../${toStr(row.transformed_image)}" style="width:100px"/></td>
        </tr>

       `;
  }
  html += '</tbody>\n</table>';
  return respond(html, HTML);
}

// ---------------------------------------------------------------------------
// admin/common-ajax.php (playtown_humanchain DB + JSON approvals)
// ---------------------------------------------------------------------------

const APPROVAL_STATUS = (v: unknown) => (looseEq(v, 1) ? 'Approved' : looseEq(v, 2) ? 'Rejected' : 'Pending');
const IMG = (src: string) => `<img src='${src}' width='50' height='50' style='border-radius:50%;'>`;

export async function adminCommonAjax(req: PhpRequest): Promise<Response> {
  const action = toStr(req.REQUEST.action);
  const R = req.REQUEST;

  if (action === 'list_human_chain_sql') {
    const { rows } = await query(
      `SELECT id, user_name, user_email, user_phone, updated_success,
                   user_designation, user_organization, avatar, user_title,user_image ,created_at
            FROM humanchainusers`,
      [],
      humanchainPool(),
    );
    const data = rows.map((row) => {
      const avatar = !empty(row.avatar) ? IMG(toStr(row.avatar)) : IMG('default-avatar.png');
      const userImage = !empty(row.user_image) ? IMG(`https://demo.playtown.co.in/app_playtown/${toStr(row.user_image)}`) : IMG('default-avatar.png');
      const info = `<div style='display:flex; align-items:center; gap:10px;'>
                        ${avatar}
                        <div>
                             <strong>${toStr(row.user_name)}</strong> (${toStr(row.user_title)})<br>
                        </div>
                      </div>`;
      const buttons = looseEq(row.updated_success, 1)
        ? `<button class='reject' data-id='${toStr(row.id)}'>Reject</button>`
        : looseEq(row.updated_success, 2)
          ? `<button class='approve' data-id='${toStr(row.id)}'>Approve</button>`
          : `<button class='approve' data-id='${toStr(row.id)}'>Approve</button>
                        <button class='reject' data-id='${toStr(row.id)}'>Reject</button>`;
      return [info, row.user_email, row.user_phone, row.user_organization, row.user_designation, userImage,
        APPROVAL_STATUS(row.updated_success), dateOf('d-M-Y H:i:s', row.created_at), buttons];
    });
    return respond(jsonEncode({ data }));
  }

  if (action === 'update_human_chain_sql') {
    // bind_param("ii") casts both values to int; failures throw on PHP 8.1, so "error" is never printed.
    await execute('UPDATE humanchainusers SET updated_success = ? WHERE id = ?', [intval(R.status), intval(R.id)], humanchainPool());
    return respond('success');
  }

  if (action === 'list_human_chain_json' || action === 'list_wall_of_wishes_json') {
    const wishes = action === 'list_wall_of_wishes_json';
    const users: any = await readJson(appPath(wishes ? 'assets/json/wall_of_wishes.json' : 'assets/json/human_chain.json'));
    const data = (Array.isArray(users) ? users : Object.values(users ?? {})).map((row: any) => {
      const userImage = !empty(row.user_image) ? IMG(`https://demo.playtown.co.in/app_playtown/${toStr(row.user_image)}`) : IMG('default-avatar.png');
      const avatar = !empty(row.avatar) ? IMG(toStr(row.avatar)) : IMG('default-avatar.png');
      const info = wishes
        ? `<div style='display:flex; align-items:center; gap:10px;'>
                        <div>
                            <strong>${toStr(row.user_name)}</strong> <br>

                        </div>
                      </div>`
        : `<div style='display:flex; align-items:center; gap:10px;'>
                        ${avatar}
                        <div>
                            <strong>${toStr(row.user_name)}</strong> <br>

                        </div>
                      </div>`;
      const buttons = looseEq(row.updated_success, 1)
        ? `<button class='btn btn-danger reject' data-id='${toStr(row.id)}'>Reject</button>`
        : looseEq(row.updated_success, 2)
          ? `<button class='btn btn-success approve' data-id='${toStr(row.id)}'>Approve</button>`
          : `<button class='btn btn-success approve' data-id='${toStr(row.id)}'>Approve</button>
                        <button class='btn btn-danger reject' data-id='${toStr(row.id)}'>Reject</button>`;
      const base = { id: row.id ?? null, user_info: info, user_email: row.user_email ?? null };
      const mid = wishes ? { user_description: row.user_description ?? null } : { user_phone: row.user_phone ?? null };
      return {
        ...base, ...mid,
        user_organization: row.user_organization ?? null, user_designation: row.user_designation ?? null,
        user_image: userImage, status: APPROVAL_STATUS(row.updated_success),
        created_at: dateOf('d-M-Y H:i:s', row.created_at), buttons,
      };
    });
    return respond(jsonEncode({ data }), JSON_CT);
  }

  if (action === 'update_human_chain_json' || action === 'update_wall_of_wishes_json') {
    const wishes = action === 'update_wall_of_wishes_json';
    const file = appPath(wishes ? 'assets/json/wall_of_wishes.json' : 'assets/json/human_chain.json');
    const users: any = await readJson(file);
    let updated = false;
    for (const user of Array.isArray(users) ? users : Object.values(users ?? {})) {
      if (looseEq(user?.id, R.id ?? null)) {
        user.updated_success = R.status ?? null;
        if (wishes) user.entry_type = 'new';
        updated = true;
        break;
      }
    }
    if (updated) {
      await writeJson(file, users, { prettyPrint: true });
      return respond(jsonEncode({ success: true, message: 'User updated successfully' }));
    }
    return respond(jsonEncode({ success: false, message: 'User not found' }));
  }

  return respond('');
}

