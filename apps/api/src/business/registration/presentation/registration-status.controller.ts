import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUserId, RequireAuthentication } from '../../../modules/shared';
import { RegistrationStatusService } from '../application/registration-status.service';

// TASK-054 (BUILD-004 etape 2, EA-015) : statut de la demande du fondateur connecte, et
// renvoi de l'email de complement (ADR-0021 D4, ADR-0022).
//
// @RequireAuthentication() : session seule, sans organisation -- un fondateur non ACTIVE
// n'en a aucune. L'identite vient de la session (@CurrentUserId()), jamais du client : un
// fondateur ne peut lire ou agir que sur SA demande.
//
// Chemin conserve tel que decide en ADR-0021 D4 (/identity/registration-status), meme si
// le code vit dans le module Business registration (dependency-cruiser).

@Controller('identity/registration-status')
export class RegistrationStatusController {
  constructor(private readonly statusService: RegistrationStatusService) {}

  @Get()
  @RequireAuthentication()
  async status(@CurrentUserId() userId: string) {
    return { data: await this.statusService.getStatus(userId), meta: {} };
  }

  /**
   * 200 { sent, nextResendAllowedAt } -- sent=false si l'envoi a echoue (trace, renvoyable) ;
   * 409 si la demande n'est pas en attente de complement ; 429 si le delai anti-abus court.
   */
  @Post('resend-email')
  @HttpCode(200)
  @RequireAuthentication()
  async resendEmail(@CurrentUserId() userId: string) {
    return { data: await this.statusService.resendComplementEmail(userId), meta: {} };
  }
}
