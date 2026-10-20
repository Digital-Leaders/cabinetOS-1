import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import { envValidationSchema } from '../../src/modules/shared/config/env.validation';
import {
  createOrganization,
  createOrganizationInTx,
  findOrganizationById,
  organizations,
} from '../../src/modules/organization';

// BUILD-004 etape 2, EA-018 / TASK-062 (brief R5, migration 0024) : ville et adresse de l'organisation.
// Les donnees d'inscription pre-remplissent l'organisation : la cascade (TASK-063) les y ecrira.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;

describe('organizations.city / organizations.address (TASK-062)', () => {
  let moduleRef: TestingModule;
  let db: DatabaseService;
  let adminPool: Pool;
  const runId = Date.now();
  const orgIds: string[] = [];

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL) throw new Error('ADMIN_DATABASE_URL est requis (nettoyage).');
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema })],
      providers: [DatabaseService],
    }).compile();
    db = moduleRef.get(DatabaseService);
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);
    await adminPool.end();
    await db.onModuleDestroy();
  });

  describe('schema', () => {
    it('ville et adresse sont FACULTATIVES : les organisations existantes (equipe, demos) n en ont pas', () => {
      expect(organizations.city.notNull).toBe(false);
      expect(organizations.address.notNull).toBe(false);
    });

    it('les colonnes existent en base, nullables (migration 0024)', async () => {
      const result = await adminPool.query(
        `SELECT column_name, is_nullable FROM information_schema.columns
         WHERE table_name = 'organizations' AND column_name IN ('city', 'address') ORDER BY 1`,
      );
      expect(result.rows).toEqual([
        { column_name: 'address', is_nullable: 'YES' },
        { column_name: 'city', is_nullable: 'YES' },
      ]);
    });
  });

  describe('createOrganizationInTx (variante de la cascade)', () => {
    it('enregistre la ville et l adresse de la demande, avec l UUID genere en amont', async () => {
      const id = uuidv7();
      orgIds.push(id);
      const created = await db.withOrganizationScope(id, (tx) =>
        createOrganizationInTx(tx, {
          id,
          name: 'Cabinet Dr Bennani',
          slug: `bennani-${runId}`,
          city: 'Casablanca',
          address: 'Rue Ibn Sina, Maarif',
        }),
      );
      expect(created).toMatchObject({
        id,
        name: 'Cabinet Dr Bennani',
        city: 'Casablanca',
        address: 'Rue Ibn Sina, Maarif',
      });
      expect(await findOrganizationById(db, id)).toMatchObject({
        city: 'Casablanca',
        address: 'Rue Ibn Sina, Maarif',
      });
    });

    it('sans ville ni adresse (adresse facultative a l inscription) : NULL, pas de chaine vide', async () => {
      const id = uuidv7();
      orgIds.push(id);
      const created = await db.withOrganizationScope(id, (tx) =>
        createOrganizationInTx(tx, {
          id,
          name: 'Sans adresse',
          slug: `sans-adresse-${runId}`,
          city: 'Rabat',
        }),
      );
      expect(created.city).toBe('Rabat');
      expect(created.address).toBeNull();
    });

    it('annule avec la transaction : ville et adresse ne subsistent pas', async () => {
      const id = uuidv7();
      await expect(
        db.withOrganizationScope(id, async (tx) => {
          await createOrganizationInTx(tx, {
            id,
            name: 'Annulee',
            slug: `annulee-${runId}`,
            city: 'Fès',
            address: 'Rue X',
          });
          throw new Error('panne simulee');
        }),
      ).rejects.toThrow('panne simulee');
      expect(await findOrganizationById(db, id)).toBeUndefined();
    });
  });

  describe('l existant est inchange', () => {
    it('createOrganization (enveloppe, sans ville ni adresse) : les deux colonnes sont NULL', async () => {
      const created = await createOrganization(db, {
        name: 'Ancienne facon',
        slug: `ancienne-${runId}`,
      });
      orgIds.push(created.id);
      expect(created.city).toBeNull();
      expect(created.address).toBeNull();
      expect(created.name).toBe('Ancienne facon');
    });
  });
});
