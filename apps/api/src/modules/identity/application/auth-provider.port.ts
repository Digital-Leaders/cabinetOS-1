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
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
