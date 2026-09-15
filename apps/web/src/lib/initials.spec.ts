import { initials } from './initials';

// Corrige suite au retour de l'encadrant sur la cloture de l'etape 1 : deux
// organisations affichaient le meme monogramme "CA" dans le selecteur
// d'organisation (app-header.tsx avait sa propre fonction, 1re + DERNIERE
// lettre) alors qu'elles etaient distinguees ailleurs (choose-organization-view.tsx,
// settings-view.tsx, 1re + 2e lettre). Une seule fonction desormais.

describe('initials (monogramme partage)', () => {
  it('distingue deux organisations qui partagent la meme derniere lettre de mot (le cas signale)', () => {
    expect(initials('Cabinet El Amrani')).toBe('CE');
    expect(initials('Clinique Al Andalous')).toBe('CA');
    expect(initials('Cabinet El Amrani')).not.toBe(initials('Clinique Al Andalous'));
  });

  it('reste distinct pour des noms d organisation realistes a 3 mots', () => {
    // La maquette d'origine choisissait ses monogrammes a la main (pas de
    // formule unique : "Centre medical Ranya" y affichait "CR", pas "CM") --
    // l objectif ici n est pas de reproduire chaque exemple a l identique, mais
    // de garantir que des organisations differentes restent distinguables.
    expect(initials('Cabinet El Amrani')).toBe('CE');
    expect(initials('Clinique Al Andalous')).toBe('CA');
    expect(initials('Centre médical Ranya')).toBe('CM');
  });

  it('un nom de personne (prenom + nom) reste correct', () => {
    expect(initials('Youssef Bennani')).toBe('YB');
  });

  it('un seul mot : les deux premieres lettres de ce mot', () => {
    expect(initials('Solo')).toBe('SO');
  });
});
