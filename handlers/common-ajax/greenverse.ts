/** Greenverse actions of common-ajax.php (served with Content-Type: application/json). */
import { execute } from '@/lib/db';
import { getWelcomeMessageById } from '@/lib/welcome-messages';
import { intval, toStr } from '@/lib/php';
import { type Ctx, json } from './context';

export async function greenverse_wishes(ctx: Ctx) {
  const fetchAll = ctx.R.fetch_all !== undefined && ctx.R.fetch_all !== null && toStr(ctx.R.fetch_all) === '1';
  const entryType = ctx.R.entry_type !== undefined && ctx.R.entry_type !== null ? toStr(ctx.R.entry_type).trim().toLowerCase() : '';
  const orderBy = ctx.R.order_by !== undefined && ctx.R.order_by !== null ? toStr(ctx.R.order_by).trim().toLowerCase() : 'id_desc';
  let limit = ctx.R.limit !== undefined && ctx.R.limit !== null ? intval(ctx.R.limit) : 50;
  let offset = ctx.R.offset !== undefined && ctx.R.offset !== null ? intval(ctx.R.offset) : 0;
  if (limit <= 0) limit = 50;
  if (limit > 500) limit = 500;
  if (offset < 0) offset = 0;

  let where = "WHERE status='1'";
  if (entryType === 'new' || entryType === 'old') where += " AND entry_type='" + entryType + "'";

  let order = 'ORDER BY id DESC';
  if (orderBy === 'id_asc') order = 'ORDER BY id ASC';
  else if (orderBy === 'created_asc') order = 'ORDER BY created_at ASC, id ASC';
  else if (orderBy === 'created_desc') order = 'ORDER BY created_at DESC, id DESC';

  const base = `SELECT id, user_name, user_description,user_organization, welcome_message_id, user_state, created_at, entry_type FROM tblgreenverse ${where} ${order}`;
  let rows;
  try {
    rows = fetchAll ? (await execute(base)).rows : (await execute(base + ' LIMIT ? OFFSET ?', [limit, offset])).rows;
  } catch {
    return json(ctx, { status: 'error', message: 'Failed to execute query', wishes: [], count: 0 });
  }

  const wishes = rows.map((row) => {
    let message = row.user_description !== undefined && row.user_description !== null ? toStr(row.user_description).trim() : '';
    if (message === '' && row.welcome_message_id !== undefined && row.welcome_message_id !== null) {
      message = getWelcomeMessageById(row.user_state, row.welcome_message_id);
    }
    return {
      id: intval(row.id),
      name: row.user_name !== undefined && row.user_name !== null && toStr(row.user_name).trim() !== '' ? row.user_name : 'Guest',
      message,
      organization: row.user_organization !== undefined && row.user_organization !== null && toStr(row.user_organization).trim() !== '' ? row.user_organization : '',
      created_at: row.created_at !== undefined && row.created_at !== null ? row.created_at : '',
    };
  });
  return json(ctx, { status: 'success', wishes, count: wishes.length });
}

export async function get_greenverse_by_id(ctx: Ctx) {
  const id = ctx.R.id !== undefined && ctx.R.id !== null ? intval(ctx.R.id) : 0;
  if (id <= 0) return json(ctx, { status: 'error', message: 'Invalid id' });
  const { rows } = await execute('SELECT * FROM tblgreenverse WHERE id = ? LIMIT 1', [id]);
  if (rows.length > 0) {
    const row = { ...rows[0] };
    row.welcome_message = getWelcomeMessageById(row.user_state, row.welcome_message_id);
    return json(ctx, { status: 'success', data: row });
  }
  return json(ctx, { status: 'error', message: 'Not found' });
}
