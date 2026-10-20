// BUILD-004 etape 2, EA-018 / TASK-065 : regles pures du REFUS d'une inscription (brief R8).
//
// Deux champs STRICTEMENT separes : un motif INTERNE (obligatoire, jamais communique au demandeur) et un
// message AU DEMANDEUR (celui que le medecin recevra). Le motif interne ne circule que de la requete de
// l'administrateur vers la base : il n'est un parametre d'AUCUN modele d'email.

export const MAX_REFUSAL_TEXT_LENGTH = 2000;

/** Comparaison tolerante (espaces, casse) : « Dossier incomplet » et « dossier   incomplet » sont le meme texte. */
export function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Garde contre l'erreur humaine la plus dangereuse de R8 : coller le MEME texte dans les deux champs, ce
 * qui communiquerait le motif interne au medecin. La separation des champs rend la fuite impossible « par
 * conception » ; ceci couvre le copier-coller. Un message distinct qui reprendrait des mots du motif reste
 * de la responsabilite de l'administrateur.
 */
export function refusalFieldsAreDistinct(
  internalReason: string,
  messageToApplicant: string,
): boolean {
  return normalizeForComparison(internalReason) !== normalizeForComparison(messageToApplicant);
}
