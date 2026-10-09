import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailSender,
  type EmailSendReceipt,
} from '../application/email-sender.port';

// EA-013 / TASK-049 (ADR-0020) : adaptateur en memoire. Utilise par les tests et
// par defaut hors production : rien ne part reellement, les messages sont
// captures (destinataire, objet, contenu complet) pour etre inspectes -- c'est ce
// qui rend testables la separation du refus (T3) et le decouplage (T2).

export interface SentEmail extends EmailMessage {
  messageId: string;
}

export class InMemoryEmailSender implements EmailSender {
  private readonly sent: SentEmail[] = [];
  private counter = 0;
  private pendingFailures = 0;
  private alwaysFail = false;
  private failureError: EmailDeliveryError = new EmailDeliveryError('Echec d envoi simule.', true);

  async send(message: EmailMessage): Promise<EmailSendReceipt> {
    if (this.alwaysFail || this.pendingFailures > 0) {
      if (this.pendingFailures > 0) this.pendingFailures -= 1;
      throw this.failureError;
    }
    this.counter += 1;
    const messageId = `memory-${this.counter}`;
    this.sent.push({ ...message, messageId });
    return { messageId };
  }

  /** Messages "envoyes" jusqu'ici, dans l'ordre. */
  get outbox(): readonly SentEmail[] {
    return this.sent;
  }

  /** Les `count` prochains envois echouent, puis le comportement normal reprend. */
  failNext(count = 1, error?: EmailDeliveryError): void {
    this.pendingFailures = count;
    if (error) this.failureError = error;
  }

  /** Tous les envois echouent jusqu'a `restore()`. */
  failAll(error?: EmailDeliveryError): void {
    this.alwaysFail = true;
    if (error) this.failureError = error;
  }

  restore(): void {
    this.alwaysFail = false;
    this.pendingFailures = 0;
  }

  reset(): void {
    this.sent.length = 0;
    this.counter = 0;
    this.restore();
  }
}
