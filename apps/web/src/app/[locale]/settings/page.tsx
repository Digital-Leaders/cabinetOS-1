import { getTranslations } from 'next-intl/server';
import { SettingsView } from '../../../features/settings/settings-view';
import { AppHeader } from '../../../features/app-shell/app-header';
import '../../../styles/cabinetos-tokens.css';

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'AppHeader' });

  return (
    <div className="cos-body">
      <AppHeader locale={locale} breadcrumb={t('settings')} />
      <SettingsView />
    </div>
  );
}
