// BUILD-004 etape 2, EA-018 / TASK-064 : regles pures de la demande de COMPLEMENT (brief R7).
//
// L'administrateur choisit le TYPE d'information demandee (trois choix, ceux de la maquette) et ecrit un
// message. Le libelle de l'information est FIXE cote serveur pour les deux premiers types (source de
// verite unique) ; pour « autre », c'est le texte saisi par l'administrateur.

export const COMPLEMENT_INFO_TYPES = ['google_listing', 'other_public_presence', 'other'] as const;
export type ComplementInfoType = (typeof COMPLEMENT_INFO_TYPES)[number];

export const MAX_COMPLEMENT_MESSAGE_LENGTH = 2000;
export const MAX_OTHER_INFO_LENGTH = 200;

/**
 * Libelles des deux types predefinis, tires de la maquette (« Lien vers la fiche Google de
 * l'etablissement », « Lien vers une autre presence professionnelle publique »). Rediges pour completer la
 * phrase de l'email : « ...nous avons besoin d'une information complementaire : <libelle> ».
 */
export const PREDEFINED_INFO_LABELS: Record<Exclude<ComplementInfoType, 'other'>, string> = {
  google_listing: 'le lien vers la fiche Google de votre établissement',
  other_public_presence: 'le lien vers une autre présence professionnelle publique',
};

/**
 * Libelle de l'information demandee, tel qu'il sera envoye ET conserve (ADR-0022 : exactement les
 * parametres du modele d'email, pour pouvoir le renvoyer a l'identique).
 */
export function requestedInfoLabel(type: ComplementInfoType, otherInfo?: string | null): string {
  if (type !== 'other') return PREDEFINED_INFO_LABELS[type];
  const custom = otherInfo?.trim();
  if (!custom) {
    throw new Error("Le type « autre information » exige de preciser l'information demandee.");
  }
  return custom;
}
