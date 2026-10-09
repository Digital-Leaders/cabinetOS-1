import { envValidationSchema } from '../../src/modules/shared/config/env.validation';

// EA-013 : la configuration email. La cle API est un secret : requise seulement
// avec le fournisseur reel, et "memory" est interdit en production.

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};
const validate = (extra: Record<string, string>) =>
  envValidationSchema.validate({ ...base, ...extra });

describe('Configuration email', () => {
  it('hors production : "memory" par defaut, adresses documentees par defaut', () => {
    const { error, value } = validate({});
    expect(error).toBeUndefined();
    expect(value.EMAIL_PROVIDER).toBe('memory');
    expect(value.EMAIL_FROM_ADDRESS).toBe('noreply@portesante.ma');
    expect(value.EMAIL_FROM_NAME).toBe('PorteSanté');
    expect(value.EMAIL_REPLY_TO).toBe('verification@portesante.ma');
  });

  it('le fournisseur brevo exige BREVO_API_KEY', () => {
    const { error } = validate({ EMAIL_PROVIDER: 'brevo' });
    expect(error?.message).toMatch(/BREVO_API_KEY/);
  });

  it('le fournisseur brevo avec une cle est accepte', () => {
    expect(
      validate({ EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'cle-de-test-0123456789' }).error,
    ).toBeUndefined();
  });

  it('en production : brevo obligatoire, memory refuse, absence refusee', () => {
    expect(validate({ NODE_ENV: 'production' }).error?.message).toMatch(/EMAIL_PROVIDER/);
    expect(validate({ NODE_ENV: 'production', EMAIL_PROVIDER: 'memory' }).error?.message).toMatch(
      /EMAIL_PROVIDER/,
    );
    expect(
      validate({
        NODE_ENV: 'production',
        EMAIL_PROVIDER: 'brevo',
        BREVO_API_KEY: 'cle-de-test-0123456789',
      }).error,
    ).toBeUndefined();
  });

  it('refuse une adresse expeditrice invalide', () => {
    expect(validate({ EMAIL_FROM_ADDRESS: 'pas-un-email' }).error?.message).toMatch(
      /EMAIL_FROM_ADDRESS/,
    );
  });
});
