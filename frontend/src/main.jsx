import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const TYPES = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const ROLES = {
  manager: { label: 'Manager', initial: 'MV', title: 'The reserve, at a glance.', description: 'A well-kept reserve. A well-fed night.', action: 'Adjust inventory', history: 'Reserve activity', icon: 'grid' },
  vampire: { label: 'Vampire', initial: 'CA', title: 'Good taste. Fresh reserves.', description: 'Your next order is waiting in the vault.', action: 'Place an order', history: 'Your orders', icon: 'bag' },
  donor: { label: 'Donor', initial: 'RA', title: 'A little given. A night sustained.', description: 'Your contribution keeps the reserve alive.', action: 'Donate blood', history: 'Your donations', icon: 'heart' },
};
const DEMO = [
  { role: 'Manager', username: 'manager', password: 'Manager123!', icon: 'grid' },
  { role: 'Vampire', username: 'vampire', password: 'Vampire123!', icon: 'bag' },
  { role: 'Donor', username: 'donor', password: 'Donor123!', icon: 'heart' },
];

function Icon({ name = 'drop', size = 20, ...props }) {
  const paths = {
    drop: <path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    bag: <><path d="M5 7h14l1 14H4L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    heart: <path d="m12 21-8-8a5 5 0 0 1 8-7 5 5 0 0 1 8 7l-8 8Z" />,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    logout: <><path d="M9 3H4v18h5m4-14 5 5-5 5m-5-5h14" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    refresh: <><path d="M20 7a9 9 0 1 0 1 8M20 2v6h-6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.drop}</svg>;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  } catch {
    throw new Error('Unable to reach the bank. Check your connection and try again.');
  }
  if (!response.ok) {
    let detail;
    try { detail = (await response.json()).detail; } catch { /* Fall back to a readable message. */ }
    const error = new Error(typeof detail === 'string' ? detail : 'Please check your entries and try again.');
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><Icon size={23} /></span><div>VAMPIRE<span>BLOOD BANK</span></div></div>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [captcha, setCaptcha] = useState(null);
  const [choice, setChoice] = useState('');
  const usernameRef = useRef(null);
  async function loadCaptcha() {
    setChoice(''); setCaptcha(null);
    try { setCaptcha(await api('/captcha')); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { loadCaptcha(); }, []);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!captcha || !choice) { setError('Answer the vampire verification first.'); return; }
    setBusy(true); setError('');
    try { onLogin(await api('/login', { method: 'POST', body: JSON.stringify({ username, password, captcha_id: captcha.id, captcha_answer: choice }) })); }
    catch (err) { setError(err.message); loadCaptcha(); }
    finally { setBusy(false); }
  }
  return <main className="login-layout">
    <section className="login-story">
      <Brand />
      <div className="story-copy"><span className="eyebrow">THE NIGHT’S MOST TRUSTED RESERVE</span><h1>Life after dark.<br /><em>Well supplied.</em></h1><p>A private reserve for extraordinary appetites.<br />Give generously. Order discreetly. Keep the night alive.</p></div>
      <div className="seal" aria-hidden="true"><span>VAMPIRE BLOOD BANK</span><Icon size={66} /><span>EST. 1897 · OPEN AFTER DARK</span></div>
      <div className="story-footer"><span className="status-dot" /> YOUR NIGHT. OUR RESERVE.<span>EST. 1897</span></div>
    </section>
    <section className="login-panel"><div className="login-box"><span className="eyebrow">MEMBER ACCESS</span><h2>Welcome to the night.</h2><p className="muted">Sign in to your blood bank account.</p>
      <form onSubmit={submit}>
        <label htmlFor="username">Username</label><input ref={usernameRef} id="username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" placeholder="Enter your username" required maxLength={80} />
        <label htmlFor="password">Password</label><input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="Enter your password" required maxLength={200} />
        <fieldset className="captcha" disabled={busy}><legend>Vampire verification</legend>
          {captcha ? <><p id="captcha-question">{captcha.question}</p><div className="captcha-options" role="radiogroup" aria-labelledby="captcha-question">{captcha.options.map(option => <button type="button" role="radio" aria-checked={choice === option} className={`captcha-option ${choice === option ? 'selected' : ''}`} key={option} onClick={() => setChoice(option)}>{option}</button>)}</div></> : <p className="muted">Consulting the night watch…</p>}
          <button type="button" className="captcha-skip" onClick={loadCaptcha}>Ask me something else</button>
        </fieldset>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Enter the bank'}<Icon name="arrow" size={18} /></button>
      </form>
      <div className="demo-heading"><span>EXPLORE THE DEMO</span><span>3 account types</span></div>
      <div className="demo-accounts">{DEMO.map(account => <button className="demo-account" key={account.username} disabled={busy} onClick={() => { setUsername(account.username); setPassword(account.password); setError(''); usernameRef.current?.focus(); }}><Icon name={account.icon} /><div><strong>{account.role}</strong><span>{account.username} / {account.password}</span></div><Icon name="arrow" size={16} /></button>)}</div>
      <p className="login-footnote"><Icon name="lock" size={13} /> Fictional blood bank · Local demonstration</p>
    </div></section>
  </main>;
}

