import { useState } from 'react';
import styles from './IdentitySettings.module.css';
import sharedStyles from './admin-memory.module.css';
import { clearStoredBearerToken, hasStoredBearerToken, setStoredBearerToken } from './authToken.js';

export default function IdentitySettings({ onBack, onBearerChange }) {
  const [isConfigured, setIsConfigured] = useState(hasStoredBearerToken);
  const [tokenDraft, setTokenDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  function saveToken(event) {
    event.preventDefault();
    setNotice('');
    setError('');
    try {
      setStoredBearerToken(tokenDraft);
      setTokenDraft('');
      setIsConfigured(true);
      onBearerChange?.();
      setNotice('Bearer guardado para esta pestaña. Las próximas solicitudes al Runtime usarán esta identidad.');
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar el Bearer.');
    }
  }

  function clearToken() {
    setNotice('');
    setError('');
    try {
      clearStoredBearerToken();
      setTokenDraft('');
      setIsConfigured(false);
      onBearerChange?.();
      setNotice('Bearer borrado. Las próximas solicitudes usarán el acceso anónimo.');
    } catch (clearError) {
      setError(clearError.message || 'No se pudo borrar el Bearer.');
    }
  }

  return (
    <main className={`${sharedStyles.page} ${styles.identityPage}`}>
      <header className={`${sharedStyles.pageHeader} ${styles.identityHeader}`}>
        <div>
          <p className={sharedStyles.pageEyebrow}>SESIÓN</p>
          <h1>Identidad de acceso</h1>
          <p className={styles.intro}>Usá un Bearer obtenido al iniciar sesión en el producto huésped, por ejemplo pc-mcp. Agent Runtime lo enviará en las solicitudes y validará la identidad según la configuración de introspección.</p>
        </div>
        <button type="button" className={sharedStyles.secondaryButton} onClick={onBack}>Volver al chat</button>
      </header>

      <section className={`${sharedStyles.surface} ${styles.card}`} aria-labelledby="identity-status-title">
        <h2 id="identity-status-title">Identidad usada por esta pestaña</h2>
        <p className={isConfigured ? styles.statusActive : styles.statusAnonymous} role="status">
          <span className={styles.statusDot} aria-hidden="true" />
          {isConfigured ? 'Bearer configurado' : 'Acceso anónimo'}
        </p>
        <p className={styles.help}>
          {isConfigured
            ? 'El token está guardado en el almacenamiento de sesión del navegador; no se muestra en pantalla. Se conserva al recargar esta pestaña y se elimina al cerrar la pestaña.'
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
          <p id="identity-token-help" className={styles.help}>El valor no se envía a pc-mcp desde esta pantalla ni se valida al guardarlo. Runtime lo validará al atender las solicitudes del chat.</p>
          <p className={styles.help}>Los Bearer opacos solo se aceptan si hay una URL de introspección configurada en Administración → Auth. Sin esa configuración, las solicitudes con este token responden 401; para usar el modo público, borrá el Bearer y usá el acceso anónimo.</p>
          <div className={styles.actions}>
            {isConfigured && <button type="button" className={styles.clearButton} onClick={clearToken}>Borrar Bearer y usar anónimo</button>}
            <button type="submit" className={sharedStyles.primaryButton} disabled={!tokenDraft.trim()}>Guardar Bearer</button>
          </div>
        </form>

        <p className={styles.warning}>El token permite actuar como la identidad asociada mientras siga vigente. Se guarda solo en esta pestaña, pero queda accesible para el código JavaScript de la página; cerrá sesión aquí si compartís el dispositivo. Borrar el token de esta UI no revoca la sesión en pc-mcp.</p>
        {notice && <p className={sharedStyles.notice} role="status">{notice}</p>}
        {error && <p className={sharedStyles.error} role="alert">{error}</p>}
      </section>
    </main>
  );
}
