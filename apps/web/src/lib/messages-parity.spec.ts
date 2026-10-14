import fr from '../messages/fr.json';
import ar from '../messages/ar.json';

// TASK-053 : chaque cle de traduction existe dans les deux langues -- un ecran ne doit
// jamais afficher une cle brute en arabe parce qu'elle n'existe qu'en francais.

function keys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('traductions FR / AR', () => {
  it('ont exactement les memes cles', () => {
    expect(keys(ar).sort()).toEqual(keys(fr).sort());
  });

  it('n ont aucune valeur vide', () => {
    for (const [lang, messages] of [
      ['fr', fr],
      ['ar', ar],
    ] as const) {
      const empty = keys(messages).filter(
        (path) =>
          path
            .split('.')
            .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], messages) === '',
      );
      expect({ lang, empty }).toEqual({ lang, empty: [] });
    }
  });
});
