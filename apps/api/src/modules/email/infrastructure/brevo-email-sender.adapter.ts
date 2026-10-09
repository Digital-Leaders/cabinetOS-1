import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailSender,
  type EmailSendReceipt,
} from '../application/email-sender.port';

// EA-013 / TASK-049 (ADR-0020) : adaptateur Brevo, API transactionnelle (HTTP).
// Pas de SDK : un appel `fetch` suffit et n'ajoute aucune dependance. La cle API
// est fournie par l'appelant (lue dans l'environnement par le module), jamais
// ecrite ici et jamais incluse dans un message d'erreur.

export const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const MAX_ERROR_DETAIL = 300;

export class BrevoEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('BREVO_API_KEY absente : impossible de creer l adaptateur Brevo.');
    }
  }

  async send(message: EmailMessage): Promise<EmailSendReceipt> {
    const payload = {
      sender: message.from,
      to: [message.to],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new EmailDeliveryError('Brevo injoignable (reseau ou delai depasse).', true, error);
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, MAX_ERROR_DETAIL);
      const retryable = response.status === 429 || response.status >= 500;
      throw new EmailDeliveryError(
        `Brevo a refuse l envoi (HTTP ${response.status})${detail ? ` : ${detail}` : ''}`,
        retryable,
      );
    }

    const body = (await response.json().catch(() => ({}))) as { messageId?: unknown };
    return { messageId: String(body.messageId ?? '') };
  }
}
