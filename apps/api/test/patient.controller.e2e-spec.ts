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
import { createPatient } from '../src/business/patient/infrastructure/patient.queries';
import { GlobalExceptionFilter } from '../src/modules/shared/filters/http-exception.filter';

// TASK-025 (BUILD-002, EA-009) : premier controleur reel du depot -- test e2e complet
// (pas seulement les fonctions de requete, deja testees separement). Meme patron
// d authentification que permissions-guard.e2e-spec.ts (TASK-016).

describe('PatientController (e2e, TASK-025)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let httpServer: string;
  const testEmail = `patient-controller-test-${Date.now()}@example.com`;
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
      name: 'Patient Controller Test Org',
      slug: `patient-controller-test-${Date.now()}`,
    });
    orgId = org.id;
    const orgB = await createOrganization(databaseService, {
      name: 'Patient Controller Test Org B',
      slug: `patient-controller-test-b-${Date.now()}`,
    });
    orgBId = orgB.id;

    const roleId = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'PatientTestRole-' + Date.now()})`,
    );
    const permissionsResult = await databaseService.db.execute(
      sql`SELECT id FROM permissions WHERE resource = 'patients'`,
    );
    for (const row of permissionsResult.rows as { id: string }[]) {
      await databaseService.db.execute(
        sql`INSERT INTO role_permissions (role_id, permission_id) VALUES (${roleId}, ${row.id}) ON CONFLICT DO NOTHING`,
      );
    }

    await fetch(`${httpServer}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Patient Test' }),
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
      tx.execute(sql`DELETE FROM patient_records WHERE organization_id = ${orgId}`),
    );
    await databaseService.withOrganizationScope(orgId, (tx) =>
      tx.execute(sql`DELETE FROM patients WHERE organization_id = ${orgId}`),
    );
    await databaseService.withOrganizationScope(orgBId, (tx) =>
      tx.execute(sql`DELETE FROM patient_records WHERE organization_id = ${orgBId}`),
    );
    await databaseService.withOrganizationScope(orgBId, (tx) =>
      tx.execute(sql`DELETE FROM patients WHERE organization_id = ${orgBId}`),
    );
    await databaseService.withOrganizationScope(orgId, (tx) =>
      tx.execute(sql`DELETE FROM memberships WHERE organization_id = ${orgId}`),
    );
    await databaseService.db.execute(sql`DELETE FROM users WHERE email = ${testEmail}`);
    await databaseService.db.execute(
      sql`DELETE FROM patient_record_counters WHERE organization_id IN (${orgId}, ${orgBId})`,
    );
    await databaseService.db.execute(
      sql`DELETE FROM organizations WHERE id IN (${orgId}, ${orgBId})`,
    );
    await authPool.end();
    await app.close();
  });

  it('POST /patients cree une fiche et renvoie 201', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({
        firstName: 'Fatima',
        lastName: 'Controller',
        dateOfBirthUnknown: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.firstName).toBe('Fatima');
    expect(body.data.record.sequentialNumber).toBeGreaterThanOrEqual(1);
  });

  it('POST /patients sans dateOfBirth ni dateOfBirthUnknown renvoie 400 (Q1)', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Sans', lastName: 'Date' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /patients avec un CIN mal forme reussit quand meme, avec un avertissement (Q2, jamais bloquant)', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({
        firstName: 'Cin',
        lastName: 'MalForme',
        dateOfBirthUnknown: true,
        cin: '123456',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.meta.warnings).toBeDefined();
  });

  it('POST /patients avec un e-mail mal forme reussit quand meme, avec un avertissement (spec design, jamais bloquant)', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({
        firstName: 'Email',
        lastName: 'MalForme',
        dateOfBirthUnknown: true,
        email: 'pas-un-email',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.meta.warnings).toBeDefined();
  });

  it('GET /patients/:id renvoie la fiche creee', async () => {
    const createRes = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Karim', lastName: 'Get', dateOfBirthUnknown: true }),
    });
    const created = (await createRes.json()).data;

    const res = await fetch(`${httpServer}/api/v1/patients/${created.id}`, {
      headers: { Cookie: cookie, 'x-organization-id': orgId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(created.id);
  });

  it('GET /patients/:id sur un id absent renvoie 404', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients/00000000-0000-0000-0000-000000000000`, {
      headers: { Cookie: cookie, 'x-organization-id': orgId },
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /patients/:id modifie l identite et le statut du dossier', async () => {
    const createRes = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Avant', lastName: 'Patch', dateOfBirthUnknown: true }),
    });
    const created = (await createRes.json()).data;

    const res = await fetch(`${httpServer}/api/v1/patients/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({ firstName: 'Apres', status: 'archived' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.firstName).toBe('Apres');
    expect(body.data.record.status).toBe('archived');
  });

  it('POST /patients refuse (400) un responsable appartenant a une autre organisation', async () => {
    const responsible = await createPatient(databaseService, orgBId, {
      firstName: 'Resp',
      lastName: 'AutreOrg',
      dateOfBirthUnknown: true,
    });

    const res = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({
        firstName: 'Dependant',
        lastName: 'MauvaisResponsable',
        dateOfBirthUnknown: true,
        responsiblePatientRecordId: responsible.record.id,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /patients?q= retrouve un patient malgre une variante d accent', async () => {
    await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({
        firstName: 'Fatima',
        lastName: 'Rechercheq',
        dateOfBirthUnknown: true,
      }),
    });

    const res = await fetch(
      `${httpServer}/api/v1/patients?q=${encodeURIComponent('fatma rechercheq')}`,
      { headers: { Cookie: cookie, 'x-organization-id': orgId } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.some((p: { lastName: string }) => p.lastName === 'Rechercheq')).toBe(true);
  });

  it('GET /patients?phone= retrouve un patient quelle que soit la forme de saisie', async () => {
    await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgId },
      body: JSON.stringify({
        firstName: 'Tel',
        lastName: 'Rechercheq',
        dateOfBirthUnknown: true,
        phoneNationalNumber: '0644556677',
      }),
    });

    const res = await fetch(`${httpServer}/api/v1/patients?phone=%2B212644556677`, {
      headers: { Cookie: cookie, 'x-organization-id': orgId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.some((p: { lastName: string }) => p.lastName === 'Rechercheq')).toBe(true);
  });

  it('sans la permission requise, l acces est refuse (403) -- meme mecanique que TASK-016', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-organization-id': orgBId },
      body: JSON.stringify({ firstName: 'X', lastName: 'Y', dateOfBirthUnknown: true }),
    });
    // L utilisateur n est membre que de orgId, jamais de orgBId : refuse par le Guard.
    expect(res.status).toBe(403);
  });
});
