import { relations, sql } from 'drizzle-orm';
import { pgTable, uuid, text, boolean, timestamp, index, check } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { users } from '../../../modules/identity';
import { organizations } from '../../../modules/organization';

// TASK-051 (BUILD-004 etape 2, EA-014) : modele des demandes d'inscription du
// fondateur (ADR-0021, D1). Migrations : 0018 (tables) et 0019 (privileges).
//
// EMPLACEMENT : module Business, pas Identity. La cascade de validation (EA-018,
// ADR-0021 D5) appellera le module Medecin (src/business/medecin), et
// dependency-cruiser interdit a src/modules (Core) d'importer src/business.
//
// EXCEPTION RLS ASSUMEE (ADR-0005) : ces deux tables sont GLOBALES, sans
// organization_id ni politique RLS -- l'organisation n'existe pas encore au moment
// de la demande (ADR-0021, D1). L'acces est controle cote application : un
// fondateur ne lit que SA demande (user_id de la session verifiee, jamais une
// valeur fournie par le client) ; l'admin passe par @RequirePlatformAdmin (TASK-058).
//
// FRONTIERE DE DONNEES (Note de Vision) : donnees d'identite professionnelle
// declarees uniquement. Aucun champ commercial ou fiscal.

export const REGISTRATION_STATUSES = [
  'PENDING_VERIFICATION',
  'COMPLEMENT_REQUESTED',
  'ACTIVE',
  'REFUSED',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const registrationRequests = pgTable(
  'registration_requests',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    // Une seule demande par compte (D1). Unicite assumee : pas de reinscription
    // apres refus en V1 (ADR-0021, P2).
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id),
    status: text('status', { enum: REGISTRATION_STATUSES })
      .notNull()
      .default('PENDING_VERIFICATION'),

    // Donnees declarees par le fondateur. L'email n'est PAS duplique : il reste
    // porte par users (Better-Auth).
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    // Code de specialite du module Medecin, ou 'generaliste' (ADR-0021, D7) --
    // traduit en NULL par la cascade. Validation applicative (TASK-052), pas une
    // contrainte de colonne : la liste vit dans le module Medecin.
    specialty: text('specialty').notNull(),
    inpe: text('inpe'), // facultatif (R2), meme nom que medecins.inpe
    numeroOrdre: text('numero_ordre'), // facultatif (R2), meme nom que medecins.numero_ordre
    structureName: text('structure_name').notNull(),
    city: text('city').notNull(), // constante partagee des villes (D7), pas de table
    address: text('address'),

    // Usage exclusif de l'equipe : jamais renvoye au fondateur.
    internalNote: text('internal_note'),

    // R8 : deux colonnes distinctes. Les endpoints cote fondateur selectionnent
    // explicitement refusal_message_to_applicant, JAMAIS refusal_internal_reason.
    refusalInternalReason: text('refusal_internal_reason'),
    refusalMessageToApplicant: text('refusal_message_to_applicant'),

    // Anti-abus du renvoi d'email : 60 s (D7), applique en TASK-054.
    lastEmailResentAt: timestamp('last_email_resent_at'),

    // Renseigne par la cascade de validation (EA-018).
    organizationId: uuid('organization_id').references(() => organizations.id),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('registration_requests_status_idx').on(table.status),
    index('registration_requests_created_at_idx').on(table.createdAt),
    check(
      'registration_requests_status_check',
      sql`${table.status} IN ('PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED', 'ACTIVE', 'REFUSED')`,
    ),
    // Coherence proposee en TASK-051 (non citee par l'ADR, signalee en PR) :
    // un refus porte toujours ses deux messages (R8) ...
    check(
      'registration_requests_refusal_complete_check',
      sql`${table.status} <> 'REFUSED' OR (${table.refusalInternalReason} IS NOT NULL AND ${table.refusalMessageToApplicant} IS NOT NULL)`,
    ),
    // ... et une demande ACTIVE pointe toujours vers l'organisation creee.
    check(
      'registration_requests_active_has_organization_check',
      sql`${table.status} <> 'ACTIVE' OR ${table.organizationId} IS NOT NULL`,
    ),
  ],
);

