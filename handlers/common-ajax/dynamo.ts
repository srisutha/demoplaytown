/**
 * DynamoDB actions of common-ajax.php.
 *
 * Attribute values are passed to the SDK exactly as the PHP code built them
 * (e.g. `['N' => 2]` is sent as a JSON number), so DynamoDB accepts or rejects
 * each request the same way it did for the PHP SDK. Service errors are caught
 * like PHP's DynamoDbException; anything else is fatal (HTTP 500).
 */
import {
  GetItemCommand, UpdateItemCommand, PutItemCommand, ScanCommand, type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { dynamodb, tableExists, createTable, flattenItem, errMessage } from '@/lib/aws';
import { appPath, fileExists, mkdirp, writeFile } from '@/lib/files';
import { shortLinkMessage, fireAndForgetGet, selfieSmsLink, sendMailgun, MAILGUN_FROM } from '@/lib/external';
import { renderCertificate } from '@/lib/pdf';
import { calculateLuckyNumber } from '@/lib/functions';
import { DOCUMENT_ROOT } from '@/lib/config';
import { base64Decode, compare, date, dateOf, empty, intval, jsonDecode, looseEq, max, strtotime, time, toBool, toStr, uniqid } from '@/lib/php';
import { type Ctx, json, req, reqOr, isAwsServiceError } from './context';
import { luckyArray } from './sql';
import path from 'node:path';

type AV = Record<string, any>;

/** ['S' => $v] – PHP dropped null members, leaving an empty attribute value. */
const S = (v: unknown): AttributeValue => (v === null || v === undefined ? {} : { S: v }) as AttributeValue;
/** ['N' => $v] – passed through untouched (ints stay JSON numbers, as the PHP SDK sent them). */
const N = (v: unknown): AttributeValue => ({ N: v }) as unknown as AttributeValue;

/** Marshaler::unmarshalItem() – sets become plain lists. */
function unmarshalItem(item: Record<string, AttributeValue> | undefined): AV {
  const toPlain = (v: any): any => {
    if (v instanceof Set) return [...v].map(toPlain);
    if (Array.isArray(v)) return v.map(toPlain);
    if (v && typeof v === 'object' && !(v instanceof Uint8Array)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPlain(x)]));
    }
    return v;
  };
  return toPlain(unmarshall(item ?? {}, { wrapNumbers: false }));
}

async function send<T>(cmd: any): Promise<T> {
  return (await dynamodb().send(cmd)) as T;
}

/** try { ... } catch (DynamoDbException $e) { ... } */
async function guarded(fn: () => Promise<Response>, onError: (msg: string) => Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (isAwsServiceError(e)) return onError(errMessage(e));
    throw e;
  }
}

async function ensureTable(ctx: Ctx, table: unknown) {
  const name = table as string;
  if (!(await tableExists(dynamodb(), name))) await createTable(dynamodb(), name, ctx.out);
}

const nonEmptyNotNull = (v: unknown, ...bad: string[]) => !empty(v) && !bad.includes(v as string);

// ---------------------------------------------------------------------------

export async function common_send_email_mailgun_dynamodb_human_chain(ctx: Ctx) {
  const smsId = reqOr(ctx, 'sms_id', '');
  const gameType = reqOr(ctx, 'game_type', '');
  const jsonDir = appPath('assets/json/');
  if (!fileExists(jsonDir)) await mkdirp(jsonDir);

  return guarded(async () => {
    const res = await send<any>(new GetItemCommand({ TableName: gameType, Key: { id: S(smsId) } }));
    if (!empty(res.Item)) {
      const user = unmarshalItem(res.Item);
      const userEmail = user.user_email ?? '';
      const userName = toStr(user.user_name ?? '');
      const id = toStr(user.id ?? '');
      let message: string;
      let subject: string;
      if (looseEq(gameType, 'human_chain')) {
        message = `${userName},\n\nThank you for joining the Pledge in support of the Vision of Viksit Bharat.\n\nThank you,\n\nIEEMA`;
        subject = 'Certificate of Commitment to the Vision of Viksit Bharat';
      } else {
        message = `${userName},\n\nThank you for sharing your thoughts on making ELECRAMA bigger and mightier.\n\nThank you,\n\nIEEMA`;
        subject = 'IEEMA Ambassador - Thank you for your participation';
      }
      let downloadLink = '';
      let attachment;
      if (looseEq(gameType, 'human_chain')) {
        const filename = `${id}_${userName}_${time()}.pdf`;
        const uploadfile = path.join(DOCUMENT_ROOT, 'app_playtown', 'pdf', filename);
        downloadLink = 'https://demo.playtown.co.in/app_playtown/pdf/' + filename;
        const pdf = await renderCertificate(userName);
        await writeFile(uploadfile, pdf);
        attachment = { field: 'attachment', data: pdf, filename };
      }
      await sendMailgun({ from: MAILGUN_FROM(), to: toStr(userEmail), subject, text: message }, attachment);
      await send(new UpdateItemCommand({
        TableName: gameType,
        Key: { id: S(smsId) },
        UpdateExpression: 'SET email_send = :val',
        ExpressionAttributeValues: { ':val': S('1') },
      }));
      return json(ctx, { status: 'success', message: 'Updated Successfully', success_url: downloadLink });
    }
    return json(ctx, { status: 'error', message: 'User not found in DynamoDB', success_url: '' });
  }, (msg) => json(ctx, { status: 'error', message: 'DynamoDB Error: ' + msg, success_url: '' }));
}

