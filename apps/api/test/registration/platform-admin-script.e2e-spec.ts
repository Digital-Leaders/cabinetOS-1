import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { authPool } from '../../src/modules/identity/infrastructure/auth';
import { AUTH_PROVIDER, type AuthProvider } from '../../src/modules/identity';
import { grantPlatformAdmin, type AdminDb } from '../../scripts/platform-admin';
import { createTestAccount } from '../fixtures/test-accounts';

// BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 P1, P3) : le script admin:grant. Les invariants
// testes : la trace (qui, pourquoi) est obligatoire ; l'ecriture exige la connexion
// d'administration ; un compte cree par le script n'existe jamais sans sa ligne admin ; un
// compte deja existant n'est jamais supprime.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;

describe('Script admin:grant (TASK-058)', () => {
  let app: INestApplication;
  let authProvider: AuthProvider;
  let adminPool: Pool;
  let appRolePool: Pool;
  const runId = Date.now();
  const emails: string[] = [];

  const emailFor = (label: string) => {
    const email = `grant-${label}-${runId}@example.com`;
    emails.push(email);
    return email;
  };
  const base = {
    grantedBy: 'Zineb Benserrar',
    reason: 'co-fondatrice, validation des inscriptions',
  };

  async function accountRow(email: string) {
    const r = await adminPool.query('SELECT id FROM users WHERE email = $1', [email]);
    return r.rows[0] as { id: string } | undefined;
  }
  async function adminRow(userId: string) {
    const r = await adminPool.query('SELECT * FROM platform_admins WHERE user_id = $1', [userId]);
    return r.rows[0] as Record<string, unknown> | undefined;
  }

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL || !DATABASE_URL)
      throw new Error('ADMIN_DATABASE_URL et DATABASE_URL requis.');
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
    appRolePool = new Pool({ connectionString: DATABASE_URL });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    authProvider = app.get<AuthProvider>(AUTH_PROVIDER);
  });

  afterAll(async () => {
    await adminPool.query(
      'DELETE FROM platform_admins WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))',
      [emails],
    );
    await adminPool.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await adminPool.end();
    await appRolePool.end();
    await authPool.end();
    await app.close();
  });

  describe('compte inexistant : cree, puis promu, dans le meme lancement', () => {
    it('cree le compte ET la ligne, avec la trace (qui, pourquoi, quand)', async () => {
      const email = emailFor('nouveau');
      const result = await grantPlatformAdmin(
        { authProvider, adminDb: adminPool },
        { ...base, email, name: 'Nouvelle Admin', password: 'admin-mdp-12345' },
      );

      expect(result).toMatchObject({ accountCreated: true, outcome: 'GRANTED' });
      const row = await adminRow(result.userId);
      expect(row).toMatchObject({
        granted_by: 'Zineb Benserrar',
        reason: 'co-fondatrice, validation des inscriptions',
        revoked_at: null,
      });
      expect(row?.granted_at).toBeInstanceOf(Date);
    });

    it('sans nom ni mot de passe : refuse, rien n est cree', async () => {
      const email = emailFor('sans-mdp');
      await expect(
        grantPlatformAdmin({ authProvider, adminDb: adminPool }, { ...base, email }),
      ).rejects.toThrow(/--name et la variable TEAM_ACCOUNT_PASSWORD/);
      expect(await accountRow(email)).toBeUndefined();
    });

    it('mot de passe trop court : refuse, rien n est cree', async () => {
      const email = emailFor('mdp-court');
      await expect(
        grantPlatformAdmin(
          { authProvider, adminDb: adminPool },
          { ...base, email, name: 'Court', password: 'court' },
        ),
      ).rejects.toThrow(/Mot de passe refuse/);
      expect(await accountRow(email)).toBeUndefined();
    });
  });

  describe('compte deja existant : simplement promu', () => {
    it('promu sans etre recree ni modifie, email insensible a la casse', async () => {
      const email = emailFor('existant');
      const existing = await createTestAccount({
        email,
        password: 'ancien-mdp-1234',
        name: 'Existant',
      });

      const result = await grantPlatformAdmin(
        { authProvider, adminDb: adminPool },
        { ...base, email: email.toUpperCase() },
      );

      expect(result).toMatchObject({
        userId: existing.userId,
        accountCreated: false,
        outcome: 'GRANTED',
      });
      expect(await adminRow(existing.userId)).toMatchObject({ granted_by: 'Zineb Benserrar' });
    });

    it('relance pour un administrateur actif : ne change rien, la trace d origine est conservee', async () => {
      const email = emailFor('deja-admin');
      const existing = await createTestAccount({
        email,
        password: 'ancien-mdp-1234',
        name: 'Deja',
      });
      await grantPlatformAdmin({ authProvider, adminDb: adminPool }, { ...base, email });

      const again = await grantPlatformAdmin(
        { authProvider, adminDb: adminPool },
        { email, grantedBy: 'Quelqu un d autre', reason: 'autre raison' },
      );

      expect(again).toMatchObject({ outcome: 'ALREADY_ADMIN', accountCreated: false });
      expect(await adminRow(existing.userId)).toMatchObject({
        granted_by: 'Zineb Benserrar',
        reason: 'co-fondatrice, validation des inscriptions',
      });
    });

    it('ancien administrateur REVOQUE : refuse, la ligne n est pas effacee (decision humaine)', async () => {
      const email = emailFor('revoque');
      const existing = await createTestAccount({
        email,
        password: 'ancien-mdp-1234',
        name: 'Revoque',
      });
      await grantPlatformAdmin({ authProvider, adminDb: adminPool }, { ...base, email });
      await adminPool.query('UPDATE platform_admins SET revoked_at = now() WHERE user_id = $1', [
        existing.userId,
      ]);

      await expect(
        grantPlatformAdmin({ authProvider, adminDb: adminPool }, { ...base, email }),
      ).rejects.toThrow(/REVOQUE/);
      const row = await adminRow(existing.userId);
      expect(row?.revoked_at).not.toBeNull();
      expect(await accountRow(email)).toBeDefined();
    });
  });

  describe('la trace est obligatoire', () => {
    it.each([
      ['granted-by absent', { grantedBy: '', reason: 'une raison' }, /--granted-by/],
      ['granted-by blanc', { grantedBy: '   ', reason: 'une raison' }, /--granted-by/],
      ['reason absente', { grantedBy: 'Operateur', reason: '' }, /--reason/],
      ['reason blanche', { grantedBy: 'Operateur', reason: '  ' }, /--reason/],
    ])('%s : refuse, ni compte ni ligne', async (label, trace, message) => {
      const email = emailFor(`trace-${label.replace(/\s/g, '-')}`);
      await expect(
        grantPlatformAdmin(
          { authProvider, adminDb: adminPool },
          { ...trace, email, name: 'Sans Trace', password: 'admin-mdp-12345' },
        ),
      ).rejects.toThrow(message);
      expect(await accountRow(email)).toBeUndefined();
    });
  });

  describe('invariant P1 : jamais de compte cree sans sa ligne admin', () => {
    it('ecriture impossible avec le role de l application : le compte cree est supprime', async () => {
      // Le role applicatif n'a que SELECT sur platform_admins (0023) : c'est la raison pour
      // laquelle le script exige ADMIN_DATABASE_URL. Utilise ici comme « echec d'ecriture » reel.
      const email = emailFor('role-applicatif');
      await expect(
        grantPlatformAdmin(
          { authProvider, adminDb: appRolePool },
          { ...base, email, name: 'Role App', password: 'admin-mdp-12345' },
        ),
      ).rejects.toMatchObject({ code: '42501' });

      expect(await accountRow(email)).toBeUndefined();
    });

    it('un compte DEJA existant n est jamais supprime, meme si l ecriture echoue', async () => {
      const email = emailFor('existant-echec');
      const existing = await createTestAccount({
        email,
        password: 'ancien-mdp-1234',
        name: 'Garde',
      });

      await expect(
        grantPlatformAdmin({ authProvider, adminDb: appRolePool }, { ...base, email }),
      ).rejects.toMatchObject({ code: '42501' });

      expect(await accountRow(email)).toEqual({ id: existing.userId });
      expect(await adminRow(existing.userId)).toBeUndefined();
    });

    it('panne simulee de l insertion : le compte cree est supprime', async () => {
      const email = emailFor('panne');
      const failing: AdminDb = {
        query: async (text, params) => {
          if (/INSERT INTO platform_admins/.test(text)) throw new Error('panne simulee');
          return adminPool.query(text, params);
        },
      };

      await expect(
        grantPlatformAdmin(
          { authProvider, adminDb: failing },
          { ...base, email, name: 'Panne', password: 'admin-mdp-12345' },
        ),
      ).rejects.toThrow('panne simulee');
      expect(await accountRow(email)).toBeUndefined();
    });
  });
});
