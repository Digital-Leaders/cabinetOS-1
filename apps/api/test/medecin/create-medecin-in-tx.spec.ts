import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import { envValidationSchema } from '../../src/modules/shared/config/env.validation';
import {
  createOrganization,
  createOrganizationInTx,
  createMembership,
  createMembershipInTx,
} from '../../src/modules/organization';
import { createMedecinInTx } from '../../src/business/medecin';
import { createMedecin } from '../../src/business/medecin/infrastructure/medecin.queries';

// BUILD-004 etape 2, EA-018 / TASK-061 (ADR-0021 D5, ADR-0023) : les trois fonctions de creation,
// extraites en variantes « transaction fournie » -- briques de la cascade de validation d'une
// inscription (organisation -> adhesion -> fiche medecin).
//
// Ce qui est prouve : (1) les trois s'executent DANS la transaction de l'appelant, donc tout est
// annule d'un bloc si l'appelant l'annule -- caches d'appartenance compris ; (2) createMedecinInTx
// EXIGE une transaction scopee sur la bonne organisation : la base refuse tout autre usage ;
// (3) l'ORDRE imposee par la cle etrangere composee ; (4) les enveloppes publiques se comportent
// exactement comme avant.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;
const RLS_VIOLATION = '42501';
const FK_VIOLATION = '23503';

