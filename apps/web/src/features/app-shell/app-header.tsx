'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getSession, signOut, type AuthUser } from '../../lib/auth-client';
import { fetchMyOrganizations, type OrganizationMembership } from '../../lib/identity-client';
import { getOrganizationId, setOrganizationId } from '../../lib/session';
import { hardNavigate } from '../../lib/navigation';
import './app-header.css';

// Header applicatif -- port fidele de docs/design/maquettes/changement-organisation.html :
// menu utilisateur (commit 1) + selecteur d'organisation (commit 3, ce lot).
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
//
// Point de vigilance securite de la spec : basculer d'organisation doit re-scoper
// PROPREMENT tout le contexte, jamais un reliquat de l'ancienne organisation. Ce
// composant ne fait aucune hypothese sur ce que chaque ecran a en cache -- il
// force un rechargement complet du document (window.location.href) apres avoir
// pose le nouveau cookie, plutot qu'une navigation cote client (router.push).
// Un rechargement complet remonte tous les composants a zero et refait tous les
// appels API sous le nouveau contexte : aucune donnee de l'ancienne organisation
// ne peut survivre dans un etat React quelconque. La preuve que l'API elle-meme
// isole correctement (jamais de reliquat cote serveur) est testee independamment
// (tests/isolation/organization-switch-isolation.spec.ts).

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

export function AppHeader({
  locale,
  breadcrumb,
}: {
  locale: string;
  breadcrumb?: React.ReactNode;
}) {
  const t = useTranslations('AppHeader');
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationMembership[] | null>(null);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  const orgRef = useRef<HTMLDivElement>(null);
  const usrRef = useRef<HTMLDivElement>(null);

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
    let cancelled = false;
    setCurrentOrgId(getOrganizationId());
    fetchMyOrganizations()
      .then((data) => {
        if (!cancelled) setOrganizations(data);
      })
      .catch(() => {
        if (!cancelled) setOrganizations(null);
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

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (orgRef.current && !orgRef.current.contains(target)) setOrgMenuOpen(false);
      if (usrRef.current && !usrRef.current.contains(target)) setMenuOpen(false);
    }
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  async function handleLogout() {
    setMenuOpen(false);
    await signOut();
    router.push(`/${locale}/login`);
  }

  function showComingSoon(message: string) {
    setMenuOpen(false);
    setComingSoon(message);
  }

  function switchOrganization(organizationId: string) {
    setOrgMenuOpen(false);
    if (organizationId === currentOrgId) {
      return;
    }
    setSwitching(true);
    setOrganizationId(organizationId);
    // Rechargement complet, volontairement pas une navigation client (router.push) --
    // voir le commentaire en tete de fichier : aucun etat React ne doit survivre a
    // la bascule d'organisation.
    hardNavigate(`/${locale}`);
  }

  const currentOrg = organizations?.find((o) => o.organizationId === currentOrgId) ?? null;

  return (
    <div className="ah-topbar">
      <div className="ah-brand">
        <span className="b1">Cabinet</span>
        <span className="b2">OS</span>
      </div>
      <div className="ah-divider" />

      <div className="ah-orgsw" ref={orgRef}>
        <button
          type="button"
          className={`ah-orgsw-btn${orgMenuOpen ? ' open' : ''}`}
          onClick={() => {
            setOrgMenuOpen((open) => !open);
            setMenuOpen(false);
          }}
          disabled={switching}
        >
          <span className="mono" aria-hidden>
            {currentOrg ? initials(currentOrg.organizationName) : ''}
          </span>
          <span className="cur">
            <span className="lab">{t('organizationLabel')}</span>
            <span className="nm">{currentOrg?.organizationName ?? ''}</span>
          </span>
          <span className="chev" aria-hidden>
            ▼
          </span>
        </button>

        {orgMenuOpen && organizations && organizations.length > 0 && (
          <div className="ah-orgsw-menu">
            <div className="mtitle">{t('switchOrganization')}</div>
            {organizations.map((org) => (
              <button
                key={org.organizationId}
                type="button"
                className={`ah-orgitem${org.organizationId === currentOrgId ? ' active' : ''}`}
                disabled={switching}
                onClick={() => switchOrganization(org.organizationId)}
              >
                <span className="mono" aria-hidden>
                  {initials(org.organizationName)}
                </span>
                <span className="nm">{org.organizationName}</span>
                {org.organizationId === currentOrgId && (
                  <span className="check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {breadcrumb && <div className="cos-crumb">{breadcrumb}</div>}

      <div className="ah-spacer" />

      <div className="ah-usr" ref={usrRef}>
        <button
          type="button"
          className="ah-usr-btn"
          onClick={() => {
            setMenuOpen((open) => !open);
            setOrgMenuOpen(false);
          }}
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
