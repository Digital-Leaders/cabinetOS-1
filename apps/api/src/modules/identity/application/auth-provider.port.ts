// TASK-014 : interface d abstraction d authentification (ADR-007).
// Isole le reste de l application derriere ce port, pour permettre un repli
// vers Keycloak sans reecrire les modules consommateurs. Aucun module autre que
// l adaptateur (infrastructure/better-auth-provider.adapter.ts) ne doit importer
// directement l API Better-Auth -- verifie par un test de frontieres dedie.

export interface AuthenticatedIdentity {
  userId: string;
  email: string;
  name: string;
}

export interface AuthProvider {
  /**
   * Verifie la session a partir des en-tetes HTTP bruts de la requete
   * (cookie de session inclus). Retourne l identite resolue, ou null si
   * aucune session valide n est trouvee.
   */
  verifySession(headers: Headers): Promise<AuthenticatedIdentity | null>;

  /**
   * Revoque explicitement une session (TASK-015). La session redevient
   * immediatement invalide sur toute requete suivante utilisant son cookie.
   * Hors perimetre : revocation de masse (toutes les sessions d un utilisateur).
   */
  revokeSession(headers: Headers, sessionToken: string): Promise<void>;

  /**
   * Cree un compte cote serveur (BUILD-004 etape 2, ADR-0021 D2) et ouvre sa
   * session. C'est le SEUL chemin de creation de compte : l'inscription HTTP
   * native est fermee (hook dans auth.ts). Les appelants sont le cas d'usage
   * d'inscription du fondateur et le script des comptes d'equipe.
   *
   * Ne leve pas pour les refus attendus (email deja pris, mot de passe refuse) :
   * ils reviennent en resultat, pour que l'appelant decide du message.
   */
  createAccount(input: CreateAccountInput): Promise<CreateAccountResult>;
}

export interface CreateAccountInput {
  email: string;
  password: string;
  name: string;
}

export type CreateAccountResult =
  | {
      ok: true;
      userId: string;
      /** En-tetes Set-Cookie de la session ouverte, a transmettre tels quels. */
      sessionCookies: string[];
    }
  | { ok: false; reason: 'EMAIL_ALREADY_USED' | 'INVALID_PASSWORD' };

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
