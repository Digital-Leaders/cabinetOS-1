import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import type { DatabaseService } from '../../shared/database/database.service';
import { organizations } from './schema';

// Organization EST l unite d isolation elle-meme : elle n est pas scopee PAR une
// organisation. Ces fonctions utilisent la connexion directe, pas withOrganizationScope.

/**
 * BUILD-004 etape 2, EA-018 / TASK-061 (ADR-0021 D5) : corps de createOrganization, extrait pour
 * pouvoir s'executer DANS UNE TRANSACTION fournie par l'appelant -- celle de la cascade de
 * validation d'une inscription (organisation -> adhesion -> fiche medecin -> statut), qui doit
 * reussir ou echouer d'un bloc. Un seul chemin de code : createOrganization en est l'enveloppe.
 *
 * `id` facultatif : la cascade genere l'UUID en amont pour ouvrir la transaction scopee sur
 * l'organisation AVANT qu'elle n'existe. La table organizations n'a pas de RLS (elle EST l'unite
 * d'isolation) : `tx` peut donc etre aussi bien une transaction qu'une connexion simple.
 */
export async function createOrganizationInTx(
  tx: NodePgDatabase,
  data: { id?: string; name: string; slug: string },
) {
  const [created] = await tx.insert(organizations).values(data).returning();
  return created;
}

export async function createOrganization(
  databaseService: DatabaseService,
  data: { name: string; slug: string },
) {
  // Comportement INCHANGE : ecriture directe, sans transaction ni portee d'organisation.
  return createOrganizationInTx(databaseService.db, data);
}

export async function findOrganizationById(databaseService: DatabaseService, id: string) {
  const [org] = await databaseService.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id));
  return org;
}

export async function updateOrganization(
  databaseService: DatabaseService,
  id: string,
  data: Partial<{ name: string; slug: string }>,
) {
  const [updated] = await databaseService.db
    .update(organizations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  return updated;
}

export async function softDeleteOrganization(databaseService: DatabaseService, id: string) {
  const [deleted] = await databaseService.db
    .update(organizations)
    .set({ deletedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  return deleted;
}
