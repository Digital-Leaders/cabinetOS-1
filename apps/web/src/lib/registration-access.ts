import type { RegistrationStatusView } from './registration-status-client';

// BUILD-004 etape 2, EA-016 / TASK-057 (ADR-0021 D4) : la regle de routage selon le statut,
// a UN seul endroit pour la connexion, l'accueil et l'ecran de statut.
//
// Seul un compte ACTIVE entre dans l'application. Un compte SANS demande (equipe, demos
// de l'etape 1) y entre aussi, exactement comme avant : le serveur repond `status: null`.
// Tout autre statut (en verification, complement demande, refuse) mene a l'ecran de statut.

export function needsStatusScreen(view: Pick<RegistrationStatusView, 'status'> | null | undefined) {
  return Boolean(view) && view!.status !== null && view!.status !== 'ACTIVE';
}

export function statusScreenPath(locale: string): string {
  return `/${locale}/registration-status`;
}