function TransactionForm({ user, inventory, selected, onSelected, onSuccess, onExpired }) {
  const manager = user.role === 'manager';
  const [type, setType] = useState(selected || 'O+');
  const [units, setUnits] = useState(manager ? inventory[selected || 'O+'] : 1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  useEffect(() => {
    setType(selected || 'O+');
    setUnits(manager ? inventory[selected || 'O+'] : 1);
    setMessage(null);
  }, [selected, manager]);
  const available = inventory[type];
  const maximum = manager ? 10000 : user.role === 'vampire' ? Math.min(100, available) : 100;
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const path = manager ? '/inventory' : user.role === 'vampire' ? '/orders' : '/donations';
      await api(path, { method: 'POST', body: JSON.stringify({ blood_type: type, units: Number(units), ...(manager ? { reason: reason.trim() } : {}) }) });
      setMessage({ kind: 'success', text: manager ? `${type} inventory updated to ${units} bags.` : user.role === 'vampire' ? `Order confirmed. ${units} bag${Number(units) === 1 ? '' : 's'} of ${type} reserved for you.` : `Thank you! ${units} bag${Number(units) === 1 ? '' : 's'} of ${type} added to the reserve.` });
      setReason('');
      if (!manager) setUnits(1);
      await onSuccess();
    } catch (err) {
      if (err.status === 401) onExpired();
      else setMessage({ kind: 'error', text: err.message });
    } finally { setBusy(false); }
  }
  function changeType(value) {
    setType(value); onSelected(value); setMessage(null);
    if (manager) setUnits(inventory[value]);
  }
  return <section className="panel action-panel" id="action"><div className="panel-heading"><span className="icon-tile"><Icon name={ROLES[user.role].icon} /></span><div><h3>{ROLES[user.role].action}</h3><p>{manager ? 'Keep your records in good order.' : user.role === 'vampire' ? 'Something to see you through the night.' : 'A generous gesture goes a long way.'}</p></div></div>
    <form onSubmit={submit}>
      <label htmlFor="blood-type">Blood type</label><select id="blood-type" value={type} onChange={e => changeType(e.target.value)} disabled={busy}>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
      <div className="field-label"><label htmlFor="units">{manager ? 'New stock quantity' : 'Quantity'}</label><span>{available} bags available</span></div>
      <div className="quantity-field"><input id="units" type="number" min={manager ? 0 : 1} max={maximum || 1} step="1" value={units} onChange={e => setUnits(e.target.value)} required disabled={busy} /><span>bags</span></div>
      {manager && <><label htmlFor="reason">Reason for adjustment</label><input id="reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Stock reconciliation" minLength={3} maxLength={200} required disabled={busy} /></>}
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`notice ${message.kind}`}>{message.text}</p>}
      <button className="primary" disabled={busy || (user.role === 'vampire' && available === 0)}>{busy ? 'Processing…' : user.role === 'vampire' && available === 0 ? 'Currently out of stock' : manager ? 'Update inventory' : user.role === 'vampire' ? 'Confirm order' : 'Confirm donation'}<Icon name="arrow" size={17} /></button>
      <p className="form-note">{manager ? 'Changes are recorded in the activity log.' : user.role === 'vampire' ? 'Confirmed orders are deducted from stock immediately.' : 'Donations are added to available stock immediately.'}</p>
    </form>
  </section>;
}

