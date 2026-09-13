import type { OrganizationMembership } from './identity-client';

// Parcours d'acces, etape 1, commit 2 -- les 3 cas de la spec, en une fonction
// pure et testable independamment de React/du reseau :
// - 1 organisation -> ouverture directe (quel que soit son isDefault -- ADR-0019).
// - Plusieurs, une avec isDefault -> ouverture de celle-ci.
// - Plusieurs, aucun defaut -> ecran de choix.
// "Ne jamais demander de choisir quand il n'y a rien a choisir" (spec) : le cas
// choose ne peut se produire qu avec au moins 2 organisations ET aucun defaut --
// jamais pour 0 ou 1 organisation.

export type OrganizationResolution =
  | { type: 'direct'; organizationId: string }
  | { type: 'choose'; memberships: OrganizationMembership[] }
  | { type: 'none' };

export function resolveOrganization(memberships: OrganizationMembership[]): OrganizationResolution {
  if (memberships.length === 0) {
    // Aucune organisation : hors perimetre de l etape 1 (comptes crees par
    // l equipe, toujours avec au moins une adhesion) -- signale, pas improvise.
    return { type: 'none' };
  }
  if (memberships.length === 1) {
    return { type: 'direct', organizationId: memberships[0].organizationId };
  }
  const defaultMembership = memberships.find((m) => m.isDefault);
  if (defaultMembership) {
    return { type: 'direct', organizationId: defaultMembership.organizationId };
  }
  return { type: 'choose', memberships };
}
