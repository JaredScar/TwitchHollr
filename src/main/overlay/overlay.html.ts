export const OVERLAY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Hollr Overlay</title>
<style>
  :root { --bg: rgba(14, 14, 20, 0.86); --fg: #fff; --muted: #b9b9c6; --accent: #9147ff; --pink: #f5009b; --blue: #387aff; }
  html, body { margin: 0; background: transparent; font-family: 'Segoe UI', Inter, system-ui, sans-serif; color: var(--fg); }
  #wrap { position: fixed; left: 24px; bottom: 24px; width: 420px; display: flex; flex-direction: column; gap: 12px; }
  .card { background: var(--bg); border-radius: 14px; padding: 16px 18px; box-shadow: 0 8px 30px rgba(0,0,0,.35);
          transform: translateY(16px); opacity: 0; transition: all .35s ease; }
  .card.show { transform: none; opacity: 1; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 10px; }
  .title { font-size: 20px; font-weight: 700; }
  .meta { color: var(--muted); font-size: 14px; white-space: nowrap; }
  .row { position: relative; margin: 6px 0; height: 34px; border-radius: 8px; background: rgba(255,255,255,.08); overflow: hidden; }
  .bar { position: absolute; inset: 0 auto 0 0; background: var(--accent); transition: width .5s ease; }
  .row.win .bar { background: #00c27a; }
  .label { position: absolute; inset: 0; display: flex; justify-content: space-between; align-items: center; padding: 0 12px; font-weight: 600; }
  #toast { align-self: flex-start; background: var(--accent); padding: 8px 14px; border-radius: 999px; font-weight: 600; }
</style>
</head>
<body>
<div id="wrap">
  <div id="toast" class="card"></div>
  <div id="pred" class="card"></div>
  <div id="poll" class="card"></div>
</div>
<script>
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let state = { activePoll: null, lastPoll: null, activePrediction: null };
  let hideLastAt = 0;

  function rows(items, total, winnerId) {
    return items.map((c) => {
      const pct = total ? Math.round((c.n / total) * 100) : 0;
      return '<div class="row' + (c.id === winnerId ? ' win' : '') + '"><div class="bar" style="width:' + pct + '%;' +
        (c.color ? 'background:' + c.color : '') + '"></div><div class="label"><span>' + esc(c.title) +
        '</span><span>' + pct + '%</span></div></div>';
    }).join('');
  }

  function render() {
    const poll = state.activePoll || (Date.now() < hideLastAt ? state.lastPoll : null);
    const pollEl = $('poll');
    if (poll) {
      const items = poll.choices.map((c) => ({ id: c.id, title: c.title, n: c.votes }));
      const total = items.reduce((a, c) => a + c.n, 0);
      const top = poll.status === 'ACTIVE' ? null : items.slice().sort((a, b) => b.n - a.n)[0];
      let meta = total + ' votes';
      if (poll.status === 'ACTIVE' && poll.endsAt) meta = Math.max(0, Math.round((Date.parse(poll.endsAt) - Date.now()) / 1000)) + 's · ' + meta;
      else meta = 'Final · ' + meta;
      pollEl.innerHTML = '<div class="head"><div class="title">' + esc(poll.title) + '</div><div class="meta">' + meta + '</div></div>' +
        rows(items, total, top && top.id);
      pollEl.classList.add('show');
    } else pollEl.classList.remove('show');

    const p = state.activePrediction;
    const predEl = $('pred');
    if (p) {
      const colors = { BLUE: 'var(--blue)', PINK: 'var(--pink)' };
      const items = p.outcomes.map((o) => ({ id: o.id, title: o.title, n: o.channelPoints, color: colors[o.color] }));
      const total = items.reduce((a, c) => a + c.n, 0);
      const meta = p.status === 'LOCKED' ? 'Locked' : p.locksAt ? Math.max(0, Math.round((Date.parse(p.locksAt) - Date.now()) / 1000)) + 's left' : '';
      predEl.innerHTML = '<div class="head"><div class="title">🔮 ' + esc(p.title) + '</div><div class="meta">' + meta + '</div></div>' + rows(items, total, p.winningOutcomeId);
      predEl.classList.add('show');
    } else predEl.classList.remove('show');
  }

  let toastTimer;
  function toast(text) {
    const el = $('toast');
    el.textContent = '📣 ' + text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function connect() {
    const es = new EventSource('/events');
    es.addEventListener('state', (e) => {
      const next = JSON.parse(e.data);
      if (state.activePoll && !next.activePoll) hideLastAt = Date.now() + 15000;
      state = next;
      render();
    });
    es.addEventListener('toast', (e) => toast(JSON.parse(e.data).text));
    es.onerror = () => { es.close(); setTimeout(connect, 2000); };
  }
  connect();
  setInterval(render, 1000);
</script>
</body>
</html>`;
