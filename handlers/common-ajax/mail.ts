/** Certificate e-mail actions (Mailgun + PDF) and the PDF download action. */
import path from 'node:path';
import fs from 'node:fs/promises';
import { execute, humanchainPool } from '@/lib/db';
import { APP_DIR, DOCUMENT_ROOT } from '@/lib/config';
import { appPath, fileExists, mkdirp, readJson, writeFile, writeJson } from '@/lib/files';
import { getIndexById, in_multidimensional_array } from '@/lib/functions';
import { sendMailgun, MAILGUN_FROM } from '@/lib/external';
import { renderCertificate } from '@/lib/pdf';
import { arrayMerge, looseEq, time, toStr } from '@/lib/php';
import { HTML } from '@/lib/http';
import { type Ctx, json, req } from './context';
import { gameFile } from './json-files';

function certificateText(gameType: unknown, userName: string) {
  return looseEq(gameType, 'human_chain')
    ? {
        message: `${userName},\n\n Thank you for joining  the Pledge in support of the Vision of Viksit Bharat .\n\nThank you,\n\nIEEMA`,
        subject: 'Certificate of Commitment to the Vision of Viksit Bharat',
      }
    : {
        message: `${userName},\n\n Thank you for sharing your thoughts on making ELECRAMA bigger and mightier.\n\nThank you,\n\nIEEMA`,
        subject: 'IEEMA Ambassador . Thank your for your participation',
      };
}

/** Writes pdf/<id>_<name>_<time>.pdf and returns the PHP $uploadfile / $filename values. */
async function writeCertificate(id: unknown, userName: string) {
  const filename = `${toStr(id)}_${userName}_${time()}`;
  const uploadfile = path.join(DOCUMENT_ROOT, 'app_playtown', 'pdf', filename + '.pdf');
  const pdf = await renderCertificate(userName);
  await writeFile(uploadfile, pdf);
  return { filename, uploadfile, pdf };
}

export async function common_send_email_mailgun_json(ctx: Ctx) {
  const smsId = req(ctx, 'sms_id');
  const gameType = req(ctx, 'game_type');
  const jsonDir = appPath('assets/json/');
  if (!fileExists(jsonDir)) await mkdirp(jsonDir);
  const file = gameFile(gameType);
  let data: any = fileExists(file) ? await readJson(file) : [];

  if (in_multidimensional_array(smsId, data)) {
    data = Array.isArray(data) ? data : [];
    const idx = getIndexById(data, smsId);
    const entry = idx === null ? null : data[idx] ?? null;
    let uploadfile: string | null = null;
    // Note: the PHP condition sends when email_send is missing *or already 1*.
    if (entry?.email_send === undefined || entry?.email_send === null || looseEq(entry.email_send, 1)) {
      const userName = toStr(entry?.user_name);
      const { message, subject } = certificateText(gameType, userName);
      let attachment;
      if (looseEq(gameType, 'human_chain')) {
        const cert = await writeCertificate(entry?.id, userName);
        uploadfile = cert.uploadfile;
        attachment = { field: 'attachment[1]', data: cert.pdf, filename: cert.filename };
      }
      await sendMailgun({ from: MAILGUN_FROM(), to: toStr(entry?.user_email), subject, text: message }, attachment);
    }
    data[idx as number] = arrayMerge(entry, { email_send: 1 });
    await writeJson(file, data);
    return json(ctx, { status: 'success', message: 'Updated Successfully', success_url: uploadfile });
  }
  return json(ctx, { status: 'error', message: 'update Error.', success_url: '' });
}

export async function common_send_email_mailgun_sql(ctx: Ctx) {
  const smsId = req(ctx, 'sms_id');
  const gameType = req(ctx, 'game_type');
  const jsonDir = appPath('assets/json/');
  if (!fileExists(jsonDir)) await mkdirp(jsonDir);

  let rows;
  try {
    rows = (await execute('SELECT * FROM humanchainusers WHERE id = ? and email_send= ?', [smsId, 0], humanchainPool())).rows;
  } catch (e) {
    if ((e as any)?.code === 'ECONNREFUSED' || (e as any)?.code === 'ER_ACCESS_DENIED_ERROR' || (e as any)?.code === 'ER_BAD_DB_ERROR') {
      return json(ctx, { status: 'error', message: 'Database connection failed: ' + (e as Error).message });
    }
    throw e;
  }
  if (rows.length > 0) {
    const user = rows[0];
    const userName = toStr(user.user_name ?? '');
    const { message, subject } = certificateText(gameType, userName);
    let uploadfile: string | null = null;
    let attachment;
    if (looseEq(gameType, 'human_chain')) {
      const cert = await writeCertificate(user.id ?? '', userName);
      uploadfile = cert.uploadfile;
      attachment = { field: 'attachment[1]', data: cert.pdf, filename: cert.filename };
    }
    await sendMailgun({ from: MAILGUN_FROM(), to: toStr(user.user_email ?? ''), subject, text: message }, attachment);
    await execute('UPDATE humanchainusers SET email_send = ? WHERE id = ?', [1, smsId], humanchainPool());
    return json(ctx, { status: 'success', message: 'Updated Successfully', success_url: uploadfile });
  }
  return json(ctx, { status: 'error', message: 'update Error.', success_url: '' });
}

/**
 * Streams a generated certificate. The PHP version accepted any path on the
 * server (realpath + readfile); this port only serves files inside
 * app_playtown/pdf, which is where every certificate is written.
 */
export async function common_download_pdf(ctx: Ctx) {
  const name = toStr(req(ctx, 'download_name'));
  const pdfDir = path.join(APP_DIR, 'pdf') + path.sep;
  const candidate = path.isAbsolute(name) ? path.resolve(name) : path.resolve(APP_DIR, name);
  let real: string | null = null;
  try {
    real = await fs.realpath(candidate);
  } catch {
    real = null;
  }
  if (name !== '' && real && real.startsWith(pdfDir)) {
    const data = await fs.readFile(real);
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Description': 'File Transfer',
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${path.basename(real)}"`,
        Expires: '0',
        'Cache-Control': 'must-revalidate',
        Pragma: 'public',
        'Content-Length': String(data.length),
      },
    });
  }
  return new Response('File not found!', { headers: { 'Content-Type': HTML } });
}
