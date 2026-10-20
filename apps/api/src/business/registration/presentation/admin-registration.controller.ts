import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUserId, RequirePlatformAdmin } from '../../../modules/shared';
import { AdminRegistrationService } from '../application/admin-registration.service';
import { RegistrationValidationService } from '../application/registration-validation.service';
import { RegistrationComplementService } from '../application/registration-complement.service';
import {
  ListRegistrationRequestsQueryDto,
  RequestComplementDto,
  UpdateInternalNoteDto,
} from './admin-registration.dto';

// BUILD-004 etape 2, EA-017 / TASK-059 : espace admin des demandes d'inscription, en lecture
// (brief §5.3 et §5.4). Reserve a l'equipe CabinetOS.
//
// @RequirePlatformAdmin() est pose au niveau de la CLASSE : toute route ajoutee un jour a ce
// controleur est reservee a l'equipe par defaut, sans y penser. Ces routes voient TOUTES les
// demandes (tables hors RLS) : c'est ce decorateur qui est la protection, et un test echoue si
// il disparait.
//
//   GET  /admin/registration-requests           liste (filtre, recherche, curseur, compteurs)
//   GET  /admin/registration-requests/:id       detail en lecture seule + note + historique
//   PUT  /admin/registration-requests/:id/internal-note   la note interne
//   POST /admin/registration-requests/:id/validate        VALIDER : cascade atomique + email decouple (EA-018)
//   POST /admin/registration-requests/:id/resend-activation-email   renvoi de l'email d'activation (R6)
//   POST /admin/registration-requests/:id/request-complement        DEMANDER UN COMPLEMENT (EA-018, R7)
//   POST /admin/registration-requests/:id/resend-complement-email   renvoi du complement, a l'identique

@Controller('admin/registration-requests')
@RequirePlatformAdmin()
export class AdminRegistrationController {
  constructor(
    private readonly adminService: AdminRegistrationService,
    private readonly validationService: RegistrationValidationService,
    private readonly complementService: RegistrationComplementService,
  ) {}

  @Get()
  list(@Query() query: ListRegistrationRequestsQueryDto) {
    return this.adminService.list(query);
  }

  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return { data: await this.adminService.detail(id), meta: {} };
  }

  @Put(':id/internal-note')
  async saveInternalNote(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateInternalNoteDto,
  ) {
    return { data: await this.adminService.saveInternalNote(id, body.internalNote), meta: {} };
  }

  /**
   * VALIDER (brief R4, R6). 200 { id, status: 'ACTIVE', organizationId, activationEmail: { sent } } --
   * `sent: false` si l'email n'est pas parti : la validation reste ACQUISE, l'echec est dans l'historique
   * et l'envoi peut etre relance. 404 demande inconnue ; 409 demande deja traitee (y compris par un autre
   * administrateur au meme instant) ; 500 si la cascade echoue : rien n'a alors ete cree.
   */
  @Post(':id/validate')
  @HttpCode(200)
  async validate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() adminUserId: string,
  ) {
    return { data: await this.validationService.validate(id, adminUserId), meta: {} };
  }

  /** 200 { sent } ; 404 inconnue ; 409 demande non validee ; 429 si un renvoi date de moins de 60 s. */
  @Post(':id/resend-activation-email')
  @HttpCode(200)
  async resendActivationEmail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() adminUserId: string,
  ) {
    return { data: await this.validationService.resendActivationEmail(id, adminUserId), meta: {} };
  }

  /**
   * DEMANDER UN COMPLEMENT (brief R7). 200 { id, status: 'COMPLEMENT_REQUESTED', complementEmail: { sent } } --
   * `sent: false` si l'email n'est pas parti : la demande de complement reste ACQUISE, l'echec est dans
   * l'historique et l'envoi peut etre relance. 400 type ou message invalide ; 404 demande inconnue ; 409
   * demande deja traitee (validee ou refusee) ; 500 si l'enregistrement echoue : rien n'a alors ete modifie.
   */
  @Post(':id/request-complement')
  @HttpCode(200)
  async requestComplement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RequestComplementDto,
    @CurrentUserId() adminUserId: string,
  ) {
    return {
      data: await this.complementService.requestComplement(id, adminUserId, body),
      meta: {},
    };
  }

  /** 200 { sent } ; 404 inconnue ; 409 demande pas en attente de complement ; 429 si un renvoi date de moins de 60 s. */
  @Post(':id/resend-complement-email')
  @HttpCode(200)
  async resendComplementEmail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUserId() adminUserId: string,
  ) {
    return { data: await this.complementService.resendComplementEmail(id, adminUserId), meta: {} };
  }
}
