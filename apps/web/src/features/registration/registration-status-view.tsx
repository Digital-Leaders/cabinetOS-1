'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { signOut } from '../../lib/auth-client';
import {
  fetchRegistrationStatus,
  resendComplementEmail,
  type RegistrationStatusView as StatusData,
} from '../../lib/registration-status-client';
import { needsStatusScreen } from '../../lib/registration-access';
import { getSupportContacts } from './support-contacts';
import './registration-status-view.css';

// TASK-055 (BUILD-004 etape 2, EA-015) : ecran de statut du fondateur -- port de la
// maquette statut-attente.html (brief §5.2). Page pleine, sans navigation CabinetOS : le
// fondateur est authentifie mais pas encore autorise a entrer.
//
// La variante affichee est DETERMINEE PAR LE STATUT REEL, lu sur le serveur (TASK-054),
// jamais par un choix de l'utilisateur : les onglets de la maquette n'existent pas ici.
//   PENDING_VERIFICATION -> « en cours de verification »
//   COMPLEMENT_REQUESTED -> « complement necessaire » + « Renvoyer l'email » (anti-abus)
//   REFUSED              -> message au demandeur (brief §3 et §8 ; pas de maquette dediee)
//   ACTIVE ou sans demande -> rien a montrer ici : on entre dans l'application.
//
// Email masque : diagnostic seulement, jamais modifiable ici (securite, §5.2).

type LoadState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: StatusData };

type ResendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; until: number }
  | { kind: 'failed'; until: number }
  | { kind: 'unexpected' };