export async function checkselfie_common_dynamodb_human_chain(ctx: Ctx) {
  const selfieId = reqOr(ctx, 'selfie_id', '');
  const teamId = reqOr(ctx, 'team_id', '');
  const eventId = reqOr(ctx, 'event_id', '');
  const gameType = reqOr(ctx, 'game_type', '');

  let filter = '#status = :status';
  const names = { '#status': 'status' };
  const values: Record<string, AttributeValue> = { ':status': S('1') };
  if (!empty(selfieId)) {
    filter += ' AND id = :selfie_id';
    values[':selfie_id'] = S(selfieId);
  }
  if (nonEmptyNotNull(teamId, 'null')) {
    filter += ' AND team_id = :team_id';
    values[':team_id'] = S(teamId);
  }
  if (nonEmptyNotNull(eventId, 'null', 'undefined')) {
    filter += ' AND event_id = :event_id';
    values[':event_id'] = S(eventId);
  }
  return guarded(async () => {
    const res = await send<any>(new ScanCommand({ TableName: gameType, FilterExpression: filter, ExpressionAttributeValues: values, ExpressionAttributeNames: names }));
    if (!empty(res.Items)) {
      return json(ctx, {
        status: 'success',
        message: 'updated.',
        success_url: `https://playtown.co.in/x/?id=${toStr(selfieId)}&route=6&peid=1701170470384351589&DLTTemplateId=1707171406364580301`,
        download_link: `download.html?game_type=${toStr(gameType)}&id=${toStr(selfieId)}`,
      });
    }
    return json(ctx, { status: 'error', message: 'update Error.', success_url: '', download_link: '', dataas: [] });
  }, (msg) => json(ctx, { status: 'error', message: 'DynamoDB Error: ' + msg, success_url: '', download_link: '' }));
}

/** Builds "#id = :game_id AND #team_id = :team_id ..." as the two *_setup_dynamodb actions did. */
function setupFilter(gameId: unknown, teamId: unknown, eventId: unknown) {
  let filter = '';
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  if (!empty(gameId)) {
    filter += '#id = :game_id';
    names['#id'] = 'id';
    values[':game_id'] = S(gameId);
  }
  if (nonEmptyNotNull(teamId, 'null')) {
    filter += filter ? ' AND ' : '';
    filter += '#team_id = :team_id';
    names['#team_id'] = 'team_id';
    values[':team_id'] = S(teamId);
  }
  if (nonEmptyNotNull(eventId, 'null', 'undefined')) {
    filter += filter ? ' AND ' : '';
    filter += '#event_id = :event_id';
    names['#event_id'] = 'event_id';
    values[':event_id'] = S(eventId);
  }
  return filter ? { FilterExpression: filter, ExpressionAttributeValues: values, ExpressionAttributeNames: names } : {};
}

const sv = (item: AV, k: string, d: string) => item[k]?.S ?? d;
const nv = (item: AV, k: string, d: string) => item[k]?.N ?? d;

export async function user_game_setup_dynamodb(ctx: Ctx) {
  const gameId = reqOr(ctx, 'game_id', '');
  const params = { TableName: 'UserGameDetails', ...setupFilter(gameId, reqOr(ctx, 'team_id', ''), reqOr(ctx, 'event_id', '')) };
  return guarded(async () => {
    const res = await send<any>(new ScanCommand(params));
    const items: any[] = [];
    let customdesign: AV | undefined;
    for (const item of res.Items ?? []) {
      items.push({
        id: sv(item, 'id', ''), userId: sv(item, 'userId', ''), gameTypeId: sv(item, 'gameTypeId', ''),
        gameTitle: sv(item, 'gameTitle', ''), participants: nv(item, 'participants', '0'), screens: nv(item, 'screens', '0'),
        price: nv(item, 'price', '0'), purchaseDate: sv(item, 'purchaseDate', ''), eventName: sv(item, 'eventName', ''),
        eventDate: sv(item, 'eventDate', ''), startDate: sv(item, 'startDate', ''), endDate: sv(item, 'endDate', ''),
        clientName: sv(item, 'clientName', ''), venue: sv(item, 'venue', ''), description: sv(item, 'description', ''),
        totalPrice: nv(item, 'totalPrice', '0'), totalDays: nv(item, 'totalDays', '0'), paymentStatus: sv(item, 'paymentStatus', ''),
        razorpayOrderId: sv(item, 'razorpayOrderId', ''), expiryDate: sv(item, 'expiryDate', ''),
      });
      // The PHP passed an (ignored) Key to Scan, so this scans the whole table.
      const custom = await send<any>(new ScanCommand({ TableName: 'customdesign' }));
      customdesign = flattenItem(custom.Items?.[0] ?? {});
    }
    // $items['customdesign_details'] = ... turns the PHP list into an object.
    const out: any = customdesign === undefined
      ? items
      : { ...Object.fromEntries(items.map((v, i) => [String(i), v])), customdesign_details: Object.keys(customdesign).length ? customdesign : [] };
    return json(ctx, { status: 'success', items: out, message: 'Game details retrieved successfully.' });
  }, (msg) => json(ctx, { status: 'error', message: 'DynamoDB Error: ' + msg, items: [] }));
}

