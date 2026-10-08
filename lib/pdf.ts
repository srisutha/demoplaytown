/**
 * Replacement for mPDF + email_template.php: an A4-landscape certificate with
 * pdf/bg-media.jpg stretched over the page (background-image-resize: 6) and
 * the user's name centred in Dancing Script, 50px, capitalised.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import PDFDocument from 'pdfkit';
import { APP_DIR } from './config';

const MM = 72 / 25.4; // points per millimetre
const PX = 25.4 / 96; // mPDF renders CSS px at 96 dpi -> mm

const FONT = path.join(process.cwd(), 'assets', 'fonts', 'DancingScript-Bold.ttf');

/** CSS text-transform: capitalize */
function capitalize(s: string): string {
  return s.replace(/(^|\s)(\S)/g, (_m, sp, c) => sp + c.toUpperCase());
}

async function background(): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(APP_DIR, 'pdf', 'bg-media.jpg'));
  } catch {
    try {
      const res = await fetch('https://demo.playtown.co.in/app_playtown/pdf/bg-media.jpg');
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
}

export async function renderCertificate(userName: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const bg = await background();
  if (bg) doc.image(bg, 0, 0, { width: pageW, height: pageH });

  // mPDF defaults: 15mm side margins, 16mm top margin; the table adds 130px padding.
  const marginX = 15 * MM;
  const top = (16 + 130 * PX) * MM;
  const fontSizePt = 50 * PX * MM;

  doc.font(FONT).fontSize(fontSizePt).fillColor('#000000');
  doc.text(capitalize(userName), marginX, top, { width: pageW - 2 * marginX, align: 'center', lineBreak: true });

  doc.end();
  return done;
}
