import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../src/modules/access-control/presentation/permissions.guard';
import { AccountAccessGateRegistry } from '../../src/modules/access-control/application/account-access-gate';
import { hasPermission } from '../../src/modules/access-control/infrastructure/permission-check.queries';
import { isPlatformAdmin } from '../../src/modules/access-control/infrastructure/platform-admin.queries';
import { RequirePermission } from '../../src/modules/shared/presentation/require-permission.decorator';
import { RequireAuthentication } from '../../src/modules/shared/presentation/require-authentication.decorator';
import { RequirePlatformAdmin } from '../../src/modules/shared/presentation/require-platform-admin.decorator';
import { Public } from '../../src/modules/shared/presentation/public.decorator';

// BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 D3) : comportement exact de PermissionsGuard
// face a @RequirePlatformAdmin(). Sans base : dependances simulees, pour prouver l'ORDRE des
// controles, l'echec FERME, et surtout qu'etre administrateur de plateforme n'eleve AUCUN droit
// dans une organisation.

jest.mock('../../src/modules/access-control/infrastructure/permission-check.queries', () => ({
  hasPermission: jest.fn(),
}));
jest.mock('../../src/modules/access-control/infrastructure/platform-admin.queries', () => ({
  isPlatformAdmin: jest.fn(),
}));
const hasPermissionMock = hasPermission as jest.MockedFunction<typeof hasPermission>;
const isPlatformAdminMock = isPlatformAdmin as jest.MockedFunction<typeof isPlatformAdmin>;

class FakeController {
  @RequirePlatformAdmin()
  adminOnly() {}

  @RequirePermission('read', 'patients')
  permissionOnly() {}

  @RequirePlatformAdmin()
  @RequirePermission('read', 'patients')
  both() {}

  @RequireAuthentication()
  sessionOnly() {}

  @Public()
  open() {}

  undecorated() {}
}

const SESSION_USER = 'user-from-verified-session';

function buildGuard(session: { userId: string } | null) {
  const registry = new AccountAccessGateRegistry();
  const findDenialSpy = jest.spyOn(registry, 'findDenial');
  const authProvider = { verifySession: jest.fn().mockResolvedValue(session) };
  const guard = new PermissionsGuard(new Reflector(), authProvider as never, {} as never, registry);
  return { guard, findDenialSpy };
}

