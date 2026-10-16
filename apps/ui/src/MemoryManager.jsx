import { useCallback, useState } from 'react';

import client from './client.js';

import useCursorPagination from './useCursorPagination.js';

import sharedStyles from './admin-memory.module.css';

import styles from './MemoryManager.module.css';



const emptyDraft = { preference: '', activationCondition: '', category: '' };



export default function MemoryManager({ onBack }) {

  const [draft, setDraft] = useState(emptyDraft);

  const [editingId, setEditingId] = useState(null);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState('');

  const [notice, setNotice] = useState('');

  const [reloadKey, setReloadKey] = useState(0);

  const fetchPreferences = useCallback(({ limit, cursor }) => client.preferences.listPage({

    limit,

    ...(cursor ? { cursor } : {}),

  }), []);

  const {

    items,

    setItems,

    loadState,

    loadError,

    hasMore,

    loadingMore,

    loadMoreError,

    loadMore,

    rootRef: memoryPageRef,

    sentinelRef: paginationSentinelRef,

  } = useCursorPagination({

    fetchPage: fetchPreferences,

    resetKey: reloadKey,

    loadErrorMessage: 'No se pudieron cargar las preferencias.',

    loadMoreErrorMessage: 'No se pudieron cargar más preferencias.',

    rootMargin: '160px',

  });



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

    <main className={`${sharedStyles.page} ${styles.memoryPage}`} ref={memoryPageRef}>

      <header className={`${sharedStyles.pageHeader} ${styles.memoryHeader}`}>

        <div>

          <p className={sharedStyles.pageEyebrow}>MEMORIA</p>

          <h1>Preferencias guardadas</h1>

          <p className={styles.intro}>Revisá qué preferencias persistentes usa el agente, cuándo se aplican y borrá las que ya no correspondan.</p>

        </div>

        <button type="button" className={sharedStyles.secondaryButton} onClick={onBack}>Volver al chat</button>

      </header>



      <section className={`${sharedStyles.surface} ${styles.explainer}`} aria-label="Qué datos persisten">

        <h2>Qué se guarda</h2>

        <ul>

          <li>Las preferencias de esta pantalla se guardan para tu identidad de sesión o cuenta y pueden recuperarse para orientar respuestas cuando se cumple la condición indicada.</li>

          <li>Las conversaciones, sus mensajes y los resúmenes también persisten, pero se administran por separado. Borrar una preferencia no borra esos datos.</li>

        </ul>

      </section>



      <div className={styles.columns}>

        <section className={`${sharedStyles.surface} ${styles.card}`} aria-labelledby="memory-preferences-title">

          <div className={styles.sectionHeading}>

            <h2 id="memory-preferences-title">Tus preferencias</h2>

            <button type="button" className={sharedStyles.secondaryButton} onClick={() => setReloadKey(key => key + 1)} disabled={loadState === 'loading'}>Actualizar</button>

          </div>

          {loadState === 'loading' && <p className={styles.state} role="status">Cargando preferencias…</p>}

          {loadState === 'error' && <div className={`${sharedStyles.error} ${styles.error}`} role="alert">{loadError}<button type="button" className={sharedStyles.secondaryButton} onClick={() => setReloadKey(key => key + 1)}>Reintentar</button></div>}

          {loadState === 'ready' && items.length === 0 && <p className={styles.state}>Todavía no hay preferencias guardadas.</p>}

          {loadState === 'ready' && items.length > 0 && <ul className={styles.list}>

            {items.map(item => <li key={item.id} className={styles.item}>

              <div className={styles.itemContent}>

                <h3>{item.preference}</h3>

                <p><strong>Se aplica cuando:</strong> {item.activationCondition}</p>

                {item.category && <span className={styles.category}>{item.category}</span>}

              </div>

              <div className={styles.itemActions}>

                <button type="button" className={sharedStyles.secondaryButton} onClick={() => startEdit(item)} disabled={busy}>Editar</button>

                <button type="button" className={styles.deleteButton} onClick={() => handleDelete(item)} disabled={busy}>Borrar</button>

              </div>

            </li>)}

          </ul>}

          {loadState === 'ready' && items.length > 0 && <div ref={paginationSentinelRef} className={styles.paginationSentinel} aria-hidden="true" />}

          {loadingMore && <p className={styles.state} role="status">Cargando más preferencias…</p>}

          {loadMoreError && <div className={`${sharedStyles.error} ${styles.error}`} role="alert">{loadMoreError}<button type="button" className={sharedStyles.secondaryButton} onClick={() => void loadMore()}>Reintentar</button></div>}

        </section>



        <section className={`${sharedStyles.surface} ${styles.card}`} aria-labelledby="memory-form-title">

          <h2 id="memory-form-title">{editingId ? 'Editar preferencia' : 'Agregar preferencia'}</h2>

          <p className={styles.formHelp}>Describí la preferencia y en qué situaciones debería tenerse en cuenta.</p>

          <form onSubmit={handleSubmit}>

            <label className={`${sharedStyles.field} ${styles.field}`}>Preferencia

              <textarea required minLength={1} maxLength={4000} value={draft.preference} onChange={event => setDraft(current => ({ ...current, preference: event.target.value }))} placeholder="Por ejemplo: Prefiero respuestas breves y con ejemplos." />

            </label>

            <label className={`${sharedStyles.field} ${styles.field}`}>Cuándo se aplica

              <textarea required minLength={1} maxLength={2000} value={draft.activationCondition} onChange={event => setDraft(current => ({ ...current, activationCondition: event.target.value }))} placeholder="Por ejemplo: Al explicar temas técnicos." />

            </label>

            <label className={`${sharedStyles.field} ${styles.field}`}>Categoría <span className={styles.optional}>(opcional)</span>

              <input maxLength={120} value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} placeholder="Estilo, trabajo, accesibilidad…" />

            </label>

            <div className={styles.formActions}>

              {editingId && <button type="button" className={sharedStyles.secondaryButton} onClick={resetForm} disabled={busy}>Cancelar edición</button>}

              <button type="submit" className={sharedStyles.primaryButton} disabled={busy || !draft.preference.trim() || !draft.activationCondition.trim()}>{busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Guardar preferencia'}</button>

            </div>

          </form>

          {notice && <p className={sharedStyles.notice} role="status">{notice}</p>}

          {error && <p className={`${sharedStyles.error} ${styles.error}`} role="alert">{error}</p>}

        </section>

      </div>

    </main>

  );

}
