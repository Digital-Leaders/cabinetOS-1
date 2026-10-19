// Outils de test de l'espace admin (TASK-060) : simulation de next-intl qui, contrairement aux
// tests precedents, REMPLACE aussi les parametres ({date}, {name}) -- l'espace admin en utilise.

export function getNested(obj: unknown, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], obj);
  return typeof value === 'string' ? value : path;
}

export function translate(
  messages: Record<string, unknown>,
  namespace: string,
  key: string,
  values?: Record<string, string | number>,
): string {
  let text = getNested(messages[namespace], key);
  for (const [name, value] of Object.entries(values ?? {})) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

/** Retire les marques de direction invisibles que l'arabe ajoute aux dates. */
export const visible = (text: string) => text.replace(/[\u200e\u200f]/g, '');
