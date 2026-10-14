import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { AppModule } from '../../src/app.module';
import { authPool } from '../../src/modules/identity/infrastructure/auth';
import { AUTH_PROVIDER, type AuthProvider } from '../../src/modules/identity';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import { createOrganization, findMembershipsByOrganization } from '../../src/modules/organization';
import { findAuditEventsByOrganization } from '../../src/modules/audit';
import { createTeamAccount } from '../../scripts/team-account';

// BUILD-004 etape 2 (ADR-0021 D2, P1) : script des comptes d'equipe. L'invariant teste
// ici est celui sur lequel repose la recuperation d'orphelin : un compte d'equipe n'existe
// jamais sans adhesion.

describe('Script des comptes d equipe (ADR-0021 P1)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let authProvider: AuthProvider;
  let adminPool: Pool;
  let orgId: string;
  let roleId: string;
  const runId = Date.now();
  const emails: string[] = [];

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    databaseService = app.get(DatabaseService);
    authProvider = app.get<AuthProvider>(AUTH_PROVIDER);

    const org = await createOrganization(databaseService, {
      name: 'Team Script Test Org',
      slug: `team-script-test-${runId}`,
    });
    orgId = org.id;
    roleId = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'TeamScriptRole-' + runId})`,
    );
  });

  afterAll(async () => {
    // audit_events est append-only pour le role applicatif : nettoyage admin.
    await adminPool.query('DELETE FROM audit_events WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM memberships WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await adminPool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await adminPool.query('DELETE FROM roles WHERE id = $1', [roleId]);
    await adminPool.end();
    await authPool.end();
    await app.close();
  });

  it('cree le compte AVEC son adhesion et une trace d audit, dans le meme lancement', async () => {
    const email = `team-script-ok-${runId}@example.com`;
    emails.push(email);

    const { userId } = await createTeamAccount(
      { authProvider, databaseService },
      { email, password: 'equipe-mdp-1234', name: 'Equipe Demo', organizationId: orgId, roleId },
    );

    const memberships = await findMembershipsByOrganization(databaseService, orgId);
    expect(memberships.some((m) => m.userId === userId)).toBe(true);
    const events = await findAuditEventsByOrganization(databaseService, orgId);
    expect(events).toContainEqual(
      expect.objectContaining({
        action: 'team_account.created',
        targetType: 'user',
        targetId: userId,
      }),
    );
  });

  it('si l adhesion echoue (role inconnu), le compte est supprime : jamais d equipe sans adhesion', async () => {
    const email = `team-script-ko-${runId}@example.com`;
    emails.push(email);

    await expect(
      createTeamAccount(
        { authProvider, databaseService },
        {
          email,
          password: 'equipe-mdp-1234',
          name: 'Sans Role',
          organizationId: orgId,
          roleId: uuidv7(),
        },
      ),
    ).rejects.toThrow(/compte annule/);

    const result = await databaseService.db.execute(
      sql`SELECT id FROM users WHERE email = ${email}`,
    );
    expect(result.rows).toHaveLength(0);
  });
});
