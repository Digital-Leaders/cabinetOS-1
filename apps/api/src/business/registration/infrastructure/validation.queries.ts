import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// BUILD-004 etape 2, EA-018 / TASK-063 : requetes de la CASCADE DE VALIDATION d'une inscription
// (brief R4, ADR-0021 D5) et du renvoi de l'email d'activation (R6).
//
// Les fonctions de la premiere partie recoivent la TRANSACTION de l'appelant (`tx`) : elles ne
// s'executent qu'a l'interieur de la cascade, qui reussit ou echoue d'un bloc. Tables registration_*
// et organizations : hors RLS (exception assumee, ADR-0021 D1) ; les ecritures dans memberships et
// medecins, elles, passent par les fonctions de leurs modules (createMembershipInTx, createMedecinInTx).

/** Statuts depuis lesquels une demande peut etre validee (brief : « transitions »). */
export const VALIDATABLE_STATUSES = ['PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED'] as const;

export interface RequestToValidate {
  id: string;
  userId: string;
  status: string;
  firstName: string;
  lastName: string;
  email: string;
  specialty: string;
  inpe: string | null;
  numeroOrdre: string | null;
  structureName: string;
  city: string;
  address: string | null;
}

/**
 * Lit la demande ET la VERROUILLE (FOR UPDATE) pour toute la duree de la transaction. Deux validations
 * simultanees de la meme demande se serialisent ici : la seconde attend la fin de la premiere, relit le
 * statut deja ACTIVE et s'arrete -- avant d'avoir cree quoi que ce soit.
 */
export async function lockRequestForValidation(
  tx: NodePgDatabase,
  id: string,
): Promise<RequestToValidate | null> {
  const result = await tx.execute(sql`
    SELECT r.id, r.user_id, r.status, r.first_name, r.last_name, u.email, r.specialty,
           r.inpe, r.numero_ordre, r.structure_name, r.city, r.address
    FROM registration_requests r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ${id}
    FOR UPDATE OF r
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    status: row.status as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    email: row.email as string,
    specialty: row.specialty as string,
    inpe: (row.inpe as string | null) ?? null,
    numeroOrdre: (row.numero_ordre as string | null) ?? null,
    structureName: row.structure_name as string,
    city: row.city as string,
    address: (row.address as string | null) ?? null,
  };
}

export async function slugIsTaken(tx: NodePgDatabase, slug: string): Promise<boolean> {
  const result = await tx.execute(sql`SELECT 1 FROM organizations WHERE slug = ${slug} LIMIT 1`);
  return result.rows.length > 0;
}

/**
 * Operation 1 de la cascade : la demande passe a ACTIVE et pointe vers l'organisation creee. Efface
 * aussi le dernier message de complement (ADR-0022 : les contraintes de la base l'exigent des qu'une
 * demande est close). Conditionnee au statut : si la demande n'est plus validable, aucune ligne n'est
 * touchee et la fonction renvoie false.
 */
export async function markRequestActive(
  tx: NodePgDatabase,
  id: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    UPDATE registration_requests
    SET status = 'ACTIVE',
        organization_id = ${organizationId},
        complement_requested_info = NULL,
        complement_message = NULL,
        updated_at = now()
    WHERE id = ${id} AND status IN ('PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED')
    RETURNING id
  `);
  return result.rows.length > 0;
}

