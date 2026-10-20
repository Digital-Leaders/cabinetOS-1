import { medecinSpecialtyEnum } from '../../medecin';
import { GENERALISTE } from './registration-rules';

// BUILD-004 etape 2, EA-018 / TASK-063 : regles pures de la cascade de validation d'une inscription
// (brief R4, R5 ; ADR-0021 D5, D7). Sans dependance technique : testees seules.

// ---------------------------------------------------------------------------------------
// Slug de l'organisation (ADR-0021 D7) : genere depuis le nom de la structure, avec suffixe en cas
// de collision (le slug est unique).

const MAX_SLUG_LENGTH = 50;
const FALLBACK_SLUG = 'organisation';

/** « Clinique Al Andalous » -> « clinique-al-andalous » ; sans accents, ni symboles. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug || FALLBACK_SLUG;
}

/** Candidat n°1 = le slug seul ; n°2 et suivants = suffixe « -2 », « -3 »... */
export function slugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
}

// ---------------------------------------------------------------------------------------
// Specialite (ADR-0021 D7) : la demande stocke un choix EXPLICITE « generaliste » ; le modele Medecin
// represente un generaliste par une specialite NULL. La cascade traduit.

type MedecinSpecialtyValue = (typeof medecinSpecialtyEnum.enumValues)[number];

export function toMedecinSpecialty(code: string): MedecinSpecialtyValue | null {
  if (code === GENERALISTE) return null;
  if ((medecinSpecialtyEnum.enumValues as readonly string[]).includes(code)) {
    return code as MedecinSpecialtyValue;
  }
  // Ne devrait jamais arriver (la liste est validee a l'inscription) : on refuse plutot que d'ecrire
  // une fiche medecin avec une specialite inventee.
  throw new Error(`Specialite inconnue dans la demande : « ${code} ».`);
}

// ---------------------------------------------------------------------------------------
// Email d'activation : lien « Se connecter ».

/** Langue de l'email : le francais (la langue du fondateur n'est pas enregistree en V1). */
export const ACTIVATION_EMAIL_LOCALE = 'fr';

export function buildLoginUrl(
  appBaseUrl: string,
  locale: string = ACTIVATION_EMAIL_LOCALE,
): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/${locale}/login`;
}

// ---------------------------------------------------------------------------------------
// Le role fondateur est seme par la migration 0025. S'il manque, c'est une erreur de DEPLOIEMENT, a
// dire clairement : on n'invente pas de role et on ne cree rien.

export function assertFounderRole<T extends { id: string }>(role: T | undefined | null): T {
  if (!role) {
    throw new Error(
      "Le role « fondateur » est introuvable : la migration 0025 n'a pas ete appliquee. Aucune validation n'est possible tant qu'elle ne l'est pas.",
    );
  }
  return role;
}
