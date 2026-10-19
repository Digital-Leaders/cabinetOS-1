// Garde-fou : la suite de tests de l'API tourne dans un fuseau NON UTC (test/jest.global-setup.js).
// Si ce test echoue, le fuseau n'est plus epingle : les defauts de fuseau redeviennent invisibles
// sur les machines de CI, qui sont en UTC. Voir la raison dans jest.global-setup.js.

describe('fuseau du processus de test', () => {
  it('n est pas UTC, pour que les defauts de fuseau se voient', () => {
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).not.toBe(0);
  });

  it('y est DE FACON CONSTANTE : meme decalage en hiver, en ete et en octobre (zone a decalage fixe)', () => {
    // Un fuseau nomme comme Africa/Casablanca changerait selon la version de Node (voir
    // jest.global-setup.js) : ici, aucune exception ne doit exister, sinon un test de decalage
    // reussirait sur une version de Node et echouerait sur une autre.
    const offsets = ['2026-01-15', '2026-07-15', '2026-10-19', '2027-03-01'].map((day) =>
      new Date(`${day}T12:00:00Z`).getTimezoneOffset(),
    );
    expect(new Set(offsets).size).toBe(1);
    expect(offsets[0]).not.toBe(0);
  });
});
