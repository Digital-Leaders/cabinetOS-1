import * as medecinPublicSurface from '../../src/business/medecin';

// BUILD-004 etape 2, EA-018 / TASK-061 (ADR-0023) : la surface publique du module Medecin est figee
// PAR LISTE EXACTE.
//
// L'invariant d'origine de TASK-047 (« aucune fonction d'ecriture exportee ») a ete RETRECI par
// ADR-0023 : `createMedecinInTx` est la SEULE ecriture exportee. Ce test echoue si une autre
// fonction d'ecriture -- mise a jour, creation hors transaction, suppression -- apparait un jour
// dans index.ts : il faudrait alors un nouvel ADR de revision, pas un ajout silencieux.

describe('surface publique du module Medecin (ADR-0023)', () => {
  const exported = Object.keys(medecinPublicSurface).sort();

  it('exporte EXACTEMENT ces noms, ni plus ni moins', () => {
    expect(exported).toEqual(
      [
        'MedecinModule',
        'createMedecinInTx', // la seule ecriture, exigeant une transaction scopee (ADR-0023)
        'findMedecinSummaryById',
        'medecinSpecialtyEnum',
        'medecins',
      ].sort(),
    );
  });

  it('createMedecinInTx est la SEULE fonction d ecriture exportee', () => {
    const writers = exported.filter((name) =>
      /^(create|update|delete|remove|save|upsert|insert|set|soft)/i.test(name),
    );
    expect(writers).toEqual(['createMedecinInTx']);
  });

  it.each(['updateMedecin', 'createMedecin', 'deleteMedecin', 'softDeleteMedecin'])(
    '%s n est PAS exportee (creation hors transaction, mise a jour et suppression restent internes)',
    (name) => {
      expect(name in medecinPublicSurface).toBe(false);
    },
  );

  it('createMedecinInTx est bien une fonction', () => {
    expect(typeof medecinPublicSurface.createMedecinInTx).toBe('function');
  });
});
