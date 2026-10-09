import {
  BrevoEmailSender,
  BREVO_API_URL,
} from '../../src/modules/email/infrastructure/brevo-email-sender.adapter';
import {
  EmailDeliveryError,
  type EmailMessage,
} from '../../src/modules/email/application/email-sender.port';

// EA-013 / TASK-049 : l'adaptateur Brevo, sans reseau (fetch injecte).

const API_KEY = 'cle-de-test-0123456789';

const message: EmailMessage = {
  to: { email: 'medecin@cabinet.ma', name: 'Dr Test' },
  from: { email: 'noreply@portesante.ma', name: 'PorteSanté' },
  subject: 'Objet',
  html: '<p>Bonjour</p>',
  text: 'Bonjour',
};

function fakeFetch(status: number, body: unknown = {}) {
  return jest
    .fn()
    .mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    ) as jest.Mock & typeof fetch;
}

describe('BrevoEmailSender', () => {
  it('traduit le message au format Brevo (URL, en-tetes, corps)', async () => {
    const fetchMock = fakeFetch(201, { messageId: '<abc@brevo>' });
    const sender = new BrevoEmailSender(API_KEY, fetchMock);

    await sender.send(message);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BREVO_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['api-key']).toBe(API_KEY);
    expect(init.headers['content-type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      sender: { email: 'noreply@portesante.ma', name: 'PorteSanté' },
      to: [{ email: 'medecin@cabinet.ma', name: 'Dr Test' }],
      subject: 'Objet',
      htmlContent: '<p>Bonjour</p>',
      textContent: 'Bonjour',
    });
  });

  it('transmet Reply-To quand il est fourni, et seulement alors', async () => {
    const fetchMock = fakeFetch(201, { messageId: 'x' });
    const sender = new BrevoEmailSender(API_KEY, fetchMock);

    await sender.send({ ...message, replyTo: { email: 'verification@portesante.ma' } });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).replyTo).toEqual({
      email: 'verification@portesante.ma',
    });
  });

  it('renvoie l identifiant du message en cas de succes', async () => {
    const sender = new BrevoEmailSender(API_KEY, fakeFetch(201, { messageId: '<abc@brevo>' }));
    await expect(sender.send(message)).resolves.toEqual({ messageId: '<abc@brevo>' });
  });

  it('un refus du fournisseur (400) est un echec NON renvoyable', async () => {
    const sender = new BrevoEmailSender(API_KEY, fakeFetch(400, { code: 'invalid_parameter' }));
    const error = await sender.send(message).catch((e) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error.retryable).toBe(false);
  });

  it.each([429, 500, 503])('un statut %i est un echec renvoyable', async (status) => {
    const sender = new BrevoEmailSender(API_KEY, fakeFetch(status));
    const error = await sender.send(message).catch((e) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error.retryable).toBe(true);
  });

  it('une panne reseau est un echec renvoyable', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as jest.Mock &
      typeof fetch;
    const error = await new BrevoEmailSender(API_KEY, fetchMock).send(message).catch((e) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error.retryable).toBe(true);
  });

  it('le message d erreur ne contient jamais la cle API', async () => {
    const sender = new BrevoEmailSender(API_KEY, fakeFetch(401, { message: 'Key not found' }));
    const error = await sender.send(message).catch((e) => e);
    expect(error.message).not.toContain(API_KEY);
  });

  it('refuse d etre cree sans cle API', () => {
    expect(() => new BrevoEmailSender('')).toThrow(/BREVO_API_KEY/);
    expect(() => new BrevoEmailSender('   ')).toThrow(/BREVO_API_KEY/);
  });
});
