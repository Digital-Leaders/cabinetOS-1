import { BetterAuthProviderAdapter } from '../../src/modules/identity/infrastructure/better-auth-provider.adapter';

// BUILD-004 etape 2 (ADR-0021 D2) : l'inscription HTTP native est fermee. Les tests
// creent donc leurs comptes par le seul chemin restant -- la creation cote serveur du
// port AuthProvider (appel interne Better-Auth) -- et non plus par
// POST /api/v1/auth/sign-up/email. Meme compte, meme session : seule la porte change.

export interface TestAccount {
  userId: string;
  /** En-tete Set-Cookie complet de la session ouverte. */
  setCookie: string;
  /** Valeur a passer dans l'en-tete Cookie d'une requete (nom=valeur). */
  cookie: string;
}

export async function createTestAccount(input: {
  email: string;
  password: string;
  name: string;
}): Promise<TestAccount> {
  const result = await new BetterAuthProviderAdapter().createAccount(input);
  if (!result.ok) {
    throw new Error(`Compte de test non cree : ${result.reason}`);
  }
  const setCookie = result.sessionCookies[0];
  return { userId: result.userId, setCookie, cookie: setCookie.split(';')[0] };
}
