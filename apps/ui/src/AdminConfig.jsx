import { useState } from 'react';
import AdminConfigHelp from './AdminConfigHelp.jsx';

const TABS = ['Chat', 'Providers', 'Embeddings', 'MCP'];
const API = import.meta.env.VITE_BASE_URL || '';
const CHAT_FIELDS = ['chatSystemPrompt', 'contextTokenBudget', 'maxContextMessages', 'responseTokenReserve', 'contextSafetyTokens', 'maxToolSteps', 'llmTraceRequests', 'summariesEnabled', 'summaryTokenBudget'];
async function errorText(res) { try { return (await res.json()).error || `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; } }
function tabValue(config, tab) {
  if (tab === 'Chat') return Object.fromEntries(CHAT_FIELDS.map((key) => [key, config[key]]));
  if (tab === 'Providers') return config.ai;
  if (tab === 'Embeddings') return config.embeddingConfig;
  return config.mcpConfig;
}

export default function AdminConfig({ onBack }) {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [loginMode, setLoginMode] = useState('bootstrap');
  const [config, setConfig] = useState(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState('Chat');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function loadData(data) { setConfig(data.settings); setVersion(data.version); setDraft(JSON.stringify(tabValue(data.settings, tab), null, 2)); setNotice(`Configuración activa · versión ${data.version}`); }
  function makeBasicHeader(user, secret) {
    const bytes = new TextEncoder().encode(`${user}:${secret}`);
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    return `Basic ${btoa(binary)}`;
  }
  async function load(overrideHeader = authHeader) {
    if (!overrideHeader) return;
    setBusy(true); setError('');
    try { const res = await fetch(`${API}/admin/runtime-config`, { headers: { Authorization: overrideHeader } }); if (!res.ok) throw new Error(await errorText(res)); setAuthHeader(overrideHeader); loadData(await res.json()); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  function signIn() {
    const header = loginMode === 'bootstrap'
      ? makeBasicHeader(username, password)
      : `Bearer ${token.trim()}`;
    load(header);
  }
  function applyValue(target, name, value) {
    if (name === 'Chat') Object.assign(target, value);
    else if (name === 'Providers') target.ai = value;
    else if (name === 'Embeddings') target.embeddingConfig = value;
    else target.mcpConfig = value;
  }
  function changeTab(nextTab) {
    if (config) {
      try {
        const next = structuredClone(config);
        applyValue(next, tab, JSON.parse(draft));
        setConfig(next);
        setDraft(JSON.stringify(tabValue(next, nextTab), null, 2));
      } catch (e) { setError(e.message); return; }
    }
    setTab(nextTab);
  }
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const next = structuredClone(config);
      const value = JSON.parse(draft);
      applyValue(next, tab, value);
      const res = await fetch(`${API}/admin/runtime-config`, { method: 'PUT', headers: { Authorization: authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ version, settings: next }) });
      if (!res.ok) throw new Error(await errorText(res));
      loadData(await res.json()); setNotice('Cambios guardados correctamente.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <main className="admin-page">
    <header className="admin-header"><div><p className="admin-eyebrow">ADMINISTRACIÓN</p><h1>Configuración del runtime</h1><p className="admin-subtitle">Cambios versionados, aplicados sin reiniciar.</p></div><button className="admin-secondary" onClick={onBack}>Volver al chat</button></header>
    {!config ? <section className="admin-card admin-auth-card"><h2>Acceso administrativo</h2><div className="admin-tabs"><button className={loginMode === 'bootstrap' ? 'active' : ''} onClick={() => setLoginMode('bootstrap')}>Admin inicial</button><button className={loginMode === 'user' ? 'active' : ''} onClick={() => setLoginMode('user')}>Usuario autenticado</button></div>{loginMode === 'bootstrap' ? <><p>Acceso inicial clásico. Usuario y contraseña predeterminados: <code>admin</code> / <code>admin</code>. Se desactiva al configurar el primer usuario administrador.</p><label className="admin-field">Usuario<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label><label className="admin-field">Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label></> : <><p>Ingresá el access token de una cuenta autenticada incluida en <code>RUNTIME_CONFIG_ADMIN_USERS</code>. No uses el token administrativo del runtime.</p><label className="admin-field">Access token del usuario<input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></label></>}<button className="admin-primary" disabled={busy || (loginMode === 'bootstrap' ? !username.trim() || !password : !token.trim())} onClick={signIn}>{busy ? 'Verificando…' : 'Continuar'}</button></section> : <>
      <nav className="admin-tabs">{TABS.map((name) => <button key={name} className={tab === name ? 'active' : ''} onClick={() => changeTab(name)}>{name}</button>)}</nav>
      <section className="admin-card admin-form"><h2>{tab}</h2>
        <AdminConfigHelp tab={tab} />
        <label className="admin-field">Configuración JSON<textarea className="admin-json" spellCheck="false" value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
        <div className="admin-actions"><button className="admin-secondary" disabled={busy} onClick={() => load()}>Recargar</button><button className="admin-primary" disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Validar y guardar'}</button></div>
      </section>
    </>}
    {notice && <p className="admin-notice">{notice}</p>}{error && <div className="admin-error">{error}{error.includes('version conflict') && <button className="admin-secondary" onClick={load}>Cargar última versión</button>}</div>}
  </main>;
}
