import { eq } from 'drizzle-orm';
import type { DatabaseService } from '../../shared/database/database.service';
import { roles } from './schema';

// Role est global (decision du Decision Gate) : les memes roles pour toutes les
// organisations. Pas de scoping, pas de creation dynamique en BUILD-001 (RBAC simple).

export async function findAllRoles(databaseService: DatabaseService) {
  return databaseService.db.select().from(roles);
}

export async function findRoleById(databaseService: DatabaseService, id: string) {
  const [role] = await databaseService.db.select().from(roles).where(eq(roles.id, id));
  return role;
}

/**
 * BUILD-004 etape 2, EA-018 / TASK-062 : un role se retrouve par son NOM. Les roles sont globaux et
 * leur nom est unique. Sert a la cascade de validation d'une inscription, qui rattache le fondateur
 * au role « fondateur » (migration 0025) sans en connaitre l'identifiant.
 */
export async function findRoleByName(databaseService: DatabaseService, name: string) {
  const [role] = await databaseService.db.select().from(roles).where(eq(roles.name, name));
  return role;
}
