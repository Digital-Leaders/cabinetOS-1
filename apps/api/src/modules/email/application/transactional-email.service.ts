import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EMAIL_SENDER,
  EmailDeliveryError,
  type EmailAddress,
  type EmailMessage,
  type EmailSender,
} from './email-sender.port';
import { renderEmail, type EmailTemplateId, type TemplateParams } from './email-templates';

// EA-013 / TASK-049-050 (ADR-0020) : point d'envoi central et reutilisable.
// Reset de mot de passe et invitations (etape 3) passeront par ici.
//
// Decouplage (R6) : sendTemplate NE LEVE JAMAIS pour un echec d'envoi. Il renvoie
// un resultat que l'appelant inscrit dans l'historique ; l'acte metier deja
// enregistre n'est jamais annule. L'appelant reste libre de renvoyer plus tard.

export const EMAIL_OPTIONS = Symbol('EMAIL_OPTIONS');

export interface EmailOptions {
  from: EmailAddress;
  /** Adresse Reply-To surveillee par l'equipe (R7). */
  supportReplyTo: EmailAddress;
}

export type EmailSendResult =
  { ok: true; messageId: string } | { ok: false; retryable: boolean; reason: string };

// Seule la demande de complement attend une reponse du medecin (R7).
const TEMPLATES_WITH_REPLY_TO: ReadonlySet<EmailTemplateId> = new Set(['verification-complement']);

@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);

  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    @Inject(EMAIL_OPTIONS) private readonly options: EmailOptions,
  ) {}

  async sendTemplate<T extends EmailTemplateId>(
    templateId: T,
    to: EmailAddress,
    params: TemplateParams[T],
  ): Promise<EmailSendResult> {
    try {
      const rendered = renderEmail(templateId, params);
      const message: EmailMessage = {
        to,
        from: this.options.from,
        ...(TEMPLATES_WITH_REPLY_TO.has(templateId)
          ? { replyTo: this.options.supportReplyTo }
          : {}),
        ...rendered,
      };
      const receipt = await this.sender.send(message);
      return { ok: true, messageId: receipt.messageId };
    } catch (error) {
      const retryable = error instanceof EmailDeliveryError ? error.retryable : false;
      const reason = error instanceof Error ? error.message : 'Erreur inconnue';
      // Ni destinataire ni contenu dans les journaux (donnees personnelles).
      this.logger.warn(`Echec d'envoi (${templateId}) : ${reason}`);
      return { ok: false, retryable, reason };
    }
  }
}
