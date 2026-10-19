import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../src/modules/access-control/presentation/permissions.guard';
import { AccountAccessGateRegistry } from '../../src/modules/access-control/application/account-access-gate';
import { AUTH_PROVIDER } from '../../src/modules/identity/application/auth-provider.port';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import * as permissionCheck from '../../src/modules/access-control/infrastructure/permission-check.queries';

// TASK-016 : test unitaire du Guard, dependances simulees -- complete le test
// e2e (test/permissions-guard.e2e-spec.ts) qui valide, lui, le comportement
// reel via de vraies requetes HTTP contre une vraie base.

function buildContext(headers: Record<string, string>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard (unitaire, TASK-016)', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let authProviderMock: { verifySession: jest.Mock };

  beforeEach(async () => {
    authProviderMock = { verifySession: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        Reflector,
        // EA-016 (TASK-056) : dependance obligatoire de la garde. Registre vide = aucune
        // porte d'acces enregistree = comportement de l'etape 1, que ce test verifie.
        AccountAccessGateRegistry,
        { provide: AUTH_PROVIDER, useValue: authProviderMock },
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
    reflector = module.get(Reflector);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('autorise un endpoint marque @Public() sans verifier de session', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
    const result = await guard.canActivate(buildContext({}));
    expect(result).toBe(true);
    expect(authProviderMock.verifySession).not.toHaveBeenCalled();
  });

  it('refuse (fail-closed) un endpoint sans @Public() ni @RequirePermission()', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(ForbiddenException);
  });

  it('renvoie 401 si aucune session valide', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ action: 'read', resource: 'members' });
    authProviderMock.verifySession.mockResolvedValueOnce(null);

    await expect(guard.canActivate(buildContext({ 'x-organization-id': 'org-1' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('renvoie 403 si l en-tete d organisation est absent', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ action: 'read', resource: 'members' });
    authProviderMock.verifySession.mockResolvedValueOnce({
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
    });

    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(ForbiddenException);
  });

  it('renvoie 403 si l utilisateur n a pas la permission requise', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ action: 'read', resource: 'members' });
    authProviderMock.verifySession.mockResolvedValueOnce({
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
    });
    jest.spyOn(permissionCheck, 'hasPermission').mockResolvedValueOnce(false);

    await expect(guard.canActivate(buildContext({ 'x-organization-id': 'org-1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('autorise l acces si l utilisateur a la permission requise', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ action: 'read', resource: 'members' });
    authProviderMock.verifySession.mockResolvedValueOnce({
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
    });
    jest.spyOn(permissionCheck, 'hasPermission').mockResolvedValueOnce(true);

    const result = await guard.canActivate(buildContext({ 'x-organization-id': 'org-1' }));
    expect(result).toBe(true);
  });
});
