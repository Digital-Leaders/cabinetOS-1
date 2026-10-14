import { submitRegistration, RegistrationError } from './registration-client';

// TASK-053 : chaque reponse du serveur (TASK-052) est classee par statut, jamais par son
// texte (le serveur repond en francais seulement ; l'ecran traduit lui-meme).

const payload = {
  firstName: 'Youssef',
  lastName: 'Bennani',
  email: 'y@cabinet.ma',
  password: 'password1234',
  specialty: 'generaliste',
  structureName: 'Cabinet',
  city: 'Rabat',
};

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('submitRegistration (TASK-053)', () => {
  it('envoie la demande a /api/v1/registration-requests, cookies inclus', async () => {
    mockFetch(201, { data: { id: 'r1', status: 'PENDING_VERIFICATION' }, meta: {} });
    await expect(submitRegistration(payload)).resolves.toEqual({
      id: 'r1',
      status: 'PENDING_VERIFICATION',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/registration-requests',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it.each([
    [409, 'EMAIL_ALREADY_USED'],
    [400, 'INVALID'],
    [500, 'UNEXPECTED'],
    [403, 'UNEXPECTED'],
  ])('statut %i -> %s', async (status, kind) => {
    mockFetch(status, { error: { status, message: 'texte serveur' } });
    await expect(submitRegistration(payload)).rejects.toEqual(new RegistrationError(kind as never));
  });

  it('panne reseau -> UNEXPECTED, jamais une exception brute', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as never;
    await expect(submitRegistration(payload)).rejects.toMatchObject({ kind: 'UNEXPECTED' });
  });
});
