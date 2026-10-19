import {
  Test,
  TestingModule,
  ConfigModule,
  DatabaseService,
  envValidationSchema,
  Pool,
  sql,
  uuidv7,
} from '../../apps/api/test/isolation-test-kit';
import { isPlatformAdmin } from '../../apps/api/src/modules/access-control/infrastructure/platform-admin.queries';

// BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 D3, P3) : garanties AU NIVEAU BASE de
// platform_admins (migrations 0022 et 0023), avec le role applicatif reel cabinetos_app --
// jamais un superutilisateur, qui contournerait toute restriction.
//
// C'est la seule table qui transcende l'isolation des organisations : l'application peut la
// LIRE (pour savoir si un compte est administrateur) mais JAMAIS y ecrire. Meme une faille de
// l'application ne peut donc pas promouvoir un compte. Comme pour audit-append-only.spec.ts :
// on prouve que l'operation interdite ECHOUE (et que la table est intacte), pas seulement que
// l'operation autorisee reussit.
//
// drizzle-orm enveloppe l'erreur pg dans .cause : le SQLSTATE y vit.
//   42501 insufficient_privilege, 23514 check_violation, 23503 foreign_key_violation.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;

describe('platform_admins - lecture seule pour l application (TASK-058)', () => {
  let moduleRef: TestingModule;
  let databaseService: DatabaseService;
  let adminPool: Pool;
  const userIds: string[] = [];

  async function createUser(): Promise<string> {
    const id = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO users (id, name, email) VALUES (${id}, 'Platform Admin Test', ${`pa-test-${id}@example.com`})`,
    );
    userIds.push(id);
    return id;
  }

  /** Seule voie d'ecriture : la connexion d'administration, comme le script admin:grant. */
  async function grantAsAdmin(userId: string, revoked = false) {
    await adminPool.query(
      `INSERT INTO platform_admins (user_id, granted_by, reason, revoked_at)
       VALUES ($1, 'Test Operateur', 'test des privileges', ${revoked ? 'now()' : 'NULL'})`,
      [userId],
    );
  }

  async function rowOf(userId: string) {
    const result = await adminPool.query('SELECT * FROM platform_admins WHERE user_id = $1', [
      userId,
    ]);
    return result.rows[0] as Record<string, unknown> | undefined;
  }

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL) {
      throw new Error('ADMIN_DATABASE_URL est requis pour ce test (ecriture et nettoyage admin).');
    }
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema })],
      providers: [DatabaseService],
    }).compile();
    databaseService = moduleRef.get(DatabaseService);
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM platform_admins WHERE user_id = ANY($1)', [userIds]);
    await adminPool.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    await adminPool.end();
    await databaseService.onModuleDestroy();
  });

  describe('le role applicatif ne peut que LIRE', () => {
    it('SELECT reussit', async () => {
      const userId = await createUser();
      await grantAsAdmin(userId);
      const result = await databaseService.db.execute(
        sql`SELECT user_id FROM platform_admins WHERE user_id = ${userId}`,
      );
      expect(result.rows).toEqual([{ user_id: userId }]);
    });

    it('INSERT echoue (privilege insuffisant) : l application ne peut promouvoir personne', async () => {
      const userId = await createUser();
      await expect(
        databaseService.db.execute(
          sql`INSERT INTO platform_admins (user_id, granted_by, reason) VALUES (${userId}, 'x', 'y')`,
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      expect(await rowOf(userId)).toBeUndefined();
    });

    it('UPDATE echoue : ni revocation ni reactivation par l application', async () => {
      const userId = await createUser();
      await grantAsAdmin(userId);
      await expect(
        databaseService.db.execute(
          sql`UPDATE platform_admins SET revoked_at = now() WHERE user_id = ${userId}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      await expect(
        databaseService.db.execute(
          sql`UPDATE platform_admins SET granted_by = 'usurpateur' WHERE user_id = ${userId}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      expect((await rowOf(userId))?.revoked_at).toBeNull();
      expect((await rowOf(userId))?.granted_by).toBe('Test Operateur');
    });

    it('DELETE echoue : la trace ne peut pas etre effacee par l application', async () => {
      const userId = await createUser();
      await grantAsAdmin(userId);
      await expect(
        databaseService.db.execute(sql`DELETE FROM platform_admins WHERE user_id = ${userId}`),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
      expect(await rowOf(userId)).toBeDefined();
    });
  });

  describe('la trace est exigee par la base elle-meme', () => {
    it.each([
      ['granted_by vide', ['', 'une raison']],
      ['granted_by blanc', ['   ', 'une raison']],
      ['reason vide', ['Operateur', '']],
      ['reason blanche', ['Operateur', '  ']],
    ])('%s : refuse, meme avec la connexion d administration', async (_label, [grantedBy, reason]) => {
      const userId = await createUser();
      await expect(
        adminPool.query(
          'INSERT INTO platform_admins (user_id, granted_by, reason) VALUES ($1, $2, $3)',
          [userId, grantedBy, reason],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await rowOf(userId)).toBeUndefined();
    });

    it('controle positif : avec une trace renseignee, l ajout reussit et la date est posee', async () => {
      const userId = await createUser();
      await grantAsAdmin(userId);
      const row = await rowOf(userId);
      expect(row).toMatchObject({ granted_by: 'Test Operateur', reason: 'test des privileges' });
      expect(row?.granted_at).toBeInstanceOf(Date);
    });
  });

  describe('un compte administrateur ne peut pas etre supprime (cle etrangere)', () => {
    it('DELETE du compte echoue tant que sa ligne existe -- meme revoquee, elle est la trace', async () => {
      const userId = await createUser();
      await grantAsAdmin(userId, true);
      await expect(
        adminPool.query('DELETE FROM users WHERE id = $1', [userId]),
      ).rejects.toMatchObject({ code: '23503' });
      expect(await rowOf(userId)).toBeDefined();
    });
  });

  describe('isPlatformAdmin (lecture avec le role applicatif)', () => {
    it('administrateur actif : true', async () => {
      const userId = await createUser();
      await grantAsAdmin(userId);
      await expect(isPlatformAdmin(databaseService, userId)).resolves.toBe(true);
    });

    it('administrateur revoque : false (la ligne reste, la garde l ignore)', async () => {
      const userId = await createUser();
      await grantAsAdmin(userId, true);
      await expect(isPlatformAdmin(databaseService, userId)).resolves.toBe(false);
    });

    it('compte quelconque : false', async () => {
      const userId = await createUser();
      await expect(isPlatformAdmin(databaseService, userId)).resolves.toBe(false);
    });

    it('identifiant inconnu : false', async () => {
      await expect(isPlatformAdmin(databaseService, 'inconnu')).resolves.toBe(false);
    });
  });
});
