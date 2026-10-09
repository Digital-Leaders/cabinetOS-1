import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  EmailModule,
  EMAIL_SENDER,
  InMemoryEmailSender,
  TransactionalEmailService,
} from '../../src/modules/email';
import { BrevoEmailSender } from '../../src/modules/email/infrastructure/brevo-email-sender.adapter';

// EA-013 : cablage du module, choix du fournisseur par configuration, et absence
// de secret dans le code.

const baseConfig = {
  EMAIL_FROM_ADDRESS: 'noreply@portesante.ma',
  EMAIL_FROM_NAME: 'PorteSanté',
  EMAIL_REPLY_TO: 'verification@portesante.ma',
};

async function build(config: Record<string, string>) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({ ...baseConfig, ...config })],
      }),
      EmailModule,
    ],
  }).compile();
}

describe('EmailModule', () => {
  it('EMAIL_PROVIDER=memory : adaptateur en memoire, service injectable', async () => {
    const moduleRef = await build({ EMAIL_PROVIDER: 'memory' });
    expect(moduleRef.get(EMAIL_SENDER)).toBeInstanceOf(InMemoryEmailSender);
    expect(moduleRef.get(TransactionalEmailService)).toBeDefined();
  });

  it('EMAIL_PROVIDER=brevo : adaptateur Brevo, cle lue dans la configuration', async () => {
    const moduleRef = await build({
      EMAIL_PROVIDER: 'brevo',
      BREVO_API_KEY: 'cle-de-test-0123456789',
    });
    expect(moduleRef.get(EMAIL_SENDER)).toBeInstanceOf(BrevoEmailSender);
  });

  it('EMAIL_PROVIDER=brevo sans cle : le module refuse de demarrer', async () => {
    await expect(build({ EMAIL_PROVIDER: 'brevo' })).rejects.toThrow(/BREVO_API_KEY/);
  });

  it('aucune cle API codee en dur dans le module email (les cles Brevo commencent par xkeysib-)', () => {
    const root = join(__dirname, '../../src/modules/email');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.ts')) files.push(full);
      }
    };
    walk(root);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, 'utf-8')).not.toMatch(/xkeysib-[a-z0-9]/i);
    }
  });
});
