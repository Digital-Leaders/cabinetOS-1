import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../src/modules/access-control/presentation/permissions.guard';
import {
  AccountAccessGateRegistry,
  type AccountAccessGate,
} from '../../src/modules/access-control/application/account-access-gate';
import { hasPermission } from '../../src/modules/access-control/infrastructure/permission-check.queries';
import { RequirePermission } from '../../src/modules/shared/presentation/require-permission.decorator';
import { RequireAuthentication } from '../../src/modules/shared/presentation/require-authentication.decorator';
import { Public } from '../../src/modules/shared/presentation/public.decorator';

// TASK-056 (BUILD-004 etape 2, EA-016, ADR-0021 D4) : comportement exact de PermissionsGuard
// face aux portes d'acces (AccountAccessGate). Sans base : les dependances sont des faux,
// pour prouver l'ORDRE des controles et l'echec FERME -- ce qu'un test e2e ne peut pas isoler.

jest.mock('../../src/modules/access-control/infrastructure/permission-check.queries', () => ({
  hasPermission: jest.fn(),
}));
const hasPermissionMock = hasPermission as jest.MockedFunction<typeof hasPermission>;

class FakeController {
  @RequirePermission('read', 'patients')
  withPermission() {}

  @RequireAuthentication()
  sessionOnly() {}

  @Public()
  open() {}
}

const SESSION_USER = 'user-from-verified-session';

function buildGuard(gates: AccountAccessGate[], session: { userId: string } | null) {
  const registry = new AccountAccessGateRegistry();
  gates.forEach((gate) => registry.register(gate));
  const findDenialSpy = jest.spyOn(registry, 'findDenial');
  const authProvider = { verifySession: jest.fn().mockResolvedValue(session) };
  const guard = new PermissionsGuard(
    new Reflector(),
    authProvider as never,
    {} as never, // DatabaseService : inutilise, hasPermission est simule
    registry,
  );
  return { guard, findDenialSpy, authProvider };
}

function contextFor(handler: () => void, headers: Record<string, string> = {}) {
  return {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

const denyingGate: AccountAccessGate = {
  check: jest
    .fn()
    .mockResolvedValue({ code: 'TEST_DENIED', message: 'Porte fermee pour ce test.' }),
};

beforeEach(() => {
  hasPermissionMock.mockReset();
  (denyingGate.check as jest.Mock).mockClear();
});

describe('PermissionsGuard + portes d acces (TASK-056)', () => {
  const handler = FakeController.prototype.withPermission;
  const orgHeader = { 'x-organization-id': 'org-1' };

  it('sans porte enregistree : comportement de l etape 1 inchange (permission accordee)', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const { guard } = buildGuard([], { userId: SESSION_USER });
    await expect(guard.canActivate(contextFor(handler, orgHeader))).resolves.toBe(true);
    expect(hasPermissionMock).toHaveBeenCalledTimes(1);
  });

  it('sans porte enregistree : permission refusee -> 403, comme avant', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { guard } = buildGuard([], { userId: SESSION_USER });
    await expect(guard.canActivate(contextFor(handler, orgHeader))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('une porte qui laisse passer (compte ACTIVE ou sans demande) : la permission decide', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const open: AccountAccessGate = { check: jest.fn().mockResolvedValue(null) };
    const { guard } = buildGuard([open], { userId: SESSION_USER });
    await expect(guard.canActivate(contextFor(handler, orgHeader))).resolves.toBe(true);
    expect(open.check).toHaveBeenCalledWith(SESSION_USER);
  });

  it('une porte qui refuse : 403 avec son message, MEME si la permission serait accordee', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const { guard } = buildGuard([denyingGate], { userId: SESSION_USER });

    const error = await guard.canActivate(contextFor(handler, orgHeader)).catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe('Porte fermee pour ce test.');
  });

  it('le refus precede toute lecture de permission : hasPermission n est jamais appele', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const { guard } = buildGuard([denyingGate], { userId: SESSION_USER });
    await guard.canActivate(contextFor(handler, orgHeader)).catch(() => undefined);
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('le refus precede l exigence de x-organization-id (message specifique, pas generique)', async () => {
    const { guard } = buildGuard([denyingGate], { userId: SESSION_USER });
    const error = await guard.canActivate(contextFor(handler, {})).catch((e) => e);
    expect((error as ForbiddenException).message).toBe('Porte fermee pour ce test.');
  });

  it('la porte recoit l identite de la SESSION verifiee, jamais une valeur fournie par le client', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const open: AccountAccessGate = { check: jest.fn().mockResolvedValue(null) };
    const { guard } = buildGuard([open], { userId: SESSION_USER });
    await guard.canActivate(
      contextFor(handler, { ...orgHeader, 'x-user-id': 'usurpateur', 'x-forwarded-user': 'autre' }),
    );
    expect(open.check).toHaveBeenCalledTimes(1);
    expect(open.check).toHaveBeenCalledWith(SESSION_USER);
  });

  it('ECHEC FERME : si une porte leve une exception, l acces est refuse, jamais accorde', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const broken: AccountAccessGate = {
      check: jest.fn().mockRejectedValue(new Error('base indisponible')),
    };
    const { guard } = buildGuard([broken], { userId: SESSION_USER });

    await expect(guard.canActivate(contextFor(handler, orgHeader))).rejects.toThrow(
      'base indisponible',
    );
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('la premiere porte qui refuse arrete l examen (les suivantes ne sont pas consultees)', async () => {
    const later: AccountAccessGate = { check: jest.fn().mockResolvedValue(null) };
    const { guard } = buildGuard([denyingGate, later], { userId: SESSION_USER });
    await guard.canActivate(contextFor(handler, orgHeader)).catch(() => undefined);
    expect(later.check).not.toHaveBeenCalled();
  });

  it('route « session seule » (statut de la demande) : la porte n est PAS consultee -- c est ainsi qu un fondateur atteint son ecran de statut', async () => {
    const { guard, findDenialSpy } = buildGuard([denyingGate], { userId: SESSION_USER });
    await expect(guard.canActivate(contextFor(FakeController.prototype.sessionOnly))).resolves.toBe(
      true,
    );
    expect(findDenialSpy).not.toHaveBeenCalled();
  });

  it('route @Public() : ni session ni porte', async () => {
    const { guard, findDenialSpy, authProvider } = buildGuard([denyingGate], null);
    await expect(guard.canActivate(contextFor(FakeController.prototype.open))).resolves.toBe(true);
    expect(authProvider.verifySession).not.toHaveBeenCalled();
    expect(findDenialSpy).not.toHaveBeenCalled();
  });

  it('sans session : 401 avant toute porte', async () => {
    const { guard, findDenialSpy } = buildGuard([denyingGate], null);
    await expect(guard.canActivate(contextFor(handler, orgHeader))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findDenialSpy).not.toHaveBeenCalled();
  });
});
