import { Injectable } from '@nestjs/common';
import { APIError } from 'better-auth/api';
import type {
  AuthProvider,
  AuthenticatedIdentity,
  CreateAccountInput,
  CreateAccountResult,
} from '../application/auth-provider.port';
import { auth } from './auth';

// Codes d'erreur Better-Auth 1.6 traduits en refus attendus (verifies par spike).
const EMAIL_ALREADY_USED_CODES = new Set([
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
  'USER_ALREADY_EXISTS',
]);
const INVALID_PASSWORD_CODES = new Set(['PASSWORD_TOO_SHORT', 'PASSWORD_TOO_LONG']);

// TASK-014 : SEUL adaptateur autorise a referencer directement l API Better-Auth
// (avec auth.ts, qui definit l instance elle-meme). Toute autre partie de
// l application doit passer par l interface AuthProvider, jamais par ce fichier
// ni par Better-Auth directement -- verifie par le test de frontieres dedie.
@Injectable()
export class BetterAuthProviderAdapter implements AuthProvider {
  async verifySession(headers: Headers): Promise<AuthenticatedIdentity | null> {
    const session = await auth.api.getSession({ headers });
    if (!session) {
      return null;
    }
    return {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
  }

  async revokeSession(headers: Headers, sessionToken: string): Promise<void> {
    // TASK-015 : revocation explicite. Le renouvellement automatique, lui, est
    // natif a Better-Auth (option updateAge, activee par defaut) -- verifySession
    // ci-dessus declenche deja ce rafraichissement a chaque appel, sans code
    // supplementaire de notre part.
    await auth.api.revokeSession({ headers, body: { token: sessionToken } });
  }

  async createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
    // Appel INTERNE (sans requete HTTP) : autorise par le hook de auth.ts, qui ne
    // ferme que l'appel HTTP direct a /sign-up/email (ADR-0021 D2).
    try {
      const { headers, response } = await auth.api.signUpEmail({
        body: input,
        returnHeaders: true,
      });
      return { ok: true, userId: response.user.id, sessionCookies: headers.getSetCookie() };
    } catch (error) {
      const code = error instanceof APIError ? (error.body as { code?: string })?.code : undefined;
      if ((code && EMAIL_ALREADY_USED_CODES.has(code)) || isUniqueEmailViolation(error)) {
        return { ok: false, reason: 'EMAIL_ALREADY_USED' };
      }
      // Deux inscriptions simultanees sur le meme email : les deux passent le controle
      // d'existence de Better-Auth, puis la seconde bute sur l'unicite de users.email.
      // Better-Auth 1.6 masque alors l'erreur de base derriere un code generique
      // (FAILED_TO_CREATE_USER, constate par spike). Si un compte porte desormais cet
      // email, c'est bien un email deja utilise -- jamais une erreur technique.
      if (code === 'FAILED_TO_CREATE_USER' && (await emailNowTaken(input.email))) {
        return { ok: false, reason: 'EMAIL_ALREADY_USED' };
      }
      if (code && INVALID_PASSWORD_CODES.has(code)) {
        return { ok: false, reason: 'INVALID_PASSWORD' };
      }
      throw error;
    }
  }
}

async function emailNowTaken(email: string): Promise<boolean> {
  const context = await auth.$context;
  return (await context.internalAdapter.findUserByEmail(email.toLowerCase())) !== null;
}

// Filet supplementaire si une version de Better-Auth laissait remonter l'erreur de base
// telle quelle (23505 sur la contrainte d'unicite de users.email). Meme sens metier.
function isUniqueEmailViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth += 1) {
    const candidate = e as { code?: string; constraint?: string; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint?.includes('email')) return true;
    e = candidate.cause;
  }
  return false;
}
