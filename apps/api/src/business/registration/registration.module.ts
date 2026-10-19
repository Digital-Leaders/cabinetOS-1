import { Module } from '@nestjs/common';
import { SharedModule } from '../../modules/shared';
import { IdentityModule } from '../../modules/identity';
import { EmailModule } from '../../modules/email';
import { AccessControlModule } from '../../modules/access-control';
import { RegistrationService } from './application/registration.service';
import { RegistrationController } from './presentation/registration.controller';
import { RegistrationAccessGate } from './application/registration-access-gate';
import { RegistrationStatusService } from './application/registration-status.service';
import { RegistrationStatusController } from './presentation/registration-status.controller';
import { AdminRegistrationService } from './application/admin-registration.service';
import { AdminRegistrationController } from './presentation/admin-registration.controller';

// TASK-052 (BUILD-004 etape 2, EA-014). Module Business : la cascade (EA-018) appellera
// le module Medecin, ce que le Core n'a pas le droit de faire (dependency-cruiser).
@Module({
  imports: [SharedModule, IdentityModule, EmailModule, AccessControlModule],
  controllers: [RegistrationController, RegistrationStatusController, AdminRegistrationController],
  providers: [
    RegistrationService,
    RegistrationStatusService,
    RegistrationAccessGate,
    AdminRegistrationService,
  ],
})
export class RegistrationModule {}
