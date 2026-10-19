import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessControlController } from './presentation/access-control.controller';
import { PlatformAdminController } from './presentation/platform-admin.controller';
import { PermissionsGuard } from './presentation/permissions.guard';
import { AccountAccessGateRegistry } from './application/account-access-gate';
import { IdentityModule } from '../identity';
import { SharedModule } from '../shared';

@Module({
  imports: [IdentityModule, SharedModule],
  controllers: [AccessControlController, PlatformAdminController],
  providers: [AccountAccessGateRegistry, { provide: APP_GUARD, useClass: PermissionsGuard }],
  // Exporte pour que les modules Business enregistrent leur porte d'acces (TASK-056).
  exports: [AccountAccessGateRegistry],
})
export class AccessControlModule {}
