import type { AdminRequestDetail, RegistrationStatus } from '../../lib/admin-client';

// BUILD-004 etape 2, EA-017 / TASK-060 : fonctions de presentation de l'espace admin (pures,
// testables seules).

/** Les deux statuts « vivants » : la demande attend encore une decision de l'equipe. */
export function isOpenStatus(status: RegistrationStatus): boolean {
  return status === 'PENDING_VERIFICATION' || status === 'COMPLEMENT_REQUESTED';
}

/** Classe CSS du badge (maquette : verif / compl / ok / no). */
export function badgeClass(status: RegistrationStatus): 'verif' | 'compl' | 'ok' | 'no' {
  switch (status) {
    case 'PENDING_VERIFICATION':
      return 'verif';
    case 'COMPLEMENT_REQUESTED':
      return 'compl';
    case 'ACTIVE':
      return 'ok';
    case 'REFUSED':
      return 'no';
  }
}

/** Chiffres latins dans les deux langues : une date lisible partout, y compris en arabe. */
const LOCALE_TAGS: Record<string, string> = { fr: 'fr-FR', ar: 'ar-MA-u-nu-latn' };

/**
 * jj/mm/aaaa, dans le fuseau de l'utilisateur.
 *
 * `timeZone` est facultatif et NE SERT QU'AUX TESTS : sans lui (l'ecran ne le passe jamais),
 * l'heure locale de l'utilisateur s'applique, ce qui est voulu. Les tests le fixent a 'UTC' pour
 * ne dependre d'aucun fuseau de machine (le jour d'un meme instant change selon le fuseau).
 */
export function formatDate(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale] ?? 'fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

/** jj/mm, comme l'historique de la maquette (meme remarque sur `timeZone`). */
export function formatDayMonth(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale] ?? 'fr-FR', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------------------
// « Raccourcis de recherche » (brief §5.4) : des liens PRE-REMPLIS, ouverts par l'equipe, qui ne
// concluent jamais rien. Pas de source unique privilegiee : trois recherches generiques, sur le
// meme principe -- Google, Google Maps, et une recherche « annuaire medical » qui n'est liee a
// aucun annuaire en particulier.

const GOOGLE_SEARCH = 'https://www.google.com/search?q=';
const GOOGLE_MAPS = 'https://www.google.com/maps/search/?api=1&query=';

function words(parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}

export interface SearchShortcuts {
  google: string;
  maps: string;
  directory: string;
}

export function buildSearchShortcuts(
  detail: Pick<AdminRequestDetail, 'doctor' | 'structure'>,
  specialtyLabel: string,
  directoryWord: string,
): SearchShortcuts {
  const name = words([detail.doctor.firstName, detail.doctor.lastName]);
  const place = words([detail.structure.name, detail.structure.address, detail.structure.city]);
  return {
    google:
      GOOGLE_SEARCH + encodeURIComponent(words([name, specialtyLabel, detail.structure.city])),
    maps: GOOGLE_MAPS + encodeURIComponent(place),
    directory:
      GOOGLE_SEARCH +
      encodeURIComponent(words([directoryWord, name, specialtyLabel, detail.structure.city])),
  };
}
