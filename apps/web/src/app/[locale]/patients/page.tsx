import { PatientSearchView } from '../../../features/patients/patient-search-view';
import { AppHeader } from '../../../features/app-shell/app-header';
import '../../../styles/cabinetos-tokens.css';

export default async function PatientsSearchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="cos-body">
      <AppHeader locale={locale} breadcrumb="Patients" />
      <PatientSearchView locale={locale} />
    </div>
  );
}
