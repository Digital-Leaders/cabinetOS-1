'use client';

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  AdminActionError,
  refuseRegistrationRequest,
  requestComplement,
  resendRegistrationEmail,
  validateRegistrationRequest,
  type AdminActionErrorKind,
  type AdminRequestDetail,
  type ComplementInfoType,
  type ResendEmailKind,
} from '../../lib/admin-client';
import { AdminDialog } from './admin-dialog';
import {
  COMPLEMENT_DEFAULT_MESSAGE,
  MAX_ACTION_TEXT_LENGTH,
  MAX_OTHER_INFO_LENGTH,
  REFUSAL_DEFAULT_MESSAGE,
  normalizeForComparison,
} from './admin-action-messages';

// BUILD-004 etape 2, EA-018 / TASK-066 : les TROIS ACTIONS de l'administrateur sur une demande ouverte --
// Valider, Demander un complement, Refuser -- avec leurs fenetres de confirmation (maquette
// admin-validation.html), et le RENVOI d'un email qui n'est pas parti.
//
// Garanties de l'ecran :
//   - rien ne part sans le clic sur le bouton de confirmation de la fenetre ;
//   - un DOUBLE CLIC n'envoie qu'UNE requete (verrou synchrone, pas seulement un etat qui se met a jour apres) ;
//   - la fenetre ne se ferme pas pendant l'envoi ;
//   - une demande deja traitee par un autre administrateur (409) est expliquee et l'affichage est actualise ;
//   - une coupure reseau (resultat INCERTAIN) n'invite PAS a reessayer a l'aveugle : on relit l'etat reel ;
//   - le motif interne d'un refus n'existe que dans la fenetre de refus : il n'est jamais affiche ailleurs.

/** Ce que l'ecran de detail doit faire apres une action. */
export type ActionSettled =
  | { type: 'done'; action: 'validate' | 'complement' | 'refuse' }
  | { type: 'conflict' } // 409, ou demande disparue : relire l'etat reel
  | { type: 'uncertain' } // pas de reponse : relire l'etat reel
  | { type: 'unauthenticated' };

type Modal = null | 'validate' | 'complement' | 'refuse';

/** Verrou SYNCHRONE : un second appel dans le meme instant est ignore AVANT toute requete. */
function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AdminActionErrorKind | null>(null);
  const locked = useRef(false);

  const submit = useCallback(
    async (run: () => Promise<void>, onBubble: (kind: AdminActionErrorKind) => boolean) => {
      if (locked.current) return;
      locked.current = true;
      setPending(true);
      setError(null);
      try {
        await run();
      } catch (caught) {
        const kind = caught instanceof AdminActionError ? caught.kind : 'UNCERTAIN';
        // Les cas qui concernent l'ecran entier (deja traitee, incertain, session) remontent ; les autres
        // restent dans la fenetre, qui reste ouverte.
        if (!onBubble(kind)) setError(kind);
      } finally {
        locked.current = false;
        setPending(false);
      }
    },
    [],
  );
  return { pending, error, submit };
}

function bubbleOf(onSettled: (s: ActionSettled) => void) {
  return (kind: AdminActionErrorKind): boolean => {
    if (kind === 'CONFLICT' || kind === 'NOT_FOUND') return (onSettled({ type: 'conflict' }), true);
    if (kind === 'UNCERTAIN') return (onSettled({ type: 'uncertain' }), true);
    if (kind === 'UNAUTHENTICATED') return (onSettled({ type: 'unauthenticated' }), true);
    return false;
  };
}

