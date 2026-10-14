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

// TASK-051 (BUILD-004 etape 2, EA-014) : surface publique limitee au schema pour
// l'instant. Le cas d'usage d'inscription (TASK-052), le statut cote fondateur
// (EA-015) et l'espace admin (EA-017) viendront s'y ajouter, chacun dans sa TASK.
