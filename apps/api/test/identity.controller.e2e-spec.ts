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

// Parcours d'acces, etape 1, commit 2 (ADR-0019) : GET /identity/organizations et
// POST /identity/organizations/:id/default sont les deux endpoints qui alimentent
// la resolution d'organisation a la connexion -- @RequireAuthentication(), jamais
// @RequirePermission() (aucune organisation n est encore selectionnee a ce stade).
//
// Les 3 cas de resolution demandes par la spec (une seule -> directe ; plusieurs +
// defaut -> defaut ; plusieurs sans defaut -> choix) sont testes ici via le
// contenu retourne par GET /identity/organizations -- la decision elle-meme
// (quel ecran ouvrir) est cote frontend (login-form.tsx / resolve-organization),
// teste separement.

describe('IdentityController -- organizations (e2e, ADR-0019)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let httpServer: string;
  const origin = 'http://localhost:3001';
  const roleId = uuidv7();

  let orgSingle: { id: string };
  let orgMultiA: { id: string };
  let orgMultiB: { id: string };

  const emailSingleOrg = `identity-single-${Date.now()}@example.com`;
  const emailMultiOrgNoDefault = `identity-multi-nodefault-${Date.now()}@example.com`;
  const password = 'password1234';

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

    orgSingle = await createOrganization(databaseService, {
      name: 'Identity Test Org Single',
      slug: `identity-test-single-${Date.now()}`,
    });
    orgMultiA = await createOrganization(databaseService, {
      name: 'Identity Test Org Multi A',
      slug: `identity-test-multi-a-${Date.now()}`,
    });
    orgMultiB = await createOrganization(databaseService, {
      name: 'Identity Test Org Multi B',
      slug: `identity-test-multi-b-${Date.now()}`,
    });

    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'IdentityTestRole-' + roleId})`,
    );

    // Utilisateur A : une seule organisation.
    await fetch(`${httpServer}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: emailSingleOrg, password, name: 'Single Org User' }),
    });
    const singleUserResult = await databaseService.db.execute(
      sql`SELECT id FROM users WHERE email = ${emailSingleOrg}`,
    );
    const singleUserId = (singleUserResult.rows[0] as { id: string }).id;
    await createMembership(databaseService, orgSingle.id, { userId: singleUserId, roleId });

    // Utilisateur B : deux organisations, aucun defaut choisi.
    await fetch(`${httpServer}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: emailMultiOrgNoDefault, password, name: 'Multi Org User' }),
    });
    const multiUserResult = await databaseService.db.execute(
      sql`SELECT id FROM users WHERE email = ${emailMultiOrgNoDefault}`,
    );
    const multiUserId = (multiUserResult.rows[0] as { id: string }).id;
    await createMembership(databaseService, orgMultiA.id, { userId: multiUserId, roleId });
    await createMembership(databaseService, orgMultiB.id, { userId: multiUserId, roleId });
  });

  afterAll(async () => {
    for (const org of [orgSingle, orgMultiA, orgMultiB]) {
      await databaseService.withOrganizationScope(org.id, (tx) =>
        tx.execute(sql`DELETE FROM memberships WHERE organization_id = ${org.id}`),
      );
    }
    await databaseService.db.execute(sql`DELETE FROM roles WHERE id = ${roleId}`);
    await databaseService.db.execute(
      sql`DELETE FROM users WHERE email IN (${emailSingleOrg}, ${emailMultiOrgNoDefault})`,
    );
    await databaseService.db.execute(
      sql`DELETE FROM organizations WHERE id IN (${orgSingle.id}, ${orgMultiA.id}, ${orgMultiB.id})`,
    );
    await authPool.end();
    await app.close();
  });

  async function loginAs(email: string): Promise<string> {
    const res = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email, password }),
    });
    return (res.headers.get('set-cookie') as string).split(';')[0];
  }

  it('sans session : 401, meme sans en-tete d organisation', async () => {
    const res = await fetch(`${httpServer}/api/v1/identity/organizations`);
    expect(res.status).toBe(401);
  });

  it('cas 1 -- une seule organisation : la liste contient une entree, l ouverture directe ne depend pas d isDefault', async () => {
    const cookie = await loginAs(emailSingleOrg);

    const res = await fetch(`${httpServer}/api/v1/identity/organizations`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      {
        organizationId: orgSingle.id,
        organizationName: 'Identity Test Org Single',
        isDefault: false,
      },
    ]);
  });

  it('cas 3 -- plusieurs organisations, aucun defaut : ne demande jamais de choisir quand il n y a rien a choisir (ici, il y a bien un choix reel)', async () => {
    const cookie = await loginAs(emailMultiOrgNoDefault);

    const res = await fetch(`${httpServer}/api/v1/identity/organizations`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.every((m: { isDefault: boolean }) => m.isDefault === false)).toBe(true);
  });

  it('cas 2 -- plusieurs organisations, defaut defini via POST .../default : la liste reflete le nouveau defaut', async () => {
    const cookie = await loginAs(emailMultiOrgNoDefault);

    const setDefaultRes = await fetch(
      `${httpServer}/api/v1/identity/organizations/${orgMultiB.id}/default`,
      { method: 'POST', headers: { Cookie: cookie } },
    );
    expect(setDefaultRes.status).toBe(201);

    const res = await fetch(`${httpServer}/api/v1/identity/organizations`, {
      headers: { Cookie: cookie },
    });
    const body = await res.json();
    expect(
      body.data.find((m: { organizationId: string }) => m.organizationId === orgMultiB.id)
        .isDefault,
    ).toBe(true);
    expect(
      body.data.find((m: { organizationId: string }) => m.organizationId === orgMultiA.id)
        .isDefault,
    ).toBe(false);
  });

  it('POST .../default avec une organisation etrangere a l utilisateur : 400, sur par construction', async () => {
    const cookie = await loginAs(emailSingleOrg);

    const res = await fetch(`${httpServer}/api/v1/identity/organizations/${orgMultiA.id}/default`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(400);

    // La liste de l utilisateur reste inchangee -- aucune ligne modifiee.
    const check = await fetch(`${httpServer}/api/v1/identity/organizations`, {
      headers: { Cookie: cookie },
    });
    const body = await check.json();
    expect(body.data).toEqual([
      {
        organizationId: orgSingle.id,
        organizationName: 'Identity Test Org Single',
        isDefault: false,
      },
    ]);
  });
});
