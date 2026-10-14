import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../../modules/shared';
import { RegistrationService } from '../application/registration.service';
import { CreateRegistrationDto } from './create-registration.dto';

// TASK-052 (BUILD-004 etape 2, EA-014) : point d'entree de l'inscription du fondateur.
// @Public() : le fondateur n'a pas encore de compte. C'est le seul endroit ou un compte
// peut etre cree depuis l'exterieur, et il cree toujours la demande avec (ADR-0021 D2).
//
// Reponses :
//   201 { data: { id, status: 'PENDING_VERIFICATION' } } + Set-Cookie de session ;
//   400 validation (champs, liste de specialites ou de villes, mot de passe) ;
//   409 email deja utilise, message neutre ;
//   500 inscription non enregistree (compte compense), message exploitable.

@Controller('registration-requests')
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Public()
  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateRegistrationDto, @Res({ passthrough: true }) response: Response) {
    const outcome = await this.registrationService.register(dto);
    for (const cookie of outcome.sessionCookies) {
      response.append('Set-Cookie', cookie);
    }
    return { data: { id: outcome.requestId, status: outcome.status }, meta: {} };
  }
}
