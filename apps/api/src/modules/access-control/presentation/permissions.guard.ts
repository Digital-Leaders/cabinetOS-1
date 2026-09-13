import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_PROVIDER } from '../../identity/application/auth-provider.port';
import type { AuthProvider } from '../../identity/application/auth-provider.port';
import { DatabaseService } from '../../shared/database/database.service';
import { hasPermission } from '../infrastructure/permission-check.queries';
import { IS_PUBLIC_KEY } from '../../shared/presentation/public.decorator';
import { REQUIRE_AUTHENTICATION_KEY } from '../../shared/presentation/require-authentication.decorator';
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from '../../shared/presentation/require-permission.decorator';

interface RequestWithAuthIdentity extends Request {
  authIdentity?: { userId: string };
}

// TASK-016 : Guard global, fail-closed. Un endpoint SANS @Public() ni
// @RequirePermission() ni @RequireAuthentication() explicite est refuse par
// defaut -- l oubli d un decorateur ne peut jamais se traduire par un acces
// ouvert par erreur.
//
// Parcours d'acces, etape 1, commit 2 (ADR-0019) : @RequireAuthentication()
// couvre le cas intermediaire entre @Public() (rien verifie) et
// @RequirePermission() (session + organisation + permission) -- une session
// valide est requise, mais aucune organisation n est encore selectionnee (la
// resolution d organisation elle-meme). L identite verifiee est deposee sur la
// requete (authIdentity) pour @CurrentUserId().
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
    private readonly databaseService: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const authenticationOnly = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_AUTHENTICATION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required && !authenticationOnly) {
      throw new ForbiddenException(
        'Endpoint sans @RequirePermission(), @RequireAuthentication() ni @Public() explicite : acces refuse par defaut.',
      );
    }

    const request = context.switchToHttp().getRequest<RequestWithAuthIdentity>();
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(key, value);
    }

    const identity = await this.authProvider.verifySession(headers);
    if (!identity) {
      throw new UnauthorizedException('Session absente ou invalide.');
    }
    request.authIdentity = { userId: identity.userId };

    if (authenticationOnly && !required) {
      return true;
    }

    const organizationId = request.headers['x-organization-id'];
    if (!organizationId || typeof organizationId !== 'string') {
      throw new ForbiddenException('Contexte d organisation (en-tete x-organization-id) requis.');
    }

    const allowed = await hasPermission(
      this.databaseService,
      organizationId,
      identity.userId,
      required!.action,
      required!.resource,
    );

    if (!allowed) {
      throw new ForbiddenException(
        `Permission manquante : ${required!.action} sur ${required!.resource}.`,
      );
    }

    return true;
  }
}