export function AdminActions({
  detail,
  onSettled,
}: {
  detail: AdminRequestDetail;
  onSettled: (settled: ActionSettled) => void;
}) {
  const t = useTranslations('Admin');
  const [modal, setModal] = useState<Modal>(null);
  const close = () => setModal(null);
  const settle = (settled: ActionSettled) => {
    close();
    onSettled(settled);
  };
  const doctorName = `${detail.doctor.firstName} ${detail.doctor.lastName}`;

  return (
    <>
      <div className="ad-actions">
        <button type="button" className="ad-btn ad-btn-ok" onClick={() => setModal('validate')}>
          {t('detail.actions.validate')}
        </button>
        <button
          type="button"
          className="ad-btn ad-btn-compl"
          onClick={() => setModal('complement')}
        >
          {t('detail.actions.complement')}
        </button>
        <button type="button" className="ad-btn ad-btn-no" onClick={() => setModal('refuse')}>
          {t('detail.actions.refuse')}
        </button>
      </div>

      {modal === 'validate' && (
        <ValidateDialog
          id={detail.id}
          doctorName={doctorName}
          onCancel={close}
          onSettled={settle}
        />
      )}
      {modal === 'complement' && (
        <ComplementDialog id={detail.id} onCancel={close} onSettled={settle} />
      )}
      {modal === 'refuse' && <RefuseDialog id={detail.id} onCancel={close} onSettled={settle} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------

function DialogError({ kind }: { kind: AdminActionErrorKind | null }) {
  const t = useTranslations('Admin');
  if (!kind) return null;
  const key = kind === 'INVALID' ? 'invalid' : kind === 'FORBIDDEN' ? 'forbidden' : 'server';
  return (
    <p className="ad-dialog-error" role="alert">
      {t(`actions.errors.${key}`)}
    </p>
  );
}

function DialogFooter({
  pending,
  onCancel,
  confirmLabel,
  confirmClass,
  confirmDisabled,
}: {
  pending: boolean;
  onCancel: () => void;
  confirmLabel: string;
  confirmClass: string;
  confirmDisabled?: boolean;
}) {
  const t = useTranslations('Admin');
  return (
    <div className="ad-dialog-foot">
      <button type="button" className="ad-btn ad-btn-ghost" onClick={onCancel} disabled={pending}>
        {t('actions.cancel')}
      </button>
      <button
        type="submit"
        className={`ad-btn ${confirmClass}`}
        disabled={pending || confirmDisabled}
      >
        {pending ? t('actions.sending') : confirmLabel}
      </button>
    </div>
  );
}

function ValidateDialog({
  id,
  doctorName,
  onCancel,
  onSettled,
}: {
  id: string;
  doctorName: string;
  onCancel: () => void;
  onSettled: (s: ActionSettled) => void;
}) {
  const t = useTranslations('Admin');
  const { pending, error, submit } = useSubmit();

  return (
    <AdminDialog title={t('actions.validate.title')} onClose={onCancel} busy={pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(async () => {
            await validateRegistrationRequest(id);
            onSettled({ type: 'done', action: 'validate' });
          }, bubbleOf(onSettled));
        }}
      >
        <p className="ad-dialog-lead">{t('actions.validate.lead', { name: `Dr ${doctorName}` })}</p>
        <ul className="ad-dialog-list">
          <li>{t('actions.validate.steps.activate')}</li>
          <li>{t('actions.validate.steps.organization')}</li>
          <li>{t('actions.validate.steps.member')}</li>
          <li>{t('actions.validate.steps.doctor')}</li>
        </ul>
        <p className="ad-dialog-note">{t('actions.validate.then')}</p>
        <DialogError kind={error} />
        <DialogFooter
          pending={pending}
          onCancel={onCancel}
          confirmLabel={t('actions.validate.confirm')}
          confirmClass="ad-btn-ok-solid"
        />
      </form>
    </AdminDialog>
  );
}

const COMPLEMENT_TYPES: ComplementInfoType[] = ['google_listing', 'other_public_presence', 'other'];

function ComplementDialog({
  id,
  onCancel,
  onSettled,
}: {
  id: string;
  onCancel: () => void;
  onSettled: (s: ActionSettled) => void;
}) {
  const t = useTranslations('Admin');
  const { pending, error, submit } = useSubmit();
  const [infoType, setInfoType] = useState<ComplementInfoType>('google_listing');
  const [otherInfo, setOtherInfo] = useState('');
  const [message, setMessage] = useState(COMPLEMENT_DEFAULT_MESSAGE);
  const otherId = useId();

  const needsOther = infoType === 'other';
  const invalid =
    message.trim() === '' ||
    message.length > MAX_ACTION_TEXT_LENGTH ||
    (needsOther && otherInfo.trim() === '');

  return (
    <AdminDialog title={t('actions.complement.title')} onClose={onCancel} busy={pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid) return;
          void submit(async () => {
            await requestComplement(id, {
              infoType,
              ...(needsOther ? { otherInfo: otherInfo.trim() } : {}),
              message: message.trim(),
            });
            onSettled({ type: 'done', action: 'complement' });
          }, bubbleOf(onSettled));
        }}
      >
        <p className="ad-dialog-lead">{t('actions.complement.lead')}</p>

        <fieldset className="ad-fieldset">
          <legend>{t('actions.complement.infoLabel')}</legend>
          {COMPLEMENT_TYPES.map((type) => (
            <label key={type} className="ad-radio">
              <input
                type="radio"
                name="infoType"
                value={type}
                checked={infoType === type}
                onChange={() => setInfoType(type)}
                disabled={pending}
              />
              <span>{t(`actions.complement.types.${type}`)}</span>
            </label>
          ))}
        </fieldset>

        {needsOther && (
          <div className="ad-field">
            <label htmlFor={otherId}>{t('actions.complement.otherLabel')}</label>
            <input
              id={otherId}
              type="text"
              maxLength={MAX_OTHER_INFO_LENGTH}
              value={otherInfo}
              onChange={(e) => setOtherInfo(e.target.value)}
              disabled={pending}
              required
            />
          </div>
        )}

        <MessageField
          label={t('actions.complement.messageLabel')}
          hint={t('actions.complement.messageHint')}
          value={message}
          onChange={setMessage}
          disabled={pending}
        />
        <DialogError kind={error} />
        <DialogFooter
          pending={pending}
          onCancel={onCancel}
          confirmLabel={t('actions.complement.confirm')}
          confirmClass="ad-btn-compl-solid"
          confirmDisabled={invalid}
        />
      </form>
    </AdminDialog>
  );
}

