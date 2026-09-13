import { getTranslations } from 'next-intl/server';
import { CreatePatientForm } from '../../../../features/patients/create-patient-form';
import { AppHeader } from '../../../../features/app-shell/app-header';
import '../../../../styles/cabinetos-tokens.css';

export default async function NewPatientPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'PatientCreate' });

  return (
    <div className="cos-body">
      <AppHeader
        locale={locale}
        breadcrumb={
          <>
            {t('breadcrumb.patients')} &rsaquo; <b>{t('breadcrumb.current')}</b>
          </>
        }
      />
      <CreatePatientForm locale={locale} />
    </div>
  );
}
