import {
  MAX_REFUSAL_TEXT_LENGTH,
  normalizeForComparison,
  refusalFieldsAreDistinct,
} from '../../src/business/registration/domain/refusal-rules';

// BUILD-004 etape 2, EA-018 / TASK-065 : regles pures du refus (brief R8).

describe('refusalFieldsAreDistinct (garde contre le copier-coller du motif interne)', () => {
  it('deux textes differents : distincts', () => {
    expect(
      refusalFieldsAreDistinct(
        'Aucune fiche publique retrouvee, INPE invalide.',
        "Nous n'avons pas pu verifier votre activite. N'hesitez pas a nous contacter.",
      ),
    ).toBe(true);
  });

  it.each([
    ['textes identiques', 'Dossier incomplet', 'Dossier incomplet'],
    ['espaces autour differents', 'Dossier incomplet', '   Dossier incomplet  '],
    ['espaces internes differents', 'Dossier   incomplet', 'Dossier incomplet'],
    ['casse differente', 'DOSSIER INCOMPLET', 'dossier incomplet'],
    ['retours a la ligne', 'Dossier\nincomplet', 'Dossier incomplet'],
  ])('%s : le meme texte, donc REFUSE', (_label, a, b) => {
    expect(refusalFieldsAreDistinct(a, b)).toBe(false);
  });

  it('un message qui contient le motif MAIS dit autre chose est distinct (la responsabilite reste a l administrateur)', () => {
    expect(
      refusalFieldsAreDistinct(
        'Dossier incomplet',
        'Dossier incomplet : merci de nous recontacter.',
      ),
    ).toBe(true);
  });

  it('normalise espaces et casse', () => {
    expect(normalizeForComparison('  Bonjour   LE\nmonde ')).toBe('bonjour le monde');
  });

  it('borne de longueur : 2000 caracteres', () => {
    expect(MAX_REFUSAL_TEXT_LENGTH).toBe(2000);
  });
});
