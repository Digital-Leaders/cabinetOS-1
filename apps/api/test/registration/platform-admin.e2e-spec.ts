import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { AppModule } from '../../src/app.module';
import { auth, authPool } from '../../src/modules/identity/infrastructure/auth';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import { GlobalExceptionFilter } from '../../src/modules/shared/filters/http-exception.filter';
import { createOrganization, createMembership } from '../../src/modules/organization';
import { ORPHAN_ACCOUNT_MIN_AGE_MINUTES } from '../../src/business/registration';
import { createTestAccount } from '../fixtures/test-accounts';

// BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 D3, P1, P3) : l'administrateur de PLATEFORME,
// de bout en bout (HTTP -> garde -> base). Verifie : qui entre, qui est refuse, que ce droit
// n'ouvre AUCUNE donnee d'organisation, et qu'un administrateur n'est jamais recupere comme
// orphelin par le parcours d'inscription.
//
// Un administrateur est ajoute avec la connexion d'administration (adminPool), comme le fait
// le script admin:grant : le role applicatif n'a pas le droit d'ecrire dans platform_admins.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;
const NEUTRAL_MESSAGE =
  'Un espace existe deja avec cet email. Connectez-vous, ou contactez-nous si besoin.';

describe('Administrateur de plateforme (e2e, TASK-058)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let adminPool: Pool;
  let httpServer: string;
  let orgId: string;
  let roleId: string;
  const runId = Date.now();
  const emails: string[] = [];

  async function newAccount(label: string) {
    const email = `padmin-${label}-${runId}@example.com`;
    emails.push(email);
    return createTestAccount({ email, password: 'equipe-mdp-1234', name: label }).then((a) => ({
      ...a,
      email,
    }));
  }

  async function makeAdmin(userId: string, revoked = false) {
    await adminPool.query(
      `INSERT INTO platform_admins (user_id, granted_by, reason, revoked_at)
       VALUES ($1, 'Test Operateur', 'test e2e', ${revoked ? 'now()' : 'NULL'})`,
      [userId],
    );
  }

  const call = (path: string, cookie?: string, headers: Record<string, string> = {}) =>
    fetch(`${httpServer}/api/v1${path}`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
    });

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL) throw new Error('ADMIN_DATABASE_URL est requis.');
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });

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
    httpServer = `http://127.0.0.1:${app.getHttpServer().address().port}`;

    const org = await createOrganization(databaseService, {
      name: 'Platform Admin Test Org',
      slug: `platform-admin-test-${runId}`,
    });
    orgId = org.id;
    roleId = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'PlatformAdminRole-' + runId})`,
    );
    const perms = await databaseService.db.execute(
      sql`SELECT id FROM permissions WHERE resource = 'patients'`,
    );
    for (const row of perms.rows as { id: string }[]) {
      await databaseService.db.execute(
        sql`INSERT INTO role_permissions (role_id, permission_id) VALUES (${roleId}, ${row.id}) ON CONFLICT DO NOTHING`,
      );
    }
  });

  afterAll(async () => {
    await adminPool.query(
      `DELETE FROM registration_events WHERE registration_request_id IN
         (SELECT r.id FROM registration_requests r JOIN users u ON u.id = r.user_id WHERE u.email = ANY($1))`,
      [emails],
    );
    await adminPool.query(
      `DELETE FROM registration_requests WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`,
      [emails],
    );
    await adminPool.query(
      'DELETE FROM platform_admins WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))',
      [emails],
    );
    await adminPool.query('DELETE FROM memberships WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await adminPool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await adminPool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    await adminPool.query('DELETE FROM roles WHERE id = $1', [roleId]);
    await adminPool.end();
    await authPool.end();
    await app.close();
  });

  describe('GET /admin/me', () => {
    it('sans session : 401', async () => {
      expect((await call('/admin/me')).status).toBe(401);
    });

    it('administrateur actif : 200, sans en-tete d organisation', async () => {
      const admin = await newAccount('actif');
      await makeAdmin(admin.userId);

      const res = await call('/admin/me', admin.cookie);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ userId: admin.userId, isPlatformAdmin: true });
    });

    it('un en-tete d organisation, meme etranger, n y change rien', async () => {
      const admin = await newAccount('avec-entete');
      await makeAdmin(admin.userId);
      const res = await call('/admin/me', admin.cookie, { 'x-organization-id': orgId });
      expect(res.status).toBe(200);
    });

    it('membre d une organisation avec TOUTES les permissions de donnees : 403 (ce n est pas un droit d organisation)', async () => {
      const member = await newAccount('membre');
      await createMembership(databaseService, orgId, { userId: member.userId, roleId });

      const res = await call('/admin/me', member.cookie, { 'x-organization-id': orgId });
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toMatch(/administrateurs de la plateforme/);
    });

    it('compte sans aucun droit : 403', async () => {
      const plain = await newAccount('simple');
      expect((await call('/admin/me', plain.cookie)).status).toBe(403);
    });

    it('fondateur dont la demande est en verification : 403', async () => {
      const email = `padmin-founder-${runId}@example.com`;
      emails.push(email);
      const reg = await fetch(`${httpServer}/api/v1/registration-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Youssef',
          lastName: 'Bennani',
          email,
          password: 'password1234',
          specialty: 'pediatrie',
          structureName: 'Cabinet',
          city: 'Rabat',
        }),
      });
      expect(reg.status).toBe(201);
      const cookie = (reg.headers.get('set-cookie') as string).split(';')[0];
      expect((await call('/admin/me', cookie)).status).toBe(403);
    });

    it('administrateur REVOQUE : 403 -- la ligne reste (trace), la garde l ignore ; reactive, 200', async () => {
      const admin = await newAccount('revoque');
      await makeAdmin(admin.userId);
      expect((await call('/admin/me', admin.cookie)).status).toBe(200);

      await adminPool.query('UPDATE platform_admins SET revoked_at = now() WHERE user_id = $1', [
        admin.userId,
      ]);
      expect((await call('/admin/me', admin.cookie)).status).toBe(403);

      // Controle positif : la reactivation (decision humaine, a la main) rouvre l'acces.
      await adminPool.query('UPDATE platform_admins SET revoked_at = NULL WHERE user_id = $1', [
        admin.userId,
      ]);
      expect((await call('/admin/me', admin.cookie)).status).toBe(200);
    });

    it('en-tetes usurpes (x-user-id...) : sans effet, l identite vient de la session', async () => {
      const admin = await newAccount('admin-usurpe');
      await makeAdmin(admin.userId);
      const plain = await newAccount('simple-usurpateur');

      const res = await call('/admin/me', plain.cookie, {
        'x-user-id': admin.userId,
        'x-forwarded-user': admin.userId,
      });
      expect(res.status).toBe(403);
    });
  });

  describe('etre administrateur de plateforme n ouvre AUCUNE donnee d organisation', () => {
    it('sans adhesion : refus par permission manquante sur les donnees, comme tout compte', async () => {
      const admin = await newAccount('donnees');
      await makeAdmin(admin.userId);

      const res = await call('/patients?q=test', admin.cookie, { 'x-organization-id': orgId });
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toMatch(/Permission manquante/);
    });

    it('administrateur ET membre : il garde exactement les permissions de son role (ici, patients)', async () => {
      const admin = await newAccount('admin-membre');
      await makeAdmin(admin.userId);
      await createMembership(databaseService, orgId, { userId: admin.userId, roleId });

      expect(
        (await call('/patients?q=test', admin.cookie, { 'x-organization-id': orgId })).status,
      ).toBe(200);
      // ... et rien de plus : medecins n'est pas dans son role.
      expect(
        (await call('/medecins?q=test', admin.cookie, { 'x-organization-id': orgId })).status,
      ).toBe(403);
    });
  });

  describe('un administrateur n est jamais recupere comme orphelin (ADR-0021 P1)', () => {
    async function ageAccount(userId: string) {
      await databaseService.db.execute(
        sql`UPDATE users SET created_at = now() - make_interval(mins => ${ORPHAN_ACCOUNT_MIN_AGE_MINUTES + 60}) WHERE id = ${userId}`,
      );
    }
    async function register(email: string) {
      return fetch(`${httpServer}/api/v1/registration-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Youssef',
          lastName: 'Bennani',
          email,
          password: 'password1234',
          specialty: 'generaliste',
          structureName: 'Cabinet',
          city: 'Rabat',
        }),
      });
    }
    async function usersWithEmail(email: string) {
      const r = await databaseService.db.execute(sql`SELECT id FROM users WHERE email = ${email}`);
      return r.rows as { id: string }[];
    }

    it('TEMOIN : un compte ancien sans demande, sans adhesion et SANS ligne admin est bien recupere', async () => {
      const plain = await newAccount('temoin-orphelin');
      await ageAccount(plain.userId);

      const res = await register(plain.email);
      expect(res.status).toBe(201);
      const users = await usersWithEmail(plain.email);
      expect(users).toHaveLength(1);
      expect(users[0].id).not.toBe(plain.userId);
    });

    it('le MEME profil, mais administrateur : jamais recupere, 409 neutre, compte et ligne intacts', async () => {
      const admin = await newAccount('admin-orphelin');
      await makeAdmin(admin.userId);
      await ageAccount(admin.userId);

      const res = await register(admin.email);
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toBe(NEUTRAL_MESSAGE);
      expect(await usersWithEmail(admin.email)).toEqual([{ id: admin.userId }]);
      expect((await call('/admin/me', admin.cookie)).status).toBe(200);
    });

    it('meme REVOQUE, sa ligne le protege : jamais recupere', async () => {
      const admin = await newAccount('admin-revoque-orphelin');
      await makeAdmin(admin.userId, true);
      await ageAccount(admin.userId);

      const res = await register(admin.email);
      expect(res.status).toBe(409);
      expect(await usersWithEmail(admin.email)).toEqual([{ id: admin.userId }]);
    });
  });
});
