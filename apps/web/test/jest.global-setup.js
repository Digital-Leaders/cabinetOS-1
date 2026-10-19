// Fuseau du processus de TEST du front : Etc/GMT-1, soit UTC+01:00 FIXE.
//
// Pourquoi l'epingler : le front affiche des dates dans le fuseau de l'UTILISATEUR (c'est voulu),
// donc un test qui attend « 28/09/2026 » pour un instant donne depend du fuseau de la machine qui
// l'execute (la CI est en UTC, les developpeurs au Maroc, et minuit UTC est deja « demain » a
// UTC+1). Constate en EA-017 : des tests de l'espace admin reussissaient a UTC+1 et echouaient a
// UTC+14. Epingle, le resultat est identique partout.
//
// Pourquoi CE fuseau (et pas un fuseau geographique comme Africa/Casablanca) : sa base de regles
// differe d'une version de Node a l'autre (constate : Casablanca est a UTC+1 sous Node 22 et UTC+0
// sous Node 24 le 19 octobre 2026). Etc/GMT-1 est un decalage FIXE, sans exception, identique
// partout. (Signe inverse : convention POSIX.) Meme choix que l'API (apps/api/test/jest.global-setup.js).
//
// Execute une fois, dans le processus parent, AVANT les tests : ils en heritent.
module.exports = async () => {
  // TEST_TZ permet d'essayer un autre fuseau : TEST_TZ=Etc/GMT+8 pnpm test
  process.env.TZ = process.env.TEST_TZ ?? 'Etc/GMT-1';
};
