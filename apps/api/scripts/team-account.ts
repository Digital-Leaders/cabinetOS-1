import { sql } from 'drizzle-orm';
import type { DatabaseService } from '../src/modules/shared';
import type { AuthProvider } from '../src/modules/identity';
import { createMembership } from '../src/modules/organization';
import { createAuditEvent } from '../src/modules/audit';

// BUILD-004 etape 2 (ADR-0021 D2, P1) : creation d'un compte d'equipe (demo, cabinet
// pilote) maintenant que l'inscription HTTP native est fermee.
//
// INVARIANT (ADR-0021 P1) : un compte d'equipe recoit TOUJOURS au moins une adhesion
// dans le meme lancement. Si l'adhesion echoue, le compte est supprime aussitot : il ne
// reste jamais un compte d'equipe sans adhesion -- qui serait indistinguable d'un
// orphelin et donc recuperable par le parcours d'inscription.
//
// Trace : chaque creation est inscrite dans audit_events de l'organisation
// (action team_account.created), en plus de la sortie console.
//
// L'ajout d'un administrateur de plateforme (platform_admins) n'existe pas encore : il
// arrivera avec la table, en TASK-058 (ADR-0021 P3).

export interface TeamAccountInput {
  email: string;
  password: string;
  name: string;
  organizationId: string;
  roleId: string;
}

export async function createTeamAccount(
  deps: { authProvider: AuthProvider; databaseService: DatabaseService },
  input: TeamAccountInput,
): Promise<{ userId: string }> {
  const account = await deps.authProvider.createAccount({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    name: input.name.trim(),
  });
  if (!account.ok) {
    throw new Error(
      account.reason === 'EMAIL_ALREADY_USED'
        ? 'Un compte existe deja avec cet email.'
        : 'Mot de passe refuse (8 caracteres minimum).',
    );
  }

  try {
    await createMembership(deps.databaseService, input.organizationId, {
      userId: account.userId,
      roleId: input.roleId,
    });
  } catch (error) {
    // Invariant P1 : pas de compte d'equipe sans adhesion.
    await deps.databaseService.db.execute(
      sql`DELETE FROM users WHERE id = ${account.userId} AND organization_memberships = '[]'::jsonb`,
    );
    throw new Error(
      `Adhesion impossible (organisation ou role inconnu ?) : compte annule. ${(error as Error).message}`,
    );
  }

  await createAuditEvent(deps.databaseService, input.organizationId, {
    action: 'team_account.created',
    targetType: 'user',
    targetId: account.userId,
  });

  return { userId: account.userId };
}
