// EA-013 / TASK-048 (ADR-0020) : port d'envoi d'email transactionnel.
// Interface du socle, independante du fournisseur : aucun module ne depend de
// Brevo directement, seul l'adaptateur (infrastructure/) le connait. Meme schema
// que AuthProvider (ADR-007) : remplacer le fournisseur ne touche aucun appelant.

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  to: EmailAddress;
  from: EmailAddress;
  replyTo?: EmailAddress;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendReceipt {
  messageId: string;
}

/**
 * Echec d'envoi remontable (R6). `retryable` indique si un renvoi a une chance
 * d'aboutir (panne reseau, limite de debit, erreur serveur) ou non (adresse ou
 * requete refusee par le fournisseur). Ne contient jamais de secret.
 */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly reason?: unknown,
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

export interface EmailSender {
  /** Envoie un message. Leve EmailDeliveryError en cas d'echec. */
  send(message: EmailMessage): Promise<EmailSendReceipt>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
