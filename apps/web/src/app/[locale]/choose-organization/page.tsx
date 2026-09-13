import { ChooseOrganizationView } from '../../../features/auth/choose-organization-view';
import '../../../styles/cabinetos-tokens.css';

// Ecran 2 du parcours d'acces (etape 1) -- pas de header applicatif ici, meme
// raison que /login : aucune organisation n est encore selectionnee.

export default async function ChooseOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <ChooseOrganizationView locale={locale} />;
}
