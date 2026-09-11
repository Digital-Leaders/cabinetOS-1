import type { Viewport } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '../../i18n/routing';

// Parcours d'acces, etape 1 -- regle non-negociable n°2 : "Thème clair forcé...
// À garantir au niveau de l'application (une page seule ne peut pas toujours
// l'imposer, testé)." D'ou ce choix ici, dans le layout racine (ce fichier
// retourne <html> directement, c est la racine reelle de l'app) plutot que dans
// une page individuelle -- deux mecanismes qui se recoupent expres :
// 1. viewport.colorScheme -> <meta name="color-scheme" content="light">, dit au
//    navigateur de rendre les widgets natifs (scrollbar, inputs) en clair.
// 2. style colorScheme sur <html> -- vrai quel que soit l'ordre de chargement
//    du CSS des pages, jamais laisse a la charge d'un import par ecran.
export const viewport: Viewport = {
  colorScheme: 'light',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} style={{ colorScheme: 'light' }}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
