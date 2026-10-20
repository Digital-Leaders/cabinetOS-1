import {
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
import { requestedInfoLabel, type ComplementInfoType } from '../domain/complement-rules';
import { recordEmailEvent, recordResendRequested } from '../infrastructure/registration.queries';
import {
  COMPLEMENT_REQUESTABLE_STATUSES,
  claimComplementResendSlotByRequestId,
  findRequestStatusById,
  insertComplementRequestedEvent,
  lockRequestForComplement,
  markComplementRequested,
} from '../infrastructure/validation.queries';

// BUILD-004 etape 2, EA-018 / TASK-064 : l'action DEMANDER UN COMPLEMENT (brief R7, R6 ; ADR-0022).
//
//   1. UN acte metier atomique, dans UNE transaction : la demande passe a COMPLEMENT_REQUESTED, conserve le
//      message sortant TEL QU'ENVOYE (pour le renvoyer a l'identique), et la trace de l'action est inscrite
//      (date, action, administrateur).
//   2. APRES et SEPAREMENT : l'email au medecin, avec le Reply-To surveille par l'equipe (R7).
//
// Le medecin repond directement a l'email, hors du logiciel : CabinetOS ne conserve ni sa reponse, ni un
// historique des messages (R7). Un echec d'email ne remet JAMAIS l'acte en cause (R6) : il est trace et
// renvoyable. Aucune donnee personnelle dans les journaux.

const OPEN_STATUSES: readonly string[] = COMPLEMENT_REQUESTABLE_STATUSES;

export interface RequestComplementInput {
  infoType: ComplementInfoType;
  otherInfo?: string | null;
  message: string;
}

export interface ComplementOutcome {
  id: string;
  status: 'COMPLEMENT_REQUESTED';
  /** false = l'email n'est pas parti : la demande de complement reste ACQUISE, l'echec est dans l'historique. */
  complementEmail: { sent: boolean };
}

@Injectable()
export class RegistrationComplementService {
  private readonly logger = new Logger(RegistrationComplementService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly emailService: TransactionalEmailService,
  ) {}

  async requestComplement(
    requestId: string,
    adminUserId: string,
    input: RequestComplementInput,
  ): Promise<ComplementOutcome> {
    // Le libelle fait partie de ce qui est envoye ET conserve : calcule une fois, ici.
    const requestedInfo = requestedInfoLabel(input.infoType, input.otherInfo);
    const message = input.message.trim();

    let recipient: { email: string; firstName: string };
    try {
      recipient = await this.databaseService.db.transaction(async (tx) => {
        // Lue et verrouillee EN PREMIER : des actions simultanees sur la meme demande se serialisent.
        const request = await lockRequestForComplement(tx, requestId);
        if (!request) throw new NotFoundException("Demande d'inscription introuvable.");
        if (!OPEN_STATUSES.includes(request.status)) {
          throw new ConflictException(
            "Cette demande n'est plus en attente : elle a deja ete traitee. Actualisez la liste.",
          );
        }
        if (!(await markComplementRequested(tx, requestId, requestedInfo, message))) {
          throw new ConflictException(
            "Cette demande n'est plus en attente : elle a deja ete traitee. Actualisez la liste.",
          );
        }
        await insertComplementRequestedEvent(tx, requestId, adminUserId);
        return { email: request.email, firstName: request.firstName };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Toute autre panne : la transaction est annulee, RIEN n'a ete modifie. Dit clairement, sans detail
      // technique (il peut contenir des valeurs de la requete).
      this.logger.error(`Demande de complement ${requestId} annulee : aucune ecriture conservee.`);
      throw new InternalServerErrorException(
        "La demande de complement n'a pas pu etre enregistree : rien n'a ete modifie. Reessayez dans quelques instants.",
      );
    }

    // ---- L'email, APRES l'acte, comme operation distincte (R6). ----
    const sent = await this.deliverComplementEmail(
      requestId,
      recipient.email,
      recipient.firstName,
      requestedInfo,
      message,
    );
    return { id: requestId, status: 'COMPLEMENT_REQUESTED', complementEmail: { sent } };
  }

  /**
   * Renvoi du complement par l'administrateur : ce que le medecin a deja recu, A L'IDENTIQUE (le message
   * est relu tel qu'envoye, ADR-0022), sous la garde anti-abus de 60 s.
   */
  async resendComplementEmail(requestId: string, adminUserId: string): Promise<{ sent: boolean }> {
    const slot = await claimComplementResendSlotByRequestId(
      this.databaseService.db,
      requestId,
      RESEND_EMAIL_WINDOW_SECONDS,
    );
    if (!slot) {
      const status = await findRequestStatusById(this.databaseService.db, requestId);
      if (status === null) throw new NotFoundException("Demande d'inscription introuvable.");
      if (status !== 'COMPLEMENT_REQUESTED') {
        throw new ConflictException(
          "Aucun complement a renvoyer : cette demande n'est pas en attente de complement.",
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
      'verification-complement',
      adminUserId,
    );
    const sent = await this.deliverComplementEmail(
      slot.requestId,
      slot.email,
      slot.firstName,
      slot.requestedInfo,
      slot.message,
    );
    return { sent };
  }

  /**
   * Envoie l'email et en inscrit le resultat dans l'historique. NE LEVE JAMAIS : meme une exception
   * inattendue pendant l'envoi est un echec trace et renvoyable (R6).
   */
  private async deliverComplementEmail(
    requestId: string,
    email: string,
    firstName: string,
    requestedInfo: string,
    message: string,
  ): Promise<boolean> {
    let result: { ok: true } | { ok: false; retryable: boolean };
    try {
      result = await this.emailService.sendTemplate(
        'verification-complement',
        { email },
        { firstName, requestedInfo, message },
      );
    } catch {
      result = { ok: false, retryable: false };
    }
    try {
      await recordEmailEvent(this.databaseService.db, requestId, 'verification-complement', result);
    } catch {
      // L'acte est acquis quoi qu'il arrive : seule la trace manque.
      this.logger.error(
        `Historique non inscrit pour l'email de complement de la demande ${requestId}.`,
      );
    }
    return result.ok;
  }
}
