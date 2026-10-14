import { RegistrationForm } from '../../../features/registration/registration-form';
import '../../../styles/cabinetos-tokens.css';

// BUILD-004 etape 2, TASK-053 : inscription du fondateur. Comme la connexion, page pleine
// sans chrome d'application (pas encore de session ni d'organisation a montrer).

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <RegistrationForm locale={locale} />;
}
