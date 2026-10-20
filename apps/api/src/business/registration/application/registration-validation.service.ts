import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { uuidv7 } from 'uuidv7';
import { DatabaseService } from '../../../modules/shared';
import { TransactionalEmailService } from '../../../modules/email';
import { createMembershipInTx, createOrganizationInTx } from '../../../modules/organization';
import { findRoleByName } from '../../../modules/access-control';
import { createMedecinInTx } from '../../medecin';
import { FOUNDER_ROLE_NAME, RESEND_EMAIL_WINDOW_SECONDS } from '../domain/registration-rules';
import {
  assertFounderRole,
  buildLoginUrl,
  slugCandidate,
  slugify,
  toMedecinSpecialty,
} from '../domain/validation-rules';
import { findPgCode, findPgConstraint } from '../infrastructure/pg-errors';
import { recordEmailEvent, recordResendRequested } from '../infrastructure/registration.queries';
import {
  VALIDATABLE_STATUSES,
  claimActivationResendSlot,
  findRequestStatusById,
  insertValidatedEvent,
  lockRequestForValidation,
  markRequestActive,
  slugIsTaken,
} from '../infrastructure/validation.queries';

// BUILD-004 etape 2, EA-018 / TASK-063 : l'action VALIDER (brief R4, R5, R6 ; ADR-0021 D5, ADR-0023).
//
//   Operations 1 a 4 -- UN SEUL ACTE METIER ATOMIQUE, dans UNE transaction :
//     organisation -> adhesion du fondateur (role « fondateur ») -> fiche medecin -> demande ACTIVE
//   Operation 5 -- APRES et SEPAREE : l'email d'activation (R6).
//
// Tout ou rien : si une etape echoue, aucune ne subsiste (organisation, adhesion, cache d'appartenance,
// fiche medecin, statut, historique). La validation NE DOIT JAMAIS echouer parce que l'email n'est pas
// parti : un echec d'envoi est trace et renvoyable, jamais un rollback.
//
// Aucune donnee personnelle dans les journaux (ni email, ni nom).

const MAX_SLUG_RETRIES = 3;
const MAX_SLUG_ATTEMPTS = 50;
const OPEN_STATUSES: readonly string[] = VALIDATABLE_STATUSES;

export interface ValidationOutcome {
  id: string;
  status: 'ACTIVE';
  organizationId: string;
  /** false = l'email n'est pas parti : la validation reste ACQUISE, l'echec est dans l'historique. */
  activationEmail: { sent: boolean };
}

@Injectable()
export class RegistrationValidationService {
  private readonly logger = new Logger(RegistrationValidationService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly emailService: TransactionalEmailService,
    private readonly configService: ConfigService,
  ) {}

  async validate(requestId: string, adminUserId: string): Promise<ValidationOutcome> {
    // Role cree par la migration 0025. S'il manque, c'est une erreur de deploiement : on s'arrete
    // AVANT d'ouvrir la moindre transaction.
    const founderRole = assertFounderRole(
      await findRoleByName(this.databaseService, FOUNDER_ROLE_NAME),
    );

    let organizationId = '';
    let recipient: { email: string; firstName: string };
    for (let attempt = 1; ; attempt += 1) {
      // L'identifiant de l'organisation est genere en amont : la transaction est scopee sur elle AVANT
      // qu'elle n'existe (la RLS de memberships et medecins l'exige).
      organizationId = uuidv7();
      try {
        recipient = await this.databaseService.withOrganizationScope(organizationId, (tx) =>
          this.cascade(tx, requestId, adminUserId, organizationId, founderRole.id),
        );
        break;
      } catch (error) {
        // Deux validations simultanees de DEUX demandes de meme nom peuvent choisir le meme nom court :
        // la contrainte d'unicite refuse la seconde, dont toute la transaction est annulee. On recommence
        // la cascade complete avec un nouveau choix.
        if (isSlugConflict(error) && attempt < MAX_SLUG_RETRIES) continue;
        if (error instanceof HttpException) throw error;
        // Tout autre echec : la transaction est annulee, RIEN n'a ete cree. On le dit clairement, sans
        // exposer le detail technique (il peut contenir des valeurs de la requete).
        this.logger.error(
          `Validation de la demande ${requestId} annulee : aucune ecriture conservee.`,
        );
        throw new InternalServerErrorException(
          "La validation n'a pas pu etre enregistree : rien n'a ete cree. Reessayez dans quelques instants.",
        );
      }
    }

    // ---- Operation 5 : l'email d'activation, APRES la validation, comme operation distincte (R6). ----
    const sent = await this.deliverActivationEmail(requestId, recipient.email, recipient.firstName);

    return { id: requestId, status: 'ACTIVE', organizationId, activationEmail: { sent } };
  }