export async function game_setup_dynamodb(ctx: Ctx) {
  const params = { TableName: 'GameTypes', ...setupFilter(reqOr(ctx, 'game_type_id', ''), reqOr(ctx, 'team_id', ''), reqOr(ctx, 'event_id', '')) };
  return guarded(async () => {
    const res = await send<any>(new ScanCommand(params));
    const items = (res.Items ?? []).map((item: AV) => ({
      id: sv(item, 'id', ''), gamename: sv(item, 'gamename', ''), game_type: sv(item, 'game_type', ''),
      duration: nv(item, 'duration', '1'), basePrice: nv(item, 'basePrice', '0'), participantPrice: nv(item, 'participantPrice', '0'),
      screenPrice: nv(item, 'screenPrice', '0'), image: sv(item, 'image', ''), baseParticipants: nv(item, 'baseParticipants', '0'),
      baseScreens: nv(item, 'baseScreens', '0'), status: sv(item, 'status', 'Inactive'),
    }));
    return json(ctx, { status: 'success', items, message: 'Game details retrieved successfully.' });
  }, (msg) => json(ctx, { status: 'error', message: 'DynamoDB Error: ' + msg, items: [] }));
}

export async function common_update_dynamodb(ctx: Ctx) {
  const commonId = req(ctx, 'common_id');
  const table = req(ctx, 'game_type');
  await ensureTable(ctx, table);
  return guarded(async () => {
    const res = await send<any>(new GetItemCommand({ TableName: table, Key: { id: S(commonId) } }));
    if (empty(res.Item)) return json(ctx, { status: 'error', message: 'Record not found' });
    await send(new UpdateItemCommand({
      TableName: table,
      Key: { id: S(commonId) },
      UpdateExpression: 'SET user_title = :t, user_description = :d, updated_success = :s',
      ExpressionAttributeValues: { ':t': S(req(ctx, 'user_title')), ':d': S(req(ctx, 'user_description')), ':s': N('1') },
    }));
    return json(ctx, { status: 'success', message: 'Updated Successfully' });
  }, (msg) => json(ctx, { status: 'error', message: 'Update Error: ' + msg }));
}

export async function common_status_update_dynamodb(ctx: Ctx) {
  const status = intval(req(ctx, 'status'));
  const commonId = req(ctx, 'common_id');
  const table = req(ctx, 'game_type');
  await ensureTable(ctx, table);
  return guarded(async () => {
    const res = await send<any>(new GetItemCommand({ TableName: table, Key: { id: S(commonId) } }));
    if (empty(res.Item)) return json(ctx, { status: 'error', message: 'Record not found' });
    await send(new UpdateItemCommand({
      TableName: table,
      Key: { id: S(commonId) },
      UpdateExpression: 'SET #st = :s, updated_success = :u',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':s': N(String(status)), ':u': N('1') },
    }));
    return json(ctx, { status: 'success', message: 'Status Updated Successfully' });
  }, (msg) => json(ctx, { status: 'error', message: 'Update Error: ' + msg }));
}

