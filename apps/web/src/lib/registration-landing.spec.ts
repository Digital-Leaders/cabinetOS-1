import { findStatusRedirect } from './registration-landing';

// TASK-057 (EA-016) : redirection serveur a l'arrivee sur l'accueil. ECHEC OUVERT : tout ce
// qui n'est pas un statut non valide lisible laisse l'accueil s'afficher -- la protection
// reelle est cote API (TASK-056).

function respond(status: number, body: unknown): typeof fetch {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const COOKIE = 'better-auth.session_token=abc.def';

describe('findStatusRedirect (TASK-057)', () => {
  it.each(['PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED', 'REFUSED'])(
    '%s : redirige vers l ecran de statut, dans la langue courante',
    async (status) => {
      const fetchImpl = respond(200, { data: { status } });
      await expect(findStatusRedirect('ar', COOKIE, { fetchImpl })).resolves.toBe(
        '/ar/registration-status',
      );
    },
  );

  it('ACTIVE : pas de redirection', async () => {
    await expect(
      findStatusRedirect('fr', COOKIE, { fetchImpl: respond(200, { data: { status: 'ACTIVE' } }) }),
    ).resolves.toBeNull();
  });

  it('compte sans demande (equipe, demos) : pas de redirection -- aucune difference pour l etape 1', async () => {
    await expect(
      findStatusRedirect('fr', COOKIE, { fetchImpl: respond(200, { data: { status: null } }) }),
    ).resolves.toBeNull();
  });

  it('transmet le cookie de session et interroge la bonne route, sans cache', async () => {
    const fetchImpl = respond(200, { data: { status: null } });
    await findStatusRedirect('fr', COOKIE, { fetchImpl, apiUrl: 'http://api.test:3000' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test:3000/api/v1/identity/registration-status',
      expect.objectContaining({ headers: { cookie: COOKIE }, cache: 'no-store' }),
    );
  });

  it('sans cookie : aucun appel, aucune redirection', async () => {
    const fetchImpl = respond(200, { data: { status: 'REFUSED' } });
    await expect(findStatusRedirect('fr', '', { fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])(
    'API en erreur (%i) : echec ouvert, pas de redirection',
    async (code) => {
      await expect(
        findStatusRedirect('fr', COOKIE, { fetchImpl: respond(code, { error: {} }) }),
      ).resolves.toBeNull();
    },
  );

  it('API injoignable : echec ouvert', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as never;
    await expect(findStatusRedirect('fr', COOKIE, { fetchImpl })).resolves.toBeNull();
  });

  it('reponse illisible : echec ouvert', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }) as never;
    await expect(findStatusRedirect('fr', COOKIE, { fetchImpl })).resolves.toBeNull();
  });

  it('API trop lente : echec ouvert apres le delai (l accueil ne reste jamais bloque)', async () => {
    const fetchImpl = jest.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as never;
    const started = Date.now();
    await expect(
      findStatusRedirect('fr', COOKIE, { fetchImpl, timeoutMs: 50 }),
    ).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
