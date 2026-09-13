// Parcours d'acces, etape 1, commit 2 : le mecanisme reel arrive -- le cookie est
// desormais pose par la resolution d'organisation a la connexion
// (resolve-organization.ts, appele depuis LoginForm) et par l ecran de choix
// (choose-organization-view.tsx), plutot que suppose par un flux futur.

const ORGANIZATION_COOKIE = 'cabinetos_organization_id';

export function getOrganizationId(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${ORGANIZATION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Cookie non httpOnly (lisible/modifiable en JS cote client) : il ne porte qu une
// preference d affichage (quelle organisation ouvrir), jamais une autorisation --
// la securite reelle reste entierement cote API (chaque requete revalide la
// permission de l utilisateur dans cette organisation precise, guard deja en
// place). SameSite=Lax, 1 an : une simple commodite de navigation, pas une donnee
// sensible.
export function setOrganizationId(organizationId: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${ORGANIZATION_COOKIE}=${encodeURIComponent(organizationId)}; path=/; max-age=31536000; SameSite=Lax`;
}
