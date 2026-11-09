import React, { useState } from 'react';

const ROLES = ['General contractor', 'Electrical subcontractor', 'Mechanical / plumbing subcontractor', 'Civil / sitework subcontractor', 'Owner / facilities', 'Other'];

function PilotForm() {
  const [f, setF] = useState({ name: '', email: '', company: '', role: ROLES[1], message: '', website: '' });
  const [state, setState] = useState('idle'); const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setState('sending'); setErr('');
    try {
      const r = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Something went wrong');
      setState('sent');
    } catch (x) { setErr(x.message); setState('idle'); }
  };
  if (state === 'sent') return <div className="lp-sent" data-testid="lead-sent">Thanks! We got your request and will reach out within one business day to set up a pilot.</div>;
  return (
    <form className="lp-form" onSubmit={submit} data-testid="lead-form">
      <div className="lp-row"><input required maxLength={120} placeholder="Your name" value={f.name} onChange={set('name')} data-testid="lead-name" />
        <input required type="email" maxLength={200} placeholder="Work email" value={f.email} onChange={set('email')} data-testid="lead-email" /></div>
      <div className="lp-row"><input maxLength={160} placeholder="Company" value={f.company} onChange={set('company')} data-testid="lead-company" />
        <select value={f.role} onChange={set('role')} data-testid="lead-role">{ROLES.map((r) => <option key={r}>{r}</option>)}</select></div>
      <textarea maxLength={2000} rows={3} placeholder="Project type, size, how you handle as-builts today (optional)" value={f.message} onChange={set('message')} data-testid="lead-message" />
      <input className="hp" tabIndex={-1} autoComplete="off" placeholder="Website" value={f.website} onChange={set('website')} aria-hidden="true" />
      <button className="primary big" disabled={state === 'sending'} data-testid="lead-submit">{state === 'sending' ? 'Sending…' : 'Request a pilot'}</button>
      {err && <div className="err" data-testid="lead-error">{err}</div>}
      <div className="muted tiny">We only use this to contact you about a pilot.</div>
    </form>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      <nav className="lp-nav">
        <div className="brand">Field As-Built</div>
        <a href="/demo" className="lp-link">Demo</a>
        <a href="#pilot" className="lp-link">Request a pilot</a>
        <a href="/app" className="lp-link signin" data-testid="sign-in-link">Sign in</a>
      </nav>
      <header className="lp-hero">
        <h1>Snap a photo in the field.<br />Get the redline on the drawing.</h1>
        <p>Field As-Built turns a foreman's photo and a one-line note into a clouded redline, placed on the right sheet and ready for the PE to confirm. Your as-builts stay current all job long, instead of being rebuilt from memory at closeout.</p>
        <div className="lp-cta">
          <a className="btn primary big" href="/demo" data-testid="try-demo">Try the demo</a>
          <a className="btn big" href="#pilot">Request a pilot</a>
        </div>
        <div className="muted small">Exports editable Bluebeam / Acrobat clouds and callouts. No new markup tool to learn.</div>
      </header>

      <section className="lp-steps">
        <div><b>1 · Photo + note</b><p>The foreman picks the sheet on their phone, takes a photo, and says or types what changed: "LP-1 moved 3 ft north to clear duct." It works with no signal and syncs later.</p></div>
        <div><b>2 · Redline drafted on the drawing</b><p>Field As-Built finds the spot on the sheet and drafts a cloud and callout. Nothing hits the record set until a PE drags it into place and confirms.</p></div>
        <div><b>3 · Continuous as-builts</b><p>Export the full set or a single sheet as a PDF with real annotations, plus a markup log grouped by capture date and a CSV. Closeout is a download, not a scramble.</p></div>
      </section>

      <section className="lp-shots">
        <figure><img src="/marketing/demo-sheet.png" alt="Redlines on a sample electrical plan" loading="lazy" /><figcaption>Redlines on the sheet (sample set)</figcaption></figure>
        <figure><img src="/marketing/phone-capture.png" alt="Phone capture screen" loading="lazy" /><figcaption>Capture on the phone</figcaption></figure>
        <figure><img src="/marketing/export-log.png" alt="Exported markup log page" loading="lazy" /><figcaption>Export + markup log</figcaption></figure>
      </section>

      <section className="lp-who">
        <h2>Built for the people who own the as-builts</h2>
        <ul>
          <li><b>Electrical subcontractors</b> come first: panel moves, re-routed conduit, added circuits, and relocated devices.</li>
          <li><b>Mechanical, plumbing and civil subs</b>: field changes that never make it back to the drawings.</li>
          <li><b>General contractors</b>: one current record set across trades, with a log of who changed what and when.</li>
        </ul>
      </section>

      <section className="lp-pilot" id="pilot">
        <h2>Request a pilot</h2>
        <p className="muted">Pilots run on one active project. We load your current drawing set and your field team starts capturing the same week.</p>
        <PilotForm />
      </section>
      <footer className="lp-foot muted small">© 2026 Field As-Built · <a href="/demo">Demo</a> · <a href="/app">Sign in</a></footer>
    </div>
  );
}
