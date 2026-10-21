// BUILD-004 etape 2, EA-018 / TASK-066 : messages PRE-REMPLIS des fenetres « Demander un complement » et
// « Refuser » (maquette admin-validation.html), que l'administrateur peut modifier avant d'envoyer.
//
// En FRANCAIS, QUELLE QUE SOIT la langue de l'interface : ils sont le contenu de l'email que recevra le medecin,
// et les emails sont rediges en francais (EA-013). Ce ne sont donc PAS des textes d'interface : ils ne passent
// pas par les fichiers de traduction.
//
// A TRANCHER (Product Owner) : l'email commence deja par « Bonjour {prenom}, » puis une phrase d'introduction ;
// ces messages de la maquette commencent aussi par « Bonjour, » : le medecin lirait deux fois « Bonjour ».
// Ils sont repris TELS QUELS de la maquette ; les ajuster est un changement d'une ligne, ici.

export const COMPLEMENT_DEFAULT_MESSAGE =
  "Bonjour, afin de finaliser la vérification de votre inscription, merci de nous transmettre le lien vers la fiche Google de votre cabinet ou toute page publique permettant d'identifier votre activité. Vous pouvez répondre directement à cet email.";

export const REFUSAL_DEFAULT_MESSAGE =
  "Bonjour, nous n'avons pas pu valider votre inscription avec les informations disponibles. Pour toute question, vous pouvez nous contacter.";

/** Memes bornes que le serveur (TASK-064 et TASK-065). */
export const MAX_ACTION_TEXT_LENGTH = 2000;
export const MAX_OTHER_INFO_LENGTH = 200;

/** Meme normalisation que le serveur (refusal-rules.ts) : le « meme texte » aux espaces et a la casse pres. */
export function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}
