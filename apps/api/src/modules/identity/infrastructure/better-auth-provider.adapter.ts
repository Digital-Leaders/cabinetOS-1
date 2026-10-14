import { Injectable } from '@nestjs/common';
import type { AuthProvider, AuthenticatedIdentity } from '../application/auth-provider.port';
import { auth } from './auth';

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
}
