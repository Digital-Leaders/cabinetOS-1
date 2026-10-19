import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { RequirePlatformAdmin } from '../../../modules/shared';
import { AdminRegistrationService } from '../application/admin-registration.service';
import { ListRegistrationRequestsQueryDto, UpdateInternalNoteDto } from './admin-registration.dto';

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
//   PUT  /admin/registration-requests/:id/internal-note   la seule ecriture : la note interne

@Controller('admin/registration-requests')
@RequirePlatformAdmin()
export class AdminRegistrationController {
  constructor(private readonly adminService: AdminRegistrationService) {}

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
}
