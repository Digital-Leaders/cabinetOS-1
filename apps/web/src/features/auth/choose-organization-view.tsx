'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  fetchMyOrganizations,
  setDefaultOrganization,
  type OrganizationMembership,
} from '../../lib/identity-client';
import { setOrganizationId } from '../../lib/session';
import './choose-organization-view.css';

// Ecran 2 (choix d'organisation) -- port fidele de
// docs/design/maquettes/choix-organisation.html. N est atteint que dans le cas 3
// de la resolution (plusieurs organisations, aucun defaut -- resolve-organization.ts) :
// jamais affiche quand il n y a rien a choisir.
//
// La case "Ouvrir directement l'organisation choisie a l'avenir" appelle
// setDefaultOrganization AVANT de rediriger, seulement si cochee -- sinon aucun
// defaut n est pose, l utilisateur repassera par cet ecran a sa prochaine connexion.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function ChooseOrganizationView({ locale }: { locale: string }) {
  const t = useTranslations('ChooseOrganization');
  const router = useRouter();

  const [memberships, setMemberships] = useState<OrganizationMembership[] | null>(null);
  const [rememberChoice, setRememberChoice] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyOrganizations()
      .then((data) => {
        if (!cancelled) setMemberships(data);
      })
      .catch(() => {
        // t() capture la traduction courante au moment de l echec, pas besoin de
        // dependre de t dans le tableau de dependances -- une fonction de
        // traduction qui changerait de reference entre rendus ne doit jamais
        // redeclencher cette recuperation (meme principe que le useEffect de
        // AppHeader, deps vides).
        if (!cancelled) setErrorMessage(t('loadError'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(organizationId: string) {
    setPicking(organizationId);
    setErrorMessage(null);
    try {
      if (rememberChoice) {
        await setDefaultOrganization(organizationId);
      }
      setOrganizationId(organizationId);
      router.push(`/${locale}`);
    } catch {
      setErrorMessage(t('pickError'));
      setPicking(null);
    }
  }

  return (
    <div className="co-shell">
      <div className="co-card">
        <div className="co-brand">
          <span className="b1">Cabinet</span>
          <span className="b2">OS</span>
        </div>
        <h1>{t('title')}</h1>
        <p className="co-sub">{t('subtitle')}</p>

        {errorMessage && (
          <div className="co-error" role="alert">
            {errorMessage}
          </div>
        )}

        {memberships === null && !errorMessage && <p className="co-loading">{t('loading')}</p>}

        {memberships?.map((m) => (
          <button
            key={m.organizationId}
            type="button"
            className="co-org"
            disabled={picking !== null}
            onClick={() => pick(m.organizationId)}
          >
            <span className="mono" aria-hidden>
              {initials(m.organizationName)}
            </span>
            <span className="name">{m.organizationName}</span>
            {m.isDefault && <span className="default-tag">{t('defaultTag')}</span>}
            <span className="go" aria-hidden>
              ›
            </span>
          </button>
        ))}

        {memberships && memberships.length > 0 && (
          <div className="co-default-row">
            <input
              type="checkbox"
              id="co-setdef"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
            />
            <label htmlFor="co-setdef">
              {t('rememberChoice')}
              <span className="hint">{t('rememberChoiceHint')}</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
