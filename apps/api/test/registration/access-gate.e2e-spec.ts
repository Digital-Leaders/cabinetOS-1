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
import { createTestAccount } from '../fixtures/test-accounts';

// TASK-056 (BUILD-004 etape 2, EA-016, ADR-0021 D4) : un compte dont la demande
// d'inscription n'est pas ACTIVE n'accede a AUCUNE donnee metier -- meme s'il contourne le
// front, et meme s'il possedait une adhesion et toutes les permissions (defense en
// profondeur : le RBAC n'est pas la seule protection).
//
// Chaque refus est accompagne de son controle positif : le MEME compte, une fois ACTIVE,
// accede normalement. Un compte sans demande (equipe, demos de l'etape 1) n'est jamais
// concerne.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;
const NOT_VALIDATED = /pas encore ete validee/;

type NonActiveStatus = 'PENDING_VERIFICATION' | 'COMPLEMENT_REQUESTED' | 'REFUSED';
const NON_ACTIVE_STATUSES: NonActiveStatus[] = [
  'PENDING_VERIFICATION',
  'COMPLEMENT_REQUESTED',
  'REFUSED',
];

describe('Un non-ACTIVE n accede a aucune donnee (e2e, TASK-056)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let adminPool: Pool;
  let httpServer: string;
  let orgId: string;
  let roleId: string;
  const runId = Date.now();
  const emails: string[] = [];

  async function registerFounder(label: string) {
    const email = `gate-${label}-${runId}@example.com`;
    emails.push(email);
    const res = await fetch(`${httpServer}/api/v1/registration-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Youssef',
        lastName: 'Bennani',
        email,
        password: 'password1234',
        specialty: 'pediatrie',
        structureName: 'Cabinet Gate',
        city: 'Rabat',
      }),
    });
    expect(res.status).toBe(201);
    const cookie = (res.headers.get('set-cookie') as string).split(';')[0];
    const { data } = await res.json();
    const [user] = (
      await databaseService.db.execute(sql`SELECT id FROM users WHERE email = ${email}`)
    ).rows as { id: string }[];
    return { email, cookie, requestId: data.id as string, userId: user.id };
  }

  async function setStatus(requestId: string, status: NonActiveStatus | 'ACTIVE') {
    // Les contraintes de la base (0018, 0021) imposent la forme de chaque statut.
    if (status === 'ACTIVE') {
      await databaseService.db.execute(sql`
        UPDATE registration_requests
        SET status = 'ACTIVE', organization_id = ${orgId},
            complement_requested_info = NULL, complement_message = NULL
        WHERE id = ${requestId}`);
    } else if (status === 'REFUSED') {
      await databaseService.db.execute(sql`
        UPDATE registration_requests
        SET status = 'REFUSED', refusal_internal_reason = 'motif', refusal_message_to_applicant = 'message',
            complement_requested_info = NULL, complement_message = NULL
        WHERE id = ${requestId}`);
    } else if (status === 'COMPLEMENT_REQUESTED') {
      await databaseService.db.execute(sql`
        UPDATE registration_requests
        SET status = 'COMPLEMENT_REQUESTED', complement_requested_info = 'info', complement_message = 'msg'
        WHERE id = ${requestId}`);
    } else {
      await databaseService.db.execute(sql`
        UPDATE registration_requests SET status = 'PENDING_VERIFICATION' WHERE id = ${requestId}`);
    }
  }

  const call = (method: string, path: string, cookie: string, withOrg = true, body?: unknown) =>
    fetch(`${httpServer}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        ...(withOrg ? { 'x-organization-id': orgId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  /** Les quatre points d'entree de donnees metier existants (Patient et Medecin, lecture et ecriture). */
  const DATA_ENDPOINTS: [string, string, string, unknown?][] = [
    ['lecture patients', 'GET', '/patients?q=test'],
    [
      'ecriture patients',
      'POST',
      '/patients',
      { firstName: 'A', lastName: 'B', dateOfBirthUnknown: true },
    ],
    ['lecture medecins', 'GET', '/medecins?q=test'],
    ['ecriture medecins', 'POST', '/medecins', { firstName: 'A', lastName: 'B' }],
  ];

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL) throw new Error('ADMIN_DATABASE_URL est requis (nettoyage).');
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
      name: 'Access Gate Test Org',
      slug: `access-gate-test-${runId}`,
    });
    orgId = org.id;
    // Un role qui possede TOUTES les permissions de donnees : si la garde ne tenait que par
    // l'absence de permissions, ce role la ferait sauter.
    roleId = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'AccessGateRole-' + runId})`,
    );
    const perms = await databaseService.db.execute(
      sql`SELECT id FROM permissions WHERE resource IN ('patients', 'medecins')`,
    );
    for (const row of perms.rows as { id: string }[]) {
      await databaseService.db.execute(
        sql`INSERT INTO role_permissions (role_id, permission_id) VALUES (${roleId}, ${row.id}) ON CONFLICT DO NOTHING`,
      );
    }
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM patient_records WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM patients WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM patient_record_counters WHERE organization_id = $1', [
      orgId,
    ]);
    await adminPool.query('DELETE FROM medecins WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM audit_events WHERE organization_id = $1', [orgId]);
    await adminPool.query(
      `DELETE FROM registration_events WHERE registration_request_id IN
         (SELECT r.id FROM registration_requests r JOIN users u ON u.id = r.user_id WHERE u.email = ANY($1))`,
      [emails],
    );
    await adminPool.query(
      `DELETE FROM registration_requests WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`,
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

  describe('fondateur sans adhesion (le cas normal, refuse par construction ET par la garde)', () => {
    it.each(NON_ACTIVE_STATUSES)(
      '%s : aucune donnee, sur chaque point d entree',
      async (status) => {
        const founder = await registerFounder(`plain-${status.toLowerCase()}`);
        await setStatus(founder.requestId, status);

        for (const [label, method, path, body] of DATA_ENDPOINTS) {
          const res = await call(method, path, founder.cookie, true, body);
          expect({ label, status: res.status }).toEqual({ label, status: 403 });
          expect(JSON.stringify(await res.json())).toMatch(NOT_VALIDATED);
        }
      },
    );

    it('meme sans en-tete d organisation : refus specifique a l inscription, pas le message generique', async () => {
      const founder = await registerFounder('no-header');
      const res = await call('GET', '/patients?q=test', founder.cookie, false);
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toMatch(NOT_VALIDATED);
    });
  });

  describe('defense en profondeur : meme AVEC une adhesion et toutes les permissions', () => {
    it.each(NON_ACTIVE_STATUSES)(
      '%s + adhesion : toujours refuse ; une fois ACTIVE, le meme compte accede',
      async (status) => {
        const founder = await registerFounder(`member-${status.toLowerCase()}`);
        await createMembership(databaseService, orgId, { userId: founder.userId, roleId });
        await setStatus(founder.requestId, status);

        // Refus : l'adhesion et le role ne suffisent pas.
        for (const [label, method, path, body] of DATA_ENDPOINTS) {
          const res = await call(method, path, founder.cookie, true, body);
          expect({ label, status: res.status }).toEqual({ label, status: 403 });
        }
        // Rien n'a ete cree par les ecritures refusees.
        const created = await databaseService.withOrganizationScope(orgId, (tx) =>
          tx.execute(sql`SELECT count(*)::int AS n FROM patients WHERE organization_id = ${orgId}`),
        );
        expect((created.rows[0] as { n: number }).n).toBe(0);

        // Controle positif : le MEME compte, une fois la demande validee, accede.
        await setStatus(founder.requestId, 'ACTIVE');
        expect((await call('GET', '/patients?q=test', founder.cookie)).status).toBe(200);
        expect((await call('GET', '/medecins?q=test', founder.cookie)).status).toBe(200);

        // Nettoyage pour le test suivant : l'adhesion et les donnees creees.
        await adminPool.query('DELETE FROM memberships WHERE user_id = $1', [founder.userId]);
      },
    );

    it('une ecriture reussit des que la demande est ACTIVE (controle positif complet)', async () => {
      const founder = await registerFounder('active-write');
      await createMembership(databaseService, orgId, { userId: founder.userId, roleId });
      await setStatus(founder.requestId, 'ACTIVE');

      const res = await call('POST', '/patients', founder.cookie, true, {
        firstName: 'Fatima',
        lastName: 'Alaoui',
        dateOfBirthUnknown: true,
      });
      expect(res.status).toBe(201);
    });
  });

  describe('les routes « session seule » restent accessibles : c est ainsi qu un fondateur atteint son ecran de statut', () => {
    it.each(NON_ACTIVE_STATUSES)(
      '%s : statut et liste de ses organisations repondent',
      async (status) => {
        const founder = await registerFounder(`auth-only-${status.toLowerCase()}`);
        await setStatus(founder.requestId, status);

        const statusRes = await call('GET', '/identity/registration-status', founder.cookie, false);
        expect(statusRes.status).toBe(200);
        expect((await statusRes.json()).data.status).toBe(status);

        const orgsRes = await call('GET', '/identity/organizations', founder.cookie, false);
        expect(orgsRes.status).toBe(200);
        expect((await orgsRes.json()).data).toEqual([]);
      },
    );
  });

  describe('un compte sans demande (equipe, demos de l etape 1) n est jamais concerne', () => {
    it('acces normal avec adhesion et permissions, comme avant', async () => {
      const email = `gate-team-${runId}@example.com`;
      emails.push(email);
      const team = await createTestAccount({ email, password: 'equipe-mdp-1234', name: 'Equipe' });
      await createMembership(databaseService, orgId, { userId: team.userId, roleId });

      expect((await call('GET', '/patients?q=test', team.cookie)).status).toBe(200);
      expect((await call('GET', '/medecins?q=test', team.cookie)).status).toBe(200);
    });

    it('sans adhesion : refus par permission manquante (message generique), pas par la garde', async () => {
      const email = `gate-team-noperm-${runId}@example.com`;
      emails.push(email);
      const team = await createTestAccount({ email, password: 'equipe-mdp-1234', name: 'Equipe' });

      const res = await call('GET', '/patients?q=test', team.cookie);
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toMatch(NOT_VALIDATED);
    });
  });
});
