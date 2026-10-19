'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AdminApiError,
  fetchRegistrationRequests,
  type AdminCounts,
  type AdminFilter,
  type AdminListItem,
} from '../../lib/admin-client';
import { initials } from '../../lib/initials';
import { badgeClass, formatDate } from './admin-format';
import { useSpecialtyLabel } from './use-specialty-label';
import { AdminShell } from './admin-shell';

// BUILD-004 etape 2, EA-017 / TASK-060 : liste des demandes d'inscription -- port de la maquette
// admin-validation.html (brief §5.3). Filtres A traiter / Validees / Refusees (A traiter par
// defaut), recherche nom ou cabinet, TOUTE LA LIGNE cliquable (zone tactile mobile).
//
// Les donnees viennent de l'API de TASK-059 : filtrage, recherche (sans accents, mots dans
// n'importe quel ordre) et pagination sont faits par le serveur ; cet ecran ne refiltre rien.

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const FILTERS: AdminFilter[] = ['pending', 'validated', 'refused'];

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: AdminListItem[]; nextCursor: string | null };

export function AdminRequestsList({ locale }: { locale: string }) {
  return (
    <AdminShell locale={locale}>
      <ListScreen locale={locale} />
    </AdminShell>
  );
}

function ListScreen({ locale }: { locale: string }) {
  const t = useTranslations('Admin');
  const router = useRouter();
  const specialtyLabel = useSpecialtyLabel();

  const [filter, setFilter] = useState<AdminFilter>('pending');
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [counts, setCounts] = useState<AdminCounts | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Une reponse arrivee apres un changement de filtre ou de recherche est ignoree : l'ecran
  // n'affiche jamais le resultat d'une requete perimee.
  const requestId = useRef(0);
  const routerRef = useRef(router);
  routerRef.current = router;

  // Recherche : appliquee apres une courte pause de frappe, pas a chaque lettre.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const fetchFirstPage = useCallback(async () => {
    const mine = ++requestId.current;
    setLoad({ kind: 'loading' });
    try {
      const page = await fetchRegistrationRequests({ filter, q: query, limit: PAGE_SIZE });
      if (mine !== requestId.current) return;
      setCounts(page.counts);
      setLoad({ kind: 'ready', items: page.items, nextCursor: page.nextCursor });
    } catch (error) {
      if (mine !== requestId.current) return;
      if (error instanceof AdminApiError && error.kind === 'UNAUTHENTICATED') {
        routerRef.current.replace(`/${locale}/login`);
        return;
      }
      setLoad({ kind: 'error' });
    }
  }, [filter, query, locale]);

  useEffect(() => {
    void fetchFirstPage();
  }, [fetchFirstPage]);

  async function loadMore() {
    if (load.kind !== 'ready' || !load.nextCursor || loadingMore) return;
    const mine = requestId.current;
    setLoadingMore(true);
    try {
      const page = await fetchRegistrationRequests({
        filter,
        q: query,
        cursor: load.nextCursor,
        limit: PAGE_SIZE,
      });
      if (mine !== requestId.current) return;
      setCounts(page.counts);
      setLoad({
        kind: 'ready',
        items: [...load.items, ...page.items],
        nextCursor: page.nextCursor,
      });
    } catch {
      if (mine === requestId.current) setLoad({ kind: 'error' });
    } finally {
      setLoadingMore(false);
    }
  }

  function open(event: React.MouseEvent, id: string) {
    // Un clic simple navigue sans recharger ; un clic avec modificateur (nouvel onglet) garde le
    // comportement du navigateur grace au vrai lien.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.push(`/${locale}/admin/${id}`);
  }

  return (
    <>
      <h1>{t('title')}</h1>

      <div className="ad-toolbar">
        <div className="ad-filters" role="tablist" aria-label={t('filters.label')}>
          {FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={filter === name}
              className={`ad-chip${filter === name ? ' on' : ''}`}
              onClick={() => setFilter(name)}
            >
              {t(`filters.${name}`)}
              {name === 'pending' && counts && <span className="ad-chip-n">{counts.pending}</span>}
            </button>
          ))}
        </div>
        <div className="ad-search">
          <span className="ad-search-ic" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            aria-label={t('search.label')}
            placeholder={t('search.placeholder')}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
      </div>

      {load.kind === 'loading' && (
        <p className="ad-muted" role="status">
          {t('loading')}
        </p>
      )}

      {load.kind === 'error' && (
        <div role="alert" className="ad-error-box">
          <p>{t('list.error')}</p>
          <button
            type="button"
            className="ad-btn ad-btn-ghost"
            onClick={() => void fetchFirstPage()}
          >
            {t('retry')}
          </button>
        </div>
      )}

      {load.kind === 'ready' && load.items.length === 0 && (
        <p className="ad-empty">
          {query.trim() ? t('list.empty.search') : t(`list.empty.${filter}`)}
        </p>
      )}

      {load.kind === 'ready' && load.items.length > 0 && (
        <>
          <div className="ad-list">
            {load.items.map((item) => (
              <a
                key={item.id}
                className="ad-req"
                href={`/${locale}/admin/${item.id}`}
                onClick={(e) => open(e, item.id)}
              >
                <span className="ad-av" aria-hidden>
                  {initials(`${item.firstName} ${item.lastName}`)}
                </span>
                <span className="ad-info">
                  <span className="ad-nm">
                    {t('doctorPrefix')} {item.firstName} {item.lastName}
                  </span>
                  <span className="ad-meta">
                    {specialtyLabel(item.specialty)} · {item.structureName} · {item.city}
                  </span>
                </span>
                <span className="ad-right">
                  <span className={`ad-badge ${badgeClass(item.status)}`}>
                    {t(`status.${item.status}`)}
                  </span>
                  <span className="ad-date">{formatDate(item.createdAt, locale)}</span>
                </span>
              </a>
            ))}
          </div>
          {load.nextCursor && (
            <button
              type="button"
              className="ad-btn ad-btn-ghost ad-more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? t('loadingMore') : t('loadMore')}
            </button>
          )}
        </>
      )}
    </>
  );
}
