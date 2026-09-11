import { spawn, ChildProcess } from 'child_process';

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess: ChildProcess;

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // pas encore pret
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Le serveur Next.js ne demarre pas a temps');
}

// Parcours d'acces, etape 1 -- "/" exige desormais une session (middleware,
// proxy.ts) : teste ici "/login", qui reste public, pour verifier le routage de
// langue (dir="ltr"/"rtl"). Marqueur de rendu reel (class="lf-shell") plutot
// qu'une chaine de traduction : NextIntlClientProvider serialise TOUTES les
// traductions (dont HomePage.title) dans le payload de CHAQUE page pour
// l'hydratation -- une chaine de traduction seule ne prouve pas que la bonne
// page a rendu, seulement que la bonne langue a charge quelque part.

describe('i18n locales (e2e)', () => {
  beforeAll(async () => {
    serverProcess = spawn(`pnpm exec next dev -p ${PORT}`, {
      cwd: __dirname + '/..',
      stdio: 'ignore',
      shell: true,
    });
    await waitForServer(`${BASE_URL}/fr/login`, 30000);
  }, 40000);

  afterAll(() => {
    serverProcess.kill();
  });

  it('affiche l ecran de connexion en francais avec dir="ltr"', async () => {
    const res = await fetch(`${BASE_URL}/fr/login`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('class="lf-shell"');
  });

  it('affiche l ecran de connexion en arabe avec dir="rtl"', async () => {
    const res = await fetch(`${BASE_URL}/ar/login`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('class="lf-shell"');
  });
});
