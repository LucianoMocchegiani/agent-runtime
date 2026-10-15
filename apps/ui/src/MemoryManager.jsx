import { useCallback, useEffect, useRef, useState } from 'react';
import client from './client.js';

const emptyDraft = { preference: '', activationCondition: '', category: '' };

export default function MemoryManager({ onBack }) {
  const [items, setItems] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const memoryPageRef = useRef(null);
  const paginationSentinelRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const generationRef = useRef(0);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const loadPreferences = useCallback(async (isActive = () => true) => {
    const generation = ++generationRef.current;
    setLoadState('loading');
    setLoadError('');
    setLoadMoreError('');
    setItems([]);
    setHasMore(false);
    setNextCursor(null);
    loadingMoreRef.current = false;
    setLoadingMore(false);
    try {
      const page = await client.preferences.listPage({ limit: 20 });
      if (!isActive() || generationRef.current !== generation) return;
      setItems(page.items);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      setLoadState('ready');
    } catch (loadFailure) {
      if (!isActive() || generationRef.current !== generation) return;
      setLoadError(loadFailure.message || 'No se pudieron cargar las preferencias.');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadPreferences(() => active);
    return () => {
      active = false;
      generationRef.current++;
    };
  }, [loadPreferences, reloadKey]);

  const loadMorePreferences = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !nextCursor) return;
    const generation = generationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await client.preferences.listPage({ limit: 20, cursor: nextCursor });
      if (generationRef.current !== generation) return;
      setItems(current => {
        const merged = new Map(current.map(item => [item.id, item]));
        for (const item of page.items) merged.set(item.id, item);
        return [...merged.values()];
      });
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (loadFailure) {
      if (generationRef.current === generation) setLoadMoreError(loadFailure.message || 'No se pudieron cargar más preferencias.');
    } finally {
      if (generationRef.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore, nextCursor]);

  useEffect(() => {
    const sentinel = paginationSentinelRef.current;
    const root = memoryPageRef.current;
    if (!sentinel || !root || !hasMore || loadState !== 'ready' || loadMoreError) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMorePreferences();
    }, { root, rootMargin: '160px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadState, loadMoreError, loadMorePreferences]);

  function startEdit(item) {
    setEditingId(item.id);
    setDraft({
      preference: item.preference,
      activationCondition: item.activationCondition,
      category: item.category ?? '',
    });
    setError('');
    setNotice('');
  }

  function resetForm() {
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    const originalId = editingId;
    try {
      const saved = await client.preferences.save({
        preference: draft.preference.trim(),
        activationCondition: draft.activationCondition.trim(),
        category: draft.category.trim() || null,
      });
      let originalDeleted = false;
      if (originalId) {
        try {
          await client.preferences.delete(originalId);
          originalDeleted = true;
        } catch (deleteFailure) {
          setError(deleteFailure.message || 'No se pudo borrar la versión anterior.');
        }
      }
      setItems(current => [saved, ...current.filter(item => item.id !== saved.id && !(originalDeleted && item.id === originalId))]);
      setLoadState('ready');
      resetForm();
      setNotice(originalId && !originalDeleted
        ? 'La nueva versión se guardó, pero no se pudo borrar la anterior. Ambas quedaron en la lista; podés borrar la anterior desde ahí.'
        : originalId ? 'Preferencia actualizada.' : 'Preferencia guardada.');
    } catch (saveFailure) {
      setError(saveFailure.message || 'No se pudo guardar la preferencia.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`¿Borrar esta preferencia?\n\n“${item.preference}”`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await client.preferences.delete(item.id);
      setItems(current => current.filter(preference => preference.id !== item.id));
      if (editingId === item.id) resetForm();
      setNotice('Preferencia borrada. Las conversaciones y los resúmenes no se modificaron.');
    } catch (deleteFailure) {
      setError(deleteFailure.message || 'No se pudo borrar la preferencia.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="memory-page" ref={memoryPageRef}>
      <header className="memory-header">
        <div>
          <p className="memory-eyebrow">MEMORIA</p>
          <h1>Preferencias guardadas</h1>
          <p className="memory-intro">Revisá qué preferencias persistentes usa el agente, cuándo se aplican y borrá las que ya no correspondan.</p>
        </div>
        <button type="button" className="admin-secondary" onClick={onBack}>Volver al chat</button>
      </header>

      <section className="memory-explainer" aria-label="Qué datos persisten">
        <h2>Qué se guarda</h2>
        <ul>
          <li>Las preferencias de esta pantalla se guardan para tu identidad de sesión o cuenta y pueden recuperarse para orientar respuestas cuando se cumple la condición indicada.</li>
          <li>Las conversaciones, sus mensajes y los resúmenes también persisten, pero se administran por separado. Borrar una preferencia no borra esos datos.</li>
        </ul>
      </section>

      <div className="memory-columns">
        <section className="memory-card" aria-labelledby="memory-preferences-title">
          <div className="memory-section-heading">
            <h2 id="memory-preferences-title">Tus preferencias</h2>
            <button type="button" className="admin-secondary" onClick={() => setReloadKey(key => key + 1)} disabled={loadState === 'loading'}>Actualizar</button>
          </div>
          {loadState === 'loading' && <p className="memory-state" role="status">Cargando preferencias…</p>}
          {loadState === 'error' && <div className="memory-error" role="alert">{loadError}<button type="button" className="admin-secondary" onClick={() => setReloadKey(key => key + 1)}>Reintentar</button></div>}
          {loadState === 'ready' && items.length === 0 && <p className="memory-state">Todavía no hay preferencias guardadas.</p>}
          {loadState === 'ready' && items.length > 0 && <ul className="memory-list">
            {items.map(item => <li key={item.id} className="memory-item">
              <div className="memory-item-content">
                <h3>{item.preference}</h3>
                <p><strong>Se aplica cuando:</strong> {item.activationCondition}</p>
                {item.category && <span className="memory-category">{item.category}</span>}
              </div>
              <div className="memory-item-actions">
                <button type="button" className="admin-secondary" onClick={() => startEdit(item)} disabled={busy}>Editar</button>
                <button type="button" className="memory-delete" onClick={() => handleDelete(item)} disabled={busy}>Borrar</button>
              </div>
            </li>)}
          </ul>}
          {loadState === 'ready' && items.length > 0 && <div ref={paginationSentinelRef} className="pagination-sentinel" aria-hidden="true" />}
          {loadingMore && <p className="memory-state" role="status">Cargando más preferencias…</p>}
          {loadMoreError && <div className="memory-error" role="alert">{loadMoreError}<button type="button" className="admin-secondary" onClick={() => void loadMorePreferences()}>Reintentar</button></div>}
        </section>

        <section className="memory-card" aria-labelledby="memory-form-title">
          <h2 id="memory-form-title">{editingId ? 'Editar preferencia' : 'Agregar preferencia'}</h2>
          <p className="memory-form-help">Describí la preferencia y en qué situaciones debería tenerse en cuenta.</p>
          <form onSubmit={handleSubmit}>
            <label className="admin-field">Preferencia
              <textarea required minLength={1} maxLength={4000} value={draft.preference} onChange={event => setDraft(current => ({ ...current, preference: event.target.value }))} placeholder="Por ejemplo: Prefiero respuestas breves y con ejemplos." />
            </label>
            <label className="admin-field">Cuándo se aplica
              <textarea required minLength={1} maxLength={2000} value={draft.activationCondition} onChange={event => setDraft(current => ({ ...current, activationCondition: event.target.value }))} placeholder="Por ejemplo: Al explicar temas técnicos." />
            </label>
            <label className="admin-field">Categoría <span className="memory-optional">(opcional)</span>
              <input maxLength={120} value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} placeholder="Estilo, trabajo, accesibilidad…" />
            </label>
            <div className="memory-form-actions">
              {editingId && <button type="button" className="admin-secondary" onClick={resetForm} disabled={busy}>Cancelar edición</button>}
              <button type="submit" className="admin-primary" disabled={busy || !draft.preference.trim() || !draft.activationCondition.trim()}>{busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Guardar preferencia'}</button>
            </div>
          </form>
          {notice && <p className="admin-notice" role="status">{notice}</p>}
          {error && <p className="memory-error" role="alert">{error}</p>}
        </section>
      </div>
    </main>
  );
}
