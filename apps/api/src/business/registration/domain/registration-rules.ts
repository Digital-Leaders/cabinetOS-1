// TASK-052 (BUILD-004 etape 2, EA-014) : regles de l'inscription du fondateur.
// Fonctions et constantes pures, sans dependance technique.

/**
 * Choix explicite « generaliste » (ADR-0021, D7). La specialite est obligatoire a
 * l'inscription, alors que le module Medecin represente un generaliste par une
 * specialite NULL : la demande stocke ce code, la cascade (EA-018) le traduit en NULL.
 */
export const GENERALISTE = 'generaliste';

/**
 * Villes proposees a l'inscription (ADR-0021, D7) : constante, sans table, en V1.
 * Memes valeurs que la liste deja utilisee par la fiche patient cote web
 * (apps/web/src/features/patients/patient-options.ts). Une liste personnalisable par
 * l'admin viendra plus tard (confirme par l'encadrant), pas maintenant.
 */
export const REGISTRATION_CITIES = [
  'Casablanca',
  'Rabat',
  'Marrakech',
  'Fès',
  'Tanger',
  'Agadir',
] as const;

/**
 * Compte orphelin (ADR-0021, P1) : un compte n'est recuperable que s'il existe depuis
 * plus que ce delai. Il protege une inscription en cours, dont le compte existe deja
 * mais dont la demande n'est pas encore inseree (cas de concurrence souleve a la
 * validation de l'ADR).
 */
export const ORPHAN_ACCOUNT_MIN_AGE_MINUTES = 10;

/**
 * Message unique, volontairement neutre (ADR-0021, D7) : il ne revele pas l'etat du
 * compte existant (demande en cours, refusee, compte d'equipe...).
 */
export const EMAIL_ALREADY_USED_MESSAGE =
  'Un espace existe deja avec cet email. Connectez-vous, ou contactez-nous si besoin.';

/** Nom d'affichage du compte, construit a partir des donnees declarees. */
export function buildAccountName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

/** Valeur facultative : espaces retires, chaine vide traitee comme absente. */
export function optionalText(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Delai anti-abus du renvoi d'email cote fondateur (ADR-0021 D7, confirme). */
export const RESEND_EMAIL_WINDOW_SECONDS = 60;

/**
 * Email masque pour l'ecran de statut (brief §5.2) : diagnostic seulement -- la premiere
 * lettre, puis « ••••• », puis le domaine. Ex. y.bennani@cabinet.ma -> y•••••@cabinet.ma.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••••';
  return `${email[0]}•••••${email.slice(at)}`;
}

/**
 * Nom du role donne au fondateur quand sa demande est validee (brief R4, operation 3 ; migration
 * 0025). Le role est GLOBAL et seme par migration avec exactement les permissions manage et read sur
 * patients et medecins (ADR-0021 D6). La cascade le retrouve par ce nom : un test echoue si la
 * migration et cette constante divergent.
 */
export const FOUNDER_ROLE_NAME = 'fondateur';
