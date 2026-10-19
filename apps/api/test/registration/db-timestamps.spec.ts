import {
  fromDbTimestamp,
  fromDbTimestampOrNull,
} from '../../src/business/registration/infrastructure/db-timestamps';

// TASK-059 : lecture des horodatages ecrits par SQL direct. Le pilote de base renvoie du texte brut
// sans fuseau ; la convention du projet (ADR-0008) est de le lire comme de l'UTC, quel que soit le
// fuseau du processus Node. La suite tourne dans un fuseau NON UTC (jest.global-setup.js) : ces
// tests echoueraient avec un simple `new Date(texte)`.

describe('fromDbTimestamp', () => {
  it('lit le texte brut de la base comme de l UTC, jamais comme l heure locale du serveur', () => {
    expect(fromDbTimestamp('2026-10-19 14:21:02.695123').toISOString()).toBe(
      '2026-10-19T14:21:02.695Z',
    );
  });

  it('LE DEFAUT CORRIGE : un `new Date(texte)` naif serait decale dans ce fuseau', () => {
    const naive = new Date('2026-10-19 14:21:02.695123').toISOString();
    expect(naive).not.toBe('2026-10-19T14:21:02.695Z');
    expect(fromDbTimestamp('2026-10-19 14:21:02.695123').toISOString()).toBe(
      '2026-10-19T14:21:02.695Z',
    );
  });

  it('sans fraction de seconde', () => {
    expect(fromDbTimestamp('2026-01-05 08:00:00').toISOString()).toBe('2026-01-05T08:00:00.000Z');
  });

  it('une valeur qui porte deja son fuseau est lue telle quelle', () => {
    expect(fromDbTimestamp('2026-10-19 14:21:02+00').toISOString()).toBe(
      '2026-10-19T14:21:02.000Z',
    );
    expect(fromDbTimestamp('2026-10-19T14:21:02.500Z').toISOString()).toBe(
      '2026-10-19T14:21:02.500Z',
    );
    expect(fromDbTimestamp('2026-10-19 16:21:02+02:00').toISOString()).toBe(
      '2026-10-19T14:21:02.000Z',
    );
    expect(fromDbTimestamp('2026-10-19 15:21:02+0100').toISOString()).toBe(
      '2026-10-19T14:21:02.000Z',
    );
    expect(fromDbTimestamp('2026-10-19 14:21:02.123456-05').toISOString()).toBe(
      '2026-10-19T19:21:02.123Z',
    );
  });

  it('une Date passe telle quelle', () => {
    const date = new Date('2026-10-19T14:21:02.000Z');
    expect(fromDbTimestamp(date)).toBe(date);
  });

  it('ete comme hiver : la lecture ne depend jamais des changements d heure locaux', () => {
    expect(fromDbTimestamp('2026-07-01 12:00:00').toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(fromDbTimestamp('2026-01-01 12:00:00').toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });
});

describe('fromDbTimestampOrNull', () => {
  it('null et undefined restent null', () => {
    expect(fromDbTimestampOrNull(null)).toBeNull();
    expect(fromDbTimestampOrNull(undefined)).toBeNull();
  });
  it('une valeur est convertie', () => {
    expect(fromDbTimestampOrNull('2026-10-19 14:21:02')?.toISOString()).toBe(
      '2026-10-19T14:21:02.000Z',
    );
  });
});
