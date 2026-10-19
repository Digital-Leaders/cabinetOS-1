import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseService } from '../../shared/database/database.service';
import { appendOrganizationMembership, removeOrganizationMembership } from '../../identity';
import { memberships, organizations } from './schema';

// Membership porte organizationId : chaque fonction exige explicitement l organisation
// active et passe par withOrganizationScope -- aucun acces "par defaut" possible.
//
// Parcours d'acces, etape 1, commit 2 (ADR-0019) : createMembership et
// deleteMembership maintiennent en plus le cache users.organization_memberships,
// dans la MEME transaction (le meme tx que withOrganizationScope fournit deja) --
// jamais une synchronisation differee. users n a pas de RLS (Identity), donc
// appendOrganizationMembership/removeOrganizationMembership n ont pas besoin
// d un scope d organisation -- elles acceptent directement ce tx.

/**
 * BUILD-004 etape 2, EA-018 / TASK-061 (ADR-0021 D5) : corps de createMembership, extrait pour
 * s'executer DANS UNE TRANSACTION fournie par l'appelant (la cascade de validation d'une
 * inscription). Insere l'adhesion ET synchronise le cache users.organization_memberships
 * (ADR-0019) dans CETTE transaction : si l'appelant l'annule, l'un et l'autre disparaissent.
 *
 * `tx` DOIT etre une transaction ouverte par withOrganizationScope pour `organizationId` : la RLS
 * de memberships refuse l'insertion dans tout autre cas.
 */
export async function createMembershipInTx(
  tx: NodePgDatabase,
  organizationId: string,
  data: { userId: string; roleId: string },
) {
  const [created] = await tx
    .insert(memberships)
    .values({ ...data, organizationId })
    .returning();

  const [org] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  await appendOrganizationMembership(tx, data.userId, organizationId, org?.name ?? '');

  return created;
}

export async function createMembership(
  databaseService: DatabaseService,
  organizationId: string,
  data: { userId: string; roleId: string },
) {
  // Comportement INCHANGE : sa propre transaction, scopee a l'organisation.
  return databaseService.withOrganizationScope(organizationId, (tx) =>
    createMembershipInTx(tx, organizationId, data),
  );
}

export async function findMembershipsByOrganization(
  databaseService: DatabaseService,
  organizationId: string,
) {
  return databaseService.withOrganizationScope(organizationId, (tx) =>
    tx.select().from(memberships).where(eq(memberships.organizationId, organizationId)),
  );
}

export async function updateMembershipRole(
  databaseService: DatabaseService,
  organizationId: string,
  membershipId: string,
  roleId: string,
) {
  return databaseService.withOrganizationScope(organizationId, async (tx) => {
    const [updated] = await tx
      .update(memberships)
      .set({ roleId })
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
      .returning();
    return updated;
  });
}

export async function deleteMembership(
  databaseService: DatabaseService,
  organizationId: string,
  membershipId: string,
) {
  return databaseService.withOrganizationScope(organizationId, async (tx) => {
    const [deleted] = await tx
      .delete(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
      .returning();

    if (deleted) {
      await removeOrganizationMembership(tx, deleted.userId, organizationId);
    }

    return deleted;
  });
}
