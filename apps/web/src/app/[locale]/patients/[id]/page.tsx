import { getTranslations } from 'next-intl/server';
import { PatientConsultationView } from '../../../../features/patients/patient-consultation-view';
import { AppHeader } from '../../../../features/app-shell/app-header';
import '../../../../styles/cabinetos-tokens.css';

export default async function PatientConsultationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: 'PatientConsultation' });

  return (
    <div className="cos-body">
      <AppHeader locale={locale} breadcrumb={t('breadcrumb.patients')} />
      <PatientConsultationView patientId={id} />
    </div>
  );
}
