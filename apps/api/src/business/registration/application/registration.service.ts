import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../../modules/shared';
import {
  AUTH_PROVIDER,
  type AuthProvider,
  type CreateAccountResult,
} from '../../../modules/identity';
import { TransactionalEmailService } from '../../../modules/email';
import {
  EMAIL_ALREADY_USED_MESSAGE,
  ORPHAN_ACCOUNT_MIN_AGE_MINUTES,
  buildAccountName,
  optionalText,
} from '../domain/registration-rules';
import { compensateAccountCreation } from './compensation';
import {
  deleteAccountWithoutRequest,
  deleteOrphanAccountByEmail,
  insertRegistrationRequest,
  recordEmailEvent,
} from '../infrastructure/registration.queries';

// TASK-052 (BUILD-004 etape 2, EA-014) : cas d'usage d'inscription du fondateur.
//
//   1. compte cree cote serveur, via AuthProvider (l'inscription HTTP native est fermee,
//      ADR-0021 D2) ; email deja utilise -> recuperation d'orphelin strict et age (P1),
//      sinon message neutre ;
//   2. demande PENDING_VERIFICATION + evenement REQUEST_SUBMITTED, dans une transaction ;
//      si cette etape echoue, le compte est supprime (compensation fiabilisee, P1) ;
//   3. email de confirmation, APRES et SEPARE de l'acte metier (R6) : son echec est
//      inscrit dans l'historique et ne remet jamais l'inscription en cause.
//
// Aucune donnee personnelle dans les journaux (ni email, ni nom).

export interface RegistrationInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  specialty: string;
  inpe?: string;
  numeroOrdre?: string;
  structureName: string;
  city: string;
  address?: string;
}

export interface RegistrationOutcome {
  requestId: string;
  status: string;
  /** Session du fondateur, pour qu'il atteigne directement l'ecran de statut. */
  sessionCookies: string[];
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
    private readonly emailService: TransactionalEmailService,
  ) {}

  async register(input: RegistrationInput): Promise<RegistrationOutcome> {
    const email = input.email.trim().toLowerCase();
    const firstName = input.firstName.trim();
    const account = await this.createAccountOrRecoverOrphan({
      email,
      password: input.password,
      name: buildAccountName(firstName, input.lastName.trim()),
    });

    let request: { id: string; status: string };
    try {
      request = await insertRegistrationRequest(this.databaseService, account.userId, {
        firstName,
        lastName: input.lastName.trim(),
        specialty: input.specialty,
        inpe: optionalText(input.inpe),
        numeroOrdre: optionalText(input.numeroOrdre),
        structureName: input.structureName.trim(),
        city: input.city,
        address: optionalText(input.address),
      });
    } catch {
      await compensateAccountCreation(
        account.userId,
        (userId) => deleteAccountWithoutRequest(this.databaseService.db, userId),
        this.logger,
      );
      throw new InternalServerErrorException(
        "Votre inscription n'a pas pu etre enregistree. Reessayez dans quelques instants.",
      );
    }

    await this.sendConfirmationEmail(request.id, email, firstName);

    return {
      requestId: request.id,
      status: request.status,
      sessionCookies: account.sessionCookies,
    };
  }

  private async createAccountOrRecoverOrphan(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<Extract<CreateAccountResult, { ok: true }>> {
    let result = await this.authProvider.createAccount(input);

    if (!result.ok && result.reason === 'EMAIL_ALREADY_USED') {
      const recovered = await deleteOrphanAccountByEmail(
        this.databaseService.db,
        input.email,
        ORPHAN_ACCOUNT_MIN_AGE_MINUTES,
      );
      if (!recovered) {
        throw new ConflictException(EMAIL_ALREADY_USED_MESSAGE);
      }
      this.logger.log('Compte orphelin recupere avant reinscription (ADR-0021 P1).');
      // Une seconde tentative concurrente a pu reprendre l'email entre-temps : meme
      // reponse neutre, jamais une erreur technique.
      result = await this.authProvider.createAccount(input);
    }

    if (!result.ok) {
      if (result.reason === 'INVALID_PASSWORD') {
        throw new BadRequestException('Le mot de passe doit contenir au moins 8 caracteres.');
      }
      throw new ConflictException(EMAIL_ALREADY_USED_MESSAGE);
    }
    return result;
  }

  private async sendConfirmationEmail(
    requestId: string,
    email: string,
    firstName: string,
  ): Promise<void> {
    // sendTemplate ne leve jamais pour un echec d'envoi (ADR-0020) : il renvoie un
    // resultat, inscrit tel quel dans l'historique. Le renvoi viendra en TASK-054.
    const result = await this.emailService.sendTemplate(
      'registration-confirmation',
      { email },
      { firstName },
    );
    try {
      await recordEmailEvent(
        this.databaseService.db,
        requestId,
        'registration-confirmation',
        result,
      );
    } catch {
      // L'inscription est acquise quoi qu'il arrive (R6). Seule la trace manque.
      this.logger.error(
        `Historique non inscrit pour l'email de confirmation de la demande ${requestId}.`,
      );
    }
  }
}
