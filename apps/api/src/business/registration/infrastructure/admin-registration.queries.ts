import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  FILTER_STATUSES,
  sortDirection,
  toSearchPatterns,
  type AdminFilter,
  type PageCursor,
} from '../domain/admin-list';
import { fromDbTimestamp } from './db-timestamps';

// BUILD-004 etape 2, EA-017 / TASK-059 : acces de l'ESPACE ADMIN aux demandes d'inscription
// (ADR-0021 D3). Lecture seule, a UNE exception : la note interne.
//
// Tables GLOBALES, hors RLS (exception assumee, ADR-0021 D1). Ces fonctions voient donc TOUTES
// les demandes : elles ne doivent etre appelees QUE depuis un endpoint @RequirePlatformAdmin()
// (admin-registration.controller.ts, marque au niveau de la CLASSE). Les endpoints du
// fondateur, eux, n'utilisent jamais ce fichier (voir registration.queries.ts).
//
// Les donnees DECLAREES par le fondateur ne sont jamais ecrites ici : l'administrateur
// examine une declaration, il ne la reecrit pas (brief §5.4, critere d'acceptation).

export interface AdminListItem {
  id: string;
  firstName: string;
  lastName: string;
  specialty: string;
  structureName: string;
  city: string;
  status: string;
  createdAt: Date;
}

export interface AdminListPage {
  items: AdminListItem[];
  /** Cle de tri de la derniere ligne, si une page suivante existe. */
  nextCursor: PageCursor | null;
}

export interface AdminCounts {
  /** « A traiter » : en verification ET complement demande. */
  pending: number;
  validated: number;
  refused: number;
}

/**
 * Une page de la liste, filtree et recherchee, par pagination a curseur (ADR-0008).
 * On lit `limit + 1` lignes : la ligne en trop dit qu'une page suivante existe, sans second
 * appel ni compteur.
 */
export async function listRegistrationRequests(
  db: NodePgDatabase,
  options: { filter: AdminFilter; query?: string; cursor?: PageCursor; limit: number },
): Promise<AdminListPage> {
  const direction = sortDirection(options.filter);
  const statuses = FILTER_STATUSES[options.filter].map((status) => sql`${status}`);

  const conditions: SQL[] = [sql`r.status IN (${sql.join(statuses, sql`, `)})`];

  // Chaque mot doit se retrouver (ET), dans n'importe quel ordre, dans nom + cabinet, sans
  // accents ni casse. Les valeurs sont toujours des parametres : jamais concatenees au SQL.
  for (const pattern of toSearchPatterns(options.query)) {
    conditions.push(sql`search_unaccent(lower(r.first_name || ' ' || r.last_name || ' ' || r.structure_name))
      LIKE search_unaccent(lower(${pattern})) ESCAPE '\\'`);
  }

  if (options.cursor) {
    const { createdAt, id } = options.cursor;
    conditions.push(
      direction === 'ASC'
        ? sql`(r.created_at, r.id) > (${createdAt}::timestamp, ${id}::uuid)`
        : sql`(r.created_at, r.id) < (${createdAt}::timestamp, ${id}::uuid)`,
    );
  }

  const order =
    direction === 'ASC' ? sql`r.created_at ASC, r.id ASC` : sql`r.created_at DESC, r.id DESC`;

  const result = await db.execute(sql`
    SELECT r.id, r.first_name, r.last_name, r.specialty, r.structure_name, r.city, r.status,
           r.created_at, r.created_at::text AS created_at_cursor
    FROM registration_requests r
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ${order}
    LIMIT ${options.limit + 1}
  `);

  const rows = result.rows as {
    id: string;
    first_name: string;
    last_name: string;
    specialty: string;
    structure_name: string;
    city: string;
    status: string;
    created_at: Date;
    created_at_cursor: string;
  }[];

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      specialty: row.specialty,
      structureName: row.structure_name,
      city: row.city,
      status: row.status,
      createdAt: fromDbTimestamp(row.created_at),
    })),
    nextCursor: hasMore && last ? { createdAt: last.created_at_cursor, id: last.id } : null,
  };
}

/** Compteurs des trois onglets (le badge « A traiter 3 » de la maquette), hors recherche. */
export async function countRegistrationRequests(db: NodePgDatabase): Promise<AdminCounts> {
  const result = await db.execute(
    sql`SELECT status, count(*)::int AS n FROM registration_requests GROUP BY status`,
  );
  const byStatus = new Map(
    (result.rows as { status: string; n: number }[]).map((row) => [row.status, row.n]),
  );
  const sum = (filter: AdminFilter) =>
    FILTER_STATUSES[filter].reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);
  return { pending: sum('pending'), validated: sum('validated'), refused: sum('refused') };
}

