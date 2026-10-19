import {
  fetchAdminMe,
  fetchIsPlatformAdmin,
  fetchRegistrationRequestDetail,
  fetchRegistrationRequests,
  saveInternalNote,
} from './admin-client';

// TASK-060 : chaque reponse de l'API admin (TASK-058, TASK-059) est classee par statut HTTP,
// jamais par le texte du serveur.

function mockFetch(status: number, body: unknown = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
  return global.fetch as jest.Mock;
}

describe('classement des erreurs', () => {
  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [500, 'UNEXPECTED'],
    [429, 'UNEXPECTED'],
  ])('statut %i -> %s', async (status, kind) => {
    mockFetch(status);
    await expect(fetchAdminMe()).rejects.toMatchObject({ kind });
  });

  it('panne reseau -> UNEXPECTED, jamais une exception brute', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as never;
    await expect(fetchAdminMe()).rejects.toMatchObject({ kind: 'UNEXPECTED' });
  });
});

describe('fetchIsPlatformAdmin : ne leve JAMAIS (la connexion ne doit pas echouer a cause de cette question)', () => {
  it('200 -> vrai', async () => {
    mockFetch(200, { data: { isPlatformAdmin: true } });
    await expect(fetchIsPlatformAdmin()).resolves.toBe(true);
  });

  it.each([401, 403, 404, 500])('statut %i -> faux', async (status) => {
    mockFetch(status);
    await expect(fetchIsPlatformAdmin()).resolves.toBe(false);
  });

  it('panne reseau -> faux', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('reseau')) as never;
    await expect(fetchIsPlatformAdmin()).resolves.toBe(false);
  });
});

describe('fetchRegistrationRequests', () => {
  const page = {
    data: [{ id: 'r1' }],
    meta: { nextCursor: 'abc', counts: { pending: 3, validated: 1, refused: 0 } },
  };

  it('envoie le filtre, avec les cookies de session', async () => {
    const fetchMock = mockFetch(200, page);
    await fetchRegistrationRequests({ filter: 'pending' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/admin/registration-requests?filter=pending',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('ajoute recherche, curseur et limite ; la recherche est nettoyee et encodee', async () => {
    const fetchMock = mockFetch(200, page);
    await fetchRegistrationRequests({
      filter: 'refused',
      q: '  Élodie & co  ',
      cursor: 'cur/sor',
      limit: 20,
    });
    const url = new URL(fetchMock.mock.calls[0][0], 'http://x');
    expect(url.searchParams.get('filter')).toBe('refused');
    expect(url.searchParams.get('q')).toBe('Élodie & co');
    expect(url.searchParams.get('cursor')).toBe('cur/sor');
    expect(url.searchParams.get('limit')).toBe('20');
  });

  it('une recherche vide ou blanche n est pas envoyee', async () => {
    const fetchMock = mockFetch(200, page);
    await fetchRegistrationRequests({ filter: 'pending', q: '   ' });
    expect(fetchMock.mock.calls[0][0]).not.toContain('q=');
  });

  it('renvoie les lignes, le curseur suivant et les compteurs', async () => {
    mockFetch(200, page);
    await expect(fetchRegistrationRequests({ filter: 'pending' })).resolves.toEqual({
      items: [{ id: 'r1' }],
      nextCursor: 'abc',
      counts: { pending: 3, validated: 1, refused: 0 },
    });
  });

  it('derniere page : pas de curseur', async () => {
    mockFetch(200, {
      data: [],
      meta: { nextCursor: null, counts: { pending: 0, validated: 0, refused: 0 } },
    });
    expect((await fetchRegistrationRequests({ filter: 'pending' })).nextCursor).toBeNull();
  });
});

describe('detail et note interne', () => {
  it('detail : l identifiant est encode dans le chemin', async () => {
    const fetchMock = mockFetch(200, { data: { id: 'x' } });
    await fetchRegistrationRequestDetail('a/b?c');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/registration-requests/a%2Fb%3Fc');
  });

  it('detail introuvable -> NOT_FOUND', async () => {
    mockFetch(404);
    await expect(fetchRegistrationRequestDetail('x')).rejects.toMatchObject({ kind: 'NOT_FOUND' });
  });

  it('note : PUT avec la seule note, et renvoie la valeur normalisee par le serveur', async () => {
    const fetchMock = mockFetch(200, {
      data: { internalNote: 'propre', updatedAt: '2026-10-19T10:00:00.000Z' },
    });
    const result = await saveInternalNote('r1', '  propre  ');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/admin/registration-requests/r1/internal-note');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ internalNote: '  propre  ' });
    expect(result).toEqual({ internalNote: 'propre', updatedAt: '2026-10-19T10:00:00.000Z' });
  });

  it('note : echec -> exception classee', async () => {
    mockFetch(403);
    await expect(saveInternalNote('r1', 'x')).rejects.toMatchObject({ kind: 'FORBIDDEN' });
  });
});
