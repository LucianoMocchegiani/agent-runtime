import { useCallback, useEffect, useState } from 'react';
import client from './client.js';
import sharedStyles from './admin-memory.module.css';
import styles from './McpConnections.module.css';

export default function McpConnections({ onBack }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyName, setBusyName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setConnections(await client.mcpConnections.list()); }
    catch (err) { setError(err.message || 'No se pudieron cargar las conexiones.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const name = url.searchParams.get('mcp-oauth');
    if (!name) return;
    if (url.searchParams.get('status') === 'connected') setNotice(`${name} quedó conectado.`);
    else setError(`No se pudo completar la conexión de ${name}. Revisá la configuración del servidor e intentá de nuevo.`);
    url.searchParams.delete('mcp-oauth');
    url.searchParams.delete('status');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  async function connect(name) {
    setBusyName(name); setError('');
    try { window.location.assign(await client.mcpConnections.authorize(name)); }
    catch (err) { setError(err.message || `No se pudo conectar ${name}.`); setBusyName(''); }
  }

  async function disconnect(name) {
    setBusyName(name); setError(''); setNotice('');
    try {
      await client.mcpConnections.disconnect(name);
      setNotice(`${name} quedó desconectado de Runtime.`);
      await refresh();
    } catch (err) { setError(err.message || `No se pudo desconectar ${name}.`); }
    finally { setBusyName(''); }
  }

  return (
    <main className={`${sharedStyles.page} ${styles.mcpPage}`}>
      <header className={`${sharedStyles.pageHeader} ${styles.mcpHeader}`}>
        <div>
          <p className={sharedStyles.pageEyebrow}>INTEGRACIONES</p>
          <h1>Conexiones MCP</h1>
          <p className={styles.intro}>Conectá tu cuenta a los servidores MCP que tengan OAuth configurado en Runtime. Las credenciales se guardan cifradas y no se envían al navegador.</p>
        </div>
        <button type="button" className={sharedStyles.secondaryButton} onClick={onBack}>Volver al chat</button>
      </header>

      {error && <div className={`${sharedStyles.error} ${styles.error}`} role="alert">{error}</div>}
      {notice && <div className={`${sharedStyles.notice} ${styles.notice}`} role="status">{notice}</div>}
      {loading ? <p className={styles.state} role="status">Consultando conexiones…</p> : connections.length === 0 ? (
        <section className={`${sharedStyles.surface} ${styles.card}`}>
          <h2>No hay conexiones OAuth configuradas</h2>
          <p>Configurá OAuth dentro de la entrada del servidor en Administración → Runtime → MCP.</p>
        </section>
      ) : (
        <div className={styles.connections}>
          {connections.map(connection => (
            <section className={`${sharedStyles.surface} ${styles.card}`} key={connection.name} aria-busy={busyName === connection.name}>
              <div>
                <h2>{connection.name}</h2>
                {connection.connected
                  ? <p>{connection.account ? <>Conectado como <strong>{connection.account}</strong></> : 'Conectado'}{connection.expiresAt ? <> · vence {new Date(connection.expiresAt).toLocaleString()}</> : null}</p>
                  : <p>No hay una cuenta conectada para este servidor.</p>}
              </div>
              <div className={styles.cardActions}>
                {connection.connected
                  ? <button type="button" className={sharedStyles.secondaryButton} onClick={() => disconnect(connection.name)} disabled={Boolean(busyName)}>Desconectar</button>
                  : <button type="button" className={sharedStyles.primaryButton} onClick={() => connect(connection.name)} disabled={Boolean(busyName)}>Conectar</button>}
              </div>
            </section>
          ))}
        </div>
      )}
      {!loading && connections.length > 0 && <p className={styles.footnote}>Desconectar elimina las credenciales guardadas en Runtime; la revocación del grant depende del proveedor OAuth.</p>}
    </main>
  );
}
