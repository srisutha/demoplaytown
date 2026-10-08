/**
 * MySQL access with the same value types PHP produced:
 *  - query():   like mysqli::query()          -> every column is a string (or null)
 *  - execute(): like mysqli prepared + get_result() / PDO on PHP 8.1
 *               -> integers and floats are numbers, DECIMAL and dates are strings
 * Values are always bound as parameters (the PHP code interpolated them).
 */
import mysql, { type Pool, type TypeCast } from 'mysql2/promise';
import { db as mainCfg, humanchainDb as hcCfg } from './config';

type Row = Record<string, any>;

export interface QueryResult {
  rows: Row[];
  affectedRows: number;
  insertId: number;
}

const stringCast: TypeCast = (field, next) => {
  if (field.type === 'GEOMETRY') return next();
  // TEXT columns are reported as BLOB types; string() decodes with the column charset.
  return field.string();
};

const nativeCast: TypeCast = (field, next) => {
  switch (field.type) {
    case 'TINY':
    case 'SHORT':
    case 'LONG':
    case 'INT24':
    case 'YEAR': {
      const s = field.string();
      return s === null ? null : Number(s);
    }
    case 'LONGLONG': {
      const s = field.string();
      if (s === null) return null;
      const n = Number(s);
      return Number.isSafeInteger(n) ? n : s;
    }
    case 'FLOAT':
    case 'DOUBLE': {
      const s = field.string();
      return s === null ? null : Number(s);
    }
    default:
      return stringCast(field, next);
  }
};

function makePool(cfg: typeof mainCfg): Pool {
  return mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    charset: cfg.charset,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectionLimit: 10,
    waitForConnections: true,
  });
}

const g = globalThis as unknown as { __ptMain?: Pool; __ptHc?: Pool };

export function mainPool(): Pool {
  return (g.__ptMain ??= makePool(mainCfg));
}

export function humanchainPool(): Pool {
  return (g.__ptHc ??= makePool(hcCfg));
}

async function run(pool: Pool, sql: string, params: any[], typeCast: TypeCast): Promise<QueryResult> {
  const [res] = await pool.query({ sql, values: params, typeCast });
  if (Array.isArray(res)) return { rows: res as Row[], affectedRows: 0, insertId: 0 };
  const header = res as mysql.ResultSetHeader;
  return { rows: [], affectedRows: header.affectedRows, insertId: header.insertId };
}

/** mysqli::query() semantics – all columns come back as strings. */
export function query(sql: string, params: any[] = [], pool: Pool = mainPool()) {
  return run(pool, sql, params, stringCast);
}

/** Prepared-statement / PDO semantics – native ints and floats. */
export function execute(sql: string, params: any[] = [], pool: Pool = mainPool()) {
  return run(pool, sql, params, nativeCast);
}

/** Escapes a table identifier that came from the TABLE_CONSTANTS whitelist. */
export function ident(name: string): string {
  return mysql.escapeId(name);
}