export function RegistrationStatusScreen({ locale }: { locale: string }) {
  const t = useTranslations('RegistrationStatus');
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  // Le statut est lu une fois a l'ouverture (puis sur « Reessayer » ou changement de
  // statut) -- jamais a chaque rendu. Le routeur est garde dans une ref : le chargement ne
  // depend pas de son identite, qui n'est pas garantie stable d'un rendu a l'autre.
  const routerRef = useRef(router);
  routerRef.current = router;

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const data = await fetchRegistrationStatus();
      if (!needsStatusScreen(data)) {
        routerRef.current.replace(`/${locale}`);
        return;
      }
      setState({ kind: 'ready', data });
    } catch {
      setState({ kind: 'error' });
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLogout() {
    await signOut();
    router.push(`/${locale}/login`);
  }

  if (state.kind === 'loading') {
    return (
      <Shell>
        <p className="rs-body" role="status">
          {t('loading')}
        </p>
      </Shell>
    );
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <p className="rs-body" role="alert">
          {t('loadError')}
        </p>
        <button type="button" className="rs-btn rs-btn-ghost" onClick={() => void load()}>
          {t('retry')}
        </button>
        <Logout onLogout={handleLogout} label={t('logout')} />
      </Shell>
    );
  }

  const { data } = state;
  return (
    <Shell>
      {data.status === 'PENDING_VERIFICATION' && <Verification data={data} />}
      {data.status === 'COMPLEMENT_REQUESTED' && (
        <Complement data={data} onStatusChanged={() => void load()} />
      )}
      {data.status === 'REFUSED' && <Refused data={data} />}
      <Help />
      <Logout onLogout={handleLogout} label={t('logout')} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rs-shell">
      <div className="rs-card">
        <div className="rs-brand">
          <span className="b1">Cabinet</span>
          <span className="b2">OS</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmailTo({ maskedEmail }: { maskedEmail?: string }) {
  const t = useTranslations('RegistrationStatus');
  if (!maskedEmail) return null;
  return (
    <p className="rs-emailto">
      {t('emailSentTo')}{' '}
      <b dir="ltr" data-testid="masked-email">
        {maskedEmail}
      </b>
    </p>
  );
}

function Verification({ data }: { data: StatusData }) {
  const t = useTranslations('RegistrationStatus');
  return (
    <>
      <div className="rs-icn rs-icn-verif" aria-hidden>
        ◷
      </div>
      <h1>{t('verification.title')}</h1>
      <p className="rs-body">{t('verification.body')}</p>
      <div className="rs-nothing">{t('verification.nothingToDo')}</div>
      <p className="rs-body">{t('verification.emailNotice')}</p>
      <EmailTo maskedEmail={data.maskedEmail} />
    </>
  );
}

function Complement({ data, onStatusChanged }: { data: StatusData; onStatusChanged: () => void }) {
  const t = useTranslations('RegistrationStatus');
  const [resend, setResend] = useState<ResendState>(() => initialResendState(data));
  const [now, setNow] = useState(() => Date.now());

  // Le bouton se reactive de lui-meme a la fin du delai anti-abus.
  useEffect(() => {
    if (resend.kind !== 'sent' && resend.kind !== 'failed') return;
    const remaining = resend.until - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => clearTimeout(timer);
  }, [resend]);

  const locked = (resend.kind === 'sent' || resend.kind === 'failed') && resend.until > now;

  async function handleResend() {
    setResend({ kind: 'sending' });
    const result = await resendComplementEmail();
    setNow(Date.now());
    if (result.kind === 'SENT') {
      setResend({ kind: 'sent', until: Date.parse(result.nextResendAllowedAt) });
    } else if (result.kind === 'SEND_FAILED') {
      setResend({ kind: 'failed', until: Date.parse(result.nextResendAllowedAt) });
    } else if (result.kind === 'TOO_SOON') {
      // Un renvoi vient d'avoir lieu (autre onglet, double clic) : on relit le statut,
      // qui donne l'heure exacte de reactivation.
      onStatusChanged();
    } else if (result.kind === 'STATUS_CHANGED') {
      onStatusChanged();
    } else {
      setResend({ kind: 'unexpected' });
    }
  }

  return (
    <>
      <div className="rs-icn rs-icn-compl" aria-hidden>
        ✉
      </div>
      <h1>{t('complement.title')}</h1>
      <p className="rs-body">{t('complement.body')}</p>
      <p className="rs-body">
        <strong>{t('complement.replyStrong')}</strong> {t('complement.replyRest')}
      </p>
      <EmailTo maskedEmail={data.maskedEmail} />
      <button
        type="button"
        className={`rs-btn rs-btn-ghost${locked && resend.kind === 'sent' ? ' rs-btn-done' : ''}`}
        onClick={() => void handleResend()}
        disabled={locked || resend.kind === 'sending'}
      >
        {locked && resend.kind === 'sent'
          ? t('complement.resent')
          : resend.kind === 'sending'
            ? t('complement.resending')
            : t('complement.resend')}
      </button>
      {resend.kind === 'failed' && (
        <p className="rs-error" role="alert">
          {t('complement.resendFailed')}
        </p>
      )}
      {resend.kind === 'unexpected' && (
        <p className="rs-error" role="alert">
          {t('complement.resendUnexpected')}
        </p>
      )}
      <p className="rs-spam">{t('complement.spam')}</p>
    </>
  );
}

function initialResendState(data: StatusData): ResendState {
  const until = data.nextResendAllowedAt ? Date.parse(data.nextResendAllowedAt) : 0;
  return until > Date.now() ? { kind: 'sent', until } : { kind: 'idle' };
}

function Refused({ data }: { data: StatusData }) {
  const t = useTranslations('RegistrationStatus');
  return (
    <>
      <div className="rs-icn rs-icn-verif" aria-hidden>
        ✉
      </div>
      <h1>{t('refused.title')}</h1>
      {/* Uniquement le message destine au demandeur (R8) : c'est tout ce que le serveur
          renvoie sur ce chemin, le motif interne n'y est jamais lu. */}
      {data.refusalMessage && <p className="rs-body rs-message">{data.refusalMessage}</p>}
      <p className="rs-body">{t('refused.contact')}</p>
    </>
  );
}

function Help() {
  const t = useTranslations('RegistrationStatus');
  const { whatsappUrl, phoneUrl } = getSupportContacts();
  if (!whatsappUrl && !phoneUrl) return null;
  return (
    <div className="rs-help">
      <div className="rs-help-lab">{t('help.title')}</div>
      <div className="rs-contacts">
        {whatsappUrl && (
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            {t('help.whatsapp')}
          </a>
        )}
        {phoneUrl && <a href={phoneUrl}>{t('help.phone')}</a>}
      </div>
    </div>
  );
}

function Logout({ onLogout, label }: { onLogout: () => void; label: string }) {
  return (
    <div className="rs-logout">
      <button type="button" className="rs-link" onClick={onLogout}>
        {label}
      </button>
    </div>
  );
}
