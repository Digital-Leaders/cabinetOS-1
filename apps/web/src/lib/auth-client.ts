// Client d'authentification minimal, meme esprit que api-client.ts : appels directs
// aux routes REST de Better-Auth (deja actives cote backend, TASK-013), sans le SDK
// client officiel -- confirme empiriquement avant d'ecrire ce fichier (sign-in/email,
// get-session, sign-out repondent tous en 200, avec le corps documente ci-dessous).
// Meme passerelle que apiFetch : /api/v1/auth/... passe par le rewrite Next.js,
// meme origine du point de vue du navigateur, cookie de session (httpOnly) transmis
// automatiquement par le navigateur.

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthSession {
  session: { id: string; userId: string; expiresAt: string };
  user: AuthUser;
}

export class AuthError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

// Connexion (etape 1) : e-mail + mot de passe uniquement. Une reponse non-ok signifie
// systematiquement des identifiants invalides pour Better-Auth ici (401,
// INVALID_EMAIL_OR_PASSWORD) -- jamais un 500 brut ne doit atteindre l ecran (verifie
// par les tests de comportement de LoginForm).
export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const response = await fetch('/api/v1/auth/sign-in/email', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AuthError(
      body?.message ?? 'E-mail ou mot de passe incorrect.',
      body?.code ?? undefined,
    );
  }
  return body.user as AuthUser;
}

// Session courante : null si absente/expiree (jamais une erreur -- une absence de
// session est un etat normal, pas un echec).
export async function getSession(): Promise<AuthSession | null> {
  const response = await fetch('/api/v1/auth/get-session', {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    return null;
  }
  const body = await response.json().catch(() => null);
  return body as AuthSession | null;
}

// Deconnexion : Better-Auth invalide la session cote serveur (verifie : get-session
// renvoie null juste apres). Le retour a l ecran de connexion est gere par l appelant
// (AppHeader), pas ici.
export async function signOut(): Promise<void> {
  await fetch('/api/v1/auth/sign-out', {
    method: 'POST',
    credentials: 'include',
  });
}
