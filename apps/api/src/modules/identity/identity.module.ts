import { Module } from '@nestjs/common';
import { SharedModule } from '../shared';
import { IdentityController } from './presentation/identity.controller';
import { AUTH_PROVIDER } from './application/auth-provider.port';
import { BetterAuthProviderAdapter } from './infrastructure/better-auth-provider.adapter';

// Parcours d'acces, etape 1, commit 2 : SharedModule importe explicitement (pas
// @Global()), meme necessite que Patient/Medecin -- DatabaseService doit etre
// injectable dans IdentityController pour la resolution d'organisation.
@Module({
  imports: [SharedModule],
  controllers: [IdentityController],
  providers: [{ provide: AUTH_PROVIDER, useClass: BetterAuthProviderAdapter }],
  exports: [AUTH_PROVIDER],
})
export class IdentityModule {}
