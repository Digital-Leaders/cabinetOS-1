import { AdminRequestsList } from '../../../features/admin/admin-requests-list';
import '../../../styles/cabinetos-tokens.css';

// BUILD-004 etape 2, EA-017 / TASK-060 : liste des demandes d'inscription (espace admin). Le
// controle d'acces (administrateur de plateforme) est fait par AdminShell, confirme par le serveur.

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AdminRequestsList locale={locale} />;
}