function Activity({ transactions, user }) {
  const [filter, setFilter] = useState('all');
  const filtered = transactions.filter(t => filter === 'all' || t.kind === filter);
  return <section className="panel activity-panel" id="activity"><div className="section-heading"><div><span className="eyebrow">THE LEDGER</span><h3>{ROLES[user.role].history}</h3></div>{user.role === 'manager' && <select aria-label="Filter activity" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All activity</option><option value="order">Orders</option><option value="donation">Donations</option><option value="adjustment">Adjustments</option></select>}</div>
    {filtered.length === 0 ? <div className="empty-state"><Icon name="clock" size={27} /><h4>A quiet night. For now.</h4><p>{filter !== 'all' ? 'No activity matches this filter.' : user.role === 'manager' ? 'Orders, donations, and stock adjustments will appear here.' : user.role === 'vampire' ? 'Your first order will appear here once confirmed.' : 'Your first contribution starts the story.'}</p></div> : <div className="table-wrap"><table><thead><tr><th>{user.role === 'manager' ? 'Activity / member' : 'Reference / date'}</th><th>Blood type</th><th>Bags</th><th>Status</th></tr></thead><tbody>{filtered.slice(0, 50).map(t => <tr key={t.id}><td><strong>{user.role === 'manager' ? `${t.kind[0].toUpperCase()}${t.kind.slice(1)} · ${t.name}` : `#${t.id.slice(0, 8).toUpperCase()}`}</strong><span>{new Date(t.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{t.reason ? ` · ${t.reason}` : ''}</span></td><td><span className="blood-tag">{t.blood_type}</span></td><td className={t.change > 0 ? 'positive' : ''}>{t.change > 0 ? '+' : ''}{t.change}</td><td><span className="complete"><Icon name="check" size={12} /> Completed</span></td></tr>)}</tbody></table>{filtered.length > 50 && <p className="form-note">Showing the latest 50 of {filtered.length} records.</p>}</div>}
  </section>;
}

function Dashboard({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState('O+');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const role = ROLES[user.role];
  async function refresh() {
    setRefreshing(true);
    try { setData(await api('/dashboard')); setError(''); }
    catch (err) { if (err.status === 401) onLogout(); else setError(err.message); }
    finally { setRefreshing(false); }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, []);
  async function logout() {
    setLogoutBusy(true);
    try { await api('/logout', { method: 'POST' }); onLogout(); }
    catch (err) { setError(err.message); setLogoutBusy(false); }
  }
  const total = data ? Object.values(data.inventory).reduce((sum, n) => sum + n, 0) : 0;
  const low = data ? TYPES.filter(t => data.inventory[t] < 10).length : 0;
  const contributions = data ? data.transactions.filter(t => t.kind === (user.role === 'donor' ? 'donation' : 'order')).reduce((sum, t) => sum + t.units, 0) : 0;
  function chooseType(type) { setSelected(type); document.getElementById('action')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  return <div className="app-layout">
    <aside className="sidebar"><Brand /><div className="workspace-label">YOUR WORKSPACE</div><nav aria-label="Main navigation"><a className="nav-link active" href="#overview"><Icon name="grid" />Overview<span>01</span></a><a className="nav-link" href="#inventory"><Icon />Blood inventory</a><a className="nav-link" href="#action"><Icon name={role.icon} />{role.action}</a><a className="nav-link" href="#activity"><Icon name="clock" />{role.history}</a></nav><div className="sidebar-note"><span className="moon" aria-hidden="true">☾</span><h4>Always after hours.</h4><p>A little reserve for<br />whatever the night brings.</p><span className="eyebrow">EST. 1897</span></div><div className="sidebar-bottom"><span className="status-dot" /> PRIVATE RESERVE <span>V.01</span></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace<span>/</span><strong>Overview</strong></div><div className="account"><span className="role-badge">{role.label}</span><span className="avatar">{role.initial}</span><div className="account-name"><strong>{user.name}</strong><span>{role.label} account</span></div><button className="icon-button" title="Sign out" aria-label="Sign out" disabled={logoutBusy} onClick={logout}><Icon name="logout" size={18} /></button></div></header>
    <main className="dashboard" id="overview"><div className="page-heading"><div><span className="eyebrow">VAMPIRE BLOOD BANK / PRIVATE RESERVE</span><h1>{role.title}</h1><p>{role.description}</p></div><button className="secondary" onClick={refresh} disabled={refreshing}><Icon name="refresh" size={15} />{refreshing ? 'Refreshing…' : 'Refresh stock'}</button></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!data ? <div className="panel loading" role="status">{error ? 'The reserve could not be loaded. Use Refresh stock to retry.' : 'Opening the reserve…'}</div> : <>
      <div className="stats-grid"><article className="stat"><div><span>Total reserve</span><Icon /></div><strong>{total.toLocaleString()}<small>bags</small></strong><p><span className="status-dot" /> Across all 8 blood types</p></article><article className="stat"><div><span>{user.role === 'manager' ? 'Blood types running low' : user.role === 'donor' ? 'Your total contribution' : 'Your total ordered'}</span><Icon name={user.role === 'manager' ? 'bag' : role.icon} /></div><strong>{user.role === 'manager' ? low : contributions}<small>{user.role === 'manager' ? 'of 8 types' : 'bags'}</small></strong><p>{user.role === 'manager' ? 'Below 10 bags · consider replenishing' : user.role === 'donor' ? 'Every contribution keeps the night alive' : 'A record of your excellent taste'}</p></article><article className="stat accent-stat"><div><span>{user.role === 'manager' ? 'Recorded transactions' : 'Your completed transactions'}</span><Icon name="check" /></div><strong>{data.transactions.length.toString().padStart(2, '0')}<small>completed</small></strong><p>Every bag accounted for.</p></article></div>
      <div className="workspace-grid"><section className="inventory-section" id="inventory"><div className="section-heading"><div><span className="eyebrow">IN THE VAULT</span><h2>Blood inventory</h2></div><span className="inventory-unit">1 bag = 1 unit</span></div><div className="blood-grid">{TYPES.map(type => <button key={type} aria-pressed={selected === type} className={`blood-card ${selected === type ? 'selected' : ''}`} onClick={() => chooseType(type)}><div className="blood-card-top"><span className="drop-tile"><Icon size={21} /></span><span className={`stock-status ${data.inventory[type] === 0 ? 'out' : data.inventory[type] < 10 ? 'low' : ''}`}><i />{data.inventory[type] === 0 ? 'Out of stock' : data.inventory[type] < 10 ? 'Low stock' : 'Available'}</span></div><strong className="blood-type">{type}</strong><div className="blood-card-bottom"><span><b>{data.inventory[type]}</b> bags</span><Icon name="arrow" size={17} /></div></button>)}</div><div className="inventory-note"><Icon name="lock" size={14} /><span>Carefully stored. Individually accounted for.</span></div></section><TransactionForm user={user} inventory={data.inventory} selected={selected} onSelected={setSelected} onSuccess={refresh} onExpired={onLogout} /></div>
      <Activity transactions={data.transactions} user={user} />
      </>}
      <footer className="page-footer"><span>VAMPIRE BLOOD BANK</span><span>Keep the night alive.<span className="footer-star">✦</span></span></footer>
    </main></div>
  </div>;
}

function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  async function restore() {
    setError('');
    try { setUser(await api('/me')); }
    catch (err) { if (err.status !== 401) setError(err.message); }
    finally { setReady(true); }
  }
  useEffect(() => { restore(); }, []);
  if (!ready || error) return <main className="startup"><Brand /><p role="status">{error || 'Opening the reserve…'}</p>{error && <button className="secondary" onClick={restore}>Try again</button>}</main>;
  return user ? <Dashboard key={user.id} user={user} onLogout={() => setUser(null)} /> : <Login onLogin={setUser} />;
}

createRoot(document.getElementById('root')).render(<App />);
