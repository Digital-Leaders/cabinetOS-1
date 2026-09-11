import { useTranslations } from 'next-intl';
import { AppHeader } from '../../features/app-shell/app-header';
import '../../styles/cabinetos-tokens.css';

// Accueil post-connexion -- prouve la boucle complete du commit 1 (connexion ->
// session -> deconnexion). Reste un espace de travail minimal : aucun module n a
// ete demande ici, seul le header applicatif (menu utilisateur) est du perimetre
// de ce commit. Le selecteur d'organisation viendra completer ce meme header
// (commit dedie), pas un nouveau header.

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = useTranslations('HomePage');

  return (
    <div className="cos-body">
      <AppHeader locale={locale} />
      <main style={{ maxWidth: 900, margin: '34px auto', padding: '0 20px' }}>
        <h1>{t('title')}</h1>
      </main>
    </div>
  );
}
