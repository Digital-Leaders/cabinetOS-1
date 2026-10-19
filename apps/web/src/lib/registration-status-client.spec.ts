import { fetchRegistrationStatus, resendComplementEmail } from './registration-status-client';

// TASK-055 : chaque reponse des routes de TASK-054 est traduite en un resultat explicite,
// jamais en exception brute pour l'ecran.

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('fetchRegistrationStatus (TASK-055)', () => {
  it('lit le statut avec les cookies de session', async () => {
    mockFetch(200, { data: { status: 'PENDING_VERIFICATION', maskedEmail: 'y•••••@c.ma' } });
    await expect(fetchRegistrationStatus()).resolves.toEqual({
      status: 'PENDING_VERIFICATION',
      maskedEmail: 'y•••••@c.ma',
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/identity/registration-status', {
      credentials: 'include',
    });
  });

  it('erreur HTTP -> exception portant le statut', async () => {
    mockFetch(401, { error: { status: 401 } });
    await expect(fetchRegistrationStatus()).rejects.toMatchObject({ status: 401 });
  });
});

describe('resendComplementEmail (TASK-055)', () => {
  const at = '2026-10-19T10:01:00.000Z';

  it.each([
    [
      200,
      { data: { sent: true, nextResendAllowedAt: at } },
      { kind: 'SENT', nextResendAllowedAt: at },
    ],
    [
      200,
      { data: { sent: false, nextResendAllowedAt: at } },
      { kind: 'SEND_FAILED', nextResendAllowedAt: at },
    ],
    [429, { error: {} }, { kind: 'TOO_SOON' }],
    [409, { error: {} }, { kind: 'STATUS_CHANGED' }],
    [404, { error: {} }, { kind: 'STATUS_CHANGED' }],
    [500, { error: {} }, { kind: 'UNEXPECTED' }],
  ])('statut %i', async (status, body, expected) => {
    mockFetch(status, body);
    await expect(resendComplementEmail()).resolves.toEqual(expected);
  });

  it('panne reseau -> UNEXPECTED', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as never;
    await expect(resendComplementEmail()).resolves.toEqual({ kind: 'UNEXPECTED' });
  });
});
