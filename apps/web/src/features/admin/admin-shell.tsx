'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { signOut } from '../../lib/auth-client';
import { AdminApiError, fetchAdminMe } from '../../lib/admin-client';
import './admin.css';

// BUILD-004 etape 2, EA-017 / TASK-060 : coque de l'espace admin (brief §5.3). Barre du haut de la
// maquette (marque + pastille « Administration ») et CONTROLE D'ACCES : rien de l'espace admin n'est
// affiche avant que le serveur ait confirme que l'utilisateur est administrateur de la plateforme
// (GET /admin/me, TASK-058).
//
//   200 -> l'espace s'affiche
//   403 -> carte « Acces reserve » : aucun element de l'espace admin n'est montre
//   401 -> session absente ou expiree : retour a la connexion
//   autre -> message clair et « Reessayer »
//
// Le front n'est qu'un confort : chaque endpoint admin est PROTEGE cote serveur
// (@RequirePlatformAdmin, TASK-058/059), quoi que fasse cet ecran.

type Access = 'checking' | 'granted' | 'forbidden' | 'error';

export function AdminShell({ locale, children }: { locale: string; children: ReactNode }) {
  const t = useTranslations('Admin');
  const router = useRouter();
  const [access, setAccess] = useState<Access>('checking');

  // Le routeur est garde dans une ref : la verification ne depend pas de son identite.
  const routerRef = useRef(router);
  routerRef.current = router;

  async function check() {
    setAccess('checking');
    try {
      await fetchAdminMe();
      setAccess('granted');
    } catch (error) {
      const kind = error instanceof AdminApiError ? error.kind : 'UNEXPECTED';
      if (kind === 'UNAUTHENTICATED') {
        routerRef.current.replace(`/${locale}/login`);
      } else if (kind === 'FORBIDDEN') {
        setAccess('forbidden');
      } else {
        setAccess('error');
      }
    }
  }

  useEffect(() => {
    // Une seule verification a l'ouverture : l'acces ne depend d'aucune valeur qui change.
    void check();
  }, []);

  async function handleLogout() {
    await signOut();
    router.push(`/${locale}/login`);
  }

  if (access === 'forbidden') {
    return (
      <div className="ad-page">
        <div className="ad-center-card">
          <h1>{t('forbidden.title')}</h1>
          <p>{t('forbidden.body')}</p>
          <button
            type="button"
            className="ad-btn ad-btn-ghost"
            onClick={() => router.push(`/${locale}`)}
          >
            {t('forbidden.home')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ad-page">
      <header className="ad-topbar">
        <div className="ad-brand">
          <span className="b1">Cabinet</span>
          <span className="b2">OS</span>
        </div>
        <span className="ad-adminbadge">{t('badge')}</span>
        <span className="ad-spacer" />
        {access === 'granted' && (
          <button type="button" className="ad-link" onClick={handleLogout}>
            {t('logout')}
          </button>
        )}
      </header>

      <main className="ad-wrap">
        {access === 'checking' && (
          <p className="ad-muted" role="status">
            {t('loading')}
          </p>
        )}
        {access === 'error' && (
          <div role="alert" className="ad-error-box">
            <p>{t('list.error')}</p>
            <button type="button" className="ad-btn ad-btn-ghost" onClick={() => void check()}>
              {t('retry')}
            </button>
          </div>
        )}
        {access === 'granted' && children}
      </main>
    </div>
  );
}
