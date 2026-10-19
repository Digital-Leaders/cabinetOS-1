// BUILD-004 etape 2, EA-017 / TASK-059 : lecture des horodatages ecrits par SQL direct.
//
// PROBLEME. Pour une requete SQL directe (db.execute), le pilote de base de donnees de Drizzle
// renvoie les colonnes `timestamp` sous forme de TEXTE BRUT sans fuseau ("2026-10-19
// 14:21:02.695123"), et non d'une Date. Faire `new Date(texte)` interprete alors ce texte dans le
// fuseau du SERVEUR : sur une machine reglee a UTC+1 (le Maroc, la plupart du temps), l'instant est decale d'une
// heure. Les requetes via l'ORM ne sont pas concernees : Drizzle y lit explicitement ces colonnes
// comme de l'UTC.
//
// CONVENTION DU PROJET (ADR-0008 : « horodatages ISO 8601 en UTC »). Les colonnes `timestamp` sont
// ecrites en UTC (le serveur de base tourne en UTC) et lues comme de l'UTC. Cette fonction applique
// cette meme convention aux lectures par SQL direct, QUEL QUE SOIT le fuseau du processus Node.
//
// A utiliser pour TOUTE colonne timestamp lue par db.execute dans ce module : jamais `new Date()`
// sur la valeur brute.

const HAS_ZONE = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

export function fromDbTimestamp(value: Date | string): Date {
  if (value instanceof Date) return value;
  const text = value.trim();
  // Une valeur qui porte deja son fuseau (timestamptz) est lue telle quelle. PostgreSQL ecrit le
  // decalage « +00 » ou « +0100 » ; JavaScript n'accepte que « +00:00 » : on le normalise.
  if (HAS_ZONE.test(text.slice(10))) {
    const iso = text
      .replace(' ', 'T')
      .replace(/([+-]\d{2})$/, '$1:00')
      .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    return new Date(iso);
  }
  // Sinon : heure UTC sans fuseau, comme ecrite par la base.
  return new Date(`${text.replace(' ', 'T')}Z`);
}

export function fromDbTimestampOrNull(value: Date | string | null | undefined): Date | null {
  return value ? fromDbTimestamp(value) : null;
}