export async function common_send_sms_dynamodb(ctx: Ctx) {
  const smsId = req(ctx, 'sms_id');
  const type = req(ctx, 'type');
  const table = req(ctx, 'game_type');
  await ensureTable(ctx, table);
  return guarded(async () => {
    const res = await send<any>(new GetItemCommand({ TableName: table, Key: { id: S(smsId) } }));
    if (empty(res.Item)) return json(ctx, { status: 'error', message: 'Record not found' });
    const data = unmarshalItem(res.Item);
    if (data.sms_send === undefined || data.sms_send === null || looseEq(data.sms_send, 0)) {
      const framedImage = '../' + toStr(data.framed_image);
      const link = !looseEq(type, '')
        ? `https://demo.playtown.co.in/app_playtown/${framedImage}`
        : `https://playtown.co.in/x/?id='${toStr(data.id)}'`;
      const shortLink = await shortLinkMessage(link);
      const message = 'Shout out from playtown.co.in for nailing the selfie Podu Six Podu, follow us on Insta @playtowngames MEDPST. Download selfie: https://mpurl.in/' + shortLink;
      const smsLink = selfieSmsLink(toStr(data.user_phone), message);
      await fireAndForgetGet(smsLink);
      await send(new UpdateItemCommand({
        TableName: table, Key: { id: S(smsId) }, UpdateExpression: 'SET sms_send = :s', ExpressionAttributeValues: { ':s': N('1') },
      }));
      return json(ctx, { status: 'success', message: 'SMS Sent Successfully', success_url: smsLink });
    }
    return json(ctx, { status: 'error', message: 'SMS already sent', success_url: '' });
  }, (msg) => json(ctx, { status: 'error', message: 'Error: ' + msg, success_url: '' }));
}

export async function common_send_email_dynamodb(ctx: Ctx) {
  const smsId = req(ctx, 'sms_id');
  const table = req(ctx, 'game_type');
  await ensureTable(ctx, table);
  return guarded(async () => {
    const res = await send<any>(new GetItemCommand({ TableName: table, Key: { id: S(smsId) } }));
    if (empty(res.Item)) return json(ctx, { status: 'error', message: 'Record not found' });
    const data = unmarshalItem(res.Item);
    if (data.email_send === undefined || data.email_send === null || looseEq(data.email_send, 0)) {
      const framedImage = '../' + toStr(data.framed_image);
      const link = !looseEq(req(ctx, 'type'), '')
        ? `https://playtown.co.in/app_playtown/${framedImage}`
        : `https://playtown.co.in/x/?id='${toStr(data.id)}'`;
      await shortLinkMessage(link);
      // The PHP source calls $sesClient->sendEmail() but $sesClient is never
      // created, so this action ends in a fatal error at this point.
      throw new Error('Call to a member function sendEmail() on null');
    }
    return json(ctx, { status: 'error', message: 'Email already sent' });
  }, (msg) => json(ctx, { status: 'error', message: 'Error: ' + msg }));
}

export async function common_check_unique_id_dynamodb(ctx: Ctx) {
  const table = req(ctx, 'game_type');
  const gameId = req(ctx, 'game_id');
  let uniqueId = req(ctx, 'unique_id');
  const teamId = req(ctx, 'team_id');
  const start = req(ctx, 'start');
  await ensureTable(ctx, table);
  return guarded(async () => {
    const res = await send<any>(new ScanCommand({
      TableName: table, FilterExpression: 'user_game_id = :user_game_id', ExpressionAttributeValues: { ':user_game_id': S(gameId) },
    }));
    let data = (res.Items ?? []).map(unmarshalItem);
    if (!looseEq(teamId, '')) data = data.filter((e: AV) => e.team_id !== undefined && e.team_id !== null && looseEq(e.team_id, teamId));
    if (looseEq(start, '')) data = data.filter((e: AV) => e.updated_success !== undefined && e.updated_success !== null && looseEq(e.updated_success, 0));
    data = data.filter((e: AV) => e.status !== undefined && e.status !== null && looseEq(e.status, 0));
    const ids = data.filter((e: AV) => e.id !== undefined && e.id !== null).map((e: AV) => e.id);
    const maxId = ids.length ? max(ids) : null;
    if (toBool(maxId)) {
      const entry = data.find((e: AV) => looseEq(e.id, maxId)) as AV;
      const t = strtotime(entry.updated_at);
      return json(ctx, { selfie_image: 'present', error: 0, unique_id: entry.unique_id ?? null, selfie_started: 1, idle_time: time() - (t === false ? 0 : t) });
    }
    return json(ctx, { selfie_image: 'not present', error: 1, unique_id: uniqueId, selfie_started: 0, idle_time: '' });
  }, (msg) => json(ctx, { status: 'error', message: 'Error: ' + msg }));
}

export async function common_time_out_dynamodb(ctx: Ctx) {
  const table = req(ctx, 'game_type');
  const gameId = req(ctx, 'game_id');
  const uniqueId = req(ctx, 'unique_id');
  const teamId = req(ctx, 'team_id');
  await ensureTable(ctx, table);
  return guarded(async () => {
    const res = await send<any>(new ScanCommand({
      TableName: table,
      FilterExpression: 'user_game_id = :user_game_id AND team_id = :team_id',
      ExpressionAttributeValues: { ':user_game_id': S(gameId), ':team_id': S(teamId) },
    }));
    const ids: any[] = [];
    for (const item of res.Items ?? []) {
      const r = unmarshalItem(item);
      if (looseEq(uniqueId, '') || looseEq(r.unique_id, uniqueId) || looseEq(r.id, uniqueId)) ids.push(r.id);
    }
    if (ids.length) {
      for (const id of ids) {
        await send(new UpdateItemCommand({
          TableName: table, Key: { id: S(id) }, UpdateExpression: 'SET status = :status', ExpressionAttributeValues: { ':status': N(2) },
        }));
      }
      return json(ctx, { status: 'success', message: 'Updated Successfully' });
    }
    return json(ctx, { status: 'error', message: 'Failed to update' });
  }, (msg) => json(ctx, { status: 'error', message: 'Error: ' + msg }));
}

