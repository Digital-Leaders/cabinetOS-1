import { BadRequestException } from '@nestjs/common';

// BUILD-004 etape 2, EA-017 / TASK-059 : regles pures de la liste admin des demandes
// d'inscription (filtres, recherche, curseur). Sans dependance technique : testees seules.

/**
 * Les trois onglets de l'ecran admin (brief §5.3). « A traiter » regroupe les deux
 * sous-etats vivants, distingues par leurs badges a l'ecran.
 */
export const ADMIN_FILTERS = ['pending', 'validated', 'refused'] as const;
export type AdminFilter = (typeof ADMIN_FILTERS)[number];

/** « A traiter » par defaut (brief §5.3). */
export const DEFAULT_ADMIN_FILTER: AdminFilter = 'pending';

export const FILTER_STATUSES: Record<AdminFilter, readonly string[]> = {
  pending: ['PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED'],
  validated: ['ACTIVE'],
  refused: ['REFUSED'],
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/**
 * Sens du tri. Une file d'attente se traite dans l'ordre d'arrivee (la plus ancienne d'abord,
 * pour qu'aucune demande ne reste en bas de liste) ; les demandes closes se consultent par
 * ordre de recence.
 */
export function sortDirection(filter: AdminFilter): 'ASC' | 'DESC' {
  return filter === 'pending' ? 'ASC' : 'DESC';
}

// ---------------------------------------------------------------------------------------
// Recherche (nom, cabinet) : chaque mot doit se retrouver, dans n'importe quel ordre, sans
// tenir compte des accents ni de la casse. Les caracteres speciaux de LIKE sont echappes : un
// « % » saisi par l'utilisateur est un « % », jamais un joker.

export const MAX_SEARCH_LENGTH = 100;
const MAX_SEARCH_TERMS = 5;

export function toSearchPatterns(query: string | undefined): string[] {
  if (!query) return [];
  return query
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS)
    .map((term) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
}

// ---------------------------------------------------------------------------------------
// Curseur de pagination (ADR-0008) : opaque pour l'appelant. Il porte la cle de tri complete
// (date de creation a la MICROSECONDE, puis identifiant) : la date seule ne departage pas deux
// demandes creees dans la meme milliseconde, et une troncature a la milliseconde ferait
// sauter ou doubler des lignes.

export interface PageCursor {
  /** `created_at::text` de la derniere ligne renvoyee, tel que lu en base. */
  createdAt: string;
  id: string;
}

const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString('base64url');
}

export function decodeCursor(raw: string): PageCursor {
  const invalid = () => new BadRequestException('Curseur de pagination invalide.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw invalid();
  const [createdAt, id] = parsed;
  // Format verifie STRICTEMENT : ces deux valeurs finissent dans une requete SQL parametree
  // et sont recastees en base ; une valeur inattendue est refusee ici, avec un 400 propre.
  if (
    typeof createdAt !== 'string' ||
    typeof id !== 'string' ||
    !CREATED_AT_PATTERN.test(createdAt) ||
    !UUID_PATTERN.test(id)
  ) {
    throw invalid();
  }
  return { createdAt, id };
}
