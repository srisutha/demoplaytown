/** Replacement for PHP's $_SESSION (session_start() in db.php). */
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { SESSION_SECRET } from './config';

export interface PhpSession {
  id?: string | number;
  user_name?: string | null;
  user_phone?: string;
  /** admin/login.php */
  user?: string;
}

function options(): SessionOptions {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
  }
  return {
    password: SESSION_SECRET,
    cookieName: 'playtown_session',
    cookieOptions: { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
  };
}

export async function getSession() {
  return getIronSession<PhpSession>(await cookies(), options());
}
