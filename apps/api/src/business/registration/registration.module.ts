import { Module } from '@nestjs/common';
import { SharedModule } from '../../modules/shared';
import { IdentityModule } from '../../modules/identity';
import { EmailModule } from '../../modules/email';
import { RegistrationService } from './application/registration.service';
import { RegistrationController } from './presentation/registration.controller';
import { RegistrationStatusService } from './application/registration-status.service';
import { RegistrationStatusController } from './presentation/registration-status.controller';

// TASK-052 (BUILD-004 etape 2, EA-014). Module Business : la cascade (EA-018) appellera
// le module Medecin, ce que le Core n'a pas le droit de faire (dependency-cruiser).
@Module({
  imports: [SharedModule, IdentityModule, EmailModule],
  controllers: [RegistrationController, RegistrationStatusController],
  providers: [RegistrationService, RegistrationStatusService],
})
export class RegistrationModule {}