export async function reset_common_team_setting_dynamodb(ctx: Ctx) {
  const teamId = req(ctx, 'team_id');
  const table = toStr(req(ctx, 'game_type')) + '_team';
  await ensureTable(ctx, table);
  return guarded(async () => {
    const res = await send<any>(new GetItemCommand({ TableName: table, Key: { team_id: S(teamId) } }));
    if (!empty(res.Item)) {
      await send(new UpdateItemCommand({
        TableName: table, Key: { team_id: S(teamId) },
        UpdateExpression: 'SET status = :status, created_at = :created_at',
        ExpressionAttributeValues: { ':status': N(1), ':created_at': S(date('Y-m-d H:i:s')) },
      }));
    } else {
      await send(new PutItemCommand({ TableName: table, Item: { team_id: S(teamId), status: N(1), created_at: S(date('Y-m-d H:i:s')) } }));
    }
    return json(ctx, { status: 'success', message: 'Updated' });
  }, (msg) => json(ctx, { status: 'error', message: 'Error: ' + msg }));
}

export async function update_common_team_setting_dynamodb(_ctx: Ctx): Promise<Response> {
  // The PHP source uses the undefined $gametype as the table name, so the
  // SDK's parameter validation (TableName is required) fails fatally.
  throw new Error('Found 1 error while validating the input provided for the DescribeTable operation: [TableName] is missing and is a required parameter');
}

export async function updatelatest_common_dynamodb(ctx: Ctx) {
  const table = req(ctx, 'game_type');
  const id = req(ctx, 'id');
  await ensureTable(ctx, table);
  return guarded(async () => {
    const res = await send<any>(new GetItemCommand({ TableName: table, Key: { id: S(id) } }));
    if (!empty(res.Item)) {
      await send(new UpdateItemCommand({
        TableName: table, Key: { id: S(id) }, UpdateExpression: 'SET entry_type = :entry_type', ExpressionAttributeValues: { ':entry_type': S('old') },
      }));
      return json(ctx, { error: 0, msg: 'Saved Successfully', data: [id] });
    }
    return json(ctx, { error: 1, msg: 'Entry not found.' });
  }, (msg) => json(ctx, { error: 1, msg: 'Error: ' + msg }));
}

export async function checkselfie_common_dynamodb(ctx: Ctx) {
  const selfieId = req(ctx, 'selfie_id');
  const teamId = req(ctx, 'team_id');
  const gameId = req(ctx, 'game_id');
  const table = req(ctx, 'game_type');
  await ensureTable(ctx, table);
  return guarded(async () => {
    const parts = ['#status = :status'];
    const values: Record<string, AttributeValue> = { ':status': S('1') };
    if (!empty(selfieId)) { parts.push('id = :selfie_id'); values[':selfie_id'] = S(selfieId); }
    if (!empty(teamId)) { parts.push('team_id = :team_id'); values[':team_id'] = S(teamId); }
    if (!empty(gameId)) { parts.push('user_game_id = :user_game_id'); values[':user_game_id'] = S(gameId); }
    const res = await send<any>(new ScanCommand({
      TableName: table, FilterExpression: parts.join(' AND '), ExpressionAttributeValues: values, ExpressionAttributeNames: { '#status': 'status' },
    }));
    if (!empty(res.Items)) {
      return json(ctx, {
        status: 'success', message: 'Updated.',
        success_url: `https://playtown.co.in/x/?id=${toStr(selfieId)}&route=6&peid=1701170470384351589&DLTTemplateId=1707171406364580301`,
        download_link: `dynamodb_download.html?game_type=${toStr(table)}&id=${toStr(selfieId)}&game_id=${toStr(gameId)}`,
      });
    }
    return json(ctx, { status: 'error', message: 'Update Error.', success_url: '', download_link: '' });
  }, (msg) => json(ctx, { status: 'error', message: 'Error: ' + msg }));
}

export async function generate_ai_carricature_pencil_dynamodb(ctx: Ctx) {
  const commonId = req(ctx, 'common_id');
  const table = req(ctx, 'game_type');
  const image = req(ctx, 'common_transformed_image');
  await ensureTable(ctx, table);
  return guarded(async () => {
    const res = await send<any>(new GetItemCommand({ TableName: table, Key: { id: S(commonId) } }));
    if (!empty(res.Item)) {
      await send(new UpdateItemCommand({
        TableName: table, Key: { id: S(commonId) }, UpdateExpression: 'SET transformed_image = :image', ExpressionAttributeValues: { ':image': S(image) },
      }));
      return json(ctx, { status: 'success', message: 'Transformed Successful', image });
    }
    return json(ctx, { status: 'error', message: 'Error: Record Not Found', image: '' });
  }, (msg) => json(ctx, { status: 'error', message: 'Error: ' + msg }));
}

