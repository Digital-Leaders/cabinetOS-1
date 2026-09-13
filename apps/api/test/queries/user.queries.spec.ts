import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import { envValidationSchema } from '../../src/modules/shared/config/env.validation';
import { createOrganization } from '../../src/modules/organization/infrastructure/organization.queries';
import {
  createMembership,
  deleteMembership,
} from '../../src/modules/organization/infrastructure/membership.queries';
import {
  findOrganizationMembershipsForUser,
  setDefaultOrganizationMembership,
} from '../../src/modules/identity/infrastructure/user.queries';

// Parcours d'acces, etape 1, commit 2 (ADR-0019) : le cache
// users.organization_memberships doit refleter exactement l etat reel de
// memberships -- pas seulement que createMembership/deleteMembership reussissent,
// que le cache reste synchronise a chaque etape. Meme exigence qu un geste
// d isolation (ADR-0019, section Consequences).

describe('user.queries -- cache organization_memberships (ADR-0019)', () => {
  let moduleRef: TestingModule;
  let databaseService: DatabaseService;
  let orgA: { id: string };
  let orgB: { id: string };
  const roleId = uuidv7();
  const userAlice = `adr19-alice-${Date.now()}`;
  const userBob = `adr19-bob-${Date.now()}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema })],
      providers: [DatabaseService],
    }).compile();
    databaseService = moduleRef.get(DatabaseService);

    orgA = await createOrganization(databaseService, {
      name: 'ADR-0019 Org A',
      slug: `adr19-org-a-${Date.now()}`,
    });
    orgB = await createOrganization(databaseService, {
      name: 'ADR-0019 Org B',
      slug: `adr19-org-b-${Date.now()}`,
    });

    await databaseService.db.execute(
      sql`INSERT INTO users (id, name, email) VALUES
        (${userAlice}, 'Alice ADR19', ${userAlice + '@example.com'}),
        (${userBob}, 'Bob ADR19', ${userBob + '@example.com'})`,
    );
    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'ADR19Role-' + roleId})`,
    );
  });

  afterAll(async () => {
    await databaseService.withOrganizationScope(orgA.id, (tx) =>
      tx.execute(sql`DELETE FROM memberships WHERE organization_id = ${orgA.id}`),
    );
    await databaseService.withOrganizationScope(orgB.id, (tx) =>
      tx.execute(sql`DELETE FROM memberships WHERE organization_id = ${orgB.id}`),
    );
    await databaseService.db.execute(sql`DELETE FROM roles WHERE id = ${roleId}`);
    await databaseService.db.execute(sql`DELETE FROM users WHERE id IN (${userAlice}, ${userBob})`);
    await databaseService.db.execute(
      sql`DELETE FROM organizations WHERE id IN (${orgA.id}, ${orgB.id})`,
    );
    await databaseService.onModuleDestroy();
  });

  it('une premiere adhesion n a jamais de defaut automatique (le cas "une seule organisation" ne depend pas d isDefault)', async () => {
    await createMembership(databaseService, orgA.id, { userId: userAlice, roleId });

    const cache = await findOrganizationMembershipsForUser(databaseService, userAlice);
    expect(cache).toEqual([
      { organizationId: orgA.id, organizationName: 'ADR-0019 Org A', isDefault: false },
    ]);
  });

  it('une deuxieme adhesion laisse l etat "plusieurs organisations, aucun defaut" atteignable (ecran de choix)', async () => {
    await createMembership(databaseService, orgB.id, { userId: userAlice, roleId });

    const cache = await findOrganizationMembershipsForUser(databaseService, userAlice);
    expect(cache).toHaveLength(2);
    expect(cache.every((m) => m.isDefault === false)).toBe(true);
  });

  it('setDefaultOrganizationMembership bascule le defaut de maniere exclusive', async () => {
    const result = await setDefaultOrganizationMembership(databaseService, userAlice, orgB.id);

    expect(result.matched).toBe(true);
    expect(result.memberships.find((m) => m.organizationId === orgA.id)?.isDefault).toBe(false);
    expect(result.memberships.find((m) => m.organizationId === orgB.id)?.isDefault).toBe(true);

    const cache = await findOrganizationMembershipsForUser(databaseService, userAlice);
    expect(cache.filter((m) => m.isDefault)).toHaveLength(1);
  });

  it('setDefaultOrganizationMembership avec une organisation qui n appartient pas a l utilisateur : sur par construction, aucune ligne modifiee', async () => {
    const orgAlienId = '00000000-0000-0000-0000-000000000000';
    const before = await findOrganizationMembershipsForUser(databaseService, userAlice);

    const result = await setDefaultOrganizationMembership(databaseService, userAlice, orgAlienId);

    expect(result.matched).toBe(false);
    const after = await findOrganizationMembershipsForUser(databaseService, userAlice);
    expect(after).toEqual(before);
  });

  it('isolation : le cache d un utilisateur ne contient jamais les adhesions d un autre', async () => {
    await createMembership(databaseService, orgA.id, { userId: userBob, roleId });

    const aliceCache = await findOrganizationMembershipsForUser(databaseService, userAlice);
    const bobCache = await findOrganizationMembershipsForUser(databaseService, userBob);

    // Bob rejoint orgA : le cache d Alice (deja membre de orgA et orgB) reste
    // inchange -- 2 entrees, jamais contamine par l adhesion de Bob.
    expect(aliceCache).toHaveLength(2);
    // Bob n a jamais ete membre de orgB -- ne doit jamais apparaitre dans son cache,
    // qui ne contient que sa propre adhesion a orgA.
    expect(bobCache).toEqual([
      { organizationId: orgA.id, organizationName: 'ADR-0019 Org A', isDefault: false },
    ]);
  });

  it('deleteMembership retire l entree du cache (le cache reste synchronise, pas seulement la table memberships)', async () => {
    const result = await databaseService.withOrganizationScope(orgA.id, (tx) =>
      tx.execute(
        sql`SELECT id FROM memberships WHERE user_id = ${userBob} AND organization_id = ${orgA.id}`,
      ),
    );
    const membership = result.rows[0] as { id: string };

    await deleteMembership(databaseService, orgA.id, membership.id);

    const bobCache = await findOrganizationMembershipsForUser(databaseService, userBob);
    expect(bobCache).toEqual([]);
  });
});
