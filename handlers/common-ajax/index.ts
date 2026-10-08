/** Port of app_playtown/common-ajax.php – dispatches on $_REQUEST['action']. */
import type { PhpRequest } from '@/lib/http';
import { Output } from '@/lib/http';
import { toStr } from '@/lib/php';
import type { Ctx } from './context';
import * as sql from './sql';
import * as gv from './greenverse';
import * as jf from './json-files';
import * as dy from './dynamo';
import * as mail from './mail';

type Handler = (ctx: Ctx) => Promise<Response>;

const ACTIONS: Record<string, Handler> = {
  common_update_point: sql.common_update_point,
  common_insert_unique_id: sql.common_insert_unique_id,
  save_common: sql.save_common,
  update_common: sql.update_common,
  common_send_sms: sql.common_send_sms,
  common_send_email: sql.common_send_email,
  common_time_out: sql.common_time_out,
  common_status_update: sql.common_status_update,
  common_check_unique_id: sql.common_check_unique_id,
  corporate_common_check_unique_id: sql.corporate_common_check_unique_id,
  checkselfie_common: sql.checkselfie_common,
  listallcommon_desc: sql.listallcommon_desc,
  listallcommon_candid_desc: sql.listallcommon_candid_desc,
  common_game_setup: sql.common_game_setup,
  common_game_team_setting: sql.common_game_team_setting,
  getlatest_common: sql.getlatest_common,
  updatelatest_common: sql.updatelatest_common,
  shuffling: sql.shuffling,
  update_common_team_setting: sql.update_common_team_setting,
  common_reset: sql.common_reset,
  common_reset_disable: sql.common_reset_disable,
  reset_common_team_setting: sql.reset_common_team_setting,
  generate_otp: sql.generate_otp,
  verify_otp: sql.verify_otp,
  set_user_session: sql.set_user_session,
  common_logo_setup: sql.common_logo_setup,
  generate_ai_carricature: sql.generate_ai_carricature_action,
  generate_ai_carricature_pencil: sql.generate_ai_carricature_pencil,
  greenverse_wishes: gv.greenverse_wishes,
  getlatest_common_list: sql.getlatest_common_list,
  get_greenverse_by_id: gv.get_greenverse_by_id,
  upload_framed_image: jf.upload_framed_image,
  common_update_json: jf.common_update_json,
  common_status_update_json: jf.common_status_update_json,
  common_send_sms_json: jf.common_send_sms_json,
  common_send_email_json: jf.common_send_email_json,
  common_check_unique_id_json: jf.common_check_unique_id_json,
  image_download_common_json: jf.image_download_common_json,
  common_time_out_json: jf.common_time_out_json,
  reset_common_team_setting_json: jf.reset_common_team_setting_json,
  update_common_team_setting_json: jf.update_common_team_setting_json,
  updatelatest_common_json: jf.updatelatest_common_json,
  checkselfie_common_json: jf.checkselfie_common_json,
  generate_ai_carricature_pencil_json: jf.generate_ai_carricature_pencil_json,
  shuffling_json: jf.shuffling_json,
  save_single_user_unique_id_json: jf.save_single_user_unique_id_json,
  common_reset_json: jf.common_reset_json,
  common_reset_disable_json: jf.common_reset_disable_json,
  common_send_email_mailgun_json: mail.common_send_email_mailgun_json,
  common_send_email_mailgun_sql: mail.common_send_email_mailgun_sql,
  common_download_pdf: mail.common_download_pdf,
  common_send_email_mailgun_dynamodb_human_chain: dy.common_send_email_mailgun_dynamodb_human_chain,
  checkselfie_common_dynamodb_human_chain: dy.checkselfie_common_dynamodb_human_chain,
  user_game_setup_dynamodb: dy.user_game_setup_dynamodb,
  game_setup_dynamodb: dy.game_setup_dynamodb,
  common_update_dynamodb: dy.common_update_dynamodb,
  common_status_update_dynamodb: dy.common_status_update_dynamodb,
  common_send_sms_dynamodb: dy.common_send_sms_dynamodb,
  common_send_email_dynamodb: dy.common_send_email_dynamodb,
  common_check_unique_id_dynamodb: dy.common_check_unique_id_dynamodb,
  common_time_out_dynamodb: dy.common_time_out_dynamodb,
  reset_common_team_setting_dynamodb: dy.reset_common_team_setting_dynamodb,
  update_common_team_setting_dynamodb: dy.update_common_team_setting_dynamodb,
  updatelatest_common_dynamodb: dy.updatelatest_common_dynamodb,
  checkselfie_common_dynamodb: dy.checkselfie_common_dynamodb,
  generate_ai_carricature_pencil_dynamodb: dy.generate_ai_carricature_pencil_dynamodb,
  shuffling_dynamodb: dy.shuffling_dynamodb,
  save_single_user_unique_id_dynamodb: dy.save_single_user_unique_id_dynamodb,
  common_reset_dynamodb: dy.common_reset_dynamodb,
  common_reset_disable_dynamodb: dy.common_reset_disable_dynamodb,
  common_send_email_mailgun_dynamodb: dy.common_send_email_mailgun_dynamodb,
  upload_framed_image_dynamodb: dy.upload_framed_image_dynamodb,
  listallcommon_desc_dynamodb: dy.listallcommon_desc_dynamodb,
  fetch_game_detail_dynamodb: dy.fetch_game_detail_dynamodb,
  getlatest_common_dynamodb: dy.getlatest_common_dynamodb,
};

/** Actions that PHP served with Content-Type: application/json. */
export const JSON_ACTIONS = new Set(['greenverse_wishes', 'getlatest_common_list', 'updatelatest_common', 'get_greenverse_by_id']);

export async function commonAjax(req: PhpRequest): Promise<Response> {
  const action = toStr(req.REQUEST.action);
  const out = new Output();
  if (JSON_ACTIONS.has(action)) out.header('Content-Type', 'application/json; charset=utf-8');
  const handler = ACTIONS[action];
  // Unknown actions fall through every branch and produce an empty 200.
  if (!handler) return out.send();
  return handler({ req, out, R: req.REQUEST, P: req.POST });
}
