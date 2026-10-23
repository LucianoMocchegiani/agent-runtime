import { useEffect, useState } from 'react';
import styles from './IdentitySettings.module.css';
import sharedStyles from './admin-memory.module.css';
import { clearStoredBearerToken, getAuthSession, setStoredBearerToken } from './authToken.js';

export default function IdentitySettings({ onBack, onBearerChange }) {
  const [isConfigured, setIsConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenDraft, setTokenDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getAuthSession()
      .then(session => { if (active) setIsConfigured(Boolean(session.authenticated)); })
      .catch(sessionError => { if (active) setError(sessionError.message || 'No se pudo consultar la sesión.'); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  async function saveToken(event) {
    event.preventDefault();
    setNotice('');
    setError('');
    try {
      await setStoredBearerToken(tokenDraft);
      setTokenDraft('');
      setIsConfigured(true);
      onBearerChange?.();
      setNotice('Bearer validado y guardado en una cookie HttpOnly. Las próximas solicitudes usarán esta identidad.');
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar el Bearer.');
    }
  }

  async function clearToken() {
    setNotice('');
    setError('');
    try {
      await clearStoredBearerToken();
      setTokenDraft('');
      setIsConfigured(false);
      onBearerChange?.();
      setNotice('Sesión cerrada. Las próximas solicitudes usarán el acceso anónimo.');
    } catch (clearError) {
      setError(clearError.message || 'No se pudo cerrar la sesión.');
    }
  }

  return (
    <main className={`${sharedStyles.page} ${styles.identityPage}`}>
      <header className={`${sharedStyles.pageHeader} ${styles.identityHeader}`}>
        <div>
          <p className={sharedStyles.pageEyebrow}>SESIÓN</p>
          <h1>Identidad de acceso</h1>
          <p className={styles.intro}>Usá un Bearer obtenido al iniciar sesión en el producto huésped, por ejemplo workspace-mcp. Agent Runtime lo validará y lo guardará en una cookie HttpOnly.</p>
        </div>
        <button type="button" className={sharedStyles.secondaryButton} onClick={onBack}>Volver al chat</button>
      </header>

      <section className={`${sharedStyles.surface} ${styles.card}`} aria-labelledby="identity-status-title">
        <h2 id="identity-status-title">Identidad usada por esta sesión</h2>
        <p className={isConfigured ? styles.statusActive : styles.statusAnonymous} role="status">
          <span className={styles.statusDot} aria-hidden="true" />
          {isLoading ? 'Consultando sesión…' : isConfigured ? 'Bearer configurado' : 'Acceso anónimo'}
        </p>
        <p className={styles.help}>
          {isConfigured
            ? 'El token no se guarda en Web Storage ni queda accesible para JavaScript; el navegador lo envía automáticamente en una cookie HttpOnly.'
            : 'Sin un Bearer configurado, la UI conserva el acceso anónimo actual.'}
        </p>

        <form onSubmit={saveToken}>
          <label className={sharedStyles.field} htmlFor="runtime-bearer-token">
            {isConfigured ? 'Reemplazar Bearer' : 'Bearer token'}
            <input
              id="runtime-bearer-token"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
              value={tokenDraft}
              onChange={event => setTokenDraft(event.target.value)}
              placeholder={isConfigured ? 'Pegá un token nuevo para reemplazarlo' : 'Pegá el token, con o sin “Bearer ”'}
              aria-describedby="identity-token-help"
            />
          </label>
          <p id="identity-token-help" className={styles.help}>El token se envía una vez al Runtime por HTTPS, se valida contra la introspección configurada y se devuelve únicamente como cookie HttpOnly; nunca se devuelve en la respuesta JSON.</p>
          <p className={styles.help}>Los Bearer opacos solo se aceptan si hay una URL de introspección configurada en Administración → Auth. Sin esa configuración, las solicitudes con este token responden 401; para usar el modo público, borrá la sesión y usá el acceso anónimo.</p>
          <div className={styles.actions}>
            {isConfigured && <button type="button" className={styles.clearButton} onClick={() => void clearToken()}>Cerrar sesión y usar anónimo</button>}
            <button type="submit" className={sharedStyles.primaryButton} disabled={isLoading || !tokenDraft.trim()}>Guardar Bearer</button>
          </div>
        </form>

        <p className={styles.warning}>La cookie es inaccesible para JavaScript, lo que reduce el riesgo de robo del token por XSS. Una vulnerabilidad XSS aún podría realizar acciones desde esta sesión mientras la página esté abierta. Cerrar sesión elimina la cookie de Runtime, pero no revoca la sesión en workspace-mcp.</p>
        {notice && <p className={sharedStyles.notice} role="status">{notice}</p>}
        {error && <p className={sharedStyles.error} role="alert">{error}</p>}
      </section>
    </main>
  );
}
