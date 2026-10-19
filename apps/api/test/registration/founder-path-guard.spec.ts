import { readFileSync } from 'fs';
import { join } from 'path';
import { maskEmail } from '../../src/business/registration/domain/registration-rules';

// TASK-054 (R8, ADR-0021 D4) : garde-fou statique. Le chemin fondateur (lecture du statut,
// renvoi d'email) ne doit JAMAIS lire le motif interne de refus ni la note de l'equipe --
// pas seulement « ne pas les renvoyer ». L'e2e prouve l'absence dans la reponse ; ce test
// empeche qu'une future modification les selectionne sur ce chemin.

const SRC = join(__dirname, '..', '..', 'src', 'business', 'registration');
const read = (path: string) => readFileSync(join(SRC, path), 'utf-8');

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  if (start < 0) throw new Error(`Fonction ${name} introuvable`);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe('Chemin fondateur : jamais le motif interne ni la note (TASK-054, R8)', () => {
  const queries = read('infrastructure/registration.queries.ts');

  it.each(['findFounderRegistrationView', 'claimComplementResendSlot'])(
    '%s ne lit ni refusal_internal_reason ni internal_note',
    (name) => {
      const body = functionBody(queries, name);
      expect(body).not.toMatch(/refusal_internal_reason|refusalInternalReason/);
      expect(body).not.toMatch(/internal_note|internalNote/);
      expect(body).not.toMatch(/SELECT\s+\*|RETURNING\s+\*/i);
    },
  );

  it.each([
    'application/registration-status.service.ts',
    'presentation/registration-status.controller.ts',
  ])('%s ne reference jamais le motif interne', (path) => {
    expect(read(path)).not.toMatch(/refusalInternalReason|refusal_internal_reason/);
  });
});

describe('maskEmail (brief §5.2)', () => {
  it.each([
    ['y.bennani@cabinet.ma', 'y•••••@cabinet.ma'],
    ['a@b.ma', 'a•••••@b.ma'],
    ['sans-arobase', '•••••'],
  ])('%s -> %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});