export async function shuffling_dynamodb(ctx: Ctx) {
  const table = req(ctx, 'game_type');
  const gameId = req(ctx, 'game_id');
  if (ctx.P.name === undefined || ctx.P.name === null || ctx.P.dob === undefined || ctx.P.dob === null) {
    return json(ctx, { status: 'error', message: 'Name and dob parameters are required' });
  }
  const name = ctx.P.name;
  const dob = ctx.P.dob;
  await ensureTable(ctx, table);
  try {
    await send(new PutItemCommand({ TableName: table, Item: { id: S(uniqid()), user_game_id: S(gameId), user_name: S(name), dob: S(dob) } }));
  } catch (e) {
    if (!isAwsServiceError(e)) throw e;
    return json(ctx, { status: 'error', message: 'Error inserting data: ' + errMessage(e) });
  }
  const day = dateOf('d', dob);
  let prediction: any;
  try {
    const res = await send<any>(new ScanCommand({
      TableName: 'predictions_table', FilterExpression: 'prediction_number = :day', ExpressionAttributeValues: { ':day': N(intval(day)) }, Limit: 1,
    }));
    prediction = !empty(res.Items) ? res.Items[0].description?.S ?? null : 'No prediction found.';
  } catch (e) {
    if (!isAwsServiceError(e)) throw e;
    prediction = 'Prediction fetch error.';
  }
  const lucky = calculateLuckyNumber(dob);
  return json(ctx, { status: 'success', message: 'Inserted successfully', prediction, username: name, randomarray: luckyArray(lucky), luckynumber: lucky });
}

export async function save_single_user_unique_id_dynamodb(ctx: Ctx) {
  const table = req(ctx, 'game_type');
  const uniqueId = req(ctx, 'unique_id');
  const gameId = req(ctx, 'game_id');
  const teamId = req(ctx, 'team_id');
  await ensureTable(ctx, table);
  try {
    const existing = await send<any>(new ScanCommand({
      TableName: table, FilterExpression: 'unique_id = :unique_id', ExpressionAttributeValues: { ':unique_id': S(uniqueId) },
    }));
    if (!empty(existing.Items)) return json(ctx, { status: 'error', message: 'Unique ID already exists' });
  } catch (e) {
    if (!isAwsServiceError(e)) throw e;
    return json(ctx, { status: 'error', message: 'Error checking Unique ID: ' + errMessage(e) });
  }
  const id = uniqid();
  const now = date('Y-m-d H:i:s');
  const item: Record<string, AttributeValue> = {
    id: S(id), user_game_id: S(gameId), team_id: S(teamId), unique_id: S(uniqueId), entry_type: S('new'),
    status: N(0), updated_success: N(0), created_at: S(now), updated_at: S(now),
  };
  return guarded(async () => {
    await send(new PutItemCommand({ TableName: table, Item: item }));
    return json(ctx, { status: 'success', message: 'Saved successfully', id, data: item });
  }, (msg) => json(ctx, { status: 'error', message: 'Error inserting data: ' + msg }));
}

export async function common_reset_dynamodb(ctx: Ctx) {
  const table = req(ctx, 'game_type');
  const status = req(ctx, 'status');
  const gameId = req(ctx, 'game_id');
  return guarded(async () => {
    const parts: string[] = [];
    const values: Record<string, AttributeValue> = {};
    if (!empty(gameId)) { parts.push('user_game_id = :user_game_id'); values[':user_game_id'] = S(gameId); }
    if (!empty(status)) { parts.push('status = :status'); values[':status'] = N(intval(status)); }
    const res = await send<any>(new ScanCommand({ TableName: table, FilterExpression: parts.join(' AND '), ExpressionAttributeValues: values }));
    if (!empty(res.Items)) return json(ctx, { error: 0, common_status_type: 'reset' });
    return json(ctx, { error: '1', msg: 'Failed.' });
  }, (msg) => json(ctx, { error: '1', msg: 'DynamoDB error: ' + msg }));
}

