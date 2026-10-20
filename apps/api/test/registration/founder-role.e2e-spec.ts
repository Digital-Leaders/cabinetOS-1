import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { auth, authPool } from '../../src/modules/identity/infrastructure/auth';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import { GlobalExceptionFilter } from '../../src/modules/shared/filters/http-exception.filter';
import { createOrganization, createMembership } from '../../src/modules/organization';
import { findRoleByName } from '../../src/modules/access-control';
import { hasPermission } from '../../src/modules/access-control/infrastructure/permission-check.queries';
import { FOUNDER_ROLE_NAME } from '../../src/business/registration';
import { createTestAccount } from '../fixtures/test-accounts';

// BUILD-004 etape 2, EA-018 / TASK-062 (ADR-0021 D6, brief R4 operation 3) : le role « fondateur »
// seme par la migration 0025. A la validation d'une inscription, le fondateur devient le premier membre
// de son organisation avec CE role (cascade, TASK-063).
//
// Prouve : le jeu de permissions est EXACT (quatre, ni plus ni moins -- aucune gestion des membres, qui
// arrive avec l'etape 3) ; la migration est idempotente et echoue plutot que de creer un role
// incomplet ; et, de bout en bout, un membre porteur de ce role peut gerer et consulter patients et
// medecins, et RIEN d'autre.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;
const MIGRATION = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'db', 'migrations', '0025_founder-role.sql'),
  'utf-8',
);
const FOUNDER_PERMISSIONS = [
  'medecins:manage',
  'medecins:read',
  'patients:manage',
  'patients:read',
];

