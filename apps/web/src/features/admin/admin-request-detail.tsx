'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AdminApiError,
  fetchRegistrationRequestDetail,
  saveInternalNote,
  type AdminHistoryEntry,
  type AdminRequestDetail,
} from '../../lib/admin-client';
import {
  badgeClass,
  buildSearchShortcuts,
  formatDate,
  formatDayMonth,
  isOpenStatus,
} from './admin-format';
import { useSpecialtyLabel } from './use-specialty-label';
import { AdminShell } from './admin-shell';

// BUILD-004 etape 2, EA-017 / TASK-060 : detail d'une demande -- port de la maquette
// admin-validation.html (brief §5.4).
//
// LECTURE SEULE : l'equipe examine une declaration, elle ne la reecrit pas. Aucun champ declare
// n'est modifiable ici (et l'API n'a aucune route pour le faire, TASK-059). La note interne est la
// seule chose enregistrable.
//
// Les trois actions (Valider, Demander un complement, Refuser) sont AFFICHEES mais inertes : leurs
// fenetres et leur logique arrivent avec EA-018. Elles n'apparaissent que sur une demande encore
// ouverte -- jamais sur une demande validee ou refusee.

type Load =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'error' }
  | { kind: 'ready'; detail: AdminRequestDetail };

export function AdminRequestDetailScreen({ locale, id }: { locale: string; id: string }) {
  return (
    <AdminShell locale={locale}>
      <DetailScreen locale={locale} id={id} />
    </AdminShell>
  );
}

