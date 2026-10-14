import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseService } from '../../../modules/shared';
import { registrationRequests, registrationEvents } from './schema';
import type { RegistrationEventAction } from './schema';

// TASK-052 (BUILD-004 etape 2, EA-014) : acces aux tables d'inscription (ADR-0021).
//
// Tables GLOBALES, hors RLS (exception assumee, ADR-0021 D1, migration 0018) : pas de
// withOrganizationScope ici, l'organisation n'existe pas encore. Le controle des lignes
// est applicatif -- chaque fonction cible UN compte ou UNE demande precise, jamais une
// liste ouverte (les listes admin viendront en TASK-059, derriere @RequirePlatformAdmin).
//
// Les deux suppressions de compte ci-dessous agissent sur users (Identity) : elles ne
// visent JAMAIS un compte qui porte une demande. La condition est dans la requete
// elle-meme (une seule instruction, donc sans fenetre entre verification et suppression),
// et la cle etrangere registration_requests.user_id empeche de toute facon la
// suppression d'un compte dont la demande vient d'etre inseree.

export interface DeclaredRegistrationData {
  firstName: string;
  lastName: string;
  specialty: string;
  inpe: string | null;
  numeroOrdre: string | null;
  structureName: string;
  city: string;
  address: string | null;
}

/**
 * Cree la demande (PENDING_VERIFICATION par defaut) et son premier evenement
 * REQUEST_SUBMITTED, dans une seule transaction : pas de demande sans historique.
 */
export async function insertRegistrationRequest(
  databaseService: DatabaseService,
  userId: string,
  declared: DeclaredRegistrationData,
): Promise<{ id: string; status: string }> {
  return databaseService.db.transaction(async (tx) => {
    const [request] = await tx
      .insert(registrationRequests)
      .values({ userId, ...declared })
      .returning({ id: registrationRequests.id, status: registrationRequests.status });
    await tx
      .insert(registrationEvents)
      .values({ registrationRequestId: request.id, action: 'REQUEST_SUBMITTED' });
    return request;
  });
}

/** Inscrit le resultat d'un envoi d'email dans l'historique (R6 : jamais le contenu). */
export async function recordEmailEvent(
  db: NodePgDatabase,
  registrationRequestId: string,
  emailTemplate: 'registration-confirmation',
  result: { ok: true } | { ok: false; retryable: boolean },
): Promise<void> {
  const action: RegistrationEventAction = result.ok ? 'EMAIL_SENT' : 'EMAIL_FAILED';
  await db.insert(registrationEvents).values({
    registrationRequestId,
    action,
    emailTemplate,
    emailFailureRetryable: result.ok ? null : result.retryable,
  });
}

/**
 * Compensation (ADR-0021 D2) : supprime le compte qui vient d'etre cree si, et
 * seulement si, aucune demande ne lui est rattachee. Sessions et identifiants
 * Better-Auth suivent par cascade (sessions/accounts ON DELETE CASCADE).
 */
export async function deleteAccountWithoutRequest(
  db: NodePgDatabase,
  userId: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM users u
    WHERE u.id = ${userId}
      AND NOT EXISTS (SELECT 1 FROM registration_requests r WHERE r.user_id = u.id)
  `);
}

/**
 * Recuperation d'un compte orphelin (ADR-0021 P1). Supprime le compte portant cet email
 * UNIQUEMENT s'il est un orphelin strict ET age :
 *   - aucune demande d'inscription ;
 *   - aucune adhesion (cache users.organization_memberships vide -- ADR-0019 : c'est la
 *     lecture des adhesions possible sans contexte d'organisation, memberships etant
 *     sous RLS forcee ; maintenu dans la meme transaction que createMembership, et
 *     rattrape pour les comptes anterieurs a 0017 par la migration 0020) ;
 *   - cree depuis plus de `minAgeMinutes` (une inscription en cours est epargnee).
 * A COMPLETER en TASK-058 : aucune ligne platform_admins (la table n'existe pas encore).
 *
 * Retourne true si un compte a ete supprime.
 */
export async function deleteOrphanAccountByEmail(
  db: NodePgDatabase,
  email: string,
  minAgeMinutes: number,
): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      DELETE FROM users u
      WHERE lower(u.email) = lower(${email})
        AND u.created_at < now() - make_interval(mins => ${minAgeMinutes})
        AND u.organization_memberships = '[]'::jsonb
        AND NOT EXISTS (SELECT 1 FROM registration_requests r WHERE r.user_id = u.id)
      RETURNING u.id
    `);
    return result.rows.length > 0;
  } catch (error) {
    // 23503 : une demande vient d'etre rattachee au compte entre-temps (cle etrangere).
    // Ce n'etait donc pas un orphelin : rien n'est supprime.
    if (findPgCode(error) === '23503') return false;
    throw error;
  }
}

function findPgCode(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
