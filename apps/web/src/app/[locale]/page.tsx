import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AppHeader } from '../../features/app-shell/app-header';
import { findStatusRedirect } from '../../lib/registration-landing';
import '../../styles/cabinetos-tokens.css';

// Accueil post-connexion -- prouve la boucle complete du commit 1 (connexion ->
// session -> deconnexion). Reste un espace de travail minimal : aucun module n a
// ete demande ici, seul le header applicatif (menu utilisateur) est du perimetre
// de ce commit. Le selecteur d'organisation viendra completer ce meme header
// (commit dedie), pas un nouveau header.
//
// Correctif post-etape-1 : useTranslations (synchrone, next-intl) n est pas
// appelable a l interieur d un composant async -- trouve en verifiant reellement
// l ecran (aperçu visuel demande par la spec), jamais detecte par les tests
// automatises existants puisqu ils simulent tous next-intl entierement. Corrige
// en utilisant getTranslations (compatible async), comme deja fait sur les
// autres pages (patients/new, patients/[id]).

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  // Etape 2 (EA-016, TASK-057) : un fondateur dont la demande n'est pas ACTIVE revient avec
  // une session encore valide -> son ecran de statut, pas un espace vide. Echec ouvert (voir
  // registration-landing.ts) ; les comptes sans demande ne voient aucune difference.
  const target = await findStatusRedirect(locale, (await cookies()).toString());
  if (target) redirect(target);

  const t = await getTranslations({ locale, namespace: 'HomePage' });

  return (
    <div className="cos-body">
      <AppHeader locale={locale} />
      <main style={{ maxWidth: 900, margin: '34px auto', padding: '0 20px' }}>
        <h1>{t('title')}</h1>
      </main>
    </div>
  );
}
