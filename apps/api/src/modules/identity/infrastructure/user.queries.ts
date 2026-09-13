import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseService } from '../../shared/database/database.service';
import { users, type OrganizationMembershipSummary } from './schema';

// User est global (pas de organizationId) : un utilisateur peut appartenir a plusieurs
// organisations via Membership. Ces fonctions ne sont donc pas scopees par organisation.

export async function findUserById(databaseService: DatabaseService, id: string) {
  const [user] = await databaseService.db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function updateUser(
  databaseService: DatabaseService,
  id: string,
  data: Partial<{ name: string; image: string | null }>,
) {
  const [updated] = await databaseService.db
    .update(users)
    .set(data)
    .where(eq(users.id, id))
    .returning();
  return updated;
}

export async function softDeleteUser(databaseService: DatabaseService, id: string) {
  const [deleted] = await databaseService.db
    .update(users)
    .set({ deletedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return deleted;
}

// Parcours d'acces, etape 1, commit 2 (ADR-0019) : maintenance du cache
// d'adhesions sur users.organization_memberships -- jamais RLS, donc jamais
// besoin de withOrganizationScope ici. Les deux fonctions ci-dessous acceptent
// directement un tx (pas un DatabaseService) : elles sont appelees depuis
// createMembership/deleteMembership (module Organization), deja a l interieur
// d une transaction (withOrganizationScope) -- meme transaction, jamais une
// synchronisation differee.

export async function appendOrganizationMembership(
  tx: NodePgDatabase,
  userId: string,
  organizationId: string,
  organizationName: string,
): Promise<void> {
  const [user] = await tx
    .select({ organizationMemberships: users.organizationMemberships })
    .from(users)
    .where(eq(users.id, userId));
  const current = user?.organizationMemberships ?? [];
  // Jamais de defaut automatique ici, meme pour une premiere adhesion : la
  // resolution a la connexion traite "1 entree" comme un cas a part (ouverture
  // directe, quel que soit isDefault -- ADR-0019). Auto-defaulter la premiere
  // adhesion empecherait l etat "plusieurs organisations, aucun defaut" de
  // jamais se produire des qu un utilisateur rejoint une deuxieme organisation
  // -- or ce cas doit rester atteignable (ecran de choix).
  const updated: OrganizationMembershipSummary[] = [
    ...current,
    { organizationId, organizationName, isDefault: false },
  ];
  await tx.update(users).set({ organizationMemberships: updated }).where(eq(users.id, userId));
}

export async function removeOrganizationMembership(
  tx: NodePgDatabase,
  userId: string,
  organizationId: string,
): Promise<void> {
  const [user] = await tx
    .select({ organizationMemberships: users.organizationMemberships })
    .from(users)
    .where(eq(users.id, userId));
  const current = user?.organizationMemberships ?? [];
  const updated = current.filter((m) => m.organizationId !== organizationId);
  await tx.update(users).set({ organizationMemberships: updated }).where(eq(users.id, userId));
}

// Lecture -- utilisee par la resolution d'organisation a la connexion, sans
// contexte d'organisation deja etabli (d ou databaseService.db direct, jamais
// withOrganizationScope, qui exigerait precisement ce qu on cherche a determiner).
export async function findOrganizationMembershipsForUser(
  databaseService: DatabaseService,
  userId: string,
): Promise<OrganizationMembershipSummary[]> {
  const [user] = await databaseService.db
    .select({ organizationMemberships: users.organizationMemberships })
    .from(users)
    .where(eq(users.id, userId));
  return user?.organizationMemberships ?? [];
}

// Ecran 2 (choix d'organisation) : "Ouvrir directement l'organisation choisie a
// l'avenir". Surete par construction (ADR-0019) : si organizationId ne
// correspond a aucune adhesion reelle de cet utilisateur, aucune entree ne
// devient defaut -- l appelant (controleur) doit alors le detecter et rejeter,
// jamais reussir silencieusement.
export async function setDefaultOrganizationMembership(
  databaseService: DatabaseService,
  userId: string,
  organizationId: string,
): Promise<{ memberships: OrganizationMembershipSummary[]; matched: boolean }> {
  const [user] = await databaseService.db
    .select({ organizationMemberships: users.organizationMemberships })
    .from(users)
    .where(eq(users.id, userId));
  const current = user?.organizationMemberships ?? [];
  const matched = current.some((m) => m.organizationId === organizationId);
  if (!matched) {
    return { memberships: current, matched: false };
  }
  const updated = current.map((m) => ({ ...m, isDefault: m.organizationId === organizationId }));
  await databaseService.db
    .update(users)
    .set({ organizationMemberships: updated })
    .where(eq(users.id, userId));
  return { memberships: updated, matched: true };
}
