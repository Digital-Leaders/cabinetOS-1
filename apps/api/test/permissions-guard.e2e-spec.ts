import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppModule } from '../src/app.module';
import { auth, authPool } from '../src/modules/identity/infrastructure/auth';
import { DatabaseService } from '../src/modules/shared/database/database.service';
import { createOrganization } from '../src/modules/organization/infrastructure/organization.queries';
import { createMembership } from '../src/modules/organization/infrastructure/membership.queries';
import { GuardTestModule } from './fixtures/guard-test.controller';

// TASK-016 : Guards d autorisation. Utilise un controleur jetable
// (test/fixtures/guard-test.controller.ts) pour tester le Guard independamment
// de la logique metier reelle -- pas d implementation d admin roles/permissions
// (explicitement hors perimetre de TASK-016).

describe('Guards Role/Permission (e2e, TASK-016)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let httpServer: string;
  const testEmail = `guard-test-${Date.now()}@example.com`;
  const testPassword = 'password1234';
  const origin = 'http://localhost:3001';
  let orgId: string;
  let orgBId: string;
  let roleWithPermissionId: string;
  let roleWithoutPermissionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, GuardTestModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    databaseService = app.get(DatabaseService);

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.all('/api/v1/auth/{*splat}', toNodeHandler(auth));
    app.use(express.json());
    app.setGlobalPrefix('api/v1', { exclude: ['api/v1/auth/{*splat}'] });

    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    httpServer = `http://127.0.0.1:${address.port}`;

    const org = await createOrganization(databaseService, {
      name: 'Guard Test Org',
      slug: `guard-test-org-${Date.now()}`,
    });
    orgId = org.id;

    // Organisation B : l utilisateur de test n en sera JAMAIS membre. Sert au
    // test verifiant qu un en-tete x-organization-id falsifie vers une
    // organisation etrangere n accorde aucun acces.
    const orgB = await createOrganization(databaseService, {
      name: 'Guard Test Org B',
      slug: `guard-test-org-b-${Date.now()}`,
    });
    orgBId = orgB.id;

    roleWithPermissionId = uuidv7();
    roleWithoutPermissionId = uuidv7();
    const permissionId = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleWithPermissionId}, ${'GuardTestRoleWith-' + Date.now()}), (${roleWithoutPermissionId}, ${'GuardTestRoleWithout-' + Date.now()})`,
    );
    await databaseService.db.execute(
      sql`INSERT INTO permissions (id, action, resource) VALUES (${permissionId}, 'read', 'members') ON CONFLICT (action, resource) DO NOTHING`,
    );
    const existingPermission = await databaseService.db.execute(
      sql`SELECT id FROM permissions WHERE action = 'read' AND resource = 'members'`,
    );
    const actualPermissionId = (existingPermission.rows[0] as { id: string }).id;
    await databaseService.db.execute(
      sql`INSERT INTO role_permissions (role_id, permission_id) VALUES (${roleWithPermissionId}, ${actualPermissionId})`,
    );

    await fetch(`${httpServer}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Guard Test' }),
    });

    const usersResult = await databaseService.db.execute(
      sql`SELECT id FROM users WHERE email = ${testEmail}`,
    );
    const realUserId = (usersResult.rows[0] as { id: string }).id;

    await createMembership(databaseService, orgId, {
      userId: realUserId,
      roleId: roleWithPermissionId,
    });
  });

  afterAll(async () => {
    await databaseService.withOrganizationScope(orgId, (tx) =>
      tx.execute(sql`DELETE FROM memberships WHERE organization_id = ${orgId}`),
    );
    await databaseService.db.execute(
      sql`DELETE FROM role_permissions WHERE role_id IN (${roleWithPermissionId}, ${roleWithoutPermissionId})`,
    );
    await databaseService.db.execute(
      sql`DELETE FROM roles WHERE id IN (${roleWithPermissionId}, ${roleWithoutPermissionId})`,
    );
    await databaseService.db.execute(sql`DELETE FROM users WHERE email = ${testEmail}`);
    await databaseService.db.execute(
      sql`DELETE FROM organizations WHERE id IN (${orgId}, ${orgBId})`,
    );
    await authPool.end();
    await app.close();
  });

  it('un endpoint public (health) repond sans authentification', async () => {
    const res = await fetch(`${httpServer}/api/v1/health`);
    expect(res.status).toBe(200);
  });

  it('un endpoint SANS @Public() ni @RequirePermission() est refuse par defaut (fail-closed)', async () => {
    const res = await fetch(`${httpServer}/api/v1/test-guard/unprotected`);
    expect(res.status).toBe(403);
  });

  it('un endpoint protege sans session valide renvoie 401', async () => {
    const res = await fetch(`${httpServer}/api/v1/test-guard/protected`, {
      headers: { 'x-organization-id': orgId },
    });
    expect(res.status).toBe(401);
  });

  it('un utilisateur authentifie sans la permission requise recoit 403', async () => {
    const signInRes = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie = (signInRes.headers.get('set-cookie') as string).split(';')[0];

    const usersResult = await databaseService.db.execute(
      sql`SELECT id FROM users WHERE email = ${testEmail}`,
    );
    const realUserId = (usersResult.rows[0] as { id: string }).id;
    await databaseService.withOrganizationScope(orgId, (tx) =>
      tx.execute(
        sql`UPDATE memberships SET role_id = ${roleWithoutPermissionId} WHERE user_id = ${realUserId} AND organization_id = ${orgId}`,
      ),
    );

    const res = await fetch(`${httpServer}/api/v1/test-guard/protected`, {
      headers: { Cookie: cookie, 'x-organization-id': orgId },
    });
    expect(res.status).toBe(403);

    await databaseService.withOrganizationScope(orgId, (tx) =>
      tx.execute(
        sql`UPDATE memberships SET role_id = ${roleWithPermissionId} WHERE user_id = ${realUserId} AND organization_id = ${orgId}`,
      ),
    );
  });

  it('un utilisateur authentifie avec la permission requise accede a la ressource', async () => {
    const signInRes = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie = (signInRes.headers.get('set-cookie') as string).split(';')[0];

    const res = await fetch(`${httpServer}/api/v1/test-guard/protected`, {
      headers: { Cookie: cookie, 'x-organization-id': orgId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
  });

  it('un utilisateur membre de l organisation A mais PAS de B recoit 403 en falsifiant x-organization-id vers B', async () => {
    // Reproduit exactement le risque signale en revue d EA-004 : un utilisateur
    // authentifie correctement (membre de orgId), qui envoie un en-tete
    // x-organization-id pointant vers une AUTRE organisation (orgBId) dont il
    // n est membre nulle part. hasPermission joint memberships sur user_id ET
    // organization_id simultanement -- l appartenance doit etre verifiee en
    // meme temps que la permission, jamais l une sans l autre.
    const signInRes = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie = (signInRes.headers.get('set-cookie') as string).split(';')[0];

    const resOwnOrg = await fetch(`${httpServer}/api/v1/test-guard/protected`, {
      headers: { Cookie: cookie, 'x-organization-id': orgId },
    });
    expect(resOwnOrg.status).toBe(200);

    const resForeignOrg = await fetch(`${httpServer}/api/v1/test-guard/protected`, {
      headers: { Cookie: cookie, 'x-organization-id': orgBId },
    });
    expect(resForeignOrg.status).toBe(403);
  });

  it('un endpoint protege sans en-tete d organisation est refuse', async () => {
    const signInRes = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie = (signInRes.headers.get('set-cookie') as string).split(';')[0];

    const res = await fetch(`${httpServer}/api/v1/test-guard/protected`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });

  it('@RequireAuthentication() (ADR-0019) : refuse sans session, meme sans organisation demandee', async () => {
    const res = await fetch(`${httpServer}/api/v1/test-guard/authenticated-only`);
    expect(res.status).toBe(401);
  });

  it('@RequireAuthentication() (ADR-0019) : autorise avec une session valide, SANS en-tete x-organization-id', async () => {
    const signInRes = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie = (signInRes.headers.get('set-cookie') as string).split(';')[0];

    const res = await fetch(`${httpServer}/api/v1/test-guard/authenticated-only`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ok).toBe(true);
    expect(typeof body.data.userId).toBe('string');
  });
});