function RefuseDialog({
  id,
  onCancel,
  onSettled,
}: {
  id: string;
  onCancel: () => void;
  onSettled: (s: ActionSettled) => void;
}) {
  const t = useTranslations('Admin');
  const { pending, error, submit } = useSubmit();
  const [internalReason, setInternalReason] = useState('');
  const [message, setMessage] = useState(REFUSAL_DEFAULT_MESSAGE);

  const sameText =
    internalReason.trim() !== '' &&
    normalizeForComparison(internalReason) === normalizeForComparison(message);
  const invalid =
    internalReason.trim() === '' ||
    message.trim() === '' ||
    internalReason.length > MAX_ACTION_TEXT_LENGTH ||
    message.length > MAX_ACTION_TEXT_LENGTH ||
    sameText;

  return (
    <AdminDialog title={t('actions.refuse.title')} onClose={onCancel} busy={pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (invalid) return;
          void submit(async () => {
            await refuseRegistrationRequest(id, {
              internalReason: internalReason.trim(),
              messageToApplicant: message.trim(),
            });
            onSettled({ type: 'done', action: 'refuse' });
          }, bubbleOf(onSettled));
        }}
      >
        <p className="ad-dialog-lead">{t('actions.refuse.lead')}</p>

        <MessageField
          label={t('actions.refuse.reasonLabel')}
          hint={t('actions.refuse.reasonHint')}
          value={internalReason}
          onChange={setInternalReason}
          disabled={pending}
          placeholder={t('actions.refuse.reasonPlaceholder')}
          internal
        />
        <MessageField
          label={t('actions.refuse.messageLabel')}
          hint={t('actions.refuse.messageHint')}
          value={message}
          onChange={setMessage}
          disabled={pending}
        />
        {sameText && (
          <p className="ad-dialog-error" role="alert">
            {t('actions.refuse.sameText')}
          </p>
        )}
        <p className="ad-dialog-note ad-dialog-warning">{t('actions.refuse.definitive')}</p>
        <DialogError kind={error} />
        <DialogFooter
          pending={pending}
          onCancel={onCancel}
          confirmLabel={t('actions.refuse.confirm')}
          confirmClass="ad-btn-no-solid"
          confirmDisabled={invalid}
        />
      </form>
    </AdminDialog>
  );
}