  /** Les operations 1 a 4, dans la transaction fournie. */
  private async cascade(
    tx: Parameters<Parameters<DatabaseService['withOrganizationScope']>[1]>[0],
    requestId: string,
    adminUserId: string,
    organizationId: string,
    founderRoleId: string,
  ): Promise<{ email: string; firstName: string }> {
    // La demande est lue et verrouillee EN PREMIER : deux validations simultanees se serialisent ici.
    const request = await lockRequestForValidation(tx, requestId);
    if (!request) throw new NotFoundException("Demande d'inscription introuvable.");
    if (!OPEN_STATUSES.includes(request.status)) {
      throw new ConflictException(
        "Cette demande n'est plus en attente : elle a deja ete traitee. Actualisez la liste.",
      );
    }

    // Verifie AVANT d'ecrire quoi que ce soit : une specialite inconnue n'est jamais ecrite.
    const specialty = toMedecinSpecialty(request.specialty);

    // Operation 2 : l'organisation (nom, ville, adresse repris de la demande : R5, aucune ressaisie).
    const slug = await pickFreeSlug(tx, request.structureName);
    await createOrganizationInTx(tx, {
      id: organizationId,
      name: request.structureName,
      slug,
      city: request.city,
      address: request.address,
    });

    // Operation 3 : le fondateur devient le premier membre, avec le role « fondateur ».
    await createMembershipInTx(tx, organizationId, {
      userId: request.userId,
      roleId: founderRoleId,
    });

    // Operation 4 : sa fiche medecin, par la fonction du module Medecin (R4 : pas de chemin parallele),
    // liee a son compte. R5 : nom, prenom, specialite, INPE, numero d'Ordre.
    await createMedecinInTx(tx, organizationId, {
      firstName: request.firstName,
      lastName: request.lastName,
      userId: request.userId,
      ...(specialty ? { specialty } : {}),
      ...(request.inpe ? { inpe: request.inpe } : {}),
      ...(request.numeroOrdre ? { numeroOrdre: request.numeroOrdre } : {}),
    });

    // Operation 1 : la demande devient ACTIVE. Apres la creation de l'organisation (cle etrangere).
    if (!(await markRequestActive(tx, requestId, organizationId))) {
      // Ne devrait pas arriver (la demande est verrouillee) : par prudence, on annule tout.
      throw new ConflictException(
        "Cette demande n'est plus en attente : elle a deja ete traitee. Actualisez la liste.",
      );
    }
    await insertValidatedEvent(tx, requestId, adminUserId);

    // Le destinataire de l'email (operation 5), deja lu ici : pas de seconde lecture apres coup.
    return { email: request.email, firstName: request.firstName };
  }

  /**
   * Renvoi de l'email d'activation par l'administrateur (R6). Seulement pour une demande ACTIVE, et sous
   * la garde anti-abus de 60 s (reservation atomique du creneau).
   */
  async resendActivationEmail(requestId: string, adminUserId: string): Promise<{ sent: boolean }> {
    const slot = await claimActivationResendSlot(
      this.databaseService.db,
      requestId,
      RESEND_EMAIL_WINDOW_SECONDS,
    );
    if (!slot) {
      const status = await findRequestStatusById(this.databaseService.db, requestId);
      if (status === null) throw new NotFoundException("Demande d'inscription introuvable.");
      if (status !== 'ACTIVE') {
        throw new ConflictException(
          "Aucun email d'activation a renvoyer : cette demande n'est pas validee.",
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
      'account-activation',
      adminUserId,
    );
    const sent = await this.deliverActivationEmail(slot.requestId, slot.email, slot.firstName);
    return { sent };
  }

  // ---------------------------------------------------------------------------------------

  /**
   * Envoie l'email d'activation et en inscrit le resultat dans l'historique. NE LEVE JAMAIS : meme une
   * exception inattendue pendant l'envoi est traitee comme un echec trace et renvoyable (R6).
   */
  private async deliverActivationEmail(
    requestId: string,
    email: string,
    firstName: string,
  ): Promise<boolean> {
    let result: { ok: true } | { ok: false; retryable: boolean };
    try {
      const loginUrl = buildLoginUrl(this.configService.get<string>('APP_BASE_URL') ?? '');
      result = await this.emailService.sendTemplate(
        'account-activation',
        { email },
        { firstName, loginUrl },
      );
    } catch {
      result = { ok: false, retryable: false };
    }
    try {
      await recordEmailEvent(this.databaseService.db, requestId, 'account-activation', result);
    } catch {
      // La validation est acquise quoi qu'il arrive : seule la trace manque.
      this.logger.error(
        `Historique non inscrit pour l'email d'activation de la demande ${requestId}.`,
      );
    }
    return result.ok;
  }
}

/** Choisit un nom court libre : « cabinet-bennani », puis « -2 », « -3 »... (ADR-0021 D7). */
async function pickFreeSlug(
  tx: Parameters<typeof slugIsTaken>[0],
  structureName: string,
): Promise<string> {
  const base = slugify(structureName);
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = slugCandidate(base, attempt);
    if (!(await slugIsTaken(tx, candidate))) return candidate;
  }
  throw new Error('Aucun nom court disponible pour cette organisation.');
}

function isSlugConflict(error: unknown): boolean {
  return findPgCode(error) === '23505' && (findPgConstraint(error) ?? '').includes('slug');
}
