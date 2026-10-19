// Fuseau du processus de TEST : Etc/GMT-1, soit UTC+1 FIXE (le decalage habituel du Maroc),
// volontairement PAS UTC.
//
// Pourquoi pas UTC : les machines de CI tournent en UTC, ce qui cache tout un pan de defauts de
// fuseau. Exemple reel, trouve en EA-017 : un horodatage lu par SQL direct etait decale d'une heure
// sur un serveur regle au Maroc, et tous les tests passaient (en UTC, le decalage est nul). En
// faisant tourner la suite dans un fuseau NON UTC, un tel defaut echoue partout, immediatement.
//
// Pourquoi « Etc/GMT-1 » et PAS « Africa/Casablanca » : un fuseau nomme depend de la base de
// fuseaux horaires EMBARQUEE dans la version de Node, et celle du Maroc est irreguliere (le
// decalage change pendant le Ramadan, dont les dates varient). CONSTATE : a la date du 19 octobre
// 2026, Node 22 donne UTC+1 pour Africa/Casablanca et Node 24 donne UTC+0. Un test qui attendait
// un decalage reussissait en local et echouait en CI. Les zones « Etc/GMT±N » sont des decalages
// FIXES, sans heure d'ete ni exception, identiques dans toutes les versions de Node.
// (Convention POSIX, deliberement inversee : Etc/GMT-1 = UTC+1.)
//
// Execute une fois, dans le processus parent, AVANT les tests : les processus de test en heritent.
module.exports = async () => {
  // TEST_TZ permet d'essayer un autre fuseau : TEST_TZ=Etc/GMT+8 pnpm test  (UTC-8)
  process.env.TZ = process.env.TEST_TZ ?? 'Etc/GMT-1';
};
