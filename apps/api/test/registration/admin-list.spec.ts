import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import {
  ADMIN_FILTERS,
  DEFAULT_ADMIN_FILTER,
  FILTER_STATUSES,
  decodeCursor,
  encodeCursor,
  sortDirection,
  toSearchPatterns,
} from '../../src/business/registration/domain/admin-list';
import { AdminRegistrationController } from '../../src/business/registration/presentation/admin-registration.controller';
import { REQUIRE_PLATFORM_ADMIN_KEY } from '../../src/modules/shared/presentation/require-platform-admin.decorator';
import { REGISTRATION_STATUSES } from '../../src/business/registration';

// BUILD-004 etape 2, EA-017 / TASK-059 : regles pures de la liste admin, et garde-fou statique
// sur la protection du controleur. Les routes admin voient TOUTES les demandes (tables hors RLS) :
// leur seule protection est @RequirePlatformAdmin(), qui ne doit jamais disparaitre.

describe('filtres de la liste admin (brief §5.3)', () => {
  it('« A traiter » est le filtre par defaut et regroupe les deux sous-etats vivants', () => {
    expect(DEFAULT_ADMIN_FILTER).toBe('pending');
    expect(FILTER_STATUSES.pending).toEqual(['PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED']);
  });

  it('les trois onglets couvrent chaque statut exactement une fois : aucune demande invisible ni doublee', () => {
    const covered = ADMIN_FILTERS.flatMap((filter) => [...FILTER_STATUSES[filter]]);
    expect([...covered].sort()).toEqual([...REGISTRATION_STATUSES].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it('la file a traiter va de la plus ancienne a la plus recente ; les demandes closes, du plus recent', () => {
    expect(sortDirection('pending')).toBe('ASC');
    expect(sortDirection('validated')).toBe('DESC');
    expect(sortDirection('refused')).toBe('DESC');
  });
});

describe('toSearchPatterns', () => {
  it('sans recherche : aucun motif', () => {
    expect(toSearchPatterns(undefined)).toEqual([]);
    expect(toSearchPatterns('')).toEqual([]);
    expect(toSearchPatterns('   ')).toEqual([]);
  });

  it('un motif par mot : l ordre des mots n a aucune importance', () => {
    expect(toSearchPatterns('  Youssef   Bennani ')).toEqual(['%Youssef%', '%Bennani%']);
  });

  it('les caracteres speciaux de LIKE sont echappes : « % » et « _ » ne sont jamais des jokers', () => {
    expect(toSearchPatterns('100%')).toEqual(['%100\\%%']);
    expect(toSearchPatterns('a_b')).toEqual(['%a\\_b%']);
    expect(toSearchPatterns('\\')).toEqual(['%\\\\%']);
  });

  it('borne le nombre de mots et la longueur : pas de requete demesuree', () => {
    expect(toSearchPatterns('a b c d e f g h')).toHaveLength(5);
    expect(toSearchPatterns('x'.repeat(500))[0]).toHaveLength(100 + 2);
  });
});

describe('curseur de pagination (ADR-0008)', () => {
  const cursor = {
    createdAt: '2026-10-19 14:21:02.695123',
    id: '01a13bd2-d439-7d64-be45-a77893aa0421',
  };

  it('aller-retour exact, microsecondes comprises', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('opaque : ce n est pas une date lisible', () => {
    expect(encodeCursor(cursor)).not.toContain('2026');
  });

  it('accepte une date sans fraction de seconde', () => {
    const noFraction = { ...cursor, createdAt: '2026-10-19 14:21:02' };
    expect(decodeCursor(encodeCursor(noFraction))).toEqual(noFraction);
  });

  it.each([
    ['du texte quelconque', 'pas-un-curseur'],
    ['du JSON qui n est pas un couple', Buffer.from('{"a":1}').toString('base64url')],
    ['un couple de mauvaise taille', Buffer.from('["2026-10-19 14:21:02"]').toString('base64url')],
    ['une date invalide', Buffer.from(JSON.stringify(['demain', cursor.id])).toString('base64url')],
    [
      'un identifiant invalide',
      Buffer.from(JSON.stringify([cursor.createdAt, 'x'])).toString('base64url'),
    ],
    [
      'une tentative d injection dans la date',
      Buffer.from(JSON.stringify(["2026-10-19'; DROP TABLE users;--", cursor.id])).toString(
        'base64url',
      ),
    ],
    [
      'une tentative d injection dans l identifiant',
      Buffer.from(JSON.stringify([cursor.createdAt, "x'; DROP TABLE users;--"])).toString(
        'base64url',
      ),
    ],
    ['des types inattendus', Buffer.from(JSON.stringify([1, 2])).toString('base64url')],
  ])('refuse %s avec un 400 propre', (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(BadRequestException);
  });
});

describe('protection du controleur admin : fermee par construction', () => {
  it('@RequirePlatformAdmin() est pose au niveau de la CLASSE', () => {
    expect(Reflect.getMetadata(REQUIRE_PLATFORM_ADMIN_KEY, AdminRegistrationController)).toBe(true);
  });

  it('chaque route de la classe est donc reservee a l equipe, y compris une route ajoutee demain', () => {
    const routes = Object.getOwnPropertyNames(AdminRegistrationController.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const route of routes) {
      const handler = AdminRegistrationController.prototype[route as never] as unknown as object;
      const marked =
        Reflect.getMetadata(REQUIRE_PLATFORM_ADMIN_KEY, handler) ??
        Reflect.getMetadata(REQUIRE_PLATFORM_ADMIN_KEY, AdminRegistrationController);
      expect({ route, marked }).toEqual({ route, marked: true });
    }
  });
});
