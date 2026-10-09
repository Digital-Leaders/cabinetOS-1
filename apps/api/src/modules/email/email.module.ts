import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_SENDER } from './application/email-sender.port';
import {
  EMAIL_OPTIONS,
  TransactionalEmailService,
  type EmailOptions,
} from './application/transactional-email.service';
import { BrevoEmailSender } from './infrastructure/brevo-email-sender.adapter';
import { InMemoryEmailSender } from './infrastructure/in-memory-email-sender.adapter';

// EA-013 (ADR-0020) : brique transverse du socle. Le fournisseur se choisit par
// configuration (EMAIL_PROVIDER) : "brevo" (obligatoire en production) ou "memory"
// (defaut hors production : rien ne part reellement). La cle API ne se lit que
// dans l'environnement (BREVO_API_KEY), jamais dans le code.
@Module({
  providers: [
    {
      provide: EMAIL_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmailOptions => ({
        from: {
          email: config.getOrThrow<string>('EMAIL_FROM_ADDRESS'),
          name: config.getOrThrow<string>('EMAIL_FROM_NAME'),
        },
        supportReplyTo: { email: config.getOrThrow<string>('EMAIL_REPLY_TO') },
      }),
    },
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get<string>('EMAIL_PROVIDER') === 'brevo'
          ? new BrevoEmailSender(config.getOrThrow<string>('BREVO_API_KEY'))
          : new InMemoryEmailSender(),
    },
    TransactionalEmailService,
  ],
  exports: [TransactionalEmailService, EMAIL_SENDER],
})
export class EmailModule {}