export interface AdminDetailRow {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  firstName: string;
  lastName: string;
  email: string;
  specialty: string;
  inpe: string | null;
  numeroOrdre: string | null;
  structureName: string;
  city: string;
  address: string | null;
  internalNote: string | null;
  complementRequestedInfo: string | null;
  complementMessage: string | null;
  refusalInternalReason: string | null;
  refusalMessageToApplicant: string | null;
  organizationId: string | null;
}

/**
 * Detail complet d'une demande, pour l'equipe. Contrairement au chemin du fondateur, le motif
 * interne de refus et la note interne SONT lus ici : c'est l'equipe qui les a ecrits. L'email est
 * en clair (l'equipe doit pouvoir contacter le demandeur) -- il vient de users, il n'est jamais
 * duplique dans la demande.
 */
export async function findRegistrationRequestDetail(
  db: NodePgDatabase,
  id: string,
): Promise<AdminDetailRow | null> {
  const result = await db.execute(sql`
    SELECT r.id, r.status, r.created_at, r.updated_at,
           r.first_name, r.last_name, u.email, r.specialty, r.inpe, r.numero_ordre,
           r.structure_name, r.city, r.address,
           r.internal_note, r.complement_requested_info, r.complement_message,
           r.refusal_internal_reason, r.refusal_message_to_applicant, r.organization_id
    FROM registration_requests r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ${id}
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    status: row.status as string,
    createdAt: fromDbTimestamp(row.created_at as Date | string),
    updatedAt: fromDbTimestamp(row.updated_at as Date | string),
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    email: row.email as string,
    specialty: row.specialty as string,
    inpe: (row.inpe as string | null) ?? null,
    numeroOrdre: (row.numero_ordre as string | null) ?? null,
    structureName: row.structure_name as string,
    city: row.city as string,
    address: (row.address as string | null) ?? null,
    internalNote: (row.internal_note as string | null) ?? null,
    complementRequestedInfo: (row.complement_requested_info as string | null) ?? null,
    complementMessage: (row.complement_message as string | null) ?? null,
    refusalInternalReason: (row.refusal_internal_reason as string | null) ?? null,
    refusalMessageToApplicant: (row.refusal_message_to_applicant as string | null) ?? null,
    organizationId: (row.organization_id as string | null) ?? null,
  };
}

export interface AdminHistoryEntry {
  id: string;
  action: string;
  createdAt: Date;
  /** Administrateur qui a agi ; null = le systeme ou le demandeur. */
  actor: { id: string; name: string } | null;
  emailTemplate: string | null;
  emailFailureRetryable: boolean | null;
}

/**
 * Historique (date, action, admin), du plus ancien au plus recent. registration_events ne
 * contient AUCUN contenu (ADR-0022) : rien d'autre a masquer ici.
 */
export async function findRegistrationHistory(
  db: NodePgDatabase,
  registrationRequestId: string,
): Promise<AdminHistoryEntry[]> {
  const result = await db.execute(sql`
    SELECT e.id, e.action, e.created_at, e.email_template, e.email_failure_retryable,
           e.actor_user_id, a.name AS actor_name
    FROM registration_events e
    LEFT JOIN users a ON a.id = e.actor_user_id
    WHERE e.registration_request_id = ${registrationRequestId}
    ORDER BY e.created_at ASC, e.id ASC
  `);
  return (
    result.rows as {
      id: string;
      action: string;
      created_at: Date;
      email_template: string | null;
      email_failure_retryable: boolean | null;
      actor_user_id: string | null;
      actor_name: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    action: row.action,
    createdAt: fromDbTimestamp(row.created_at),
    actor: row.actor_user_id ? { id: row.actor_user_id, name: row.actor_name ?? '' } : null,
    emailTemplate: row.email_template,
    emailFailureRetryable: row.email_failure_retryable,
  }));
}

/**
 * Note interne de verification (brief §5.4) : facultative, visible uniquement par l'equipe,
 * jamais communiquee au medecin. C'est la SEULE ecriture de l'espace admin en lecture : elle
 * ne touche ni le statut, ni les donnees declarees. Une note vide efface la note (NULL).
 */
export async function updateInternalNote(
  db: NodePgDatabase,
  id: string,
  note: string | null,
): Promise<{ internalNote: string | null; updatedAt: Date } | null> {
  const result = await db.execute(sql`
    UPDATE registration_requests
    SET internal_note = ${note}, updated_at = now()
    WHERE id = ${id}
    RETURNING internal_note, updated_at
  `);
  const row = result.rows[0] as { internal_note: string | null; updated_at: Date } | undefined;
  return row
    ? { internalNote: row.internal_note, updatedAt: fromDbTimestamp(row.updated_at) }
    : null;
}
