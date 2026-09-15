'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  fetchMyOrganizations,
  setDefaultOrganization,
  type OrganizationMembership,
} from '../../lib/identity-client';
import { initials } from '../../lib/initials';
import './settings-view.css';

// Ecran Reglages -- reglage "organisation par defaut" (ADR-0019). Reutilise
// exactement le meme mecanisme que l'ecran de choix (choose-organization-view.tsx) :
// setDefaultOrganization, deja construit et teste au commit 2. Rien de nouveau
// cote backend ici, seul cet ecran manquait pour que "modifiable a tout moment
// dans vos reglages" (spec, ecran 2) soit vrai.
//
// Important : ce reglage change l'organisation qui s'ouvrira a la PROCHAINE
// connexion -- il ne change jamais l'organisation courante de la session en
// cours (ca, c'est le role du selecteur d'organisation, commit 3). Les deux
// mecanismes sont independants, volontairement.

export function SettingsView() {
  const t = useTranslations('Settings');

  const [organizations, setOrganizations] = useState<OrganizationMembership[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyOrganizations()
      .then((data) => {
        if (!cancelled) setOrganizations(data);
      })
      .catch(() => {
        if (!cancelled) setErrorMessage(t('loadError'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function makeDefault(organizationId: string) {
    setSavingId(organizationId);
    setErrorMessage(null);
    setConfirmation(null);
    try {
      await setDefaultOrganization(organizationId);
      setOrganizations(
        (current) =>
          current?.map((m) => ({ ...m, isDefault: m.organizationId === organizationId })) ??
          current,
      );
      setConfirmation(t('savedConfirmation'));
    } catch {
      setErrorMessage(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="stv-content">
      <h1>{t('title')}</h1>
      <p className="stv-sub">{t('subtitle')}</p>

      <div className="stv-section-title">{t('sectionTitle')}</div>

      {errorMessage && (
        <div className="stv-error" role="alert">
          {errorMessage}
        </div>
      )}
      {confirmation && (
        <div className="stv-confirmation" role="status">
          {confirmation}
        </div>
      )}

      {organizations === null && !errorMessage && <p className="stv-loading">{t('loading')}</p>}

      {organizations?.map((org) => (
        <div key={org.organizationId} className="stv-org">
          <span className="mono" aria-hidden>
            {initials(org.organizationName)}
          </span>
          <span className="nm">{org.organizationName}</span>
          {organizations.length > 1 &&
            (org.isDefault ? (
              <span className="stv-current-tag">{t('currentDefault')}</span>
            ) : (
              <button
                type="button"
                className="stv-set-default-btn"
                disabled={savingId !== null}
                onClick={() => makeDefault(org.organizationId)}
              >
                {savingId === org.organizationId ? t('saving') : t('setAsDefault')}
              </button>
            ))}
        </div>
      ))}

      {organizations && organizations.length <= 1 && (
        <p className="stv-hint">{t('singleOrgHint')}</p>
      )}
    </div>
  );
}
