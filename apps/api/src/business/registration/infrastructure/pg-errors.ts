// BUILD-004 etape 2, EA-018 / TASK-063 : lecture des erreurs PostgreSQL. drizzle-orm enveloppe l'erreur
// du pilote dans `.cause` (DrizzleQueryError) : le code SQLSTATE et le nom de la contrainte y vivent.

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

function walk(
  error: unknown,
  pick: (candidate: PgErrorLike) => string | undefined,
): string | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth += 1) {
    const value = pick(e as PgErrorLike);
    if (value) return value;
    e = (e as PgErrorLike).cause;
  }
  return undefined;
}

/** Code SQLSTATE (5 caracteres) de l'erreur ou de sa cause, ex. « 23505 » (doublon), « 23503 » (cle etrangere). */
export function findPgCode(error: unknown): string | undefined {
  return walk(error, (c) =>
    typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code) ? c.code : undefined,
  );
}

/** Nom de la contrainte violee, quand PostgreSQL le donne. */
export function findPgConstraint(error: unknown): string | undefined {
  return walk(error, (c) => (typeof c.constraint === 'string' ? c.constraint : undefined));
}
