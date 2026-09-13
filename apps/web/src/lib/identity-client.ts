// Client pour les endpoints Identity qui alimentent la resolution d'organisation
// a la connexion (ADR-0019, commit 2) -- distinct de auth-client.ts (routes
// natives Better-Auth) : ceux-ci sont des endpoints NestJS ordinaires
// (@RequireAuthentication(), jamais @RequirePermission() -- aucune organisation
// n est encore selectionnee a ce stade).

export interface OrganizationMembership {
  organizationId: string;
  organizationName: string;
  isDefault: boolean;
}

export async function fetchMyOrganizations(): Promise<OrganizationMembership[]> {
  const response = await fetch('/api/v1/identity/organizations', {
    method: 'GET',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Impossible de recuperer les organisations.');
  }
  const body = await response.json();
  return body.data as OrganizationMembership[];
}

// Ecran 2 (choix d'organisation) : "Ouvrir directement l'organisation choisie a
// l'avenir". Le serveur refuse (400) si organizationId ne correspond a aucune
// adhesion reelle de l utilisateur -- sur par construction (ADR-0019), jamais
// suppose ici.
export async function setDefaultOrganization(organizationId: string): Promise<void> {
  const response = await fetch(`/api/v1/identity/organizations/${organizationId}/default`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error("Impossible de definir l'organisation par defaut.");
  }
}
