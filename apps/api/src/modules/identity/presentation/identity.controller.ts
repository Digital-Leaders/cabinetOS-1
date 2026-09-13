import { Controller, Get, Post, Param, BadRequestException } from '@nestjs/common';
import { DatabaseService, RequireAuthentication, CurrentUserId } from '../../shared';
import {
  findOrganizationMembershipsForUser,
  setDefaultOrganizationMembership,
} from '../infrastructure/user.queries';

// Parcours d'acces, etape 1, commit 2 (ADR-0019) : ces deux endpoints resolvent
// l organisation a la connexion, AVANT qu aucune organisation ne soit
// selectionnee -- @RequireAuthentication() (session seule), jamais
// @RequirePermission() (qui exigerait x-organization-id, precisement ce qu on
// cherche a determiner). userId vient exclusivement de la session verifiee
// (@CurrentUserId()), jamais d un parametre client.

@Controller('identity')
export class IdentityController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get('organizations')
  @RequireAuthentication()
  async organizations(@CurrentUserId() userId: string) {
    const memberships = await findOrganizationMembershipsForUser(this.databaseService, userId);
    return { data: memberships, meta: {} };
  }

  @Post('organizations/:organizationId/default')
  @RequireAuthentication()
  async setDefaultOrganization(
    @CurrentUserId() userId: string,
    @Param('organizationId') organizationId: string,
  ) {
    const result = await setDefaultOrganizationMembership(
      this.databaseService,
      userId,
      organizationId,
    );
    if (!result.matched) {
      throw new BadRequestException(
        'organizationId ne correspond a aucune adhesion de cet utilisateur.',
      );
    }
    return { data: result.memberships, meta: {} };
  }
}
