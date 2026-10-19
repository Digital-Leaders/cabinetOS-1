import { AdminRequestDetailScreen } from '../../../../features/admin/admin-request-detail';
import '../../../../styles/cabinetos-tokens.css';

// BUILD-004 etape 2, EA-017 / TASK-060 : detail d'une demande d'inscription (espace admin).

export default async function AdminRequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  return <AdminRequestDetailScreen locale={locale} id={id} />;
}
