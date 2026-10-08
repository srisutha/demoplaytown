/**
 * Serves the legacy app_playtown files (HTML, JS, CSS, images, videos and
 * the JSON data files the frontends poll) the way Apache did.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { APP_DIR } from './config';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=UTF-8', '.htm': 'text/html; charset=UTF-8', '.css': 'text/css',
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.map': 'application/json',
  '.txt': 'text/plain', '.xml': 'application/xml', '.csv': 'text/csv', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const NOT_FOUND = () => new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });

/** Paths Apache would refuse, plus server-side sources that must never be sent. */
function isBlocked(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.some((p) => p.startsWith('.'))) return true; // .htaccess, .user.ini, ...
  if (parts[0] === 'vendor') return true;
  if (/\.(php\d?|phtml|inc|ini|lock)$/i.test(rel)) return true;
  if (/^composer\.json$/i.test(rel)) return true;
  return false;
}

export async function serveStatic(req: Request, rel: string): Promise<Response> {
  // tamilpreneur/.htaccess contains an invalid directive, so Apache answered 500.
  if (rel === 'tamilpreneur' || rel.startsWith('tamilpreneur/')) {
    return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  }
  if (isBlocked(rel)) return NOT_FOUND();

  const abs = path.resolve(APP_DIR, rel);
  if (abs !== APP_DIR && !abs.startsWith(APP_DIR + path.sep)) return NOT_FOUND();

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return NOT_FOUND();
  }

  if (stat.isDirectory()) {
    const url = new URL(req.url);
    if (!url.pathname.endsWith('/')) {
      return new Response(null, { status: 301, headers: { Location: url.pathname + '/' + url.search } });
    }
    for (const index of ['index.html', 'index.htm']) {
      const candidate = path.join(abs, index);
      if (fs.existsSync(candidate)) return sendFile(req, candidate, await fsp.stat(candidate), rel ? `${rel}/${index}` : index);
    }
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }
  return sendFile(req, abs, stat, rel);
}

function sendFile(req: Request, abs: string, stat: fs.Stats, rel: string): Response {
  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  const lastModified = stat.mtime.toUTCString();
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = new Headers({
    'Content-Type': type,
    'Last-Modified': lastModified,
    ETag: etag,
    'Accept-Ranges': 'bytes',
  });
  // greenverse/.htaccess: never cache its JavaScript.
  if (rel.startsWith('greenverse/') && rel.endsWith('.js')) {
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
  }

  const inm = req.headers.get('if-none-match');
  const ims = req.headers.get('if-modified-since');
  if ((inm && inm === etag) || (!inm && ims && new Date(ims).getTime() >= Math.floor(stat.mtimeMs / 1000) * 1000)) {
    return new Response(null, { status: 304, headers });
  }

  const head = req.method === 'HEAD';
  const range = req.headers.get('range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start = m[1] === '' ? Math.max(0, stat.size - Number(m[2])) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      headers.set('Content-Range', `bytes */${stat.size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(head ? null : stream(abs, start, end), { status: 206, headers });
  }

  headers.set('Content-Length', String(stat.size));
  return new Response(head ? null : stream(abs), { status: 200, headers });
}

function stream(abs: string, start?: number, end?: number): ReadableStream {
  return Readable.toWeb(fs.createReadStream(abs, { start, end })) as unknown as ReadableStream;
}
