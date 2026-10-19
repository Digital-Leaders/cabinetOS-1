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
import { AccountAccessGateRegistry } from '../application/account-access-gate';
import { isPlatformAdmin } from '../infrastructure/platform-admin.queries';
import { IS_PUBLIC_KEY } from '../../shared/presentation/public.decorator';
import { REQUIRE_AUTHENTICATION_KEY } from '../../shared/presentation/require-authentication.decorator';
import { REQUIRE_PLATFORM_ADMIN_KEY } from '../../shared/presentation/require-platform-admin.decorator';
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
    private readonly accessGates: AccountAccessGateRegistry,
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

    const platformAdminOnly = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_PLATFORM_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required && !authenticationOnly && !platformAdminOnly) {
      throw new ForbiddenException(
        'Endpoint sans @RequirePermission(), @RequireAuthentication(), @RequirePlatformAdmin() ni @Public() explicite : acces refuse par defaut.',
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

    // BUILD-004 etape 2 (ADR-0021 D3, TASK-058) : endpoint d'administration de la PLATEFORME.
    // Reserve aux comptes de platform_admins (lus avec l'identite de la SESSION verifiee,
    // jamais celle du client). Aucune organisation n'est requise ni consultee, et ce droit
    // n'ouvre AUCUNE donnee d'organisation : sur un endpoint @RequirePermission, un
    // administrateur de plateforme reste soumis aux permissions de son organisation comme
    // n'importe qui. Un endpoint qui cumule les deux decorateurs exige les deux.
    if (platformAdminOnly) {
      if (!(await isPlatformAdmin(this.databaseService, identity.userId))) {
        throw new ForbiddenException('Acces reserve aux administrateurs de la plateforme.');
      }
      if (!required) {
        return true;
      }
    }

    if (authenticationOnly && !required) {
      return true;
    }

    // BUILD-004 etape 2 (ADR-0021 D4, TASK-056) : acces aux DONNEES metier. Un compte dont la
    // demande d'inscription n'est pas ACTIVE n'y accede jamais -- avant meme de regarder
    // l'organisation ou les permissions, donc independamment du RBAC. Place APRES le retour
    // anticipe ci-dessus : les routes « session seule » (statut de la demande, liste de ses
    // propres organisations) restent accessibles, c'est ainsi qu'un fondateur atteint son
    // ecran de statut. Un compte sans demande (equipe, demos) n'est jamais concerne.
    const denial = await this.accessGates.findDenial(identity.userId);
    if (denial) {
      throw new ForbiddenException(denial.message);
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