export async function common_reset_disable_dynamodb(ctx: Ctx) {
  const table = req(ctx, 'game_type');
  const gameId = req(ctx, 'game_id');
  return guarded(async () => {
    const res = await send<any>(new ScanCommand({
      TableName: table, FilterExpression: 'user_game_id = :user_game_id', ExpressionAttributeValues: { ':user_game_id': S(gameId) },
    }));
    if (!empty(res.Items)) {
      for (const item of res.Items) {
        await send(new UpdateItemCommand({
          TableName: table, Key: { id: item.id }, UpdateExpression: 'SET #s = :status',
          ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':status': N(0) },
        }));
      }
      return json(ctx, { error: 0, msg: 'Saved Successfully', common_status_type: '' });
    }
    return json(ctx, { error: '1', msg: 'Failed.', common_status_type: '' });
  }, (msg) => json(ctx, { error: '1', msg: 'DynamoDB error: ' + msg, common_status_type: '' }));
}

export async function common_send_email_mailgun_dynamodb(ctx: Ctx) {
  const smsId = req(ctx, 'sms_id');
  const gameType = req(ctx, 'game_type');
  return guarded(async () => {
    const res = await send<any>(new GetItemCommand({ TableName: gameType, Key: { id: S(smsId) } }));
    if (res.Item === undefined || res.Item === null) return json(ctx, { status: 'error', message: 'User not found', success_url: '' });
    const user = unmarshalItem(res.Item);
    if (user.email_send !== undefined && user.email_send !== null && looseEq(user.email_send, 1)) {
      return json(ctx, { status: 'error', message: 'Email already sent', success_url: '' });
    }
    const userName = toStr(user.user_name);
    let message: string;
    let subject: string;
    if (looseEq(gameType, 'human_chain')) {
      message = `${userName},\n\n Thank you for joining the Pledge in support of the Vision of Viksit Bharat.\n\nThank you,\n\nIEEMA`;
      subject = 'Certificate of Commitment to the Vision of Viksit Bharat';
    } else {
      message = `${userName},\n\n Thank you for sharing your thoughts on making ELECRAMA bigger and mightier.\n\nThank you,\n\nIEEMA`;
      subject = 'IEEMA Ambassador. Thank you for your participation';
    }
    let downloadLink = '';
    let attachment;
    if (looseEq(gameType, 'human_chain')) {
      const filename = `${toStr(smsId)}_${userName}_${time()}`;
      const uploadfile = path.join(DOCUMENT_ROOT, 'app_playtown', 'pdf', filename + '.pdf');
      downloadLink = 'https://demo.playtown.co.in/app_playtown/pdf/' + filename + '.pdf';
      const pdf = await renderCertificate(userName);
      await writeFile(uploadfile, pdf);
      attachment = { field: 'attachment[1]', data: pdf, filename };
    }
    await sendMailgun({ from: MAILGUN_FROM(), to: toStr(user.user_email), subject, text: message }, attachment);
    await send(new UpdateItemCommand({
      TableName: gameType, Key: { id: S(smsId) }, UpdateExpression: 'SET #es = :email_send',
      ExpressionAttributeNames: { '#es': 'email_send' }, ExpressionAttributeValues: { ':email_send': N(1) },
    }));
    return json(ctx, { status: 'success', message: 'Updated Successfully', success_url: downloadLink });
  }, (msg) => json(ctx, { status: 'error', message: 'DynamoDB error: ' + msg, success_url: '' }));
}

export async function upload_framed_image_dynamodb(ctx: Ctx) {
  const body = jsonDecode<any>(ctx.req.input);
  if (!body || !Array.isArray(body.images)) {
    return json(ctx, { status: 'error', message: 'Invalid data', framed_image_url: '', framed_image_short_link: '' });
  }
  const first = body.images[0] ?? {};
  const id = first.id ?? '';
  const gameType = first.game_type ?? 'common';
  const uploadDir = 'assets/images/' + toStr(gameType) + '/framed_images';
  if (!fileExists(appPath(uploadDir))) await mkdirp(appPath(uploadDir));

  let url = '';
  for (const item of body.images) {
    const parts = toStr(item?.converted_image).split(',');
    if (parts.length === 2 && parts[0].startsWith('data:image/png')) {
      const filename = `${uploadDir}/img_${time()}_${uniqid()}.webp`;
      url = 'https://demo.playtown.co.in/app_playtown/' + filename;
      if (await writeFile(appPath(filename), base64Decode(parts[1]))) {
        try {
          await send(new UpdateItemCommand({
            TableName: gameType, Key: { id: S(id) }, UpdateExpression: 'SET #fi = :framed_image',
            ExpressionAttributeNames: { '#fi': 'framed_image' }, ExpressionAttributeValues: { ':framed_image': S(filename.replace(/\\/g, '/')) },
          }));
        } catch (e) {
          if (!isAwsServiceError(e)) throw e;
          return json(ctx, { status: 'error', message: 'DynamoDB Error: ' + errMessage(e) });
        }
      } else {
        return json(ctx, { status: 'error', message: 'Image upload failed' });
      }
    }
  }
  const short = await shortLinkMessage(url);
  return json(ctx, { status: 'success', message: 'Saved successfully', framed_image_url: url, framed_image_short_link: short ? 'https://mpurl.in/' + short : '' });
}

