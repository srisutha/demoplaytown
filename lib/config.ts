/**
 * Port of app_playtown/db.php constants. Secrets that were hardcoded in the
 * PHP files now come from environment variables (see .env.example).
 */
import path from 'node:path';

const env = (name: string, fallback = '') => process.env[name] ?? fallback;

/** Absolute path of the legacy app_playtown directory (data, uploads, assets). */
export const APP_DIR = path.resolve(env('PLAYTOWN_APP_DIR', path.join(process.cwd(), '..', 'app_playtown')));

/** Equivalent of $_SERVER['DOCUMENT_ROOT'] – the parent of app_playtown. */
export const DOCUMENT_ROOT = path.dirname(APP_DIR);

export const web_url = 'https://playtown.co.in/app_playtown/';
export const img_url = 'https://app.playtown.co.in/public/uploads';

export const vance_ai_api_token = env('VANCE_AI_API_TOKEN');
export const vance_ai_api_upload = 'https://api-service.vanceai.com/web_api/v1/upload';
export const vance_ai_api_process = 'https://api-service.vanceai.com/web_api/v1/transform';
export const vance_ai_api_download = 'https://api-service.vanceai.com/web_api/v1/download';
export const dst_path = 'ai_caricature/assets/downloads';
export const org_path = 'ai_caricature/assets/downloads/orginal.jpeg';

/** Table-name constants resolved by PHP's constant($_REQUEST['tbl_action']). */
export const TABLE_CONSTANTS: Record<string, string> = {
  art_beat_table: 'tblart_beats',
  ai_artist_table: 'tblai_artist',
  friendship_tree_table: 'tblfriendship_tree',
  selfie_splash_table: 'tblselfie_splash',
  wall_of_wishes_table: 'tblwall_of_wishes',
  corporate_friendship_tree_table: 'tblcorporate_friendship_tree',
  corporate_puzzle_hustle_table: 'tblcorporate_puzzle_hustle',
  puzzle_hustle_table: 'tblpuzzle_hustle',
  friendship_team_setting_table: 'tblfriendship_team_setting',
  puzzle_hustle_team_setting_table: 'tblpuzzle_hustle_team_setting',
  energy_meter_table: 'tblenergy_meter',
  premier_league_table: 'tblpremier_leaque',
  ai_caricature_table: 'tblai_caricature',
  souvenir_wall_table: 'tblsouvenir_wall',
  candid_live_table: 'tblcandid_live',
  prediction_box_table: 'tblprediction_box',
  expression_wall_table: 'tblexpression_wall',
  human_chain_table: 'tblhuman_chain',
  tree_table: 'tbltree',
  tree_team_setting_table: 'tbltree_team_setting',
  greenverse_table: 'tblgreenverse',
};

export class UndefinedConstant extends Error {}

/** PHP constant(): throws (fatal error) for unknown names. */
export function constant(name: unknown): string {
  const key = typeof name === 'string' ? name : '';
  if (!Object.prototype.hasOwnProperty.call(TABLE_CONSTANTS, key)) {
    throw new UndefinedConstant(`Undefined constant "${String(name)}"`);
  }
  return TABLE_CONSTANTS[key];
}

/** PHP defined(). */
export function defined(name: unknown): boolean {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(TABLE_CONSTANTS, name);
}

export const db = {
  host: env('DB_HOST', 'localhost'),
  port: Number(env('DB_PORT', '3306')),
  user: env('DB_USER'),
  password: env('DB_PASSWORD'),
  database: env('DB_NAME', 'yuha_demo_playtown_app'),
  charset: env('DB_CHARSET', 'utf8mb4'),
};

export const humanchainDb = {
  host: env('HC_DB_HOST', 'localhost'),
  port: Number(env('HC_DB_PORT', '3306')),
  user: env('HC_DB_USER', 'playtown_humanchain'),
  password: env('HC_DB_PASSWORD'),
  database: env('HC_DB_NAME', 'playtown_humanchain'),
  charset: env('HC_DB_CHARSET', 'utf8'),
};

export const aws = {
  accessKeyId: env('AWS_ACCESS_KEY_ID'),
  secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
  region: env('AWS_REGION', 'ap-south-1'),
  regionSouth: env('AWS_REGION_SOUTH', 'ap-south-1'),
  /** upload_dynamodb.php and humanchain_dynamodb/fetch_humanchainusers.php used us-east-1. */
  legacyRegion: env('AWS_LEGACY_REGION', 'us-east-1'),
  s3Bucket: env('AWS_S3_BUCKET_NAME', 'playtown'),
};

export const mailgun = {
  apiKey: env('MAILGUN_API_KEY'),
  domain: env('MAILGUN_DOMAIN', 'mpurl.in'),
};

export const sms = {
  user: env('SMS_USER', 'mediaworks'),
  password: env('SMS_PASSWORD'),
};

export const SESSION_SECRET = env('SESSION_SECRET');

export const ADMIN_LOGIN = {
  username: env('ADMIN_USERNAME', 'admin'),
  password: env('ADMIN_PASSWORD'),
};
