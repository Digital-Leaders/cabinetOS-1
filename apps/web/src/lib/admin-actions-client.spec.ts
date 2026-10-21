import {
  AdminActionError,
  refuseRegistrationRequest,
  requestComplement,
  resendRegistrationEmail,
  validateRegistrationRequest,
} from './admin-client';

// BUILD-004 etape 2, EA-018 / TASK-066 : client des trois actions et du renvoi d'email. Verifie la FORME de chaque
// requete et le classement de chaque reponse -- en particulier la distinction SERVER (rien n'a ete modifie, on peut
// reessayer) / UNCERTAIN (aucune reponse : l'action a peut-etre reussi, on ne reessaie pas a l'aveugle).

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];

function mockFetch(status: number, body: unknown = {}) {
  calls = [];
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }) as unknown as typeof fetch;
}
const sentBody = () => JSON.parse(calls[0].init.body as string);

describe('validateRegistrationRequest', () => {
  it('POST sur /validate, cookies inclus, sans corps ; lit l organisation et le sort de l email', async () => {
    mockFetch(200, { data: { organizationId: 'org-1', activationEmail: { sent: true } } });
    await expect(validateRegistrationRequest('r 1')).resolves.toEqual({
      organizationId: 'org-1',
      emailSent: true,
    });
    expect(calls[0].url).toBe('/api/v1/admin/registration-requests/r%201/validate');
    expect(calls[0].init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(calls[0].init.body).toBeUndefined();
  });

  it('email non parti : emailSent est FAUX, la validation reste reussie (pas d exception)', async () => {
    mockFetch(200, { data: { organizationId: 'org-1', activationEmail: { sent: false } } });
    await expect(validateRegistrationRequest('r1')).resolves.toMatchObject({ emailSent: false });
  });

  it('reponse 2xx illisible : l action a reussi, on ne declare pas un echec', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('illisible');
      },
    })) as unknown as typeof fetch;
    await expect(validateRegistrationRequest('r1')).resolves.toEqual({
      organizationId: '',
      emailSent: false,
    });
  });
});

describe('requestComplement', () => {
  it('type predefini : envoie le type et le message, JAMAIS de precision', async () => {
    mockFetch(200, { data: { complementEmail: { sent: true } } });
    await requestComplement('r1', {
      infoType: 'google_listing',
      otherInfo: 'ignore',
      message: 'Bonjour',
    });
    expect(calls[0].url).toContain('/r1/request-complement');
    expect(sentBody()).toEqual({ infoType: 'google_listing', message: 'Bonjour' });
  });

  it('« autre » : envoie la precision', async () => {
    mockFetch(200, { data: { complementEmail: { sent: true } } });
    await requestComplement('r1', {
      infoType: 'other',
      otherInfo: 'une copie',
      message: 'Bonjour',
    });
    expect(sentBody()).toEqual({ infoType: 'other', otherInfo: 'une copie', message: 'Bonjour' });
  });

  it('lit le sort de l email', async () => {
    mockFetch(200, { data: { complementEmail: { sent: false } } });
    await expect(
      requestComplement('r1', { infoType: 'google_listing', message: 'm' }),
    ).resolves.toEqual({ emailSent: false });
  });
});

describe('refuseRegistrationRequest', () => {
  it('envoie les DEUX champs et la CONFIRMATION (confirmed: true) -- exigee par le serveur', async () => {
    mockFetch(200, { data: { refusalEmail: { sent: true } } });
    await refuseRegistrationRequest('r1', {
      internalReason: 'motif',
      messageToApplicant: 'message',
    });
    expect(calls[0].url).toContain('/r1/refuse');
    expect(sentBody()).toEqual({
      internalReason: 'motif',
      messageToApplicant: 'message',
      confirmed: true,
    });
  });

  it('les deux champs restent distincts dans la requete : le motif n est jamais fusionne au message', async () => {
    mockFetch(200, { data: { refusalEmail: { sent: true } } });
    await refuseRegistrationRequest('r1', {
      internalReason: 'MOTIF-SECRET',
      messageToApplicant: 'Message public',
    });
    const body = sentBody();
    expect(body.messageToApplicant).toBe('Message public');
    expect(body.messageToApplicant).not.toContain('MOTIF-SECRET');
  });
});

describe('resendRegistrationEmail', () => {
  it.each([
    ['activation', 'resend-activation-email'],
    ['complement', 'resend-complement-email'],
    ['refusal', 'resend-refusal-email'],
  ] as const)('%s -> POST …/%s', async (kind, route) => {
    mockFetch(200, { data: { sent: true } });
    await expect(resendRegistrationEmail('r1', kind)).resolves.toEqual({ sent: true });
    expect(calls[0].url).toBe(`/api/v1/admin/registration-requests/r1/${route}`);
  });

  it('sent: false est un resultat, pas une exception', async () => {
    mockFetch(200, { data: { sent: false } });
    await expect(resendRegistrationEmail('r1', 'activation')).resolves.toEqual({ sent: false });
  });
});

describe('classement des erreurs (communes aux quatre appels)', () => {
  const calls4 = [
    () => validateRegistrationRequest('r1'),
    () => requestComplement('r1', { infoType: 'google_listing', message: 'm' }),
    () => refuseRegistrationRequest('r1', { internalReason: 'a', messageToApplicant: 'b' }),
    () => resendRegistrationEmail('r1', 'activation'),
  ];

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [400, 'INVALID'],
    [429, 'TOO_SOON'],
    [500, 'SERVER'],
    [502, 'SERVER'],
    [418, 'SERVER'],
  ])('statut %i -> %s, pour les quatre appels', async (status, kind) => {
    for (const call of calls4) {
      mockFetch(status, { error: {} });
      await expect(call()).rejects.toEqual(new AdminActionError(kind as never));
    }
  });

  it('AUCUNE reponse (reseau coupe) -> UNCERTAIN : le resultat est inconnu, ce n est PAS une erreur serveur', async () => {
    for (const call of calls4) {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as never;
      const error = await call().catch((e) => e);
      expect(error).toBeInstanceOf(AdminActionError);
      expect(error.kind).toBe('UNCERTAIN');
      expect(error.kind).not.toBe('SERVER');
    }
  });
});
