import { LoginForm } from '../../../features/auth/login-form';
import '../../../styles/cabinetos-tokens.css';

// Ecran 1 du parcours d'acces (etape 1) -- pas de header applicatif ici (pas de
// session a montrer) : la maquette (connexion.html) ne montre aucun chrome
// d'application, uniquement la carte de connexion.

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LoginForm locale={locale} />;
}
