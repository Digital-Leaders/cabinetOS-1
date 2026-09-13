// Rechargement complet du document -- utilise pour la bascule d'organisation en
// cours de session (app-header.tsx) : jamais une navigation cote client
// (router.push), voir le commentaire de switchOrganization() pour le pourquoi.
// Extrait dans sa propre fonction pour rester testable -- jsdom ne permet pas
// de mocker directement l affectation a window.location.href.

export function hardNavigate(path: string): void {
  window.location.href = path;
}
