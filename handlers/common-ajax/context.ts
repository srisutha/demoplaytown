import type { PhpRequest, Params } from '@/lib/http';
import { Output } from '@/lib/http';
import { jsonEncode, toStr } from '@/lib/php';

export interface Ctx {
  req: PhpRequest;
  out: Output;
  /** $_REQUEST */
  R: Params;
  /** $_POST */
  P: Params;
}

/** echo json_encode($v); exit; */
export function json(ctx: Ctx, v: unknown): Response {
  ctx.out.echo(jsonEncode(v));
  return ctx.out.send();
}

/** An action that echoes nothing and falls through to the end of the script. */
export function nothing(ctx: Ctx): Response {
  return ctx.out.send();
}

/** `@$_REQUEST['k']` */
export const req = (ctx: Ctx, k: string): any => (ctx.R[k] === undefined ? null : ctx.R[k]);

/** `isset($_REQUEST['k']) ? $_REQUEST['k'] : $d` */
export const reqOr = (ctx: Ctx, k: string, d: any): any => (ctx.R[k] === undefined || ctx.R[k] === null ? d : ctx.R[k]);

/** `$_POST['k']` */
export const post = (ctx: Ctx, k: string): any => (ctx.P[k] === undefined ? null : ctx.P[k]);

/**
 * Renders SQL the way PHP string interpolation did, for the handful of
 * responses that echo the query text back to the client. Each `?` becomes
 * the raw value (the surrounding quotes are already in the template).
 */
export function sqlText(template: string, values: unknown[]): string {
  let i = 0;
  return template.replace(/\?/g, () => toStr(values[i++]));
}

/**
 * A query written exactly as the PHP source interpolated it, with each
 * '$var' replaced by '?'. Returns the parameterised SQL to execute and the
 * literal text PHP would have produced (some responses echo it).
 */
export function phpSql(template: string, values: unknown[]) {
  return { sql: template.replace(/'\?'/g, '?'), text: sqlText(template, values), values };
}

/** Errors thrown by the AWS service (PHP caught these as DynamoDbException). */
export function isAwsServiceError(e: unknown): boolean {
  return !!e && typeof e === 'object' && '$metadata' in (e as object) && '$fault' in (e as object);
}
