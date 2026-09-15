// Monogramme partage (avatar utilisateur, badge d'organisation) -- auparavant
// duplique dans app-header.tsx (1re + DERNIERE lettre) et choose-organization-view.tsx
// / settings-view.tsx (1re + 2e lettre), ce qui produisait des monogrammes
// incoherents pour un meme nom selon l'ecran (ex. "Cabinet El Amrani" et
// "Clinique Al Andalous" affichaient tous deux "CA" dans le selecteur
// d'organisation, alors qu'ils etaient distingues "CE"/"CA" ailleurs).
//
// Convention retenue : 1re lettre des DEUX premiers mots -- reproduit la
// maquette d'origine pour 2 des 3 exemples ("Cabinet El Amrani" -> CE,
// "Clinique Al Andalous" -> CA ; "Centre medical Ranya" y affichait "CR",
// choisi a la main, sans formule unique). L objectif ici n est pas de
// reproduire chaque exemple a l identique, mais de garantir que des
// organisations differentes restent distinguables -- ce que cette regle fait
// pour les noms réalistes rencontres dans ce Build.

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}
