import { needsStatusScreen, statusScreenPath } from './registration-access';

// BUILD-004 etape 2, EA-016 / TASK-057 : redirection cote SERVEUR a l'arrivee sur l'accueil.
//
// Cas vise : un fondateur dont la session est encore valide (elle dure des jours) revient sur
// le site. proxy.ts le renvoie de /login vers l'accueil ; sans ce controle il y trouverait un
// espace vide au lieu de son ecran de statut. Aucun clignotement : la redirection a lieu
// avant tout rendu.
//
// ECHEC OUVERT, volontairement : si le statut est illisible (API lente, indisponible,
// reponse inattendue), on laisse l'accueil s'afficher. Ce n'est pas une faille : cette
// redirection n'est qu'un confort de navigation. La protection reelle est cote API
// (TASK-056, PermissionsGuard) et refuse toute donnee a un non-ACTIVE quoi que fasse le front.

export interface LandingDeps {
  fetchImpl?: typeof fetch;
  apiUrl?: string;
  timeoutMs?: number;
}

export async function findStatusRedirect(
  locale: string,
  cookieHeader: string,
  deps: LandingDeps = {},
): Promise<string | null> {
  if (!cookieHeader) return null;
  const apiUrl = deps.apiUrl ?? process.env.API_URL ?? 'http://localhost:3000';
  try {
    const response = await (deps.fetchImpl ?? fetch)(
      `${apiUrl}/api/v1/identity/registration-status`,
      {
        headers: { cookie: cookieHeader },
        cache: 'no-store',
        signal: AbortSignal.timeout(deps.timeoutMs ?? 3000),
      },
    );
    if (!response.ok) return null;
    const body = await response.json();
    return needsStatusScreen(body?.data) ? statusScreenPath(locale) : null;
  } catch {
    return null;
  }
}