function DetailScreen({ locale, id }: { locale: string; id: string }) {
  const t = useTranslations('Admin');
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const routerRef = useRef(router);
  routerRef.current = router;

  const fetchDetail = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      setLoad({ kind: 'ready', detail: await fetchRegistrationRequestDetail(id) });
    } catch (error) {
      const kind = error instanceof AdminApiError ? error.kind : 'UNEXPECTED';
      if (kind === 'UNAUTHENTICATED') routerRef.current.replace(`/${locale}/login`);
      else if (kind === 'NOT_FOUND') setLoad({ kind: 'notFound' });
      else setLoad({ kind: 'error' });
    }
  }, [id, locale]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  const back = (
    <a
      className="ad-backlink"
      href={`/${locale}/admin`}
      onClick={(e) => {
        e.preventDefault();
        router.push(`/${locale}/admin`);
      }}
    >
      <span aria-hidden>‹</span> {t('back')}
    </a>
  );

  if (load.kind === 'loading') {
    return (
      <>
        {back}
        <p className="ad-muted" role="status">
          {t('loading')}
        </p>
      </>
    );
  }

  if (load.kind === 'notFound' || load.kind === 'error') {
    return (
      <>
        {back}
        <div role="alert" className="ad-error-box">
          <p>{load.kind === 'notFound' ? t('detail.notFound') : t('detail.error')}</p>
          {load.kind === 'error' && (
            <button
              type="button"
              className="ad-btn ad-btn-ghost"
              onClick={() => void fetchDetail()}
            >
              {t('retry')}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {back}
      <DetailBody detail={load.detail} locale={locale} />
    </>
  );
}

function DetailBody({ detail, locale }: { detail: AdminRequestDetail; locale: string }) {
  const t = useTranslations('Admin');
  const specialtyLabel = useSpecialtyLabel();
  const specialty = specialtyLabel(detail.doctor.specialty);
  const shortcuts = buildSearchShortcuts(detail, specialty, t('detail.verify.directoryWord'));

  return (
    <>
      <section className="ad-dhead">
        <div className="ad-dhead-nm">
          {t('doctorPrefix')} {detail.doctor.firstName} {detail.doctor.lastName}
        </div>
        <div className="ad-dhead-sp">{specialty}</div>
        <div className="ad-dhead-st">
          <span className={`ad-badge ${badgeClass(detail.status)}`}>
            {t(`status.${detail.status}`)}
          </span>
          <span className="ad-recu">
            {t('detail.received', { date: formatDate(detail.createdAt, locale) })}
          </span>
        </div>
      </section>

      <div className="ad-dgrid">
        <Card title={t('detail.doctor')}>
          <Row label={t('detail.fields.firstName')} value={detail.doctor.firstName} />
          <Row label={t('detail.fields.lastName')} value={detail.doctor.lastName} />
          <Row label={t('detail.fields.email')} value={detail.doctor.email} ltr />
          <Row label={t('detail.fields.specialty')} value={specialty} />
          <Row label={t('detail.fields.inpe')} value={detail.doctor.inpe} ltr />
          <Row label={t('detail.fields.numeroOrdre')} value={detail.doctor.numeroOrdre} ltr />
        </Card>
        <Card title={t('detail.structure')}>
          <Row label={t('detail.fields.structureName')} value={detail.structure.name} />
          <Row label={t('detail.fields.city')} value={detail.structure.city} />
          <Row label={t('detail.fields.address')} value={detail.structure.address} />
        </Card>
      </div>

      {detail.complement && (
        <Card title={t('detail.complement.title')} wide>
          <Row
            label={t('detail.complement.info')}
            value={detail.complement.requestedInfo}
            wideLabel
          />
          <Row
            label={t('detail.complement.message')}
            value={detail.complement.message}
            wideLabel
            pre
          />
        </Card>
      )}

      {detail.refusal && (
        <Card title={t('detail.refusal.title')} wide>
          <Row
            label={t('detail.refusal.internalReason')}
            value={detail.refusal.internalReason}
            wideLabel
            pre
          />
          <Row
            label={t('detail.refusal.message')}
            value={detail.refusal.messageToApplicant}
            wideLabel
            pre
          />
        </Card>
      )}

      <section className="ad-card ad-shortcuts">
        <h2>{t('detail.verify.title')}</h2>
        <p className="ad-card-note">{t('detail.verify.note')}</p>
        <div className="ad-sclinks">
          <a href={shortcuts.google} target="_blank" rel="noopener noreferrer">
            <span aria-hidden>🔎</span> {t('detail.verify.google')}
          </a>
          <a href={shortcuts.maps} target="_blank" rel="noopener noreferrer">
            <span aria-hidden>📍</span> {t('detail.verify.maps')}
          </a>
          <a href={shortcuts.directory} target="_blank" rel="noopener noreferrer">
            <span aria-hidden>📖</span> {t('detail.verify.directory')}
          </a>
        </div>
      </section>

      <InternalNote id={detail.id} initial={detail.internalNote} />

      <History entries={detail.history} locale={locale} />

      {isOpenStatus(detail.status) && (
        <div>
          <div className="ad-actions">
            <button type="button" className="ad-btn ad-btn-ok" disabled>
              {t('detail.actions.validate')}
            </button>
            <button type="button" className="ad-btn ad-btn-compl" disabled>
              {t('detail.actions.complement')}
            </button>
            <button type="button" className="ad-btn ad-btn-no" disabled>
              {t('detail.actions.refuse')}
            </button>
          </div>
          <p className="ad-card-note ad-actions-note">{t('detail.actions.soon')}</p>
        </div>
      )}
    </>
  );
}

function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`ad-card${wide ? ' ad-card-wide' : ''}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  ltr,
  wideLabel,
  pre,
}: {
  label: string;
  value: string | null | undefined;
  ltr?: boolean;
  wideLabel?: boolean;
  pre?: boolean;
}) {
  const t = useTranslations('Admin');
  const empty = !value;
  return (
    <div className={`ad-kv${wideLabel ? ' ad-kv-stack' : ''}`}>
      <span className="ad-k">{label}</span>
      <span
        className={`ad-v${empty ? ' empty' : ''}${pre ? ' ad-pre' : ''}`}
        dir={ltr && !empty ? 'ltr' : undefined}
      >
        {empty ? t('notSpecified') : value}
      </span>
    </div>
  );
}

type NoteState = 'idle' | 'saving' | 'saved' | 'error';

function InternalNote({ id, initial }: { id: string; initial: string | null }) {
  const t = useTranslations('Admin');
  const [saved, setSaved] = useState(initial ?? '');
  const [value, setValue] = useState(initial ?? '');
  const [state, setState] = useState<NoteState>('idle');

  const changed = value.trim() !== saved.trim();

  async function save() {
    setState('saving');
    try {
      const result = await saveInternalNote(id, value);
      const next = result.internalNote ?? '';
      setSaved(next);
      setValue(next);
      setState('saved');
    } catch {
      setState('error');
    }
  }

  return (
    <section className="ad-card ad-notebox">
      <h2>{t('detail.note.title')}</h2>
      <p className="ad-card-note">{t('detail.note.sub')}</p>
      <textarea
        aria-label={t('detail.note.label')}
        value={value}
        maxLength={2000}
        onChange={(e) => {
          setValue(e.target.value);
          if (state !== 'saving') setState('idle');
        }}
      />
      <div className="ad-note-bar">
        <button
          type="button"
          className="ad-btn ad-btn-ghost"
          onClick={() => void save()}
          disabled={!changed || state === 'saving'}
        >
          {state === 'saving' ? t('detail.note.saving') : t('detail.note.save')}
        </button>
        {state === 'saved' && (
          <span className="ad-saved" role="status">
            {t('detail.note.saved')}
          </span>
        )}
        {state === 'error' && (
          <span className="ad-note-error" role="alert">
            {t('detail.note.error')}
          </span>
        )}
      </div>
    </section>
  );
}

function History({ entries, locale }: { entries: AdminHistoryEntry[]; locale: string }) {
  const t = useTranslations('Admin');

  function label(entry: AdminHistoryEntry): string {
    const template = entry.emailTemplate;
    let text: string;
    if (entry.action === 'EMAIL_SENT' && template) {
      text = t(`detail.history.emailSent.${template}`);
    } else if (entry.action === 'EMAIL_FAILED' && template) {
      text = t(`detail.history.emailFailed.${template}`);
      if (entry.emailFailureRetryable) text += ` (${t('detail.history.retryable')})`;
    } else if (entry.action === 'EMAIL_RESEND_REQUESTED' && template) {
      text = t(`detail.history.emailResend.${template}`);
    } else {
      text =
        entry.action in ACTION_KEYS
          ? t(`detail.history.actions.${entry.action}`)
          : t('detail.history.unknown');
    }
    return entry.actor ? `${text} — ${t('detail.history.by', { name: entry.actor.name })}` : text;
  }

  return (
    <section className="ad-card ad-timeline">
      <h2>{t('detail.history.title')}</h2>
      {entries.map((entry) => (
        <div className="ad-tl-item" key={entry.id}>
          <span className="ad-tl-d" title={formatDate(entry.createdAt, locale)}>
            {formatDayMonth(entry.createdAt, locale)}
          </span>
          <span className="ad-tl-e">{label(entry)}</span>
        </div>
      ))}
    </section>
  );
}

const ACTION_KEYS: Record<string, true> = {
  REQUEST_SUBMITTED: true,
  COMPLEMENT_REQUESTED: true,
  RETURNED_TO_VERIFICATION: true,
  VALIDATED: true,
  REFUSED: true,
};