// Historique append-only (D1) : meme principe qu'audit_events -- cabinetos_app n'a
// ni UPDATE ni DELETE (migration 0019). Chaque transition et chaque envoi d'email,
// reussi ou echoue, y est inscrit.
// INTERDIT ici (R7, R8) : contenu des emails, contenu des echanges, motif interne
// de refus, message d'erreur brut du fournisseur (il peut contenir l'adresse).
export const REGISTRATION_EVENT_ACTIONS = [
  'REQUEST_SUBMITTED', // le fondateur soumet sa demande
  'COMPLEMENT_REQUESTED', // l'admin demande un complement
  'RETURNED_TO_VERIFICATION', // l'admin repasse la demande en verification
  'VALIDATED', // cascade reussie, demande ACTIVE
  'REFUSED', // refus
  'EMAIL_RESEND_REQUESTED', // demande de renvoi (fondateur ou admin)
  'EMAIL_SENT', // envoi reussi (email_template renseigne)
  'EMAIL_FAILED', // envoi echoue (email_template + email_failure_retryable)
] as const;
export type RegistrationEventAction = (typeof REGISTRATION_EVENT_ACTIONS)[number];

// Les quatre modeles d'EA-013 (email-templates.ts, ADR-0020).
export const REGISTRATION_EMAIL_TEMPLATES = [
  'registration-confirmation',
  'verification-complement',
  'account-activation',
  'registration-refusal',
] as const;

export const registrationEvents = pgTable(
  'registration_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    registrationRequestId: uuid('registration_request_id')
      .notNull()
      .references(() => registrationRequests.id),
    action: text('action', { enum: REGISTRATION_EVENT_ACTIONS }).notNull(),
    // NULL = systeme ou demandeur ; renseigne = l'admin qui a agi.
    actorUserId: text('actor_user_id').references(() => users.id),
    emailTemplate: text('email_template', { enum: REGISTRATION_EMAIL_TEMPLATES }),
    emailFailureRetryable: boolean('email_failure_retryable'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('registration_events_request_id_idx').on(table.registrationRequestId, table.createdAt),
    check(
      'registration_events_action_check',
      sql`${table.action} IN ('REQUEST_SUBMITTED', 'COMPLEMENT_REQUESTED', 'RETURNED_TO_VERIFICATION', 'VALIDATED', 'REFUSED', 'EMAIL_RESEND_REQUESTED', 'EMAIL_SENT', 'EMAIL_FAILED')`,
    ),
    check(
      'registration_events_email_template_check',
      sql`${table.emailTemplate} IS NULL OR ${table.emailTemplate} IN ('registration-confirmation', 'verification-complement', 'account-activation', 'registration-refusal')`,
    ),
    // Un evenement d'email nomme toujours son modele ; les autres jamais.
    check(
      'registration_events_email_template_presence_check',
      sql`(${table.action} IN ('EMAIL_RESEND_REQUESTED', 'EMAIL_SENT', 'EMAIL_FAILED')) = (${table.emailTemplate} IS NOT NULL)`,
    ),
    // Seul un echec d'envoi dit s'il est renvoyable.
    check(
      'registration_events_failure_retryable_check',
      sql`(${table.action} = 'EMAIL_FAILED') = (${table.emailFailureRetryable} IS NOT NULL)`,
    ),
  ],
);

export const registrationRequestsRelations = relations(registrationRequests, ({ many }) => ({
  events: many(registrationEvents),
}));

export const registrationEventsRelations = relations(registrationEvents, ({ one }) => ({
  request: one(registrationRequests, {
    fields: [registrationEvents.registrationRequestId],
    references: [registrationRequests.id],
  }),
}));
