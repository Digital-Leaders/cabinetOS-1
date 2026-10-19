import { sql } from 'drizzle-orm';
import type { DatabaseService } from '../../shared/database/database.service';

// BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 D3) : ce compte est-il un administrateur de
// plateforme ACTIF ? platform_admins est GLOBALE (sans RLS) : pas de withOrganizationScope.
//
// userId provient toujours de la session verifiee cote serveur, jamais du client. Une ligne
// revoquee (revoked_at renseigne) ne compte pas. Cette fonction ne fait que LIRE : le role
// applicatif n'a pas d'autre droit sur la table (migration 0023).

export async function isPlatformAdmin(
  databaseService: DatabaseService,
  userId: string,
): Promise<boolean> {
  const result = await databaseService.db.execute(
    sql`SELECT 1 FROM platform_admins WHERE user_id = ${userId} AND revoked_at IS NULL`,
  );
  return result.rows.length > 0;
}
