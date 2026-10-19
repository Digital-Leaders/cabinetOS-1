// Fuseau du processus de TEST : Africa/Casablanca (UTC+1), volontairement PAS UTC.
//
// Pourquoi : les machines de CI tournent en UTC, ce qui cache tout un pan de defauts de fuseau.
// Exemple reel, trouve en EA-017 : un horodatage lu par SQL direct etait decale d'une heure sur un
// serveur regle au Maroc, et tous les tests passaient (en UTC, le decalage est nul). En faisant
// tourner la suite dans un fuseau NON UTC -- celui de nos utilisateurs --, un tel defaut echoue
// partout, immediatement, au lieu d'attendre la mise en production.
//
// Execute une fois, dans le processus parent, AVANT les tests : les processus de test en heritent.
module.exports = async () => {
  // TEST_TZ permet d'essayer un autre fuseau : TEST_TZ=America/Los_Angeles pnpm test
  process.env.TZ = process.env.TEST_TZ ?? 'Africa/Casablanca';
};
