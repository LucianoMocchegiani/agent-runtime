import { useEffect, useState } from 'react';
import client from './client.js';
import AdminConfigHelp from './AdminConfigHelp.jsx';
import sharedStyles from './admin-memory.module.css';
import styles from './AdminConfig.module.css';

const TABS = [
  { id: 'Profiles', label: 'Profiles' },
  { id: 'Providers', label: 'Provider' },
  { id: 'Embeddings', label: 'Embedding' },
  { id: 'MCP', label: 'MCP' },
  { id: 'Auth', label: 'Auth' },
  { id: 'Admins', label: 'Administradores' },
];
function editableProfile(profile) {
  const { systemPrompt, ...config } = profile.config;
  return { name: profile.name, model: profile.model, config };
}

function tabValue(config, tab) {
  if (tab === 'Providers') return { providers: config.ai.providers };
  if (tab === 'Embeddings') return config.embeddingConfig ?? { model: '' };
  if (tab === 'Auth') return { authIntrospectUrl: config.authIntrospectUrl, authMapping: config.authMapping };
  return config.mcpConfig;
}

export default function AdminConfig({ onBack }) {
  const [token, setToken] = useState('');
  const [loginMode, setLoginMode] = useState('recovery');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [config, setConfig] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [runtimeAdmins, setRuntimeAdmins] = useState([]);
  const [newAdminUserId, setNewAdminUserId] = useState('');
  const [profileDraft, setProfileDraft] = useState('');
  const [systemPromptDraft, setSystemPromptDraft] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [defaultForNewChatsId, setDefaultForNewChatsId] = useState('');
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState('Profiles');
  const [draft, setDraft] = useState('');
  const [authTestToken, setAuthTestToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function loadData(data) {
    const needsProvider = Object.keys(data.settings.ai?.providers ?? {}).length === 0;
    const nextTab = needsProvider && tab === 'Profiles' ? 'Providers' : tab;
    setConfig(data.settings);
    setVersion(data.version);
    setTab(nextTab);
    if (nextTab !== 'Admins') setDraft(JSON.stringify(tabValue(data.settings, nextTab === 'Profiles' ? 'Providers' : nextTab), null, 2));
    setNotice(`Configuración activa · versión ${data.version}`);
  }

  async function load(overrideHeader = authHeader) {
    setBusy(true);
    setError('');
    try {
      const [data, profileData, adminData] = await Promise.all([
        client.admin.getRuntimeConfig(overrideHeader),
        client.admin.listAgentProfiles(overrideHeader),
        client.admin.listRuntimeAdmins(overrideHeader),
      ]);
      const nextProfiles = profileData.items ?? [];
      setAuthHeader(overrideHeader);
      loadData(data);
      setProfiles(nextProfiles);
      setRuntimeAdmins(adminData.items ?? []);
      setDefaultForNewChatsId(profileData.defaultForNewChatsId ?? nextProfiles[0]?.id ?? '');
      const selected = nextProfiles.find((item) => item.id === selectedProfileId) ?? nextProfiles[0];
      if (selected) {
        setSelectedProfileId(selected.id);
        setProfileDraft(JSON.stringify(editableProfile(selected), null, 2));
        setSystemPromptDraft(selected.config.systemPrompt);
      } else {
        setSelectedProfileId('');
        setProfileDraft('');
        setSystemPromptDraft('');
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    void load(''); // Intenta reutilizar la sesión HttpOnly antes de pedir credenciales manuales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signIn() {
    if (loginMode === 'bearer') {
      load(`Bearer ${token.trim()}`);
      return;
    }
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    load(`Basic ${encoded}`);
  }

  function applyValue(target, name, value) {
    if (name === 'Providers') target.ai = { ...target.ai, providers: value.providers };
    else if (name === 'Embeddings') target.embeddingConfig = value?.model?.trim() ? { model: value.model.trim() } : null;
    else if (name === 'Auth') {
      target.authIntrospectUrl = value.authIntrospectUrl;
      target.authMapping = value.authMapping;
    } else target.mcpConfig = value;
  }

  function changeTab(nextTab) {
    try {
      const next = structuredClone(config);
      if (tab !== 'Profiles' && tab !== 'Admins') applyValue(next, tab, JSON.parse(draft));
      setConfig(next);
      if (nextTab !== 'Profiles' && nextTab !== 'Admins') setDraft(JSON.stringify(tabValue(next, nextTab), null, 2));
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
      loadData(await client.admin.saveRuntimeConfig(authHeader, { version, settings: next }));
      setNotice('Cambios guardados correctamente.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function testAuth() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const settings = JSON.parse(draft);
      const { identity } = await client.admin.testAuth(authHeader, { settings, token: authTestToken });
      setNotice(`Introspección correcta · userId: ${identity.userId}${identity.email ? ` · email: ${identity.email}` : ''}${identity.name ? ` · name: ${identity.name}` : ''}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function saveDefaultForNewChats() {
    if (!defaultForNewChatsId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await client.admin.setDefaultForNewChats(authHeader, defaultForNewChatsId);
      setNotice('Perfil predeterminado para nuevos chats guardado.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function addAdmin() {
    const userId = newAdminUserId.trim();
    if (!userId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await client.admin.addRuntimeAdmin(authHeader, userId);
      setNewAdminUserId('');
      setRuntimeAdmins((await client.admin.listRuntimeAdmins(authHeader)).items ?? []);
      setNotice(`Acceso administrativo concedido a ${userId}.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function removeAdmin(userId) {
    if (runtimeAdmins.length < 2 || !confirm(`¿Revocar el acceso administrativo de ${userId}?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await client.admin.removeRuntimeAdmin(authHeader, userId);
      setRuntimeAdmins((await client.admin.listRuntimeAdmins(authHeader)).items ?? []);
      setNotice(`Acceso administrativo revocado para ${userId}.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function saveProfile() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = JSON.parse(profileDraft);
      value.config.systemPrompt = systemPromptDraft;
      await client.admin.updateAgentProfile(authHeader, selectedProfileId, value);
      await load();
      setNotice('Perfil guardado. Se aplicará en los próximos turnos de las conversaciones que lo tengan asignado.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function createProfile() {
    setBusy(true);
    setError('');
    try {
      const source = profiles[0];
      const profile = source
        ? { name: 'Nuevo perfil', model: source.model, config: source.config }
        : null;
      if (!profile) throw new Error('No hay perfil base para copiar.');
      const created = await client.admin.createAgentProfile(authHeader, profile);
      await load();
      setSelectedProfileId(created.id);
      setProfileDraft(JSON.stringify(editableProfile(created), null, 2));
      setSystemPromptDraft(created.config.systemPrompt);
      setTab('Profiles');
      setNotice('Perfil creado. Revisá sus datos y guardá los cambios si hace falta.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function archiveProfile() {
    if (!selectedProfileId || profiles.length < 2 || !confirm('¿Archivar este perfil? Las conversaciones que lo tienen asignado conservarán esa referencia.')) return;
    setBusy(true);
    setError('');
    try {
      await client.admin.archiveAgentProfile(authHeader, selectedProfileId);
      await load();
      setNotice('Perfil archivado. Las conversaciones existentes conservan su asignación.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function selectProfile(id) {
    const profile = profiles.find((item) => item.id === id);
    setSelectedProfileId(id);
    setProfileDraft(profile ? JSON.stringify(editableProfile(profile), null, 2) : '');
    setSystemPromptDraft(profile?.config.systemPrompt ?? '');
    setError('');
  }

  return <main className={`${sharedStyles.page} ${styles.adminPage}`}>
    <header className={`${sharedStyles.pageHeader} ${styles.adminHeader}`}>
      <div><p className={sharedStyles.pageEyebrow}>ADMINISTRACIÓN</p><h1>Configuración del runtime</h1><p className={styles.subtitle}>Cambios versionados, aplicados sin reiniciar.</p></div>
      <button className={sharedStyles.secondaryButton} onClick={onBack}>Volver al chat</button>
    </header>
    {!config ? <section className={`${sharedStyles.surface} ${styles.card} ${styles.authCard}`}>
      <h2>Acceso administrativo</h2>
      <p>La cuenta local de recuperación funciona aunque no esté configurada la autenticación externa: por defecto es <code>admin/admin</code>. Cambiala con <code>RUNTIME_ADMIN_USERNAME</code> y <code>RUNTIME_ADMIN_PASSWORD</code>. También podés entrar con un Bearer verificado que figure entre los administradores del runtime.</p>
      <label className={sharedStyles.field}>Método de acceso<select value={loginMode} onChange={(e) => setLoginMode(e.target.value)}>
        <option value="recovery">Cuenta local de recuperación</option>
        <option value="bearer">Bearer del proveedor de autenticación</option>
      </select></label>
      {loginMode === 'recovery' ? <>
        <label className={sharedStyles.field}>Usuario<input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className={sharedStyles.field}>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      </> : <label className={sharedStyles.field}>Access token<input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></label>}
      <button className={sharedStyles.primaryButton} disabled={busy || (loginMode === 'recovery' ? !username || !password : !token.trim())} onClick={signIn}>{busy ? 'Verificando…' : 'Continuar'}</button>
      {!busy && loginMode === 'recovery' && (!username || !password) && <p className={styles.loginHint} role="status">Ingresá el usuario y la contraseña de recuperación.</p>}
      {!busy && loginMode === 'bearer' && !token.trim() && <p className={styles.loginHint} role="status">Ingresá el access token para continuar.</p>}
    </section> : <>
      {Object.keys(config.ai?.providers ?? {}).length === 0 && <p className={`${sharedStyles.notice} ${styles.notice}`} role="status">Instalación nueva: no hay proveedores de IA configurados. Agregá una clave y modelos habilitados en Provider. Después elegí el modelo en el perfil predeterminado.</p>}
      <nav className={styles.tabs} role="tablist" aria-label="Configuración del runtime">
        {TABS.map(({ id, label }) => <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className={tab === id ? styles.active : ''}
          onClick={() => changeTab(id)}
        >{label}</button>)}
      </nav>
      {tab === 'Profiles' ? <section className={`${sharedStyles.surface} ${styles.card}`} role="tabpanel">
        <h2>Perfiles de agente</h2>
        <AdminConfigHelp tab="Profiles" />
        <p className={`${sharedStyles.notice} ${styles.notice}`}>Cada conversación usa el perfil que tiene asignado. El predeterminado solo se aplica a los chats nuevos; cambiarlo no modifica las conversaciones existentes.</p>
        <div className={styles.profileControls}>
          <label className={`${sharedStyles.field} ${styles.profileField}`}>Perfil para nuevos chats<select value={defaultForNewChatsId} onChange={(e) => setDefaultForNewChatsId(e.target.value)} disabled={!profiles.length}>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select></label>
          <div className={styles.profileButtons}>
            <button className={sharedStyles.primaryButton} disabled={busy || !defaultForNewChatsId} onClick={saveDefaultForNewChats}>Guardar predeterminado</button>
          </div>
        </div>
        <div className={styles.profileControls}>
          <label className={`${sharedStyles.field} ${styles.profileField}`}>Perfil a editar<select value={selectedProfileId} onChange={(e) => selectProfile(e.target.value)} disabled={!profiles.length}>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select></label>
          <div className={styles.profileButtons}>
            <button className={sharedStyles.secondaryButton} disabled={busy || !profiles.length} onClick={createProfile}>Crear perfil</button>
            <button className={sharedStyles.secondaryButton} disabled={busy || profiles.length < 2} onClick={archiveProfile}>Archivar</button>
          </div>
        </div>
        {selectedProfileId && <>
          <label className={sharedStyles.field}>System prompt<textarea className={styles.prompt} maxLength={100000} value={systemPromptDraft} onChange={(e) => setSystemPromptDraft(e.target.value)} /></label>
          <label className={sharedStyles.field}>Perfil JSON · name, model y config (sin systemPrompt)<textarea className={styles.json} spellCheck="false" value={profileDraft} onChange={(e) => setProfileDraft(e.target.value)} /></label>
          <div className={styles.actions}><button className={sharedStyles.primaryButton} disabled={busy} onClick={saveProfile}>{busy ? 'Guardando…' : 'Validar y guardar perfil'}</button></div>
        </>}
      </section> : tab === 'Admins' ? <section className={`${sharedStyles.surface} ${styles.card}`} role="tabpanel">
        <h2>Administradores del runtime</h2>
        <p>Solo se admiten IDs exactos devueltos por el endpoint de introspección. La autorización se consulta en la base de datos; no se usa una allowlist de entorno.</p>
        <form className={styles.profileControls} onSubmit={(event) => { event.preventDefault(); void addAdmin(); }}>
          <label className={`${sharedStyles.field} ${styles.profileField}`}>User ID verificado<input value={newAdminUserId} onChange={(event) => setNewAdminUserId(event.target.value)} autoComplete="off" /></label>
          <div className={styles.profileButtons}><button className={sharedStyles.primaryButton} type="submit" disabled={busy || !newAdminUserId.trim()}>Agregar administrador</button></div>
        </form>
        <div className={styles.adminList}>
          {runtimeAdmins.map((admin) => <div className={styles.adminRow} key={admin.userId}>
            <div><strong>{admin.userId}</strong><p>Agregado {new Date(admin.createdAt).toLocaleString()}{admin.createdByUserId ? ` · por ${admin.createdByUserId}` : ' · bootstrap CLI'}</p></div>
            <button className={sharedStyles.secondaryButton} type="button" disabled={busy || runtimeAdmins.length < 2} onClick={() => removeAdmin(admin.userId)}>Revocar</button>
          </div>)}
        </div>
        {runtimeAdmins.length === 1 && <p className={styles.subtitle}>No se puede revocar al último administrador.</p>}
      </section> : <>
        <section className={`${sharedStyles.surface} ${styles.card}`} role="tabpanel">
          <h2>{TABS.find((item) => item.id === tab)?.label}</h2>
          <AdminConfigHelp tab={tab} />
          <label className={sharedStyles.field}>Configuración JSON<textarea className={styles.json} spellCheck="false" value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
          {tab === 'Auth' && <>
            <label className={sharedStyles.field}>Bearer para probar la introspección<input type="password" autoComplete="off" value={authTestToken} onChange={(e) => setAuthTestToken(e.target.value)} /></label>
            <p className={styles.subtitle}>El token se usa solo para esta prueba, no se guarda y se envía al endpoint configurado.</p>
          </>}
          <div className={styles.actions}><button className={sharedStyles.secondaryButton} disabled={busy} onClick={() => load()}>Recargar</button>{tab === 'Auth' && <button className={sharedStyles.secondaryButton} disabled={busy || !authTestToken.trim()} onClick={testAuth}>Probar conexión</button>}<button className={sharedStyles.primaryButton} disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Validar y guardar'}</button></div>
        </section>
      </>}
    </>}
    {notice && <p className={`${sharedStyles.notice} ${styles.notice}`} role="status">{notice}</p>}
    {error && <div className={`${sharedStyles.error} ${styles.error}`} role="alert">{error}{error.includes('version conflict') && <button className={sharedStyles.secondaryButton} onClick={load}>Cargar última versión</button>}</div>}
  </main>;
}
