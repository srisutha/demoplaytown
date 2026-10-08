/**
 * Everything under /app_playtown. Former PHP endpoints keep their exact URLs
 * (e.g. /app_playtown/common-ajax.php) and are handled by the TypeScript
 * ports; every other path is served from the app_playtown folder.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readRequest, fatal, displayedFatal, respond, HTML, JSON_CT, type PhpRequest } from '@/lib/http';
import { jsonEncode } from '@/lib/php';
import { serveStatic } from '@/lib/static';
import { commonAjax, JSON_ACTIONS } from '@/handlers/common-ajax';
import { uploadPhp, dynamodbUploadPhp, uploadDynamodbPhp, uploadchainPhp } from '@/handlers/uploads';
import {
  candidLiveUpload, souvenirWallUpload, humanChainEmployeeUpload, fetchHumanchainUsersSql,
  fetchHumanchainUsersDynamo, getWishes, aiCaricatureList, adminCommonAjax,
} from '@/handlers/misc';
import {
  friendshipTreePrint, friendshipTreePortraitPrint, wallOfWishesPrint, selfiesplashPrint, virtualPrint,
  virtualWishPodPrint, appUi, adminLogin,
} from '@/handlers/pages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Endpoint = (req: PhpRequest) => Promise<Response>;

const ENDPOINTS: Record<string, Endpoint> = {
  'common-ajax.php': commonAjax,
  'upload.php': uploadPhp,
  'dynamodb_upload.php': dynamodbUploadPhp,
  'upload_dynamodb.php': uploadDynamodbPhp,
  'uploadchain.php': uploadchainPhp,
  'submit.php': async () => respond('hi'),
  'friendship_tree_print.php': () => friendshipTreePrint(),
  'friendshiptreepringpotrait.php': () => friendshipTreePortraitPrint(),

  'admin/common-ajax.php': adminCommonAjax,
  'admin/login.php': adminLogin,
  'admin/wall_of_wishes_print.php': () => wallOfWishesPrint(),

  'ai_caricature/list.php': () => aiCaricatureList(),
  'candid_live/upload.php': candidLiveUpload,
  'souvenir-wall-upload/upload.php': souvenirWallUpload,
  'human_chain_employee/upload.php': humanChainEmployeeUpload,
  'human_chain_new_sql/fetch_humanchainusers.php': fetchHumanchainUsersSql,
  'humanchain_dynamodb/fetch_humanchainusers.php': fetchHumanchainUsersDynamo,

  'virtual_wish_pod/get_wishes.php': () => getWishes(),
  'virtual_wish_pod/selfiesplash_print.php': () => selfiesplashPrint(),
  'virtual_wish_pod/virtualprint.php': () => virtualPrint(),
  'virtual_wish_pod/virtualwishpod_print.php': () => virtualWishPodPrint(),

  'app_ui/home.php': (r) => appUi('home.php', r),
  'app_ui/payment.php': (r) => appUi('payment.php', r),
  'app_ui/payment_history.php': (r) => appUi('payment_history.php', r),
  'app_ui/profile.php': (r) => appUi('profile.php', r),
  'app_ui/tutorial.php': (r) => appUi('tutorial.php', r),
  'app_ui/videoplay.php': (r) => appUi('videoplay.php', r),
};

/** .php files that contained no PHP code – served as plain HTML from templates/static-php. */
const STATIC_PHP = new Set([
  'thankyou-card.php',
  'socket.php',
  'admin/human_chain_approval_json.php',
  'admin/human_chain_approval_sql.php',
  'admin/wall_of_wishes_approval_json.php',
]);

/** What each PHP script sent when it died, given its error-display settings. */
function onFatal(rel: string, req: PhpRequest | null, e: unknown): Response {
  if (rel === 'common-ajax.php') {
    // display_errors was switched on for every action except the JSON ones.
    return JSON_ACTIONS.has(String(req?.REQUEST.action ?? '')) ? fatal(e) : displayedFatal(e);
  }
  if (rel === 'upload.php') {
    // upload.php installed an exception handler that reported errors as JSON.
    console.error('[php-fatal]', e);
    const err = e as Error;
    return respond(jsonEncode({ status: 'debug_exception', error: err?.message ?? String(e) }), JSON_CT);
  }
  if (rel === 'dynamodb_upload.php') return displayedFatal(e);
  return fatal(e);
}

function relativePath(req: Request): string | null {
  const { pathname } = new URL(req.url);
  if (pathname === '/app_playtown') return null;
  const rest = pathname.slice('/app_playtown/'.length);
  try {
    return rest.split('/').map(decodeURIComponent).join('/');
  } catch {
    return rest;
  }
}

async function handle(req: Request): Promise<Response> {
  const rel = relativePath(req);
  if (rel === null) {
    const url = new URL(req.url);
    return new Response(null, { status: 301, headers: { Location: '/app_playtown/' + url.search } });
  }

  const endpoint = ENDPOINTS[rel];
  if (endpoint) {
    let php: PhpRequest | null = null;
    try {
      php = await readRequest(req);
      return await endpoint(php);
    } catch (e) {
      return onFatal(rel, php, e);
    }
  }
  if (STATIC_PHP.has(rel)) {
    const html = await fs.readFile(path.join(process.cwd(), 'templates', 'static-php', rel + '.html'), 'utf8');
    return respond(html, HTML);
  }
  return serveStatic(req, rel);
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
export const OPTIONS = handle;