export async function listallcommon_desc_dynamodb(ctx: Ctx) {
  const table = req(ctx, 'game_type');
  const limit = ctx.R.limit !== undefined && ctx.R.limit !== null ? intval(ctx.R.limit) : 10;
  const teamId = reqOr(ctx, 'team_id', '');
  const uniqueId = reqOr(ctx, 'unique_id', '');
  const start = reqOr(ctx, 'start', '');
  const gameId = reqOr(ctx, 'game_id', '');
  const filterOrder = reqOr(ctx, 'order_by', 'desc');
  const lastKey = ctx.R.last_key !== undefined && ctx.R.last_key !== null ? jsonDecode(ctx.R.last_key) : null;

  if (empty(table)) return json(ctx, { error: 'Table name is missing' });

  const parts: string[] = [];
  const values: Record<string, AttributeValue> = {};
  if (ctx.R.status !== undefined && ctx.R.status !== null && ctx.R.status !== '') {
    parts.push('status = :status');
    values[':status'] = N(toStr(ctx.R.status));
  }
  if (start === '') {
    parts.push('updated_success = :updated_success');
    values[':updated_success'] = N('0');
  } else if (start === '2') {
    parts.push('updated_success = :updated_success');
    values[':updated_success'] = N('1');
  }
  if (!empty(teamId)) { parts.push('team_id = :team_id'); values[':team_id'] = S(teamId); }
  if (!empty(uniqueId)) { parts.push('(id = :unique_id OR unique_id = :unique_id)'); values[':unique_id'] = S(uniqueId); }
  if (!empty(gameId)) { parts.push('user_game_id = :user_game_id'); values[':user_game_id'] = S(gameId); }

  return guarded(async () => {
    const filter = parts.length ? { FilterExpression: parts.join(' AND '), ExpressionAttributeValues: values } : {};
    const res = await send<any>(new ScanCommand({ TableName: table, Limit: limit, ...filter, ...(toBool(lastKey) ? { ExclusiveStartKey: lastKey } : {}) }));
    const count = await send<any>(new ScanCommand({ TableName: table, Select: 'COUNT', ...filter }));
    let list = (res.Items ?? []).map(flattenItem);
    if (list.length && filterOrder === 'desc') list = [...list].sort((a: AV, b: AV) => compare(b.id, a.id));
    return json(ctx, {
      list_common: list, error: 0, common_list_data_count: list.length,
      latest_total_common_count: count.Count, LastEvaluatedKey: res.LastEvaluatedKey ?? null,
    });
  }, (msg) => json(ctx, { error: 1, message: msg }));
}

export async function fetch_game_detail_dynamodb(ctx: Ctx) {
  const selfieId = reqOr(ctx, 'id', null);
  const teamId = reqOr(ctx, 'team_id', null);
  const gameId = reqOr(ctx, 'game_id', null);
  const table = reqOr(ctx, 'game_type', null);
  if (empty(table)) return json(ctx, { status: 'error', message: 'Missing game_type (table name)' });
  if (!(await tableExists(dynamodb(), table))) return json(ctx, { status: 'error', message: 'Table does not exist' });
  return guarded(async () => {
    const parts: string[] = [];
    const values: Record<string, AttributeValue> = {};
    if (!empty(selfieId)) { parts.push('id = :selfie_id'); values[':selfie_id'] = S(selfieId); }
    if (!empty(teamId) && teamId !== 'null') { parts.push('team_id = :team_id'); values[':team_id'] = S(teamId); }
    if (!empty(gameId)) { parts.push('user_game_id = :user_game_id'); values[':user_game_id'] = S(gameId); }
    if (!parts.length) return json(ctx, { status: 'error', message: 'At least one filter (id, team_id, game_id) is required' });
    const res = await send<any>(new ScanCommand({ TableName: table, FilterExpression: parts.join(' AND '), ExpressionAttributeValues: values }));
    if (!empty(res.Items)) return json(ctx, { status: 'success', message: 'Data fetched successfully', items: res.Items.map(flattenItem) });
    return json(ctx, { status: 'error', message: 'No matching records found', items: [] });
  }, (msg) => json(ctx, { status: 'error', message: 'Error: ' + msg }));
}

export async function getlatest_common_dynamodb(ctx: Ctx) {
  const table = req(ctx, 'game_type');
  return guarded(async () => {
    const res = await send<any>(new ScanCommand({
      TableName: table, FilterExpression: 'entry_type = :entry_type', ExpressionAttributeValues: { ':entry_type': S('new') }, Limit: 1,
    }));
    const data = (res.Items ?? []).map(unmarshalItem);
    return json(ctx, { latest_list_common: data, error: 0, latest_list_common_data_count: data.length });
  }, (msg) => json(ctx, { error: 1, msg: 'DynamoDB Error: ' + msg }));
}