function MessageField({
  label,
  hint,
  value,
  onChange,
  disabled,
  placeholder,
  internal,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
  internal?: boolean;
}) {
  const fieldId = useId();
  const hintId = useId();
  return (
    <div className={`ad-field${internal ? ' ad-field-internal' : ''}`}>
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        rows={internal ? 3 : 5}
        value={value}
        placeholder={placeholder}
        maxLength={MAX_ACTION_TEXT_LENGTH}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-describedby={hintId}
        required
      />
      <p className="ad-field-hint" id={hintId}>
        {hint}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Renvoi d'un email qui n'est pas parti.

const RESEND_BY_STATUS: Partial<
  Record<AdminRequestDetail['status'], { kind: ResendEmailKind; template: string }>
> = {
  ACTIVE: { kind: 'activation', template: 'account-activation' },
  COMPLEMENT_REQUESTED: { kind: 'complement', template: 'verification-complement' },
  REFUSED: { kind: 'refusal', template: 'registration-refusal' },
};

/**
 * Avertissement + renvoi, DERIVE DE L'HISTORIQUE : si le dernier email de la demande est un echec, l'action reste
 * acquise mais le medecin n'a pas recu son email. Etant derive de l'historique (et non d'un etat transitoire), il
 * persiste apres actualisation et disparait des qu'un envoi reussit. Ne concerne que l'email attendu pour le
 * statut courant (jamais l'email de confirmation d'inscription).
 */
export function EmailRetryNotice({
  detail,
  onChanged,
}: {
  detail: AdminRequestDetail;
  onChanged: (outcome: 'resent' | 'conflict') => void;
}) {
  const t = useTranslations('Admin');
  const [state, setState] = useState<'idle' | 'sending' | 'tooSoon' | 'failed'>('idle');
  const locked = useRef(false);

  const expected = RESEND_BY_STATUS[detail.status];
  const lastEmail = [...detail.history]
    .reverse()
    .find((entry) => entry.action === 'EMAIL_SENT' || entry.action === 'EMAIL_FAILED');
  if (!expected || !lastEmail) return null;
  if (lastEmail.action !== 'EMAIL_FAILED' || lastEmail.emailTemplate !== expected.template)
    return null;

  async function resend() {
    if (locked.current || !expected) return;
    locked.current = true;
    setState('sending');
    try {
      const { sent } = await resendRegistrationEmail(detail.id, expected.kind);
      if (sent) {
        onChanged('resent');
      } else {
        setState('failed');
      }
    } catch (caught) {
      const kind = caught instanceof AdminActionError ? caught.kind : 'UNCERTAIN';
      if (kind === 'TOO_SOON') setState('tooSoon');
      else if (kind === 'CONFLICT' || kind === 'NOT_FOUND') onChanged('conflict');
      else setState('failed');
    } finally {
      locked.current = false;
    }
  }

  return (
    <div className="ad-notice ad-notice-warn" role="alert">
      <p>{t(`actions.emailRetry.message.${expected.kind}`)}</p>
      <button
        type="button"
        className="ad-btn ad-btn-ghost"
        onClick={() => void resend()}
        disabled={state === 'sending'}
      >
        {state === 'sending' ? t('actions.sending') : t('actions.emailRetry.button')}
      </button>
      {state === 'tooSoon' && <p className="ad-notice-sub">{t('actions.emailRetry.tooSoon')}</p>}
      {state === 'failed' && <p className="ad-notice-sub">{t('actions.emailRetry.failed')}</p>}
    </div>
  );
}

/** Bandeau de resultat d'une action (succes, deja traitee, resultat incertain). */
export function ActionNotice({
  notice,
}: {
  notice: { tone: 'success' | 'warn'; text: ReactNode } | null;
}) {
  if (!notice) return null;
  return (
    <div
      className={`ad-notice ${notice.tone === 'success' ? 'ad-notice-ok' : 'ad-notice-warn'}`}
      role={notice.tone === 'success' ? 'status' : 'alert'}
    >
      <p>{notice.text}</p>
    </div>
  );
}
