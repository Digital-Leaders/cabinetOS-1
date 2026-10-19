'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { signInWithEmail, AuthError } from '../../lib/auth-client';
import { fetchMyOrganizations } from '../../lib/identity-client';
import { fetchRegistrationStatus } from '../../lib/registration-status-client';
import { fetchIsPlatformAdmin } from '../../lib/admin-client';
import { needsStatusScreen, statusScreenPath } from '../../lib/registration-access';
import { resolveOrganization } from '../../lib/resolve-organization';
import { setOrganizationId } from '../../lib/session';
import './login-form.css';

// Ecran 1 (connexion) -- port fidele de docs/design/maquettes/connexion.html et de
// docs/design/parcours-acces-etape-1-spec.md. Une seule validation cote client
// (champs non vides, surlignes si manquants) : les identifiants eux-memes ne sont
// jamais valides ici, uniquement par Better-Auth cote serveur (auth-client.ts).
//
// Commit 2 (ADR-0019) : apres connexion reussie, resolution d'organisation --
// une seule -> ouverture directe (cookie pose, accueil) ; plusieurs + defaut ->
// ouverture directe du defaut ; plusieurs sans defaut -> ecran de choix (aucun
// cookie pose ici, choose-organization-view.tsx s en charge apres selection).
//
// "Mot de passe oublie" et "Creer mon cabinet" sont des reperes gardes visibles
// (decision Product Owner). "Mot de passe oublie" mene encore a une etape reportee
// (reinitialisation) : un clic affiche un message "bientot disponible". "Creer mon
// cabinet" s'active avec l'etape 2 (TASK-053) et ouvre l'inscription du fondateur --
// sans changer l'ecran, comme prevu par la spec de l'etape 1.

export function LoginForm({ locale }: { locale: string }) {
  const t = useTranslations('Login');
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: boolean; password?: boolean }>({});
  const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
  const [comingSoonMessage, setComingSoonMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const errors: { email?: boolean; password?: boolean } = {};
    if (trimmedEmail === '') errors.email = true;
    if (password === '') errors.password = true;
    setFieldErrors(errors);
    setComingSoonMessage(null);

    if (errors.email || errors.password) {
      setFormErrorMessage(null);
      return;
    }

    setFormErrorMessage(null);
    setSubmitting(true);
    try {
      await signInWithEmail(trimmedEmail, password);

      // Etape 2 (EA-016, ADR-0021 D4) : seul un compte ACTIVE -- ou sans demande (equipe,
      // demos) -- entre dans l'application. Un fondateur dont la demande est en
      // verification, en attente de complement ou refusee est conduit a son ecran de statut
      // AVANT toute resolution d'organisation (il n'en a aucune : ce n'est pas une erreur).
      // Echec ouvert : si le statut est illisible, le parcours de l'etape 1 se deroule
      // comme avant (l'API refuse de toute facon les donnees a un non-ACTIVE, TASK-056).
      const registration = await fetchRegistrationStatus().catch(() => null);
      if (needsStatusScreen(registration)) {
        router.push(statusScreenPath(locale));
        return;
      }

      const memberships = await fetchMyOrganizations();
      const resolution = resolveOrganization(memberships);
      if (resolution.type === 'direct') {
        setOrganizationId(resolution.organizationId);
        router.push(`/${locale}`);
      } else if (resolution.type === 'choose') {
        router.push(`/${locale}/choose-organization`);
      } else if (await fetchIsPlatformAdmin()) {
        // Etape 2 (EA-017, TASK-060) : un administrateur de plateforme (equipe CabinetOS) n'a
        // AUCUNE organisation -- ce n'est pas une erreur, son espace est l'administration.
        // Question posee seulement quand il n'y a aucune organisation : un compte avec au moins
        // une organisation n'est jamais concerne, son parcours reste celui de l'etape 1.
        router.push(`/${locale}/admin`);
      } else {
        // "none" : hors perimetre de l etape 1 (comptes toujours crees avec au
        // moins une adhesion) -- signale plutot qu un ecran invente sans besoin reel.
        setFormErrorMessage(t('noOrganization'));
      }
    } catch (err) {
      setFormErrorMessage(
        err instanceof AuthError ? t('invalidCredentials') : t('unexpectedError'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function showComingSoon(message: string) {
    setFormErrorMessage(null);
    setComingSoonMessage(message);
  }

  return (
    <div className="lf-shell">
      <div className="lf-card">
        <div className="lf-brand">
          <span className="b1">Cabinet</span>
          <span className="b2">OS</span>
        </div>
        <p className="lf-tagline">{t('tagline')}</p>

        {formErrorMessage && (
          <div className="lf-form-error" role="alert">
            <span aria-hidden>⚠</span>
            <span>{formErrorMessage}</span>
          </div>
        )}
        {comingSoonMessage && (
          <div className="lf-coming-soon" role="status">
            {comingSoonMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className={`lf-field${fieldErrors.email ? ' error' : ''}`}>
            <label htmlFor="lf-email">{t('emailLabel')}</label>
            <input
              type="email"
              id="lf-email"
              placeholder={t('emailPlaceholder')}
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className={`lf-field${fieldErrors.password ? ' error' : ''}`}>
            <div className="lf-pw-row">
              <label htmlFor="lf-password">{t('passwordLabel')}</label>
              <button
                type="button"
                className="lf-forgot"
                onClick={() => showComingSoon(t('comingSoon.resetPassword'))}
              >
                {t('forgotPassword')}
              </button>
            </div>
            <input
              type="password"
              id="lf-password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="lf-btn" disabled={submitting}>
            {submitting ? t('submitting') : t('submit')}
          </button>
        </form>

        <div className="lf-foot">
          {t('noAccount')}{' '}
          <button
            type="button"
            className="lf-link"
            onClick={() => router.push(`/${locale}/register`)}
          >
            {t('createCabinet')}
          </button>
        </div>
      </div>
    </div>
  );
}
