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

// Parcours d'acces, etape 1, commit 3 -- LE livrable le plus important de ce
// chantier (dixit la spec) : preuve qu'apres bascule d'organisation en cours de
// session, un utilisateur ne voit JAMAIS un reliquat de l'ancienne organisation.
//
// Different des suites d isolation existantes (tests/isolation/patient-isolation.spec.ts,
// medecin-isolation.spec.ts) : celles-ci prouvent deja qu une donnee creee dans
// une organisation est invisible scopee sur une autre -- au niveau des fonctions
// de requete. Ce test-ci prouve la MEME propriete mais au niveau HTTP complet
// (guard -> controleur -> RLS), avec UN SEUL utilisateur authentifie UNE SEULE
// fois, membre reel des deux organisations, qui bascule uniquement en changeant
// l en-tete x-organization-id entre deux requetes -- exactement ce que fait
// AppHeader cote frontend apres un rechargement complet. Aucune deconnexion,
// aucune nouvelle session : le meme cookie sert aux deux organisations.
//
// Meme exigence que les trois gestes d isolation des modules : prouver le
// refus/l etancheite, pas seulement que la bascule fonctionne (controle positif
// inclus dans chaque sens).

describe('Changement d organisation en cours de session -- etancheite (e2e, commit 3)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let httpServer: string;
  const origin = 'http://localhost:3001';
  const testEmail = `org-switch-test-${Date.now()}@example.com`;
  const testPassword = 'password1234';

  let orgA: { id: string };
  let orgB: { id: string };
  let cookie: string;
  let patientInA: { id: string };
  let patientInB: { id: string };

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

    orgA = await createOrganization(databaseService, {
      name: 'Org Switch Test A',
      slug: `org-switch-test-a-${Date.now()}`,
    });
    orgB = await createOrganization(databaseService, {
      name: 'Org Switch Test B',
      slug: `org-switch-test-b-${Date.now()}`,
    });

    // Meme role/permissions (lecture + gestion des patients) dans les DEUX
    // organisations -- l utilisateur est un membre reel des deux, pas un
    // acces devine ou force.
    const roleId = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'OrgSwitchTestRole-' + Date.now()})`,
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
      body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Org Switch Test' }),
    });
    const usersResult = await databaseService.db.execute(
      sql`SELECT id FROM users WHERE email = ${testEmail}`,
    );
    const userId = (usersResult.rows[0] as { id: string }).id;

    await createMembership(databaseService, orgA.id, { userId, roleId });
    await createMembership(databaseService, orgB.id, { userId, roleId });

    const signInRes = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    cookie = (signInRes.headers.get('set-cookie') as string).split(';')[0];

    // Une fiche patient distincte par organisation, creee via HTTP -- avec le
    // MEME cookie de session, seul l en-tete d organisation change entre les
    // deux appels. C est exactement la "bascule" a prouver etanche.
    const createInA = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'x-organization-id': orgA.id,
      },
      body: JSON.stringify({
        firstName: 'Bascule',
        lastName: 'DansOrgA',
        dateOfBirthUnknown: true,
      }),
    });
    patientInA = (await createInA.json()).data;

    const createInB = await fetch(`${httpServer}/api/v1/patients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'x-organization-id': orgB.id,
      },
      body: JSON.stringify({
        firstName: 'Bascule',
        lastName: 'DansOrgB',
        dateOfBirthUnknown: true,
      }),
    });
    patientInB = (await createInB.json()).data;
  });

  afterAll(async () => {
    await databaseService.withOrganizationScope(orgA.id, (tx) =>
      tx.execute(sql`DELETE FROM patient_records WHERE organization_id = ${orgA.id}`),
    );
    await databaseService.withOrganizationScope(orgB.id, (tx) =>
      tx.execute(sql`DELETE FROM patient_records WHERE organization_id = ${orgB.id}`),
    );
    await databaseService.withOrganizationScope(orgA.id, (tx) =>
      tx.execute(sql`DELETE FROM patients WHERE organization_id = ${orgA.id}`),
    );
    await databaseService.withOrganizationScope(orgB.id, (tx) =>
      tx.execute(sql`DELETE FROM patients WHERE organization_id = ${orgB.id}`),
    );
    await databaseService.db.execute(
      sql`DELETE FROM patient_record_counters WHERE organization_id IN (${orgA.id}, ${orgB.id})`,
    );
    await databaseService.withOrganizationScope(orgA.id, (tx) =>
      tx.execute(sql`DELETE FROM memberships WHERE organization_id = ${orgA.id}`),
    );
    await databaseService.withOrganizationScope(orgB.id, (tx) =>
      tx.execute(sql`DELETE FROM memberships WHERE organization_id = ${orgB.id}`),
    );
    await databaseService.db.execute(sql`DELETE FROM users WHERE email = ${testEmail}`);
    await databaseService.db.execute(
      sql`DELETE FROM organizations WHERE id IN (${orgA.id}, ${orgB.id})`,
    );
    await authPool.end();
    await app.close();
  });

  it('controle positif : chaque organisation voit bien sa propre fiche (avant de prouver le refus)', async () => {
    const resA = await fetch(`${httpServer}/api/v1/patients/${patientInA.id}`, {
      headers: { Cookie: cookie, 'x-organization-id': orgA.id },
    });
    expect(resA.status).toBe(200);

    const resB = await fetch(`${httpServer}/api/v1/patients/${patientInB.id}`, {
      headers: { Cookie: cookie, 'x-organization-id': orgB.id },
    });
    expect(resB.status).toBe(200);
  });

  it('bascule A -> B (meme cookie, en-tete different) : la recherche ne renvoie jamais la fiche de A', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients?q=Bascule`, {
      headers: { Cookie: cookie, 'x-organization-id': orgB.id },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(patientInB.id);
    expect(ids).not.toContain(patientInA.id);
  });

  it('bascule B -> A (meme cookie, en-tete different) : la recherche ne renvoie jamais la fiche de B', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients?q=Bascule`, {
      headers: { Cookie: cookie, 'x-organization-id': orgA.id },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(patientInA.id);
    expect(ids).not.toContain(patientInB.id);
  });

  it('reliquat impossible : demander la fiche de A avec l en-tete de B renvoie 404, jamais la fiche', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients/${patientInA.id}`, {
      headers: { Cookie: cookie, 'x-organization-id': orgB.id },
    });
    expect(res.status).toBe(404);
  });

  it('symetriquement : demander la fiche de B avec l en-tete de A renvoie 404, jamais la fiche', async () => {
    const res = await fetch(`${httpServer}/api/v1/patients/${patientInB.id}`, {
      headers: { Cookie: cookie, 'x-organization-id': orgA.id },
    });
    expect(res.status).toBe(404);
  });

  it('des allers-retours repetes (A, B, A, B) restent etanches a chaque etape, pas seulement au premier essai', async () => {
    for (const [org, expectedId, forbiddenId] of [
      [orgA, patientInA.id, patientInB.id],
      [orgB, patientInB.id, patientInA.id],
      [orgA, patientInA.id, patientInB.id],
      [orgB, patientInB.id, patientInA.id],
    ] as const) {
      const res = await fetch(`${httpServer}/api/v1/patients?q=Bascule`, {
        headers: { Cookie: cookie, 'x-organization-id': org.id },
      });
      const body = await res.json();
      const ids = body.data.map((p: { id: string }) => p.id);
      expect(ids).toContain(expectedId);
      expect(ids).not.toContain(forbiddenId);
    }
  });
});
