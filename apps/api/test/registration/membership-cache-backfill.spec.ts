import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';

// TASK-052 (ADR-0021 P1) : migration 0020. Un compte qui avait des adhesions AVANT 0017
// (cache users.organization_memberships cree vide) ressemblerait a un orphelin. 0020
// remplit ces caches ; ce test reproduit un compte herite et rejoue la migration.

const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'db',
    'migrations',
    '0020_backfill-user-memberships-cache.sql',
  ),
  'utf-8',
);

describe('Migration 0020 -- rattrapage du cache d adhesions (TASK-052, P1)', () => {
  let adminPool: Pool;
  const runId = Date.now();
  const legacyUserId = `legacy-${runId}`;
  const freshUserId = `fresh-${runId}`;
  const orgId = uuidv7();
  const roleId = uuidv7();

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
    await adminPool.query(
      `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Cabinet Herite', $2)`,
      [orgId, `cabinet-herite-${runId}`],
    );
    await adminPool.query(`INSERT INTO roles (id, name) VALUES ($1, $2)`, [
      roleId,
      `LegacyRole-${runId}`,
    ]);
    // Compte herite : adhesion presente, cache reste vide (etat d'avant 0017).
    await adminPool.query(`INSERT INTO users (id, name, email) VALUES ($1, 'Herite', $2)`, [
      legacyUserId,
      `${legacyUserId}@example.com`,
    ]);
    await adminPool.query(
      `INSERT INTO memberships (id, user_id, organization_id, role_id) VALUES ($1, $2, $3, $4)`,
      [uuidv7(), legacyUserId, orgId, roleId],
    );
    // Compte sans adhesion : son cache doit rester vide.
    await adminPool.query(`INSERT INTO users (id, name, email) VALUES ($1, 'Sans', $2)`, [
      freshUserId,
      `${freshUserId}@example.com`,
    ]);
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM memberships WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM users WHERE id = ANY($1)', [[legacyUserId, freshUserId]]);
    await adminPool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await adminPool.query('DELETE FROM roles WHERE id = $1', [roleId]);
    await adminPool.end();
  });

  async function cacheOf(userId: string) {
    const result = await adminPool.query(
      'SELECT organization_memberships FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0].organization_memberships;
  }

  it('remplit le cache d un compte herite, sans inventer de defaut', async () => {
    expect(await cacheOf(legacyUserId)).toEqual([]);
    await adminPool.query(MIGRATION);
    expect(await cacheOf(legacyUserId)).toEqual([
      { organizationId: orgId, organizationName: 'Cabinet Herite', isDefault: false },
    ]);
  });

  it('laisse vide le cache d un compte sans adhesion', async () => {
    expect(await cacheOf(freshUserId)).toEqual([]);
  });

  it('est idempotente : un cache deja rempli n est pas modifie', async () => {
    await adminPool.query(
      `UPDATE users SET organization_memberships = jsonb_set(organization_memberships, '{0,isDefault}', 'true')
       WHERE id = $1`,
      [legacyUserId],
    );
    await adminPool.query(MIGRATION);
    expect((await cacheOf(legacyUserId))[0].isDefault).toBe(true);
  });
});