describe('role « fondateur » (TASK-062)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let adminPool: Pool;
  let httpServer: string;
  let orgId: string;
  let founderRoleId: string;
  const runId = Date.now();
  const emails: string[] = [];

  async function permissionsOfFounderRole(): Promise<string[]> {
    const result = await adminPool.query(
      `SELECT p.resource || ':' || p.action AS permission
       FROM roles r JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
       WHERE r.name = $1 ORDER BY 1`,
      [FOUNDER_ROLE_NAME],
    );
    return result.rows.map((row) => row.permission as string);
  }

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
      name: 'Founder Role Test Org',
      slug: `founder-role-test-${runId}`,
    });
    orgId = org.id;
    const role = await findRoleByName(databaseService, FOUNDER_ROLE_NAME);
    founderRoleId = role!.id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM patient_records WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM patients WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM patient_record_counters WHERE organization_id = $1', [
      orgId,
    ]);
    await adminPool.query('DELETE FROM medecins WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM audit_events WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM memberships WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await adminPool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await adminPool.end();
    await authPool.end();
    await app.close();
  });

  describe('le role existe, et la constante du code correspond a la migration', () => {
    it('findRoleByName retrouve le role par FOUNDER_ROLE_NAME', async () => {
      const role = await findRoleByName(databaseService, FOUNDER_ROLE_NAME);
      expect(role).toMatchObject({ name: 'fondateur' });
      expect(role?.description).toMatch(/Premier membre/);
    });

    it('un nom inconnu ne trouve rien (undefined, jamais une erreur)', async () => {
      expect(await findRoleByName(databaseService, 'role-qui-n-existe-pas')).toBeUndefined();
    });
  });

  describe('jeu de permissions EXACT (ADR-0021 D6)', () => {
    it('exactement manage et read sur patients et medecins : quatre, ni plus ni moins', async () => {
      expect(await permissionsOfFounderRole()).toEqual(FOUNDER_PERMISSIONS);
    });

    it('aucune permission de gestion des membres ni d administration : elles arrivent avec l etape 3', async () => {
      const permissions = await permissionsOfFounderRole();
      for (const forbidden of ['members', 'roles', 'organizations', 'permissions', 'audit']) {
        expect(permissions.some((p) => p.startsWith(`${forbidden}:`))).toBe(false);
      }
    });
  });

  describe('la migration 0025 : idempotente, et qui echoue plutot que de creer un role incomplet', () => {
    it('rejouee deux fois : ni role en double, ni permission en double, ni permission perdue', async () => {
      await adminPool.query(MIGRATION);
      await adminPool.query(MIGRATION);
      const count = await adminPool.query('SELECT count(*)::int AS n FROM roles WHERE name = $1', [
        FOUNDER_ROLE_NAME,
      ]);
      expect(count.rows[0].n).toBe(1);
      expect(await permissionsOfFounderRole()).toEqual(FOUNDER_PERMISSIONS);
    });

    it('n ENLEVE jamais une permission qu un operateur aurait ajoutee au role : elle ne fait qu ajouter', async () => {
      // Un cabinet n'a pas la main sur ce role (global), mais la migration ne doit jamais RETIRER une
      // permission qu'un operateur y aurait ajoutee : elle ne fait qu'ajouter.
      await adminPool.query(
        `INSERT INTO permissions (id, action, resource) VALUES (gen_random_uuid(), 'read', $1) ON CONFLICT DO NOTHING`,
        [`extra-${runId}`],
      );
      await adminPool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = $1 AND p.resource = $2`,
        [FOUNDER_ROLE_NAME, `extra-${runId}`],
      );
      try {
        await adminPool.query(MIGRATION);
        expect(await permissionsOfFounderRole()).toContain(`extra-${runId}:read`);
      } finally {
        await adminPool.query(`DELETE FROM permissions WHERE resource = $1`, [`extra-${runId}`]);
      }
      expect(await permissionsOfFounderRole()).toEqual(FOUNDER_PERMISSIONS);
    });

    it('ECHOUE si une des quatre permissions manque (au lieu de creer un role incomplet)', async () => {
      const client = await adminPool.connect();
      try {
        await client.query('BEGIN');
        // Simule un catalogue sans la permission « manage / patients », puis un role a recreer.
        await client.query(`DELETE FROM roles WHERE name = $1`, [FOUNDER_ROLE_NAME]);
        await client.query(
          `DELETE FROM permissions WHERE action = 'manage' AND resource = 'patients'`,
        );
        await expect(client.query(MIGRATION)).rejects.toThrow(
          /Role fondateur incomplet : 3 permission/,
        );
      } finally {
        // Tout est annule : le catalogue et le role reviennent tels qu'ils etaient.
        await client.query('ROLLBACK');
        client.release();
      }
      expect(await permissionsOfFounderRole()).toEqual(FOUNDER_PERMISSIONS);
    });
  });

  describe('ce que le role donne, et seulement cela (au niveau de la garde)', () => {
    it('un membre porteur du role a les quatre permissions, et AUCUNE autre', async () => {
      const email = `founder-role-perm-${runId}@example.com`;
      emails.push(email);
      const account = await createTestAccount({
        email,
        password: 'fondateur-mdp-1234',
        name: 'Fondateur',
      });
      await createMembership(databaseService, orgId, {
        userId: account.userId,
        roleId: founderRoleId,
      });

      const check = (action: string, resource: string) =>
        hasPermission(databaseService, orgId, account.userId, action, resource);
      expect(await check('manage', 'patients')).toBe(true);
      expect(await check('read', 'patients')).toBe(true);
      expect(await check('manage', 'medecins')).toBe(true);
      expect(await check('read', 'medecins')).toBe(true);
      for (const [action, resource] of [
        ['read', 'members'],
        ['manage', 'members'],
        ['manage', 'roles'],
        ['manage', 'organizations'],
        ['read', 'audit'],
      ]) {
        expect({ action, resource, granted: await check(action, resource) }).toEqual({
          action,
          resource,
          granted: false,
        });
      }
    });

    it('un membre qui n a PAS ce role n a rien : le role ne se diffuse pas', async () => {
      const email = `founder-role-none-${runId}@example.com`;
      emails.push(email);
      const account = await createTestAccount({
        email,
        password: 'fondateur-mdp-1234',
        name: 'Sans role',
      });
      expect(await hasPermission(databaseService, orgId, account.userId, 'read', 'patients')).toBe(
        false,
      );
    });
  });

  describe('de bout en bout (HTTP) : gerer et consulter patients et medecins, et rien d autre', () => {
    it('cree et lit un patient et un medecin ; l espace admin lui reste ferme', async () => {
      const email = `founder-role-http-${runId}@example.com`;
      emails.push(email);
      const account = await createTestAccount({
        email,
        password: 'fondateur-mdp-1234',
        name: 'Fondateur HTTP',
      });
      await createMembership(databaseService, orgId, {
        userId: account.userId,
        roleId: founderRoleId,
      });
      const call = (method: string, path: string, body?: unknown) =>
        fetch(`${httpServer}/api/v1${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Cookie: account.cookie,
            'x-organization-id': orgId,
          },
          body: body ? JSON.stringify(body) : undefined,
        });

      expect(
        (
          await call('POST', '/patients', {
            firstName: 'Fatima',
            lastName: 'Alaoui',
            dateOfBirthUnknown: true,
          })
        ).status,
      ).toBe(201);
      expect((await call('GET', '/patients?q=Alaoui')).status).toBe(200);
      expect(
        (await call('POST', '/medecins', { firstName: 'Omar', lastName: 'Fikri' })).status,
      ).toBe(201);
      expect((await call('GET', '/medecins?q=Fikri')).status).toBe(200);
      // Hors du perimetre du role : l'espace admin de la plateforme n'est pas ouvert a un fondateur.
      expect((await call('GET', '/admin/me')).status).toBe(403);
      expect((await call('GET', '/admin/registration-requests')).status).toBe(403);
    });
  });
});
