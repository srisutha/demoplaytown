/** Outbound HTTP calls that the PHP code made with cURL. */
import { mailgun, sms } from './config';
import { urlencode } from './php';

/** functions.php get_short_link(): returns the raw response body (or a "Curl error" string). */
export async function getShortLink(weburl: string): Promise<string> {
  try {
    const res = await fetch('https://mpurl.in/api.php/createshorturl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_url: weburl }),
    });
    return await res.text();
  } catch (e) {
    return 'Curl error: ' + (e as Error).message;
  }
}

/** json_decode(get_short_link($link))->message, or '' */
export async function shortLinkMessage(link: string): Promise<string> {
  const raw = await getShortLink(link);
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.message !== undefined && parsed.message !== null ? String(parsed.message) : '';
  } catch {
    return '';
  }
}

/** curl_exec() of a GET URL whose response is ignored. */
export async function fireAndForgetGet(url: string): Promise<string | false> {
  try {
    const res = await fetch(url);
    return await res.text();
  } catch {
    return false;
  }
}

/** The SMS gateway URL exactly as the PHP code built it (the client receives it as success_url). */
export function selfieSmsLink(userPhone: string, message: string): string {
  return (
    `http://panel.smsmessenger.in/api/mt/SendSMS?user=${sms.user}&password=${sms.password}&senderid=MEDPST&channel=Trans&DCS=0&flashsms=0` +
    `&number=${userPhone}&text=${urlencode(message)}&route=6&peid=1701170470384351589&DLTTemplateId=1707171406364580301`
  );
}

export function otpSmsLink(userPhone: string, message: string): string {
  return (
    `http://panel.smsmessenger.in/api/mt/SendSMS?user=${urlencode(sms.user)}&password=${urlencode(sms.password)}&senderid=${urlencode('MEDWRK')}` +
    `&channel=Trans&DCS=0&flashsms=${urlencode('0')}&number=${urlencode(userPhone)}&text=${urlencode(message)}` +
    `&route=${urlencode(6)}&peid=${urlencode('1701170470384351589')}&DLTTemplateId=${urlencode('1707170480875216455')}`
  );
}

export interface MailgunAttachment {
  field: string; // 'attachment' or 'attachment[1]'
  data: Buffer;
  filename: string;
}

/** POST https://api.mailgun.net/v3/{domain}/messages with basic auth, as the PHP cURL calls did. */
export async function sendMailgun(fields: Record<string, string>, attachment?: MailgunAttachment) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (attachment) {
    form.append(attachment.field, new Blob([new Uint8Array(attachment.data)], { type: 'application/pdf' }), attachment.filename);
  }
  try {
    const res = await fetch(`https://api.mailgun.net/v3/${mailgun.domain}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`api:${mailgun.apiKey}`).toString('base64') },
      body: form,
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, body: (e as Error).message };
  }
}

export const MAILGUN_FROM = () => `Mediapoint <noreply@${mailgun.domain}>`;
