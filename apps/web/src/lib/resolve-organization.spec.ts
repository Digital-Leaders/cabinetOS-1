import { resolveOrganization } from './resolve-organization';

// Parcours d'acces, etape 1, commit 2 -- "Le test doit prouver qu'on ne demande
// jamais de choisir quand il n'y a rien a choisir" (spec). Fonction pure : pas de
// mock necessaire.

describe('resolveOrganization (ADR-0019, commit 2)', () => {
  it('cas 1 -- une seule organisation : ouverture directe, quel que soit isDefault', () => {
    const result = resolveOrganization([
      { organizationId: 'org-1', organizationName: 'Cabinet A', isDefault: false },
    ]);
    expect(result).toEqual({ type: 'direct', organizationId: 'org-1' });
  });

  it('cas 2 -- plusieurs organisations avec un defaut : ouverture directe du defaut', () => {
    const result = resolveOrganization([
      { organizationId: 'org-1', organizationName: 'Cabinet A', isDefault: false },
      { organizationId: 'org-2', organizationName: 'Cabinet B', isDefault: true },
      { organizationId: 'org-3', organizationName: 'Cabinet C', isDefault: false },
    ]);
    expect(result).toEqual({ type: 'direct', organizationId: 'org-2' });
  });

  it('cas 3 -- plusieurs organisations, aucun defaut : ecran de choix', () => {
    const memberships = [
      { organizationId: 'org-1', organizationName: 'Cabinet A', isDefault: false },
      { organizationId: 'org-2', organizationName: 'Cabinet B', isDefault: false },
    ];
    const result = resolveOrganization(memberships);
    expect(result).toEqual({ type: 'choose', memberships });
  });

  it('ne demande jamais de choisir pour une seule organisation, meme si isDefault est absent/false', () => {
    const result = resolveOrganization([
      { organizationId: 'org-solo', organizationName: 'Solo Cabinet', isDefault: false },
    ]);
    expect(result.type).not.toBe('choose');
  });

  it('aucune organisation : signale (type "none"), jamais un ecran de choix vide', () => {
    const result = resolveOrganization([]);
    expect(result).toEqual({ type: 'none' });
  });
});
