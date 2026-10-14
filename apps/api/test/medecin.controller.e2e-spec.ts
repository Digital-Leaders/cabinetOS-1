import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppModule } from '../src/app.module';
import { auth, authPool } from '../src/modules/identity/infrastructure/auth';
import { DatabaseService } from '../src/modules/shared/database/database.service';
import { createOrganization } from '../src/modules/organization/infrastructure/organization.queries';
import { createMembership } from '../src/modules/organization/infrastructure/membership.queries';
import { GlobalExceptionFilter } from '../src/modules/shared/filters/http-exception.filter';

// TASK-045 (BUILD-003, EA-012) : test e2e complet du controleur Medecin -- meme
// patron que patient.controller.e2e-spec.ts (TASK-025) et permissions-guard.e2e-spec.ts
// (TASK-016). Recherche par nom (TASK-046) et surface publique (TASK-047) hors
// perimetre ici.

describe('MedecinController (e2e, TASK-045)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let httpServer: string;
  const testEmail = `medecin-controller-test-${Date.now()}@example.com`;
  const testPassword = 'password1234';
  const origin = 'http://localhost:3001';
  let orgId: string;
  let orgBId: string;
  let cookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    databaseService = app.get(DatabaseService);

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.all('/api/v1/auth/{*splat}', toNodeHandler(auth));
    app.use(express.json());
    app.setGlobalPrefix('api/v1', { exclude: ['api/v1/auth/{*splat}'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    httpServer = `http://127.0.0.1:${address.port}`;

    const org = await createOrganization(databaseService, {
      name: 'Medecin Controller Test Org',
      slug: `medecin-controller-test-${Date.now()}`,
    });
    orgId = org.id;
    const orgB = await createOrganization(databaseService, {
      name: 'Medecin Controller Test Org B',
      slug: `medecin-controller-test-b-${Date.now()}`,
    });
    orgBId = orgB.id;

    const roleId = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'MedecinTestRole-' + Date.now()})`,
    );
    const permissionsResult = await databaseService.db.execute(
      sql`SELECT id FROM permissions WHERE resource = 'medecins'`,
    );
    for (const row of permissionsResult.rows as { id: string }[]) {
      await databaseService.db.execute(
        sql`INSERT INTO role_permissions (role_id, permission_id) VALUES (${roleId}, ${row.id}) ON CONFLICT DO NOTHING`,
      );
    }

    await fetch(`${httpServer}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Medecin Test' }),
    });
    const usersResult = await databaseService.db.execute(
      sql`SELECT id FROM users WHERE email = ${testEmail}`,
    );
    const userId = (usersResult.rows[0] as { id: string }).id;
    await createMembership(databaseService, orgId, { userId, roleId });

    const signInRes = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    cookie = (signInRes.headers.get('set-cookie') as string).split(';')[0];
  });

  afterAll(async () => {
    await databaseService.withOrganizationScope(orgId, (tx) =>
      tx.execute(sql`DELETE FROM medecins WHERE organization_id = ${orgId}`),
    );
    await databaseService.withOrganizationScope(orgBId, (tx) =>
      tx.execute(sql`DELETE FROM medecins WHERE organization_id = ${orgBId}`),
    );
    await databaseService.withOrganizationScope(orgId, (tx) =>
      tx.execute(sql`DELETE FROM memberships WHERE organization_id = ${orgId}`),
    );
    await databaseService.db.execute(sql`DELETE FROM users WHERE email = ${testEmail}`);
    await databaseService.db.execute(
      sql`DELETE FROM organizations WHERE id IN (${orgId}, ${orgBId})`,
    );
    await authPool.end();
    await app.close();
  });

  it('POST /medecins cree une fiche et renvoie 201', async () => {
    const res = await fetch(`${httpServer}/api/v1/medecins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Yassine', lastName: 'Controller' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.firstName).toBe('Yassine');
  });

  it('POST /medecins avec un INPE mal forme reussit quand meme, avec un avertissement (F.1, jamais bloquant)', async () => {
    const res = await fetch(`${httpServer}/api/v1/medecins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Inpe', lastName: 'MalForme', inpe: '123' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.meta.warnings).toBeDefined();
  });

  it('POST /medecins avec un INPE bien forme ne genere aucun avertissement', async () => {
    const res = await fetch(`${httpServer}/api/v1/medecins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Inpe', lastName: 'BienForme', inpe: '123456789' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.meta.warnings).toBeUndefined();
  });

  it('POST /medecins refuse (400) un userId qui ne correspond a aucune adhesion reelle', async () => {
    const res = await fetch(`${httpServer}/api/v1/medecins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({
        firstName: 'Rattachement',
        lastName: 'Invalide',
        userId: 'utilisateur-inexistant-sans-adhesion',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /medecins/:id renvoie la fiche creee', async () => {
    const createRes = await fetch(`${httpServer}/api/v1/medecins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Karim', lastName: 'Get' }),
    });
    const created = (await createRes.json()).data;

    const res = await fetch(`${httpServer}/api/v1/medecins/${created.id}`, {
      headers: { Cookie: cookie, 'x-organization-id': orgId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(created.id);
  });

  it('GET /medecins/:id sur un id absent renvoie 404', async () => {
    const res = await fetch(`${httpServer}/api/v1/medecins/00000000-0000-0000-0000-000000000000`, {
      headers: { Cookie: cookie, 'x-organization-id': orgId },
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /medecins/:id modifie l identite', async () => {
    const createRes = await fetch(`${httpServer}/api/v1/medecins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Avant', lastName: 'Patch' }),
    });
    const created = (await createRes.json()).data;

    const res = await fetch(`${httpServer}/api/v1/medecins/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Apres', specialty: 'cardiologie' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.firstName).toBe('Apres');
    expect(body.data.specialty).toBe('cardiologie');
  });

  it('PATCH /medecins/:id sur un id absent renvoie 404', async () => {
    const res = await fetch(`${httpServer}/api/v1/medecins/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'X' }),
    });
    expect(res.status).toBe(404);
  });

  it('GET /medecins?q= retrouve un medecin malgre une variante d accent (TASK-046)', async () => {
    await fetch(`${httpServer}/api/v1/medecins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Fatima', lastName: 'Rechercheq' }),
    });

    const res = await fetch(
      `${httpServer}/api/v1/medecins?q=${encodeURIComponent('fatma rechercheq')}`,
      { headers: { Cookie: cookie, 'x-organization-id': orgId } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.some((m: { lastName: string }) => m.lastName === 'Rechercheq')).toBe(true);
  });

  it('GET /medecins sans q renvoie une liste vide (pas de recherche par defaut)', async () => {
    const res = await fetch(`${httpServer}/api/v1/medecins`, {
      headers: { Cookie: cookie, 'x-organization-id': orgId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('sans la permission requise, l acces est refuse (403) -- meme mecanique que TASK-016', async () => {
    const res = await fetch(`${httpServer}/api/v1/medecins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgBId },
      body: JSON.stringify({ firstName: 'X', lastName: 'Y' }),
    });
    // L utilisateur n est membre que de orgId, jamais de orgBId : refuse par le Guard.
    expect(res.status).toBe(403);
  });
});
