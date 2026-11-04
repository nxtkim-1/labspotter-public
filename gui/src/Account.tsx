import React, { useEffect, useState } from 'react';
import { ABOUT } from './about';

type User = { id: string; name: string } | null;
type Me = { user: User; signup: 'open' | 'invite' };
const post = async (path: string, body: object) => {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j && j.error ? String(j.error) : 'Request failed (' + r.status + ')');
    return j;
};

function Preview() {
    return <div className="lp-preview" role="img" aria-label="Illustration of the LabSpotter guide screen">
        <div className="lp-pv-top"><span>STEP 2 OF 4</span><span className="lp-pv-pause">Pause</span></div>
        <p className="lp-pv-step">Stir the solution gently for ten seconds.</p>
        <div className="lp-pv-sug"><i />Clip looks like: stirring<small>Suggestion only, not confirmed</small></div>
        <div className="lp-pv-row"><span className="lp-pv-btn">Correct</span><span className="lp-pv-btn alt">Add a video</span></div>
        <div className="lp-pv-bar"><b style={{ width: '25%' }} /></div><small className="lp-pv-cap">1 of 4 done. Illustration.</small>
    </div>;
}

function Landing({ onGo, onApp, user }: { onGo: (m: 'login' | 'signup') => void; onApp?: () => void; user?: User }) {
    return <div className="acct-root lp">
        <div className="lp-dark">
            <nav className="lp-nav"><span className="lp-logo"><img src={import.meta.env.BASE_URL + 'brand/labspotter-mark-light.svg'} width={32} height={32} alt="LabSpotter logo" />LabSpotter</span>
                <span className="lp-navr">{user ? <button className="as-btn" onClick={onApp}>Open the app</button> : <><button className="lp-signin" onClick={() => onGo('login')}>Sign in</button><button className="as-btn lp-nav-cta" onClick={() => onGo('signup')}>Create account</button></>}</span></nav>
            <header className="lp-hero"><div className="lp-hero-t">
                <span className="lp-eyebrow">A second pair of eyes for the bench</span>
                <h1>{ABOUT.headline}</h1>
                <p>{ABOUT.sub}</p>
                {!user && <div className="lp-cta"><button className="as-btn big lp-primary" onClick={() => onGo('signup')}>Get started</button><button className="lp-ghost" onClick={() => onGo('login')}>Sign in</button></div>}
            </div><Preview /></header>
        </div>
        <section className="lp-sec"><h2>How it works</h2>
            <div className="lp-steps">{ABOUT.how.map((h, i) => <div className="lp-step" key={h.t}><b>{i + 1}</b><h3>{h.t}</h3><p>{h.d}</p></div>)}</div></section>
        <section className="lp-sec"><h2>You stay in charge</h2>
            <div className="lp-pr">{ABOUT.principles.map(h => <div className="lp-prin" key={h.t}><h3>{h.t}</h3><p>{h.d}</p></div>)}</div></section>
        <section className="lp-band"><span className="lp-eyebrow">Our mission</span><p>{ABOUT.mission}</p></section>
        <footer className="lp-foot"><b>{ABOUT.by}</b><p className="acct-hint">{ABOUT.limits}</p></footer>
    </div>;
}

