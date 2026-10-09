import { Module } from '@nestjs/common';
import { SharedModule } from './modules/shared';
import { IdentityModule } from './modules/identity';
import { OrganizationModule } from './modules/organization';
import { AccessControlModule } from './modules/access-control';
import { AuditModule } from './modules/audit';
import { NotificationsModule } from './modules/notifications';
import { SettingsModule } from './modules/settings';
import { StorageModule } from './modules/storage';
import { PatientModule } from './business/patient';
import { MedecinModule } from './business/medecin';

@Module({
  imports: [
    SharedModule,
    IdentityModule,
    OrganizationModule,
    AccessControlModule,
    AuditModule,
    NotificationsModule,
    SettingsModule,
    StorageModule,
    PatientModule,
    MedecinModule,
  ],
})
export class AppModule {}
