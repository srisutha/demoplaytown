/**
 * Ports of the participant upload endpoints:
 *   app_playtown/upload.php           – JSON files (+ MySQL for greenverse)
 *   app_playtown/dynamodb_upload.php  – DynamoDB + S3
 *   app_playtown/upload_dynamodb.php  – DynamoDB (us-east-1)
 *   app_playtown/uploadchain.php      – playtown_humanchain MySQL database
 */
import crypto from 'node:crypto';
import { PutItemCommand, GetItemCommand, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { marshall } from '@aws-sdk/util-dynamodb';
import { query, execute, humanchainPool } from '@/lib/db';
import { aws } from '@/lib/config';
import { dynamodb, dynamodbLegacy, s3, tableExists, createTable, errMessage } from '@/lib/aws';
import { appPath, fileExists, mkdirp, readJson, writeFile, writeJson } from '@/lib/files';
import { getIndexById, in_multidimensional_array_loose } from '@/lib/functions';
import { getWelcomeMessageId } from '@/lib/welcome-messages';
import { type PhpRequest, Output, JSON_CT } from '@/lib/http';
import { arrayRand, base64Decode, date, intval, isNumeric, jsonDecode, jsonEncode, looseEq, max, rand, strPadLeft, time, toBool, toStr, uniqid } from '@/lib/php';

const isAwsServiceError = (e: unknown) => !!e && typeof e === 'object' && '$metadata' in (e as object) && '$fault' in (e as object);

/** `$a ?? $b` for decoded JSON values. */
const nz = (v: any, d: any) => (v === undefined || v === null ? d : v);
/** `$dataURL['k']` – a missing key reads as null. */
const g = (o: any, k: string) => (o && o[k] !== undefined ? o[k] : null);

function generateUnique3DigitCode(used: unknown[]): string {
  let code: string;
  do {
    code = strPadLeft(rand(0, 999), 3, '0');
  } while (used.some((u) => looseEq(u, code)));
  return code;
}

/** PHP `$x + 1` on a value read from JSON (non-numeric strings are a TypeError). */
function plusOne(v: unknown): number {
  if (typeof v === 'number') return v + 1;
  if (v === null || v === undefined || v === false) return 1;
  if (v === true) return 2;
  if (isNumeric(v)) return Number(v) + 1;
  throw new TypeError('Unsupported operand types: string + int');
}

const DEFAULT_TEAMS = () => [
  { team_name: 'TeamA', last_inserted_team: 0 },
  { team_name: 'TeamB', last_inserted_team: 0 },
  { team_name: 'TeamC', last_inserted_team: 0 },
];

/** Shared check_email action of upload.php / upload_dynamodb.php / uploadchain.php (JSON-file based). */
async function checkEmailJson(req: PhpRequest, out: Output): Promise<Response> {
  const userEmail = req.REQUEST.user_email ?? null;
  const gameType = req.REQUEST.game_type ?? null;
  const unique = req.REQUEST.email_id_unique ?? null;
  const jsonDir = appPath('assets/json/');
  if (!fileExists(jsonDir)) await mkdirp(jsonDir);
  const file = appPath('assets/json//' + toStr(gameType) + '.json');
  const data = fileExists(file) ? await readJson(file) : [];
  if (toBool(unique) && in_multidimensional_array_loose(userEmail, data)) {
    return out.echo(jsonEncode({ status: 'error', message: 'E-mail already exists. Please try again' })).send();
  }
  return out.echo(jsonEncode({ status: 'success', message: '' })).send();
}

// ---------------------------------------------------------------------------
// upload.php
// ---------------------------------------------------------------------------

export async function uploadPhp(req: PhpRequest): Promise<Response> {
  const out = new Output().header('Content-Type', JSON_CT);
  const echo = (v: unknown) => out.echo(jsonEncode(v)).send();

  if (looseEq(req.REQUEST.action ?? null, 'check_email')) {
    if (looseEq(req.REQUEST.game_type ?? null, 'greenverse')) {
      if (toBool(req.REQUEST.email_id_unique ?? null)) {
        const r = await query('SELECT id FROM tblgreenverse WHERE user_email=? LIMIT 1', [toStr(req.REQUEST.user_email)]);
        if (r.rows.length > 0) return echo({ status: 'error', message: 'E-mail already exists. Please try again' });
      }
      return echo({ status: 'success', message: '' });
    }
    return checkEmailJson(req, out);
  }
  if (req.method !== 'POST') return echo({ status: 'error', message: 'Invalid request method' });

  const data = jsonDecode<any>(req.input);
  if (!data || !Array.isArray(data.images)) return echo({ status: 'error', message: 'Invalid data' });

  const first = data.images[0] ?? {};
  const teamId = nz(first.team_id, '');
  const gameType = nz(first.game_type, 'common');
  const uploadDir = 'assets/images/' + toStr(gameType);
  const jsonDir = 'assets/json/';
  if (!fileExists(appPath(uploadDir))) await mkdirp(appPath(uploadDir));
  if (!fileExists(appPath(jsonDir))) await mkdirp(appPath(jsonDir));

  if (!looseEq(teamId, '')) {
    const teamFile = appPath(jsonDir + toStr(gameType) + '_team.json');
    if (!fileExists(teamFile)) await writeJson(teamFile, DEFAULT_TEAMS());
  }
  if (data.images.length === 0) return out.send();

  const jsonFile = appPath(jsonDir + '/' + toStr(gameType) + '.json');
  let existing: any[] = fileExists(jsonFile) ? (await readJson<any[]>(jsonFile)) ?? [] : [];
  if (!Array.isArray(existing)) existing = Object.values(existing ?? {});
  let id: any;

  for (const item of data.images) {
    if (existing.length > 0) {
      const ids = existing.filter((e) => e && e.id !== undefined && e.id !== null).map((e) => e.id);
      if (!ids.length) throw new Error('max(): Argument #1 ($value) must contain at least one element');
      id = plusOne(max(ids));
    } else {
      id = existing.length + 1;
    }

    const userName = g(item, 'user_name');
    const userDeviceId = g(item, 'user_device_id');
    const eventId = g(item, 'event_id');
    const userEmail = g(item, 'user_email');
    const userDescription = g(item, 'user_description');
    const userId = g(item, 'user_id');
    const userPhone = g(item, 'user_phone');
    const userTitle = g(item, 'user_title');
    const userImage = g(item, 'user_image');
    const imageData = toStr(userImage).split(',');
    const userGender = nz(item?.user_gender, '');
    const userColor = nz(item?.user_color, '');
    const userHand = nz(item?.user_hand, '');
    const userAge = nz(item?.user_age, '');
    const userOrganization = g(item, 'user_organization');
    const userState = nz(item?.user_state, '');
    const welcomeMessageId = getWelcomeMessageId(userState);
    const userDesignation = nz(item?.user_designation, '');
    const userIp = nz(item?.user_ip_address, '');
    const userDeviceType = toStr(nz(item?.user_device_type, '')).slice(0, 100);
    const userAgent = nz(item?.user_agent, '');
    const userDevicePlatform = toStr(nz(item?.user_device_platform, '')).slice(0, 100);
    const userDeviceBrowser = toStr(nz(item?.user_device_browser, '')).slice(0, 100);
    const userDeviceBrowserVersion = toStr(nz(item?.user_device_browser_version, '')).slice(0, 100);
    const lastinsertedId = g(item, 'lastinsertedId');
    const fileUpload = g(item, 'file_upload');
    const deviceUnique = g(item, 'game_device_id_unique');
    const emailUnique = g(item, 'email_id_unique');
    const avatar = g(item, 'avatar');
    const autoApprove = g(item, 'auto_approve');
    const hasJpeg = (imageData.length === 2 && imageData[0].startsWith('data:image/jpeg')) || fileUpload === 0;
    const hasLastId = lastinsertedId !== null && !looseEq(lastinsertedId, '');

    // ── GREENVERSE: stored in MySQL ──
    if (looseEq(gameType, 'greenverse')) {
      if (looseEq(deviceUnique, 1)) {
        const r = await query('SELECT id FROM tblgreenverse WHERE user_device_id=? LIMIT 1', [toStr(userDeviceId)]);
        if (r.rows.length > 0) return echo({ status: 'error', message: 'Device Id  Already Exist' });
      }
      if (looseEq(emailUnique, 1)) {
        const r = await query('SELECT id FROM tblgreenverse WHERE user_email=? LIMIT 1', [toStr(userEmail)]);
        if (r.rows.length > 0) return echo({ status: 'error', message: 'E-mail already exists. Please try again' });
      }
      if (hasJpeg) {
        let imageFilename = `${uploadDir}/img_${time()}_${uniqid()}.webp`;
        const written = await writeFile(appPath(imageFilename), base64Decode(imageData[1] ?? ''));
        if (written || fileUpload === 0) {
          const randomColor = !looseEq(userColor, '') ? userColor : arrayRand(['1', '2']);
          imageFilename = (fileUpload === 0 ? toStr(userImage) : imageFilename).replace(/\\/g, '/');
          const used = (await query('SELECT unique_image_code FROM tblgreenverse')).rows.map((r) => r.unique_image_code);
          const code = generateUnique3DigitCode(used);
          const updatedSuccess = toBool(autoApprove) ? intval(autoApprove) : 0;
          const s = (v: unknown) => (v === null || v === undefined ? null : toStr(v));
          if (hasLastId) {
            await execute(
              "UPDATE tblgreenverse SET event_id=?, unique_image_code=?, user_name=?, user_email=?, user_id=?, user_phone=?, user_gender=?, avatar=?, user_title=?, user_image=?, user_description=?, entry_type='new', team_id=?, user_color=?, user_age=?, user_hand=?, user_designation=?, user_organization=?, user_state=?, welcome_message_id=?, user_device_id=?, user_device_type=?, user_agent=?, user_device_platform=?, user_device_browser=?, user_device_browser_version=?, user_ip_address=?, status=1, updated_success=?, updated_at=NOW() WHERE id=?",
              [s(eventId), code, s(userName), s(userEmail), s(userId), s(userPhone), s(userGender), s(avatar), s(userTitle), imageFilename, s(userDescription),
                s(teamId), s(randomColor), s(userAge), s(userHand), s(userDesignation), s(userOrganization), s(userState), welcomeMessageId, s(userDeviceId),
                userDeviceType, s(userAgent), userDevicePlatform, userDeviceBrowser, userDeviceBrowserVersion, s(userIp), updatedSuccess, intval(lastinsertedId)],
            );
            return echo({ status: 'success', message: 'Submitted successfully', id: lastinsertedId });
          }
          const ins = await execute(
            "INSERT INTO tblgreenverse (event_id, unique_id, unique_image_code, user_name, user_email, user_id, user_phone, user_gender, avatar, user_title, user_image, user_description, entry_type, team_id, user_color, user_age, user_hand, user_designation, user_organization, user_state, welcome_message_id, user_device_id, user_device_type, user_agent, user_device_platform, user_device_browser, user_device_browser_version, user_ip_address, status, updated_success, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,NOW(),NOW())",
            [s(eventId), '', code, s(userName), s(userEmail), s(userId), s(userPhone), s(userGender), s(avatar), s(userTitle), imageFilename, s(userDescription),
              s(teamId), s(randomColor), s(userAge), s(userHand), s(userDesignation), s(userOrganization), s(userState), welcomeMessageId, s(userDeviceId),
              userDeviceType, s(userAgent), userDevicePlatform, userDeviceBrowser, userDeviceBrowserVersion, s(userIp), updatedSuccess],
          );
          await query('UPDATE tblgreenverse SET unique_id=? WHERE id=?', [String(ins.insertId), String(ins.insertId)]);
          return echo({ status: 'success', message: 'Submitted successfully', id: ins.insertId });
        }
        return echo({ status: 'error', message: 'Upload Failed', id: '' });
      }
      // No usable image: PHP falls through to the JSON-file path below.
    }

    if (looseEq(deviceUnique, 1) && in_multidimensional_array_loose(userDeviceId, existing)) {
      return echo({ status: 'error', message: 'Device Id  Already Exist' });
    } else if (looseEq(emailUnique, 1) && in_multidimensional_array_loose(userEmail, existing)) {
      return echo({ status: 'error', message: 'E-mail already exists. Please try again' });
    } else if (hasJpeg) {
      let imageFilename = `${uploadDir}/img_${time()}_${uniqid()}.webp`;
      const written = await writeFile(appPath(imageFilename), base64Decode(imageData[1] ?? ''));
      if (written || fileUpload === 0) {
        const randomColor = !looseEq(userColor, '') ? userColor : arrayRand(['1', '2']);
        if (hasLastId) id = lastinsertedId;
        const index = getIndexById(existing, id);
        const usedCodes = existing.filter((e) => e && e.unique_image_code !== undefined && e.unique_image_code !== null).map((e) => e.unique_image_code);
        const code = generateUnique3DigitCode(usedCodes);
        imageFilename = fileUpload === 0 ? toStr(userImage) : imageFilename;
        const now = date('Y-m-d H:i:s');
        const newData = {
          id, event_id: eventId, unique_id: id, unique_image_code: code, user_name: userName, user_email: userEmail,
          user_id: userId, user_phone: userPhone, user_gender: userGender, avatar, user_title: userTitle,
          user_image: imageFilename.replace(/\\/g, '/'), user_description: userDescription, entry_type: 'new', team_id: teamId,
          user_color: randomColor, user_age: userAge, user_hand: userHand, user_designation: userDesignation,
          user_organization: userOrganization, user_state: userState, welcome_message_id: welcomeMessageId,
          user_device_id: userDeviceId, user_device_type: userDeviceType, user_agent: userAgent,
          user_device_platform: userDevicePlatform, user_device_browser: userDeviceBrowser,
          user_device_browser_version: userDeviceBrowserVersion, user_ip_address: userIp,
          status: 1, updated_success: toBool(autoApprove) ? autoApprove : 0, created_at: now, updated_at: now,
        };
        if (hasLastId && index !== null && !looseEq(index, '')) existing[index] = newData;
        else existing.push(newData);
      } else {
        return echo({ status: 'error', message: 'Upload Failed', id: '' });
      }
    }
  }
  await writeJson(jsonFile, existing);
  return echo({ status: 'success', message: 'Submitted successfully', id });
}

// ---------------------------------------------------------------------------
// dynamodb_upload.php (DynamoDB in $AWS_REGION, images to S3)
// ---------------------------------------------------------------------------

async function ensureTable(client: DynamoDBClient, table: string, out: Output) {
  if (!(await tableExists(client, table))) await createTable(client, table, out);
}

async function uploadImageToS3(base64Image: unknown, gameType: unknown): Promise<string | null> {
  const parts = toStr(base64Image).split(',');
  if (parts.length === 2 && parts[0].startsWith('data:image/jpeg')) {
    const key = `${toStr(gameType)}/img_${time()}_${uniqid()}.webp`;
    try {
      await s3().send(new PutObjectCommand({
        Bucket: aws.s3Bucket, Key: key, Body: base64Decode(parts[1]), ContentType: 'image/webp', ACL: 'public-read',
      }));
      return `https://${aws.s3Bucket}.s3.amazonaws.com/${key}`;
    } catch (e) {
      if (!isAwsServiceError(e)) throw e;
      console.error('Error uploading file: ' + errMessage(e));
      return errMessage(e);
    }
  }
  return null;
}

/** PHP Marshaler::marshalItem() equivalent. */
const marshalItem = (item: Record<string, unknown>) => marshall(item, { removeUndefinedValues: true, convertEmptyValues: false });

export async function dynamodbUploadPhp(req: PhpRequest): Promise<Response> {
  const out = new Output().header('Content-Type', JSON_CT);
  const echo = (v: unknown) => out.echo(jsonEncode(v)).send();
  const client = dynamodb();

  if (looseEq(req.REQUEST.action ?? null, 'check_email')) {
    const table = toStr(req.REQUEST.game_type);
    await ensureTable(client, table, out);
    if (toBool(req.REQUEST.email_id_unique ?? null)) {
      try {
        const r = await client.send(new GetItemCommand({ TableName: table, Key: { user_email: { S: req.REQUEST.user_email ?? null } as any } }));
        if (r.Item && Object.keys(r.Item).length) return echo({ status: 'error', message: 'E-mail already exists. Please try again' });
      } catch (e) {
        if (!isAwsServiceError(e)) throw e;
        return echo({ status: 'error', message: 'Database error: ' + errMessage(e) });
      }
    }
    return echo({ status: 'success', message: 'Email is available' });
  }
  if (req.method !== 'POST') return echo({ status: 'error', message: 'Invalid request method' });

  const data = jsonDecode<any>(req.input);
  if (!data || !Array.isArray(data.images)) return echo({ status: 'error', message: 'Invalid data format' });

  const responses: any[] = [];
  for (const u of data.images) {
    try {
      const table = toStr(g(u, 'game_type'));
      await ensureTable(client, table, out);
      if (toBool(g(u, 'email_id_unique'))) {
        // PHP passed a plain string as the key value, which the SDK's parameter
        // validation rejects with an (uncaught) InvalidArgumentException.
        throw new Error('[Key][user_email] must be an associative array');
      }
      const userImage = await uploadImageToS3(g(u, 'user_image'), g(u, 'game_type'));
      const id = crypto.randomUUID();
      const item = {
        id,
        user_game_id: nz(u.game_id, ''), unique_id: nz(u.unique_id, uniqid()), user_name: g(u, 'user_name'),
        user_email: nz(u.user_email, ''), user_id: nz(u.user_id, ''), user_phone: nz(u.user_phone, ''),
        user_gender: nz(u.user_gender, ''), avatar: nz(u.avatar, ''), user_title: nz(u.user_title, ''),
        user_image: nz(userImage, ''), user_description: nz(u.user_description, ''), entry_type: 'new',
        team_id: nz(u.team_id, ''), user_color: nz(u.user_color, 0), user_age: nz(u.user_age, 0), user_hand: nz(u.user_hand, ''),
        user_designation: nz(u.user_designation, ''), user_organization: nz(u.user_organization, ''),
        user_device_id: g(u, 'user_device_id'), user_device_type: nz(u.user_device_type, ''), user_agent: nz(u.user_agent, ''),
        user_device_platform: nz(u.user_device_platform, ''), user_device_browser: nz(u.user_device_browser, ''),
        user_device_browser_version: nz(u.user_device_browser_version, ''), user_ip_address: nz(u.user_ip_address, ''),
        status: '1', updated_success: '0',
      };
      await client.send(new PutItemCommand({ TableName: table, Item: marshalItem(item) }));
      responses.push({ status: 'success', message: 'Data inserted successfully', user_email: g(u, 'user_email'), id, item });
    } catch (e) {
      if (!isAwsServiceError(e)) throw e;
      responses.push({ status: 'error', message: 'Database error: ' + errMessage(e) });
    }
  }
  return echo(responses);
}

// ---------------------------------------------------------------------------
// upload_dynamodb.php (DynamoDB in us-east-1, no Content-Type header)
// ---------------------------------------------------------------------------

export async function uploadDynamodbPhp(req: PhpRequest): Promise<Response> {
  const out = new Output();
  const echo = (v: unknown) => out.echo(jsonEncode(v)).send();
  const client = dynamodbLegacy();

  if (looseEq(req.REQUEST.action ?? null, 'check_email')) return checkEmailJson(req, out);
  if (req.method !== 'POST') return echo({ status: 'error', message: 'Invalid request method' });

  const data = jsonDecode<any>(req.input);
  if (!data || !Array.isArray(data.images)) return echo({ status: 'error', message: 'Invalid data format' });

  const responses: any[] = [];
  for (const u of data.images) {
    try {
      const table = toStr(g(u, 'game_type'));
      await ensureTable(client, table, out);
      if (toBool(g(u, 'email_id_unique'))) throw new Error('[Key][user_email] must be an associative array');

      const parts = toStr(g(u, 'user_image')).split(',');
      if (parts.length === 2 && parts[0].startsWith('data:image/jpeg')) {
        // Saved to disk but (as in the PHP source) not referenced by the item below.
        await writeFile(appPath(`human_chain_new_dynamodb/assets/img/user_images/img_${time()}_${uniqid()}.webp`), base64Decode(parts[1]));
      }
      const id = crypto.randomUUID();
      const item = {
        id,
        event_id: nz(u.event_id, ''), unique_id: nz(u.unique_id, uniqid()), user_name: g(u, 'user_name'),
        user_email: nz(u.user_email, ''), user_id: nz(u.user_id, ''), user_phone: nz(u.user_phone, ''),
        user_gender: nz(u.user_gender, ''), avatar: nz(u.avatar, ''), user_title: nz(u.user_title, ''),
        user_image: nz(u.user_image, ''), user_description: nz(u.user_description, ''), entry_type: 'new',
        team_id: nz(u.team_id, ''), user_color: nz(u.user_color, 0), user_age: nz(u.user_age, 0), user_hand: nz(u.user_hand, ''),
        user_designation: nz(u.user_designation, ''), user_organization: nz(u.user_organization, ''),
        user_device_id: g(u, 'user_device_id'), user_device_type: nz(u.user_device_type, ''), user_agent: nz(u.user_agent, ''),
        user_device_platform: nz(u.user_device_platform, ''), user_device_browser: nz(u.user_device_browser, ''),
        user_device_browser_version: nz(u.user_device_browser_version, ''), user_ip_address: nz(u.user_ip_address, ''),
        status: '1', updated_success: '0',
      };
      await client.send(new PutItemCommand({ TableName: table, Item: marshalItem(item) }));
      responses.push({ status: 'success', message: 'Data inserted successfully', user_email: g(u, 'user_email'), id });
    } catch (e) {
      if (!isAwsServiceError(e)) throw e;
      responses.push({ status: 'error', message: 'Database error: ' + errMessage(e) });
    }
  }
  return echo(responses);
}

// ---------------------------------------------------------------------------
// uploadchain.php (playtown_humanchain database, no Content-Type header)
// ---------------------------------------------------------------------------

/** PDOException::getMessage() style text. */
export function pdoMessage(e: any): string {
  if (e?.sqlState) return `SQLSTATE[${e.sqlState}]: ${e.errno ?? ''} ${e.sqlMessage ?? e.message}`.trim();
  return e?.message ?? String(e);
}

export async function uploadchainPhp(req: PhpRequest): Promise<Response> {
  const out = new Output();
  const echo = (v: unknown) => out.echo(jsonEncode(v)).send();
  const pool = humanchainPool();
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    return echo({ status: 'error', message: 'Database connection failed: ' + pdoMessage(e) });
  }

  if (looseEq(req.REQUEST.action ?? null, 'check_email')) return checkEmailJson(req, out);
  if (req.method !== 'POST') return echo({ status: 'error', message: 'Invalid request method' });

  const data = jsonDecode<any>(req.input);
  if (!data || !Array.isArray(data.images)) return echo({ status: 'error', message: 'Invalid data format' });

  const responses: any[] = [];
  for (const u of data.images) {
    try {
      const parts = toStr(g(u, 'user_image')).split(',');
      const dup = await execute('SELECT id FROM humanchainusers WHERE user_email = ? ', [g(u, 'user_email')], pool);
      if (dup.rows.length > 0) {
        responses.push({ status: 'error', message: 'Email or Device ID already exists', user_email: g(u, 'user_email') });
        continue;
      }
      if (parts.length === 2 && parts[0].startsWith('data:image/jpeg')) {
        const imageFilename = `human_chain_new_sql/assets/img/user_images/img_${time()}_${uniqid()}.webp`;
        if (await writeFile(appPath(imageFilename), base64Decode(parts[1]))) {
          const m = await execute('SELECT MAX(id) AS max_id FROM humanchainusers', [], pool);
          const maxId = m.rows[0]?.max_id;
          const uniqueId = maxId !== null && maxId !== undefined ? Number(maxId) + 1 : 1;
          const ins = await execute(
            `INSERT INTO humanchainusers (
                event_id, unique_id, user_name, user_email, user_id, user_phone, user_gender, avatar,
                user_title, user_image, user_description, entry_type, team_id, user_color, user_age,
                user_hand, user_designation, user_organization, user_device_id, user_device_type, user_agent,
                user_device_platform, user_device_browser, user_device_browser_version, user_ip_address, status, updated_success
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?,?,?,?,?,1,0)`,
            [nz(u.event_id, null), nz(u.unique_id, uniqueId), g(u, 'user_name'), g(u, 'user_email'), nz(u.user_id, ''), nz(u.user_phone, ''),
              nz(u.user_gender, null), nz(u.avatar, ''), nz(u.user_title, ''), imageFilename, nz(u.user_description, ''), nz(u.team_id, ''),
              nz(u.user_color, 0), nz(u.user_age, null), nz(u.user_hand, null), nz(u.user_designation, ''), nz(u.user_organization, ''),
              g(u, 'user_device_id'), nz(u.user_device_type, ''), nz(u.user_agent, ''), nz(u.user_device_platform, ''),
              nz(u.user_device_browser, ''), nz(u.user_device_browser_version, ''), nz(u.user_ip_address, '')],
            pool,
          );
          responses.push({ status: 'success', message: 'Data inserted successfully', id: String(ins.insertId), user_email: g(u, 'user_email') });
        } else {
          // PHP referenced an undefined $e here: "Call to a member function getMessage() on null".
          throw new Error('Call to a member function getMessage() on null');
        }
      }
    } catch (e) {
      if (!(e as any)?.sqlState) throw e;
      responses.push({ status: 'error', message: 'Database error: ' + pdoMessage(e) });
    }
  }
  return echo(responses);
}