function Auth({ me, start, onAuthed, onBack }: { me: Me; start: 'login' | 'signup'; onAuthed: (u: User) => void; onBack: () => void }) {
    const [mode, setMode] = useState<'login' | 'signup'>(start);
    const [name, setName] = useState(''); const [pw, setPw] = useState(''); const [invite, setInvite] = useState('');
    const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
    const go = async (e: React.FormEvent) => {
        e.preventDefault(); setErr(''); setBusy(true);
        try { const j = await post(mode === 'login' ? '/api/auth/login' : '/api/auth/signup', { username: name, password: pw, invite }); onAuthed(j.user); }
        catch (x: any) { setErr(x.message); } finally { setBusy(false); }
    };
    return <div className="acct-root"><div className="acct-page acct-narrow">
        <button className="as-link" onClick={onBack}>Back to home</button>
        <section className="acct-card acct-form"><h1 className="acct-h">{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
            <form onSubmit={go}>
                <label>Username<input value={name} onChange={e => setName(e.target.value)} autoComplete="username" required minLength={3} maxLength={32} /></label>
                <label>Password<input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 10} /></label>
                {mode === 'signup' && <p className="acct-hint">At least 10 characters. There is no email and no password recovery, so keep it somewhere safe.</p>}
                {mode === 'signup' && me.signup === 'invite' && <label>Invite code<input value={invite} onChange={e => setInvite(e.target.value)} required /></label>}
                {err && <p className="acct-err" role="alert">{err}</p>}
                <button className="as-btn big" disabled={busy}>{busy ? 'One moment' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
            </form>
            <button className="as-link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }}>{mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}</button>
        </section>
    </div></div>;
}

function ThemeChoice() {
    const [theme, setTheme] = useState(() => localStorage.getItem('labspotter_theme') || 'light');
    return <label>Theme <select aria-label="Theme" value={theme} onChange={e => { const v=e.target.value; setTheme(v); localStorage.setItem('labspotter_theme',v); document.documentElement.dataset.theme=v; }}><option value="light">Light</option><option value="dark">Dark</option></select><p className="as-quiet">Remembered on this browser.</p></label>;
}
function Settings({ user, onOut, onBack }: { user: NonNullable<User>; onOut: () => void; onBack: () => void }) {
    const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [delPw, setDelPw] = useState('');
    const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
    const run = async (f: () => Promise<void>) => { setMsg(''); setErr(''); try { await f(); } catch (x: any) { setErr(x.message); } };
    return <div className="acct-root"><div className="acct-page">
        <button className="as-link" onClick={onBack}>Back to the app</button>
        <h1>Settings</h1>
        <section className="acct-card"><h2>Appearance</h2><ThemeChoice /></section>
        <section className="acct-card"><h2>Account</h2><p>Signed in as <b>{user.name}</b>.</p>
            <button className="as-btn alt" onClick={() => run(async () => { await post('/api/auth/logout', {}); onOut(); })}>Sign out</button></section>
        <section className="acct-card acct-form"><h2>Change password</h2>
            <form onSubmit={e => { e.preventDefault(); run(async () => { await post('/api/auth/password', { current: cur, new: nw }); setMsg('Password changed. Please sign in again.'); setTimeout(onOut, 1200); }); }}>
                <label>Current password<input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" required /></label>
                <label>New password (10 or more characters)<input type="password" value={nw} onChange={e => setNw(e.target.value)} autoComplete="new-password" required minLength={10} /></label>
                <button className="as-btn alt">Change password</button></form></section>
        <section className="acct-card acct-form"><h2>Your data</h2>
            <p>Your notes and saved sessions are stored on this website under your account. Nobody else can open them through the app. Keep a copy of anything important elsewhere too.</p>
            <form onSubmit={e => { e.preventDefault(); if (!window.confirm('Delete your account and everything saved under it? This cannot be undone.')) return; run(async () => { await post('/api/auth/delete', { password: delPw }); onOut(); }); }}>
                <label>Password to confirm<input type="password" value={delPw} onChange={e => setDelPw(e.target.value)} autoComplete="current-password" required /></label>
                <button className="as-btn alt acct-danger">Delete my account and data</button></form></section>
        {msg && <p className="acct-ok" role="status">{msg}</p>}{err && <p className="acct-err" role="alert">{err}</p>}
    </div></div>;
}

// Wraps the app. On a local run /api/auth/me answers 404 and the app renders unchanged. On a hosted site it
// shows the Home/sign-in page until the visitor signs in, then the app plus an Account strip (Home, Settings).
export function AccountGate({ children }: { children: React.ReactNode }) {
    const [me, setMe] = useState<Me | null | 'local'>(null);
    const [page, setPage] = useState<'app' | 'settings' | 'home'>('app');
    const [pub, setPub] = useState<'home' | 'login' | 'signup'>('home');
    useEffect(() => {
        fetch('/api/auth/me').then(async r => { if (!r.ok) { setMe('local'); return; } setMe(await r.json()); }).catch(() => setMe('local'));
    }, []);
    if (me === null) return <div className="acct-root"><div className="acct-page"><p className="acct-hint">Loading</p></div></div>;
    if (me === 'local') return <>{children}</>;
    const user = me.user;
    const setUser = (u: User) => { setMe({ ...me, user: u }); setPage('app'); };
    if (!user) return pub === 'home' ? <Landing onGo={setPub} /> : <Auth me={me} start={pub} onAuthed={setUser} onBack={() => setPub('home')} />;
    if (page === 'settings') return <Settings user={user} onOut={() => setUser(null)} onBack={() => setPage('app')} />;
    if (page === 'home') return <div><div className="acct-strip"><button className="as-link" onClick={() => setPage('app')}>Back to the app</button></div><Landing user={user} onGo={() => { }} onApp={() => setPage('app')} /></div>;
    return <><div className="acct-strip"><span>{user.name}</span><button className="as-link" onClick={() => setPage('home')}>About</button><button className="as-link" onClick={() => setPage('settings')}>Settings</button></div>{children}</>;
}
