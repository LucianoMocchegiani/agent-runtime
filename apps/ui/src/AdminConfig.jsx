import { useState } from 'react';
import AdminConfigHelp from './AdminConfigHelp.jsx';

const TABS = [
  { id: 'Profiles', label: 'Profiles' },
  { id: 'Providers', label: 'Provider' },
  { id: 'Embeddings', label: 'Embedding' },
  { id: 'MCP', label: 'MCP' },
];
const API = import.meta.env.VITE_BASE_URL || '';

async function errorText(res) {
  try { return (await res.json()).error || `HTTP ${res.status}`; }
  catch { return `HTTP ${res.status}`; }
}

function tabValue(config, tab) {
  if (tab === 'Providers') return { providers: config.ai.providers };
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
  const [profiles, setProfiles] = useState([]);
  const [profileDraft, setProfileDraft] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState('Profiles');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function loadData(data) {
    const needsProvider = Object.keys(data.settings.ai?.providers ?? {}).length === 0;
    const nextTab = needsProvider && tab !== 'Profiles' ? 'Providers' : tab;
    setConfig(data.settings);
    setVersion(data.version);
    setTab(nextTab);
    setDraft(JSON.stringify(tabValue(data.settings, nextTab === 'Profiles' ? 'Providers' : nextTab), null, 2));
    setNotice(`Configuración activa · versión ${data.version}`);
  }

  function makeBasicHeader(user, secret) {
    const bytes = new TextEncoder().encode(`${user}:${secret}`);
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    return `Basic ${btoa(binary)}`;
  }

  async function load(overrideHeader = authHeader) {
    if (!overrideHeader) return;
    setBusy(true);
    setError('');
    try {
      const headers = { Authorization: overrideHeader };
      const [res, profileRes] = await Promise.all([
        fetch(`${API}/admin/runtime-config`, { headers }),
        fetch(`${API}/admin/agent-profiles`, { headers }),
      ]);
      if (!res.ok) throw new Error(await errorText(res));
      if (!profileRes.ok) throw new Error(await errorText(profileRes));
      const data = await res.json();
      const profileData = await profileRes.json();
      const nextProfiles = profileData.items ?? [];
      setAuthHeader(overrideHeader);
      loadData(data);
      setProfiles(nextProfiles);
      const selected = nextProfiles.find((item) => item.id === selectedProfileId) ?? nextProfiles[0];
      if (selected) {
        setSelectedProfileId(selected.id);
        setProfileDraft(JSON.stringify(selected, null, 2));
      } else {
        setSelectedProfileId('');
        setProfileDraft('');
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function signIn() {
    const header = loginMode === 'bootstrap'
      ? makeBasicHeader(username, password)
      : `Bearer ${token.trim()}`;
    load(header);
  }

  function applyValue(target, name, value) {
    if (name === 'Providers') target.ai = { ...target.ai, providers: value.providers };
    else if (name === 'Embeddings') target.embeddingConfig = value;
    else target.mcpConfig = value;
  }

  function changeTab(nextTab) {
    try {
      const next = structuredClone(config);
      if (tab !== 'Profiles') applyValue(next, tab, JSON.parse(draft));
      setConfig(next);
      if (nextTab !== 'Profiles') setDraft(JSON.stringify(tabValue(next, nextTab), null, 2));
    } catch (e) { setError(e.message); return; }
    setError('');
    setTab(nextTab);
  }

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = structuredClone(config);
      applyValue(next, tab, JSON.parse(draft));
      const res = await fetch(`${API}/admin/runtime-config`, {
        method: 'PUT',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, settings: next }),
      });
      if (!res.ok) throw new Error(await errorText(res));
      loadData(await res.json());
      setNotice('Cambios guardados correctamente.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function saveProfile() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = JSON.parse(profileDraft);
      const res = await fetch(`${API}/admin/agent-profiles/${encodeURIComponent(selectedProfileId)}`, {
        method: 'PUT',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!res.ok) throw new Error(await errorText(res));
      await load();
      setNotice('Perfil guardado. El que quede primero por sortOrder se aplicará globalmente en los próximos turnos de todas las conversaciones.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function activateProfile() {
    if (!selectedProfileId || profiles[0]?.id === selectedProfileId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/admin/agent-profiles/${encodeURIComponent(selectedProfileId)}/activate`, {
        method: 'POST', headers: { Authorization: authHeader },
      });
      if (!res.ok) throw new Error(await errorText(res));
      await load();
      setNotice('Perfil activado globalmente. Se usará en los próximos turnos de todas las conversaciones.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function createProfile() {
    setBusy(true);
    setError('');
    try {
      const source = profiles[0];
      const profile = source
        ? { ...source, id: undefined, name: 'Nuevo perfil', sortOrder: Math.max(...profiles.map((item) => item.sortOrder)) + 1 }
        : null;
      if (!profile) throw new Error('No hay perfil base para copiar.');
      const res = await fetch(`${API}/admin/agent-profiles`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error(await errorText(res));
      const created = await res.json();
      await load();
      setSelectedProfileId(created.id);
      setProfileDraft(JSON.stringify(created, null, 2));
      setTab('Profiles');
      setNotice('Perfil creado. Revisá sus datos y guardá los cambios si hace falta.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function archiveProfile() {
    if (!selectedProfileId || profiles.length < 2 || !confirm('¿Archivar este perfil? Si es el activo, el siguiente perfil pasará a aplicarse globalmente.')) return;
    const wasGlobal = profiles[0]?.id === selectedProfileId;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/admin/agent-profiles/${encodeURIComponent(selectedProfileId)}`, {
        method: 'DELETE', headers: { Authorization: authHeader },
      });
      if (!res.ok) throw new Error(await errorText(res));
      await load();
      setNotice(wasGlobal ? 'Perfil archivado. El siguiente perfil activo se aplicará globalmente.' : 'Perfil archivado.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function selectProfile(id) {
    const profile = profiles.find((item) => item.id === id);
    setSelectedProfileId(id);
    setProfileDraft(profile ? JSON.stringify(profile, null, 2) : '');
    setError('');
  }

  return <main className="admin-page">
    <header className="admin-header">
      <div><p className="admin-eyebrow">ADMINISTRACIÓN</p><h1>Configuración del runtime</h1><p className="admin-subtitle">Cambios versionados, aplicados sin reiniciar.</p></div>
      <button className="admin-secondary" onClick={onBack}>Volver al chat</button>
    </header>
    {!config ? <section className="admin-card admin-auth-card">
      <h2>Acceso administrativo</h2>
      <div className="admin-tabs">
        <button className={loginMode === 'bootstrap' ? 'active' : ''} onClick={() => setLoginMode('bootstrap')}>Admin inicial</button>
        <button className={loginMode === 'user' ? 'active' : ''} onClick={() => setLoginMode('user')}>Usuario autenticado</button>
      </div>
      {loginMode === 'bootstrap' ? <>
        <p>Acceso inicial clásico. Usuario y contraseña predeterminados: <code>admin</code> / <code>admin</code>. Se desactiva al configurar el primer usuario administrador.</p>
        <label className="admin-field">Usuario<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="admin-field">Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      </> : <>
        <p>Ingresá el access token de una cuenta autenticada incluida en <code>RUNTIME_CONFIG_ADMIN_USERS</code>. No uses el token administrativo del runtime.</p>
        <label className="admin-field">Access token del usuario<input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></label>
      </>}
      <button className="admin-primary" disabled={busy || (loginMode === 'bootstrap' ? !username.trim() || !password : !token.trim())} onClick={signIn}>{busy ? 'Verificando…' : 'Continuar'}</button>
    </section> : <>
      {Object.keys(config.ai?.providers ?? {}).length === 0 && <p className="admin-notice" role="status">Instalación nueva: no hay proveedores de IA configurados. Agregá una clave y modelos habilitados en Provider. Después elegí el modelo en el perfil predeterminado.</p>}
      <nav className="admin-tabs" role="tablist" aria-label="Configuración del runtime">
        {TABS.map(({ id, label }) => <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className={tab === id ? 'active' : ''}
          onClick={() => changeTab(id)}
        >{label}</button>)}
      </nav>
      {tab === 'Profiles' ? <section className="admin-card admin-form" role="tabpanel">
        <h2>Perfiles de agente</h2>
        <AdminConfigHelp tab="Profiles" />
        <p className="admin-notice">Por ahora, el perfil activo (★) se usa globalmente en todas las conversaciones. Activar otro perfil cambia el comportamiento de los próximos turnos en todos los chats.</p>
        <div className="admin-profile-controls">
          <label className="admin-field admin-profile-field">Perfil a editar<select value={selectedProfileId} onChange={(e) => selectProfile(e.target.value)} disabled={!profiles.length}>
            {profiles.map((profile, index) => <option key={profile.id} value={profile.id}>{index === 0 ? '★ ' : ''}{profile.name} · orden {profile.sortOrder}</option>)}
          </select></label>
          <div className="admin-profile-buttons">
            <button className="admin-primary" disabled={busy || !selectedProfileId || profiles[0]?.id === selectedProfileId} onClick={activateProfile}>Activar globalmente</button>
            <button className="admin-secondary" disabled={busy || !profiles.length} onClick={createProfile}>Crear perfil</button>
            <button className="admin-secondary" disabled={busy || profiles.length < 2} onClick={archiveProfile}>Archivar</button>
          </div>
        </div>
        {selectedProfileId && <>
          <label className="admin-field">Perfil JSON · name, modelId, sortOrder y config<textarea className="admin-json" spellCheck="false" value={profileDraft} onChange={(e) => setProfileDraft(e.target.value)} /></label>
          <div className="admin-actions"><button className="admin-primary" disabled={busy} onClick={saveProfile}>{busy ? 'Guardando…' : 'Validar y guardar perfil'}</button></div>
        </>}
      </section> : <>
        <p className="admin-subtitle">El modelo y los parámetros de comportamiento se administran en Profiles. Esta sección contiene proveedores y credenciales, embeddings y servidores MCP globales.</p>
        <section className="admin-card admin-form" role="tabpanel">
          <h2>{TABS.find((item) => item.id === tab)?.label}</h2>
          <AdminConfigHelp tab={tab} />
          <label className="admin-field">Configuración JSON<textarea className="admin-json" spellCheck="false" value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
          <div className="admin-actions"><button className="admin-secondary" disabled={busy} onClick={() => load()}>Recargar</button><button className="admin-primary" disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Validar y guardar'}</button></div>
        </section>
      </>}
    </>}
    {notice && <p className="admin-notice" role="status">{notice}</p>}
    {error && <div className="admin-error" role="alert">{error}{error.includes('version conflict') && <button className="admin-secondary" onClick={load}>Cargar última versión</button>}</div>}
  </main>;
}
