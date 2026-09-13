import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

// Parcours d'acces, etape 1, commit 2 (ADR-0019) : extrait l identite deposee sur
// la requete par PermissionsGuard apres verifySession() -- utilisable sur tout
// endpoint @RequireAuthentication() ou @RequirePermission(). Meme principe que
// CurrentOrganizationId : le controle de presence ici est un filet de securite,
// le Guard a deja verifie la session avant que le controleur ne s execute.

interface RequestWithAuthIdentity extends Request {
  authIdentity?: { userId: string };
}

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<RequestWithAuthIdentity>();
    const userId = request.authIdentity?.userId;
    if (!userId) {
      throw new UnauthorizedException('Session absente ou invalide.');
    }
    return userId;
  },
);
