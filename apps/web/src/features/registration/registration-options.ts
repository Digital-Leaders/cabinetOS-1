// TASK-053 (BUILD-004 etape 2, EA-014) : valeurs des deux listes controlees de
// l'inscription. Ce sont les CODES stockes (jamais les libelles) ; les libelles FR/AR
// vivent dans messages/*.json (Registration.specialties / Registration.cities).
//
// Source de verite cote serveur : medecinSpecialtyEnum (module Medecin) + 'generaliste'
// (ADR-0021 D7), et REGISTRATION_CITIES (module registration). Un test cote API
// (apps/api/test/registration/registration-options-sync.spec.ts) echoue si ces listes
// divergent : le front ne peut pas proposer une valeur que le serveur refuserait.

/** « Medecin generaliste » en tete, puis les 35 specialites, dans l'ordre de la liste validee. */
export const SPECIALTY_CODES = [
  'generaliste',
  'cardiologie',
  'dermatologie',
  'endocrinologie_maladies_metaboliques',
  'gastro_enterologie',
  'gynecologie_obstetrique',
  'pediatrie',
  'pneumologie',
  'neurologie',
  'psychiatrie',
  'rhumatologie',
  'nephrologie',
  'urologie',
  'ophtalmologie',
  'orl',
  'chirurgie_generale',
  'chirurgie_orthopedique_traumatologie',
  'neurochirurgie',
  'chirurgie_cardiovasculaire_vasculaire',
  'chirurgie_plastique_reconstructrice_esthetique',
  'chirurgie_pediatrique',
  'anesthesie_reanimation',
  'oncologie_medicale',
  'radiotherapie_oncologie_radiotherapique',
  'hematologie',
  'medecine_interne',
  'maladies_infectieuses',
  'medecine_physique_readaptation',
  'medecine_travail',
  'medecine_legale',
  'radiologie_imagerie_medicale',
  'anatomie_pathologique',
  'biologie_medicale',
  'medecine_nucleaire',
  'geriatrie',
  'medecine_urgence',
] as const;

/** Memes villes que la fiche patient (patient-options.ts) et que le serveur (D7). */
export const REGISTRATION_CITIES = [
  'Casablanca',
  'Rabat',
  'Marrakech',
  'Fès',
  'Tanger',
  'Agadir',
] as const;
