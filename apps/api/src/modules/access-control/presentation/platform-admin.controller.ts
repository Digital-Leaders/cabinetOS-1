import { Controller, Get } from '@nestjs/common';
import { CurrentUserId, RequirePlatformAdmin } from '../../shared';

// BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 D3) : « suis-je administrateur de la
// plateforme ? ». 200 pour un administrateur actif, 403 pour tout autre compte (membre
// d'organisation, fondateur, compte revoque), 401 sans session.
//
// C'est le premier point d'entree protege par @RequirePlatformAdmin() : il prouve la garde de
// bout en bout, et l'espace admin (TASK-060) s'en servira pour savoir s'il peut s'afficher.
// Prefixe /admin : les endpoints d'administration (TASK-059, EA-018) y vivront tous.

@Controller('admin')
export class PlatformAdminController {
  @Get('me')
  @RequirePlatformAdmin()
  me(@CurrentUserId() userId: string) {
    return { data: { userId, isPlatformAdmin: true }, meta: {} };
  }
}
