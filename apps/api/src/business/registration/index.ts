export { RegistrationModule } from './registration.module';
export {
  registrationRequests,
  registrationEvents,
  registrationRequestsRelations,
  registrationEventsRelations,
  REGISTRATION_STATUSES,
  REGISTRATION_EVENT_ACTIONS,
  REGISTRATION_EMAIL_TEMPLATES,
  type RegistrationStatus,
  type RegistrationEventAction,
} from './infrastructure/schema';

export {
  GENERALISTE,
  REGISTRATION_CITIES,
  ORPHAN_ACCOUNT_MIN_AGE_MINUTES,
  RESEND_EMAIL_WINDOW_SECONDS,
  FOUNDER_ROLE_NAME,
} from './domain/registration-rules';

// TASK-051/052 (BUILD-004 etape 2, EA-014) : schema, module et regles exposes. Aucune
// fonction d'ecriture exportee : l'inscription passe uniquement par le controleur.
// Le statut cote fondateur (EA-015) et l'espace admin (EA-017) viendront s'y ajouter.
