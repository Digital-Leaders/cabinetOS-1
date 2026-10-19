import { needsStatusScreen, statusScreenPath } from './registration-access';

// TASK-057 (EA-016, ADR-0021 D4) : la regle de routage, a un seul endroit.

describe('needsStatusScreen (TASK-057)', () => {
  it.each([
    ['PENDING_VERIFICATION', true],
    ['COMPLEMENT_REQUESTED', true],
    ['REFUSED', true],
    ['ACTIVE', false],
  ])('%s -> ecran de statut : %s', (status, expected) => {
    expect(needsStatusScreen({ status: status as never })).toBe(expected);
  });

  it('compte SANS demande (equipe, demos de l etape 1) : jamais l ecran de statut', () => {
    expect(needsStatusScreen({ status: null })).toBe(false);
  });

  it('statut illisible (null / undefined) : pas de redirection, le serveur reste l autorite', () => {
    expect(needsStatusScreen(null)).toBe(false);
    expect(needsStatusScreen(undefined)).toBe(false);
  });

  it('un statut inconnu (futur) est traite comme non valide : on n ouvre pas l application par defaut', () => {
    expect(needsStatusScreen({ status: 'SUSPENDED' as never })).toBe(true);
  });

  it('le chemin de l ecran de statut garde la langue', () => {
    expect(statusScreenPath('ar')).toBe('/ar/registration-status');
    expect(statusScreenPath('fr')).toBe('/fr/registration-status');
  });
});
