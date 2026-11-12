import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// Garde-fou du reset commun (reset.css). Un test jsdom ne calcule pas les tailles a l'ecran : il ne peut pas voir
// qu'un champ deborde. Ce test verifie donc ce qui EMPECHE le defaut : la regle existe et le layout racine, seul point
// d'entree commun a toutes les pages, la charge. (Le defaut lui-meme a ete mesure dans un vrai navigateur : champs qui
// debordent de 26 a 28 px, champs voisins qui se chevauchent, defilement horizontal dans les fenetres.)

const SRC = join(__dirname, '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf-8');

describe('reset commun des tailles (box-sizing)', () => {
  it('reset.css declare box-sizing: border-box sur tous les elements et pseudo-elements, comme les maquettes', () => {
    const css = read('styles/reset.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(
      /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{\s*box-sizing:\s*border-box;?\s*\}/,
    );
  });

  it('le layout racine ([locale]/layout.tsx) charge ce fichier : toutes les pages le recoivent', () => {
    expect(read('app/[locale]/layout.tsx')).toMatch(/import\s+'\.\.\/\.\.\/styles\/reset\.css';/);
  });

  it('les maquettes declaraient cette regle : le front ne contient plus aucune regle box-sizing contraire', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (
          full.endsWith('.css') &&
          !full.endsWith('reset.css') &&
          /box-sizing:\s*content-box/.test(readFileSync(full, 'utf-8'))
        ) {
          offenders.push(full.replace(SRC + '/', ''));
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
