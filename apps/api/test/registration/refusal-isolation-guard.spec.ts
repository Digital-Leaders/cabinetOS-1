import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// BUILD-004 etape 2, EA-018 / TASK-065 (brief R8) : garde-fou STATIQUE. « Impossible par conception
// d'envoyer le motif interne au medecin » : le motif interne ne doit atteindre AUCUN code qui envoie un email.
// Les tests e2e prouvent l'absence du motif dans ce qui a ete envoye ; ce test empeche en plus qu'une future
// modification ne CREE un chemin (un parametre, une lecture SQL, un champ de modele) par lequel il pourrait passer.

const SRC = join(__dirname, '..', '..', 'src');
const read = (path: string) => readFileSync(join(SRC, path), 'utf-8');

/** Corps d'une methode ou fonction, par appariement des accolades (jamais par une regle de mise en forme). */
function bodyOf(source: string, name: RegExp): string {
  const match = name.exec(source);
  if (!match) throw new Error(`Introuvable : ${name}`);
  const open = source.indexOf('{', source.indexOf(')', match.index));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && (depth -= 1) === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(`Accolades non appariees pour ${name}`);
}

const INTERNAL =
  /internalReason|internal_reason|refusalInternalReason|refusal_internal_reason|motif/i;

describe('le motif interne n atteint JAMAIS le code qui envoie l email (R8)', () => {
  const service = read('business/registration/application/registration-refusal.service.ts');
  const queries = read('business/registration/infrastructure/validation.queries.ts');

  it("deliverRefusalEmail (l'envoi) ne recoit pas, ne lit pas et ne mentionne pas le motif interne", () => {
    const body = bodyOf(service, /private async deliverRefusalEmail\(/);
    expect(body).not.toMatch(INTERNAL);
  });

  it('resendRefusalEmail (le renvoi) ne mentionne pas le motif interne', () => {
    const body = bodyOf(service, /async resendRefusalEmail\(/);
    expect(body).not.toMatch(INTERNAL);
  });

  it('claimRefusalResendSlot ne LIT PAS le motif interne : il ne selectionne que le message AU DEMANDEUR', () => {
    const body = bodyOf(queries, /export async function claimRefusalResendSlot\(/);
    expect(body).not.toMatch(/refusal_internal_reason|refusalInternalReason|internal_reason/);
    expect(body).toMatch(/refusal_message_to_applicant/);
    expect(body).not.toMatch(/SELECT\s+\*|RETURNING\s+\*/i);
  });

  it("le modele d'email de refus n'a QUE deux parametres : le prenom et le message au demandeur", () => {
    const templates = read('modules/email/application/email-templates.ts');
    const line = templates.split('\n').find((l) => l.includes("'registration-refusal': {"));
    expect(line).toBeDefined();
    expect(line!.replace(/\s+/g, ' ')).toContain(
      "'registration-refusal': { firstName: string; messageToApplicant: string }",
    );
    const renderer = bodyOf(
      templates,
      /'registration-refusal': \(\{ firstName, messageToApplicant \}\) =>/,
    );
    expect(renderer).not.toMatch(INTERNAL);
  });

  it("aucun code ne demande l'envoi du modele de refus en dehors du service de refus", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (
          full.endsWith('.ts') &&
          /sendTemplate\(\s*'registration-refusal'/.test(readFileSync(full, 'utf-8'))
        ) {
          offenders.push(full.replace(SRC + '/', ''));
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([
      'business/registration/application/registration-refusal.service.ts',
    ]);
  });

  it('la lecture cote demandeur (statut) ne selectionne pas le motif interne : garde-fou de TASK-054 toujours en place', () => {
    const founder = read('business/registration/infrastructure/registration.queries.ts');
    const body = bodyOf(founder, /export async function findFounderRegistrationView\(/);
    expect(body).not.toMatch(/refusal_internal_reason|refusalInternalReason/);
  });
});
