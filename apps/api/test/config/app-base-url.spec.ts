import { envValidationSchema } from '../../src/modules/shared/config/env.validation';

// BUILD-004 etape 2, EA-018 / TASK-063 : APP_BASE_URL, l'adresse publique du site, cible du lien
// « Se connecter » de l'email d'activation. Obligatoire en production : un lien vers localhost dans un
// email envoye a un medecin serait un defaut grave.

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};
const production = {
  ...base,
  NODE_ENV: 'production',
  EMAIL_PROVIDER: 'brevo',
  BREVO_API_KEY: 'cle-fictive-de-test',
  EMAIL_FROM_ADDRESS: 'noreply@portesante.ma',
  EMAIL_FROM_NAME: 'PorteSante',
  EMAIL_REPLY_TO: 'verification@portesante.ma',
};
const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(env, { allowUnknown: true, abortEarly: false });

describe('APP_BASE_URL (TASK-063)', () => {
  it('hors production : le front local par defaut, rien a configurer', () => {
    const { error, value } = validate({ ...base, NODE_ENV: 'development' });
    expect(error).toBeUndefined();
    expect(value.APP_BASE_URL).toBe('http://localhost:3001');
  });

  it('en test : meme valeur par defaut', () => {
    const { error, value } = validate({ ...base, NODE_ENV: 'test' });
    expect(error).toBeUndefined();
    expect(value.APP_BASE_URL).toBe('http://localhost:3001');
  });

  it('EN PRODUCTION : absente, le demarrage est REFUSE (jamais un lien vers localhost)', () => {
    const { error } = validate(production);
    expect(error?.message).toMatch(/APP_BASE_URL.*required/);
  });

  it('en production, avec une adresse https valide : accepte', () => {
    const { error, value } = validate({ ...production, APP_BASE_URL: 'https://app.portesante.ma' });
    expect(error).toBeUndefined();
    expect(value.APP_BASE_URL).toBe('https://app.portesante.ma');
  });

  it.each([
    ['sans protocole', 'app.portesante.ma'],
    ['un autre protocole', 'ftp://app.portesante.ma'],
    ['un protocole dangereux', 'javascript:alert(1)'],
    ['vide', ''],
  ])('refuse une adresse invalide (%s), en production comme ailleurs', (_label, value) => {
    expect(validate({ ...production, APP_BASE_URL: value }).error).toBeDefined();
    expect(validate({ ...base, NODE_ENV: 'development', APP_BASE_URL: value }).error).toBeDefined();
  });
});
