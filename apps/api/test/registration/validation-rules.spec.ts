import { medecinSpecialtyEnum } from '../../src/business/medecin';
import {
  ACTIVATION_EMAIL_LOCALE,
  assertFounderRole,
  buildLoginUrl,
  slugCandidate,
  slugify,
  toMedecinSpecialty,
} from '../../src/business/registration/domain/validation-rules';

// BUILD-004 etape 2, EA-018 / TASK-063 : regles pures de la cascade de validation.

describe('slugify (ADR-0021 D7)', () => {
  it.each([
    ['Cabinet Dr Bennani', 'cabinet-dr-bennani'],
    ['Clinique Al Andalous', 'clinique-al-andalous'],
    ['Centre médical Ranya', 'centre-medical-ranya'],
    ['  Cabinet   du   Dr  Élodie  ', 'cabinet-du-dr-elodie'],
    ["Clinique L'Océan & Fils (Fès)", 'clinique-l-ocean-fils-fes'],
    ['عيادة الدكتور بناني', 'organisation'],
    ['???', 'organisation'],
    ['', 'organisation'],
  ])('%j -> %j', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it('borne la longueur et ne finit jamais par un tiret', () => {
    const slug = slugify(`${'a'.repeat(48)} b c d`);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug).not.toMatch(/-$/);
    expect(slugify('x'.repeat(200)).length).toBe(50);
  });

  it('ne produit que des minuscules, chiffres et tirets : un slug sur', () => {
    for (const name of [
      '<script>alert(1)</script>',
      "Robert'); DROP TABLE organizations;--",
      '../../etc/passwd',
    ]) {
      expect(slugify(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe('slugCandidate : suffixe anti-collision', () => {
  it('le premier candidat est le slug seul ; ensuite -2, -3...', () => {
    expect(slugCandidate('cabinet-bennani', 1)).toBe('cabinet-bennani');
    expect(slugCandidate('cabinet-bennani', 2)).toBe('cabinet-bennani-2');
    expect(slugCandidate('cabinet-bennani', 10)).toBe('cabinet-bennani-10');
  });

  it('le suffixe tient dans la limite de longueur, meme pour un tres long slug', () => {
    const base = slugify('x'.repeat(200));
    expect(slugCandidate(base, 3).length).toBeLessThanOrEqual(50);
    expect(slugCandidate(base, 3)).toMatch(/-3$/);
  });
});

describe('toMedecinSpecialty (ADR-0021 D7)', () => {
  it('« generaliste » devient NULL : le modele Medecin represente un generaliste par une specialite NULL', () => {
    expect(toMedecinSpecialty('generaliste')).toBeNull();
  });

  it('chaque specialite du module Medecin est conservee telle quelle', () => {
    for (const code of medecinSpecialtyEnum.enumValues) {
      expect(toMedecinSpecialty(code)).toBe(code);
    }
  });

  it('une specialite inconnue est refusee : on n ecrit jamais une fiche avec une valeur inventee', () => {
    expect(() => toMedecinSpecialty('astrologie')).toThrow(/Specialite inconnue/);
    expect(() => toMedecinSpecialty('')).toThrow();
  });
});

describe('buildLoginUrl', () => {
  it('adresse du site + langue + /login, en francais par defaut', () => {
    expect(ACTIVATION_EMAIL_LOCALE).toBe('fr');
    expect(buildLoginUrl('https://app.portesante.ma')).toBe('https://app.portesante.ma/fr/login');
  });

  it('un slash final dans la configuration ne produit pas de « // »', () => {
    expect(buildLoginUrl('https://app.portesante.ma/')).toBe('https://app.portesante.ma/fr/login');
    expect(buildLoginUrl('http://localhost:3001///')).toBe('http://localhost:3001/fr/login');
  });

  it('la langue peut etre precisee', () => {
    expect(buildLoginUrl('https://app.portesante.ma', 'ar')).toBe(
      'https://app.portesante.ma/ar/login',
    );
  });
});

describe('assertFounderRole', () => {
  it('retourne le role quand il existe', () => {
    const role = { id: 'r1', name: 'fondateur' };
    expect(assertFounderRole(role)).toBe(role);
  });

  it.each([undefined, null])(
    'role absent (%s) : erreur claire de deploiement, rien n est cree',
    (missing) => {
      expect(() => assertFounderRole(missing)).toThrow(/migration 0025/);
    },
  );
});
