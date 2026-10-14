import { readFileSync } from 'fs';
import { join } from 'path';
import { medecinSpecialtyEnum } from '../../src/business/medecin';
import { GENERALISTE, REGISTRATION_CITIES } from '../../src/business/registration';

// TASK-053 (BUILD-004 etape 2) : les listes de l'ecran d'inscription (apps/web) doivent
// rester exactement celles que le serveur accepte (TASK-052). Le front ne peut pas
// importer le code de l'API ; ce test lit donc le fichier du front et compare. S'il
// echoue, une liste a derive : un medecin se verrait proposer une valeur refusee, ou
// ne trouverait pas la sienne.

const WEB_OPTIONS = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    '..',
    'web',
    'src',
    'features',
    'registration',
    'registration-options.ts',
  ),
  'utf-8',
);

function readWebList(name: string): string[] {
  const match = WEB_OPTIONS.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`));
  if (!match) throw new Error(`Liste ${name} introuvable dans registration-options.ts`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const WEB_LABELS = {
  fr: JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'web', 'src', 'messages', 'fr.json'), 'utf-8'),
  ),
  ar: JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'web', 'src', 'messages', 'ar.json'), 'utf-8'),
  ),
};

describe('Listes de l inscription : front et serveur identiques (TASK-053)', () => {
  it('specialites : generaliste puis les valeurs du module Medecin, dans le meme ordre', () => {
    expect(readWebList('SPECIALTY_CODES')).toEqual([
      GENERALISTE,
      ...medecinSpecialtyEnum.enumValues,
    ]);
  });

  it('villes : exactement REGISTRATION_CITIES', () => {
    expect(readWebList('REGISTRATION_CITIES')).toEqual([...REGISTRATION_CITIES]);
  });

  it('chaque code a un libelle, en francais et en arabe', () => {
    for (const lang of ['fr', 'ar'] as const) {
      const labels = WEB_LABELS[lang].Registration;
      for (const code of [GENERALISTE, ...medecinSpecialtyEnum.enumValues]) {
        expect({ lang, code, label: labels.specialties[code] }).toEqual({
          lang,
          code,
          label: expect.any(String),
        });
      }
      for (const city of REGISTRATION_CITIES) {
        expect({ lang, city, label: labels.cities[city] }).toEqual({
          lang,
          city,
          label: expect.any(String),
        });
      }
    }
  });
});