/** Trace de la validation dans l'historique : date, action, administrateur (R7 : jamais de contenu). */
export async function insertValidatedEvent(
  tx: NodePgDatabase,
  registrationRequestId: string,
  actorUserId: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO registration_events (id, registration_request_id, action, actor_user_id)
    VALUES (gen_random_uuid(), ${registrationRequestId}, 'VALIDATED', ${actorUserId})
  `);
}

// ---------------------------------------------------------------------------------------
// Renvoi de l'email d'activation (R6 : « l'admin peut relancer l'envoi »).

export interface ActivationRecipient {
  requestId: string;
  email: string;
  firstName: string;
}

/**
 * Reserve le creneau de renvoi en UNE seule instruction (meme principe que le renvoi du complement,
 * TASK-054) : la verification du delai et la pose de l'horodatage sont atomiques, donc deux clics
 * simultanes d'administrateurs ne produisent qu'un seul email. Ne reserve rien si la demande n'est pas
 * ACTIVE (il n'y a alors aucun email d'activation a renvoyer).
 */
export async function claimActivationResendSlot(
  db: NodePgDatabase,
  id: string,
  windowSeconds: number,
): Promise<ActivationRecipient | null> {
  const result = await db.execute(sql`
    UPDATE registration_requests r
    SET last_email_resent_at = now()
    FROM users u
    WHERE r.id = ${id}
      AND u.id = r.user_id
      AND r.status = 'ACTIVE'
      AND (r.last_email_resent_at IS NULL
           OR r.last_email_resent_at <= now() - make_interval(secs => ${windowSeconds}))
    RETURNING r.id, u.email, r.first_name
  `);
  const row = result.rows[0] as { id: string; email: string; first_name: string } | undefined;
  return row ? { requestId: row.id, email: row.email, firstName: row.first_name } : null;
}

/** Statut courant d'une demande (pour expliquer un refus de renvoi : inconnue, non validee, trop tot). */
export async function findRequestStatusById(
  db: NodePgDatabase,
  id: string,
): Promise<string | null> {
  const result = await db.execute(sql`SELECT status FROM registration_requests WHERE id = ${id}`);
  const row = result.rows[0] as { status: string } | undefined;
  return row ? row.status : null;
}

// ---------------------------------------------------------------------------------------
// TASK-064 (EA-018, brief R7) : demande de COMPLEMENT.

/** Statuts depuis lesquels un complement peut etre (re)demande. Depuis « complement demande » : une
 * nouvelle demande ECRASE la precedente (ADR-0022 : « ecrasees a chaque nouvelle demande »). */
export const COMPLEMENT_REQUESTABLE_STATUSES = [
  'PENDING_VERIFICATION',
  'COMPLEMENT_REQUESTED',
] as const;

export interface RequestToAskComplement {
  id: string;
  status: string;
  email: string;
  firstName: string;
}

/** Lit la demande ET la verrouille (FOR UPDATE) : des actions simultanees sur la meme demande se serialisent. */
export async function lockRequestForComplement(
  tx: NodePgDatabase,
  id: string,
): Promise<RequestToAskComplement | null> {
  const result = await tx.execute(sql`
    SELECT r.id, r.status, r.first_name, u.email
    FROM registration_requests r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ${id}
    FOR UPDATE OF r
  `);
  const row = result.rows[0] as
    { id: string; status: string; first_name: string; email: string } | undefined;
  return row
    ? { id: row.id, status: row.status, firstName: row.first_name, email: row.email }
    : null;
}

/**
 * La demande passe a COMPLEMENT_REQUESTED et conserve le message sortant, TEL QU'ENVOYE (ADR-0022), pour
 * qu'il puisse etre renvoye a l'identique. Conditionnee au statut : false si la demande n'est plus ouverte.
 */
export async function markComplementRequested(
  tx: NodePgDatabase,
  id: string,
  requestedInfo: string,
  message: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    UPDATE registration_requests
    SET status = 'COMPLEMENT_REQUESTED',
        complement_requested_info = ${requestedInfo},
        complement_message = ${message},
        updated_at = now()
    WHERE id = ${id} AND status IN ('PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED')
    RETURNING id
  `);
  return result.rows.length > 0;
}

/** Trace de l'action (date, action, administrateur) -- jamais le contenu de l'echange (R7). */
export async function insertComplementRequestedEvent(
  tx: NodePgDatabase,
  registrationRequestId: string,
  actorUserId: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO registration_events (id, registration_request_id, action, actor_user_id)
    VALUES (gen_random_uuid(), ${registrationRequestId}, 'COMPLEMENT_REQUESTED', ${actorUserId})
  `);
}

export interface ComplementResend {
  requestId: string;
  email: string;
  firstName: string;
  requestedInfo: string;
  message: string;
}

/**
 * Renvoi du complement PAR L'ADMINISTRATEUR (brief §6 : « renvoyer la demande sans la recreer »). Meme
 * principe que le renvoi du fondateur (TASK-054) : verification du delai et pose de l'horodatage en UNE
 * instruction, donc atomiques ; le message est relu TEL QU'ENVOYE, jamais reconstruit.
 */
export async function claimComplementResendSlotByRequestId(
  db: NodePgDatabase,
  id: string,
  windowSeconds: number,
): Promise<ComplementResend | null> {
  const result = await db.execute(sql`
    UPDATE registration_requests r
    SET last_email_resent_at = now()
    FROM users u
    WHERE r.id = ${id}
      AND u.id = r.user_id
      AND r.status = 'COMPLEMENT_REQUESTED'
      AND (r.last_email_resent_at IS NULL
           OR r.last_email_resent_at <= now() - make_interval(secs => ${windowSeconds}))
    RETURNING r.id, u.email, r.first_name, r.complement_requested_info, r.complement_message
  `);
  const row = result.rows[0] as
    | {
        id: string;
        email: string;
        first_name: string;
        complement_requested_info: string;
        complement_message: string;
      }
    | undefined;
  return row
    ? {
        requestId: row.id,
        email: row.email,
        firstName: row.first_name,
        requestedInfo: row.complement_requested_info,
        message: row.complement_message,
      }
    : null;
}
