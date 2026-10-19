import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../../modules/shared';
import { TransactionalEmailService } from '../../../modules/email';
import { RESEND_EMAIL_WINDOW_SECONDS, maskEmail } from '../domain/registration-rules';
import {
  claimComplementResendSlot,
  findFounderRegistrationView,
  recordEmailEvent,
  recordResendRequested,
} from '../infrastructure/registration.queries';

// TASK-054 (BUILD-004 etape 2, EA-015) : ce que le fondateur connecte peut savoir et faire
// sur SA demande (ADR-0021 D4, ADR-0022). L'identite vient toujours de la session verifiee.

export interface RegistrationStatusView {
  /** null : compte sans demande (compte d'equipe) -- il entre normalement (ADR-0021 D1). */
  status: string | null;
  maskedEmail?: string;
  /** Uniquement pour REFUSED : le message destine au demandeur, jamais le motif interne. */
  refusalMessage?: string;
  /** Uniquement pour COMPLEMENT_REQUESTED : a partir de quand un renvoi est accepte. */
  nextResendAllowedAt?: string | null;
}

export interface ResendOutcome {
  sent: boolean;
  nextResendAllowedAt: string;
}

@Injectable()
export class RegistrationStatusService {
  private readonly logger = new Logger(RegistrationStatusService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly emailService: TransactionalEmailService,
  ) {}

  async getStatus(userId: string): Promise<RegistrationStatusView> {
    const view = await findFounderRegistrationView(this.databaseService.db, userId);
    if (!view) return { status: null };

    const result: RegistrationStatusView = {
      status: view.status,
      maskedEmail: maskEmail(view.email),
    };
    if (view.status === 'REFUSED' && view.refusalMessageToApplicant) {
      result.refusalMessage = view.refusalMessageToApplicant;
    }
    if (view.status === 'COMPLEMENT_REQUESTED') {
      result.nextResendAllowedAt = view.lastEmailResentAt
        ? nextAllowed(view.lastEmailResentAt).toISOString()
        : null;
    }
    return result;
  }

  /**
   * Renvoie a l'identique le dernier message de complement (ADR-0022), sous la garde
   * anti-abus de 60 s. Le message est relu tel qu'envoye, jamais reconstruit. Un echec
   * d'envoi est trace et renvoyable (R6) ; il ne leve pas.
   */
  async resendComplementEmail(userId: string): Promise<ResendOutcome> {
    const slot = await claimComplementResendSlot(
      this.databaseService.db,
      userId,
      RESEND_EMAIL_WINDOW_SECONDS,
    );
    if (!slot) {
      throw await this.explainRefusedResend(userId);
    }

    await recordResendRequested(this.databaseService.db, slot.requestId, 'verification-complement');
    const result = await this.emailService.sendTemplate(
      'verification-complement',
      { email: slot.email },
      { firstName: slot.firstName, requestedInfo: slot.requestedInfo, message: slot.message },
    );
    try {
      await recordEmailEvent(
        this.databaseService.db,
        slot.requestId,
        'verification-complement',
        result,
      );
    } catch {
      this.logger.error(`Historique non inscrit pour le renvoi de la demande ${slot.requestId}.`);
    }

    return { sent: result.ok, nextResendAllowedAt: nextAllowed(slot.resentAt).toISOString() };
  }

  private async explainRefusedResend(userId: string): Promise<HttpException> {
    const view = await findFounderRegistrationView(this.databaseService.db, userId);
    if (!view) {
      return new NotFoundException('Aucune demande d inscription pour ce compte.');
    }
    if (view.status !== 'COMPLEMENT_REQUESTED') {
      return new ConflictException('Aucun email a renvoyer pour cette demande.');
    }
    return new HttpException(
      'Un email vient d etre renvoye. Patientez avant un nouvel envoi.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function nextAllowed(lastResentAt: Date): Date {
  return new Date(new Date(lastResentAt).getTime() + RESEND_EMAIL_WINDOW_SECONDS * 1000);
}
