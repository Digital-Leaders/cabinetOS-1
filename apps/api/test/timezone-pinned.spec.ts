// Garde-fou : la suite de tests de l'API tourne dans un fuseau NON UTC (test/jest.global-setup.js).
// Si ce test echoue, le fuseau n'est plus epingle : les defauts de fuseau redeviennent invisibles
// sur les machines de CI, qui sont en UTC. Voir la raison dans jest.global-setup.js.

describe('fuseau du processus de test', () => {
  it('n est pas UTC, pour que les defauts de fuseau se voient', () => {
    // Janvier : hors heure d'ete et hors Ramadan 2026 (18 fev.), donc le decalage est stable.
    expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).not.toBe(0);
  });
});