function contextFor(handler: () => void, headers: Record<string, string> = {}) {
  return {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

beforeEach(() => {
  hasPermissionMock.mockReset();
  isPlatformAdminMock.mockReset();
});

describe('PermissionsGuard + @RequirePlatformAdmin() (TASK-058)', () => {
  const adminOnly = FakeController.prototype.adminOnly;

  it('administrateur actif : acces accorde, SANS en-tete d organisation, sans aucune permission lue', async () => {
    isPlatformAdminMock.mockResolvedValue(true);
    const { guard, findDenialSpy } = buildGuard({ userId: SESSION_USER });

    await expect(guard.canActivate(contextFor(adminOnly))).resolves.toBe(true);
    expect(hasPermissionMock).not.toHaveBeenCalled();
    // Les portes d'acces aux donnees (statut d'inscription) ne concernent pas ce chemin.
    expect(findDenialSpy).not.toHaveBeenCalled();
  });

  it('compte quelconque : 403, jamais d acces', async () => {
    isPlatformAdminMock.mockResolvedValue(false);
    const { guard } = buildGuard({ userId: SESSION_USER });

    const error = await guard.canActivate(contextFor(adminOnly)).catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toMatch(/administrateurs de la plateforme/);
  });

  it('sans session : 401 avant toute lecture de la table des administrateurs', async () => {
    const { guard } = buildGuard(null);
    await expect(guard.canActivate(contextFor(adminOnly))).rejects.toThrow(UnauthorizedException);
    expect(isPlatformAdminMock).not.toHaveBeenCalled();
  });

  it('l identite verifiee est celle de la SESSION, jamais une valeur fournie par le client', async () => {
    isPlatformAdminMock.mockResolvedValue(true);
    const { guard } = buildGuard({ userId: SESSION_USER });

    await guard.canActivate(
      contextFor(adminOnly, { 'x-user-id': 'usurpateur', 'x-forwarded-user': 'autre' }),
    );
    expect(isPlatformAdminMock).toHaveBeenCalledTimes(1);
    expect(isPlatformAdminMock).toHaveBeenCalledWith(expect.anything(), SESSION_USER);
  });

  it('ECHEC FERME : si la lecture echoue, l acces est refuse, jamais accorde', async () => {
    isPlatformAdminMock.mockRejectedValue(new Error('base indisponible'));
    const { guard } = buildGuard({ userId: SESSION_USER });

    await expect(guard.canActivate(contextFor(adminOnly))).rejects.toThrow('base indisponible');
  });

  it('un decorateur @RequirePlatformAdmin() suffit a ne pas etre refuse « par defaut »', async () => {
    isPlatformAdminMock.mockResolvedValue(true);
    const { guard } = buildGuard({ userId: SESSION_USER });
    await expect(guard.canActivate(contextFor(adminOnly))).resolves.toBe(true);
  });

  it('endpoint sans aucun decorateur : toujours refuse par defaut (fail-closed inchange)', async () => {
    const { guard } = buildGuard({ userId: SESSION_USER });
    await expect(
      guard.canActivate(contextFor(FakeController.prototype.undecorated)),
    ).rejects.toThrow(/refuse par defaut/);
    expect(isPlatformAdminMock).not.toHaveBeenCalled();
  });
});

describe('Etre administrateur de plateforme n eleve AUCUN droit dans une organisation (TASK-058)', () => {
  const orgHeader = { 'x-organization-id': 'org-1' };

  it('endpoint @RequirePermission seul : la table des administrateurs n est meme pas consultee', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { guard } = buildGuard({ userId: SESSION_USER });

    await expect(
      guard.canActivate(contextFor(FakeController.prototype.permissionOnly, orgHeader)),
    ).rejects.toThrow(ForbiddenException);
    expect(isPlatformAdminMock).not.toHaveBeenCalled();
  });

  it('endpoint cumulant les deux decorateurs : non-administrateur refuse avant la permission', async () => {
    isPlatformAdminMock.mockResolvedValue(false);
    hasPermissionMock.mockResolvedValue(true);
    const { guard } = buildGuard({ userId: SESSION_USER });

    await expect(
      guard.canActivate(contextFor(FakeController.prototype.both, orgHeader)),
    ).rejects.toThrow(/administrateurs de la plateforme/);
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('endpoint cumulant les deux decorateurs : administrateur SANS la permission est refuse', async () => {
    isPlatformAdminMock.mockResolvedValue(true);
    hasPermissionMock.mockResolvedValue(false);
    const { guard } = buildGuard({ userId: SESSION_USER });

    await expect(
      guard.canActivate(contextFor(FakeController.prototype.both, orgHeader)),
    ).rejects.toThrow(/Permission manquante/);
  });

  it('endpoint cumulant les deux decorateurs : il faut les DEUX pour passer', async () => {
    isPlatformAdminMock.mockResolvedValue(true);
    hasPermissionMock.mockResolvedValue(true);
    const { guard } = buildGuard({ userId: SESSION_USER });

    await expect(
      guard.canActivate(contextFor(FakeController.prototype.both, orgHeader)),
    ).resolves.toBe(true);
  });

  it('route « session seule » et route @Public() : la table des administrateurs n est jamais lue', async () => {
    const { guard } = buildGuard({ userId: SESSION_USER });
    await guard.canActivate(contextFor(FakeController.prototype.sessionOnly));
    await guard.canActivate(contextFor(FakeController.prototype.open));
    expect(isPlatformAdminMock).not.toHaveBeenCalled();
  });
});
