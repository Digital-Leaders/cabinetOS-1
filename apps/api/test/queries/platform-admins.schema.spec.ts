import { platformAdmins } from '../../src/modules/access-control';

// BUILD-004 etape 2, EA-017 / TASK-058 : nullabilite exacte de platform_admins. Les garanties
// base (lecture seule pour l'application, CHECK de trace, cle etrangere) sont prouvees avec le
// role applicatif reel dans tests/isolation/platform-admins-privileges.spec.ts.

describe('platform_admins schema (TASK-058)', () => {
  it('identifie le compte par sa cle primaire, et exige la trace (qui, pourquoi, quand)', () => {
    expect(platformAdmins.userId.primary).toBe(true);
    expect(platformAdmins.userId.notNull).toBe(true);
    expect(platformAdmins.grantedBy.notNull).toBe(true);
    expect(platformAdmins.reason.notNull).toBe(true);
    expect(platformAdmins.grantedAt.notNull).toBe(true);
    expect(platformAdmins.grantedAt.hasDefault).toBe(true);
  });

  it('un retrait conserve la ligne : revoked_at est facultatif', () => {
    expect(platformAdmins.revokedAt.notNull).toBe(false);
  });

  it('est une table globale : aucune colonne d organisation (hors RLS, exception assumee)', () => {
    expect(Object.keys(platformAdmins)).not.toContain('organizationId');
  });
});
