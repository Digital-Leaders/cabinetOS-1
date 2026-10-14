import { readFileSync } from 'fs';
import { join } from 'path';
import { envValidationSchema } from '../src/modules/shared/config/env.validation';

// EA-013 (correctif demande a la validation) : .env.recette.example (NODE_ENV=production)
// doit declarer toutes les variables exigees en production. Sans le bloc EMAIL_*, la
// recette refusait de demarrer (EMAIL_PROVIDER=brevo obligatoire en production).
// Les secrets restent vides dans le fichier : on les remplit ici par des valeurs fictives,
// uniquement pour verifier qu'aucune variable n'y manque.

function parseEnvFile(path: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

describe('.env.recette.example', () => {
  const env = parseEnvFile(join(__dirname, '..', '.env.recette.example'));

  it('declare EMAIL_PROVIDER=brevo et la cle Brevo, laissee vide (jamais de secret commite)', () => {
    expect(env.NODE_ENV).toBe('production');
    expect(env.EMAIL_PROVIDER).toBe('brevo');
    expect(env).toHaveProperty('BREVO_API_KEY', '');
  });

  it('passe la validation de demarrage une fois les secrets fournis par l environnement', () => {
    // allowUnknown : memes options que ConfigModule (@nestjs/config) au demarrage.
    const { error } = envValidationSchema.validate(
      { ...env, BREVO_API_KEY: 'valeur-fictive-de-test' },
      { allowUnknown: true, abortEarly: false },
    );
    expect(error).toBeUndefined();
  });
});
