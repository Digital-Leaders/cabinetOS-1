// Garde-fou : les tests du front tournent dans un fuseau FIXE (test/jest.global-setup.js). S'il
// echoue, le fuseau n'est plus epingle et des tests de dates peuvent de nouveau reussir sur une
// machine et echouer sur une autre. Voir la raison dans jest.global-setup.js.

describe('fuseau du processus de test (front)', () => {
  it('est le MEME decalage toute l annee et pour toute date, sans exception', () => {
    // Ignore quand on essaie volontairement un autre fuseau avec TEST_TZ.
    if (process.env.TEST_TZ) return;
    const offsets = [
      '2026-01-15',
      '2026-03-01',
      '2026-07-15',
      '2026-10-19',
      '2030-06-01',
      '2040-12-31',
    ].map((day) => new Date(`${day}T12:00:00Z`).getTimezoneOffset());
    expect(new Set(offsets)).toEqual(new Set([-60]));
  });
});
