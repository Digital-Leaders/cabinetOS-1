'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getSession, signOut, type AuthUser } from '../../lib/auth-client';
import './app-header.css';

// Header applicatif -- port partiel de docs/design/maquettes/changement-organisation.html :
// uniquement le menu utilisateur (avatar, nom/e-mail, Profil/Reglages, deconnexion).
// Le selecteur d'organisation (haut a gauche dans la maquette) est hors perimetre --
// commit dedie au changement d'organisation en cours de session.
//
// Profil et Reglages n'ont pas d'ecran construit dans ce Build (hors perimetre de
// l etape 1) : memes reperes "bientot disponible" que dans LoginForm plutot que des
// liens morts.
//
// La session est lue au montage via get-session (jamais mise en cache localement --
// source de verite unique cote serveur). Si elle est absente ici, c est que le
// middleware (proxy.ts) a laisse passer une page protegee sans session valide --
// filet de securite, pas la premiere ligne de defense (meme principe que
// CurrentOrganizationId cote backend).

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

export function AppHeader({ locale }: { locale: string }) {
  const t = useTranslations('AppHeader');
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((session) => {
        if (!cancelled) setUser(session?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!comingSoon) return;
    const timer = setTimeout(() => setComingSoon(null), 3000);
    return () => clearTimeout(timer);
  }, [comingSoon]);

  async function handleLogout() {
    setMenuOpen(false);
    await signOut();
    router.push(`/${locale}/login`);
  }

  function showComingSoon(message: string) {
    setMenuOpen(false);
    setComingSoon(message);
  }

  return (
    <div className="ah-topbar">
      <div className="ah-brand">
        <span className="b1">Cabinet</span>
        <span className="b2">OS</span>
      </div>
      <div className="ah-spacer" />

      <div className="ah-usr">
        <button
          type="button"
          className="ah-usr-btn"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={t('menuLabel')}
        >
          <span className="av" aria-hidden>
            {user ? initials(user.name) : ''}
          </span>
        </button>

        {menuOpen && user && (
          <div className="ah-usr-menu">
            <div className="ah-usr-head">
              <div className="nm">{user.name}</div>
              <div className="em">{user.email}</div>
            </div>
            <button
              type="button"
              className="ah-usr-item"
              onClick={() => showComingSoon(t('comingSoon.profile'))}
            >
              {t('profile')}
            </button>
            <button
              type="button"
              className="ah-usr-item"
              onClick={() => showComingSoon(t('comingSoon.settings'))}
            >
              {t('settings')}
            </button>
            <button type="button" className="ah-usr-item danger" onClick={handleLogout}>
              {t('logout')}
            </button>
          </div>
        )}
      </div>

      {comingSoon && (
        <div className="ah-coming-soon" role="status">
          {comingSoon}
        </div>
      )}
    </div>
  );
}
