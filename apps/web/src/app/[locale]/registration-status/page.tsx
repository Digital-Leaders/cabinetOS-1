import { RegistrationStatusScreen } from '../../../features/registration/registration-status-view';
import '../../../styles/cabinetos-tokens.css';

// BUILD-004 etape 2, TASK-055 : statut de la demande du fondateur. Page protegee (session
// requise, proxy.ts) mais pleine, sans chrome d'application : le fondateur n'a pas encore
// d'organisation.

export default async function RegistrationStatusPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <RegistrationStatusScreen locale={locale} />;
}