describe('variantes « transaction fournie » (TASK-061)', () => {
  let moduleRef: TestingModule;
  let db: DatabaseService;
  let adminPool: Pool;
  let roleId: string;
  const runId = Date.now();
  const orgIds: string[] = [];
  const userIds: string[] = [];

  async function newUser(label: string): Promise<string> {
    const id = `tx-${label}-${runId}-${userIds.length}`;
    await db.db.execute(
      sql`INSERT INTO users (id, name, email) VALUES (${id}, ${label}, ${`${id}@example.com`})`,
    );
    userIds.push(id);
    return id;
  }
  function newOrgInput(label: string) {
    const id = uuidv7();
    orgIds.push(id);
    return { id, name: `Cascade ${label}`, slug: `cascade-${label}-${runId}-${orgIds.length}` };
  }
  const orgExists = async (id: string) =>
    ((await adminPool.query('SELECT 1 FROM organizations WHERE id = $1', [id])).rowCount ?? 0) > 0;
  const countIn = async (table: 'memberships' | 'medecins', orgId: string) =>
    Number(
      (
        await adminPool.query(`SELECT count(*) AS n FROM ${table} WHERE organization_id = $1`, [
          orgId,
        ])
      ).rows[0].n,
    );
  const cacheOf = async (userId: string) =>
    (
      await adminPool.query('SELECT organization_memberships AS c FROM users WHERE id = $1', [
        userId,
      ])
    ).rows[0].c as unknown[];

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL)
      throw new Error('ADMIN_DATABASE_URL est requis (verifications et nettoyage).');
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema })],
      providers: [DatabaseService],
    }).compile();
    db = moduleRef.get(DatabaseService);
    roleId = uuidv7();
    await adminPool.query('INSERT INTO roles (id, name) VALUES ($1, $2)', [
      roleId,
      `TxRole-${runId}`,
    ]);
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM medecins WHERE organization_id = ANY($1)', [orgIds]);
    await adminPool.query('DELETE FROM memberships WHERE organization_id = ANY($1)', [orgIds]);
    await adminPool.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    await adminPool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);
    await adminPool.query('DELETE FROM roles WHERE id = $1', [roleId]);
    await adminPool.end();
    await db.onModuleDestroy();
  });

  describe('la cascade complete, dans UNE transaction', () => {
    it('reussite : organisation, adhesion, cache d appartenance et fiche medecin sont tous la', async () => {
      const org = newOrgInput('succes');
      const userId = await newUser('succes');

      const result = await db.withOrganizationScope(org.id, async (tx) => {
        const created = await createOrganizationInTx(tx, org);
        const membership = await createMembershipInTx(tx, org.id, { userId, roleId });
        const medecin = await createMedecinInTx(tx, org.id, {
          firstName: 'Youssef',
          lastName: 'Bennani',
          userId,
        });
        return { created, membership, medecin };
      });

      expect(result.created.id).toBe(org.id); // l'UUID genere en amont est bien celui de la ligne
      expect(await orgExists(org.id)).toBe(true);
      expect(await countIn('memberships', org.id)).toBe(1);
      expect(await countIn('medecins', org.id)).toBe(1);
      expect(await cacheOf(userId)).toEqual([
        { organizationId: org.id, organizationName: org.name, isDefault: false },
      ]);
      expect(result.medecin).toMatchObject({
        organizationId: org.id,
        userId,
        firstName: 'Youssef',
      });
    });

    it('TOUT OU RIEN : si l appelant annule apres la fiche medecin, RIEN ne subsiste -- cache compris', async () => {
      const org = newOrgInput('annule');
      const userId = await newUser('annule');

      await expect(
        db.withOrganizationScope(org.id, async (tx) => {
          await createOrganizationInTx(tx, org);
          await createMembershipInTx(tx, org.id, { userId, roleId });
          await createMedecinInTx(tx, org.id, { firstName: 'A', lastName: 'B', userId });
          throw new Error('panne simulee apres la creation de la fiche medecin');
        }),
      ).rejects.toThrow('panne simulee');

      expect(await orgExists(org.id)).toBe(false);
      expect(await countIn('memberships', org.id)).toBe(0);
      expect(await countIn('medecins', org.id)).toBe(0);
      // Le cache d'appartenance, maintenu dans la MEME transaction (ADR-0019), est revenu en arriere.
      expect(await cacheOf(userId)).toEqual([]);
    });

    it('une panne a CHAQUE etape ne laisse rien : organisation, adhesion ou fiche', async () => {
      for (const failAt of ['apres-organisation', 'apres-adhesion'] as const) {
        const org = newOrgInput(failAt);
        const userId = await newUser(failAt);
        await expect(
          db.withOrganizationScope(org.id, async (tx) => {
            await createOrganizationInTx(tx, org);
            if (failAt === 'apres-organisation') throw new Error('panne');
            await createMembershipInTx(tx, org.id, { userId, roleId });
            throw new Error('panne');
          }),
        ).rejects.toThrow('panne');
        expect({ failAt, org: await orgExists(org.id) }).toEqual({ failAt, org: false });
        expect(await countIn('memberships', org.id)).toBe(0);
        expect(await cacheOf(userId)).toEqual([]);
      }
    });

    it('L ORDRE est impose par la cle etrangere composee : une fiche liee a un compte sans adhesion est refusee, et tout est annule', async () => {
      const org = newOrgInput('ordre');
      const userId = await newUser('ordre');

      await expect(
        db.withOrganizationScope(org.id, async (tx) => {
          await createOrganizationInTx(tx, org);
          // Fiche AVANT l'adhesion : (organization_id, user_id) n'existe pas encore dans memberships.
          await createMedecinInTx(tx, org.id, { firstName: 'A', lastName: 'B', userId });
        }),
      ).rejects.toMatchObject({ cause: { code: FK_VIOLATION } });

      expect(await orgExists(org.id)).toBe(false);
      expect(await countIn('medecins', org.id)).toBe(0);
    });
  });

  describe('createMedecinInTx EXIGE une transaction scopee sur la bonne organisation (ADR-0023)', () => {
    it('avec la connexion simple (hors transaction scopee) : refus par la RLS, rien n est cree', async () => {
      const org = await createOrganization(db, newOrgInput('hors-tx'));

      await expect(
        createMedecinInTx(db.db, org.id, { firstName: 'Hors', lastName: 'Transaction' }),
      ).rejects.toMatchObject({ cause: { code: RLS_VIOLATION } });
      expect(await countIn('medecins', org.id)).toBe(0);
    });

    it('dans une transaction scopee sur UNE AUTRE organisation : refus par la RLS, rien n est cree', async () => {
      const target = await createOrganization(db, newOrgInput('cible'));
      const other = await createOrganization(db, newOrgInput('autre'));

      await expect(
        db.withOrganizationScope(other.id, (tx) =>
          createMedecinInTx(tx, target.id, { firstName: 'Mauvaise', lastName: 'Organisation' }),
        ),
      ).rejects.toMatchObject({ cause: { code: RLS_VIOLATION } });
      expect(await countIn('medecins', target.id)).toBe(0);
      expect(await countIn('medecins', other.id)).toBe(0);
    });

    it('controle positif : dans la transaction scopee sur la bonne organisation, la fiche est creee', async () => {
      const org = await createOrganization(db, newOrgInput('bonne'));
      const medecin = await db.withOrganizationScope(org.id, (tx) =>
        createMedecinInTx(tx, org.id, { firstName: 'Bonne', lastName: 'Organisation' }),
      );
      expect(medecin.organizationId).toBe(org.id);
      expect(await countIn('medecins', org.id)).toBe(1);
    });
  });

  describe('les enveloppes publiques se comportent EXACTEMENT comme avant', () => {
    it('createMedecin et createMedecinInTx : meme normalisation, memes valeurs (un seul chemin de code, R4)', async () => {
      const org = await createOrganization(db, newOrgInput('equiv'));
      const input = {
        firstName: 'Salma',
        lastName: 'Tazi',
        inpe: ' 123 456 789 ',
        specialty: 'pediatrie' as const,
        city: 'Rabat',
      };

      const viaWrapper = await createMedecin(db, org.id, input);
      const viaInTx = await db.withOrganizationScope(org.id, (tx) =>
        createMedecinInTx(tx, org.id, { ...input, inpe: ' 987 654 321 ' }),
      );

      // L'INPE est normalise (espaces retires) par les DEUX chemins : c'est le meme code.
      expect(viaWrapper.inpe).toBe('123456789');
      expect(viaInTx.inpe).toBe('987654321');
      const pick = (m: typeof viaWrapper) => ({
        firstName: m.firstName,
        lastName: m.lastName,
        specialty: m.specialty,
        city: m.city,
        organizationId: m.organizationId,
        userId: m.userId,
        deletedAt: m.deletedAt,
      });
      expect(pick(viaInTx)).toEqual(pick(viaWrapper));
    });

    it('createMembership (enveloppe) maintient toujours le cache d appartenance, dans sa propre transaction', async () => {
      const org = await createOrganization(db, newOrgInput('wrap-membre'));
      const userId = await newUser('wrap-membre');

      const membership = await createMembership(db, org.id, { userId, roleId });

      expect(membership).toMatchObject({ organizationId: org.id, userId, roleId });
      expect(await cacheOf(userId)).toEqual([
        { organizationId: org.id, organizationName: org.name, isDefault: false },
      ]);
    });

    it('createOrganization (enveloppe) : meme ligne que la variante, sans transaction', async () => {
      const a = await createOrganization(db, { name: 'Wrapper', slug: `wrap-a-${runId}` });
      const b = await createOrganizationInTx(db.db, { name: 'Variante', slug: `wrap-b-${runId}` });
      orgIds.push(a.id, b.id);
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      expect(a.id).not.toBe(b.id);
    });
  });
});
