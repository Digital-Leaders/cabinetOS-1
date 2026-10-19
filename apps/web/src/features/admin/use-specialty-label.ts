import { useTranslations } from 'next-intl';

// TASK-060 : libelle d'une specialite a partir de son CODE, avec les traductions de l'ecran
// d'inscription (Registration.specialties) -- une seule source, jamais recopiee. Un code que les
// traductions ne connaissent pas (liste modifiee plus tard) s'affiche tel quel plutot que de casser
// l'ecran.
export function useSpecialtyLabel(): (code: string) => string {
  const t = useTranslations('Registration');
  return (code: string) => {
    const key = `specialties.${code}`;
    return typeof t.has === 'function' && !t.has(key) ? code : t(key);
  };
}
