import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../../modules/shared';
import { TransactionalEmailService } from '../../../modules/email';
import { RESEND_EMAIL_WINDOW_SECONDS } from '../domain/registration-rules';
import { refusalFieldsAreDistinct } from '../domain/refusal-rules';
import { recordEmailEvent, recordResendRequested } from '../infrastructure/registration.queries';
import {
  VALIDATABLE_STATUSES,
  claimRefusalResendSlot,
  findRequestStatusById,
  insertRefusedEvent,
  lockRequestForAction,
  markRequestRefused,
} from '../infrastructure/validation.queries';

// BUILD-004 etape 2, EA-018 / TASK-065 : l'action REFUSER (brief R8, R6 ; ADR-0021 P2).
//
//   1. UN acte metier atomique, dans UNE transaction : la demande passe a REFUSED avec ses DEUX champs
//      strictement separes (motif INTERNE + message AU DEMANDEUR), et la trace de l'action est inscrite
//      (date, action, administrateur).
//   2. APRES et SEPAREMENT : l'email de refus, qui ne porte QUE le message au demandeur.
//
// R8 -- « impossible par conception d'envoyer le motif interne au medecin » : le motif interne n'est le
// parametre d'AUCUN modele d'email, et les methodes qui envoient (deliverRefusalEmail, resendRefusalEmail)
// ne le RECOIVENT PAS : il n'existe aucun chemin de code par lequel il pourrait y arriver. Un test echoue
// si ces methodes y font un jour reference.
//
// Le refus est DEFINITIF en V1 (ADR-0021 P2) : pas de reinscription, le compte reste bloque. Aucune donnee
// personnelle ni aucun texte saisi dans les journaux.

const OPEN_STATUSES: readonly string[] = VALIDATABLE_STATUSES;

export interface RefusalOutcome {
  id: string;
  status: 'REFUSED';
  /** false = l'email n'est pas parti : le refus reste ACQUIS, l'echec est dans l'historique. */
  refusalEmail: { sent: boolean };
}

@Injectable()
export class RegistrationRefusalService {
  private readonly logger = new Logger(RegistrationRefusalService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly emailService: TransactionalEmailService,
  ) {}

  async refuse(
    requestId: string,
    adminUserId: string,
    internalReason: string,
    messageToApplicant: string,
  ): Promise<RefusalOutcome> {
    const reason = internalReason.trim();
    const message = messageToApplicant.trim();
    if (!refusalFieldsAreDistinct(reason, message)) {
      throw new BadRequestException(
        'Le message au demandeur ne peut pas etre identique au motif interne : le motif interne ne doit jamais etre communique.',
      );
    }

    let recipient: { email: string; firstName: string };
    try {
      recipient = await this.databaseService.db.transaction(async (tx) => {
        // Lue et verrouillee EN PREMIER : des actions simultanees sur la meme demande se serialisent.
        const request = await lockRequestForAction(tx, requestId);
        if (!request) throw new NotFoundException("Demande d'inscription introuvable.");
        if (!OPEN_STATUSES.includes(request.status)) {
          throw new ConflictException(
            "Cette demande n'est plus en attente : elle a deja ete traitee. Actualisez la liste.",
          );
        }
        if (!(await markRequestRefused(tx, requestId, reason, message))) {
          throw new ConflictException(
            "Cette demande n'est plus en attente : elle a deja ete traitee. Actualisez la liste.",
          );
        }
        await insertRefusedEvent(tx, requestId, adminUserId);
        return { email: request.email, firstName: request.firstName };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Panne : la transaction est annulee, RIEN n'a ete modifie. Le message d'erreur est GENERIQUE et le
      // journal ne contient NI le motif NI le message (ce sont des textes saisis, potentiellement sensibles).
      this.logger.error(`Refus de la demande ${requestId} annule : aucune ecriture conservee.`);
      throw new InternalServerErrorException(
        "Le refus n'a pas pu etre enregistre : rien n'a ete modifie. Reessayez dans quelques instants.",
      );
    }

    // ---- L'email, APRES l'acte, comme operation distincte (R6). Le motif interne n'est PAS transmis. ----
    const sent = await this.deliverRefusalEmail(
      requestId,
      recipient.email,
      recipient.firstName,
      message,
    );
    return { id: requestId, status: 'REFUSED', refusalEmail: { sent } };
  }

  /**
   * Renvoi de l'email de refus par l'administrateur (le demandeur n'a aucun ecran pour le redemander). Relit
   * le message AU DEMANDEUR tel que conserve ; sous la garde anti-abus de 60 s.
   */
  async resendRefusalEmail(requestId: string, adminUserId: string): Promise<{ sent: boolean }> {
    const slot = await claimRefusalResendSlot(
      this.databaseService.db,
      requestId,
      RESEND_EMAIL_WINDOW_SECONDS,
    );
    if (!slot) {
      const status = await findRequestStatusById(this.databaseService.db, requestId);
      if (status === null) throw new NotFoundException("Demande d'inscription introuvable.");
      if (status !== 'REFUSED') {
        throw new ConflictException(
          "Aucun email de refus a renvoyer : cette demande n'est pas refusee.",
        );
      }
      throw new HttpException(
        "Un email vient d'etre renvoye. Patientez avant un nouvel envoi.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await recordResendRequested(
      this.databaseService.db,
      slot.requestId,
      'registration-refusal',
      adminUserId,
    );
    const sent = await this.deliverRefusalEmail(
      slot.requestId,
      slot.email,
      slot.firstName,
      slot.messageToApplicant,
    );
    return { sent };
  }

  /**
   * Envoie l'email de refus et en inscrit le resultat dans l'historique. NE LEVE JAMAIS (R6). Ne recoit QUE
   * le message au demandeur : le motif interne n'est pas dans sa portee.
   */
  private async deliverRefusalEmail(
    requestId: string,
    email: string,
    firstName: string,
    messageToApplicant: string,
  ): Promise<boolean> {
    let result: { ok: true } | { ok: false; retryable: boolean };
    try {
      result = await this.emailService.sendTemplate(
        'registration-refusal',
        { email },
        { firstName, messageToApplicant },
      );
    } catch {
      result = { ok: false, retryable: false };
    }
    try {
      await recordEmailEvent(this.databaseService.db, requestId, 'registration-refusal', result);
    } catch {
      this.logger.error(`Historique non inscrit pour l'email de refus de la demande ${requestId}.`);
    }
    return result.ok;
  }
}
