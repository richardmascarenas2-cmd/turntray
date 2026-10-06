/* Setup page (admins): name and logos, territories, accounts, trays, biologics stock, team.
   Uses the app's globals from index.html (db, adb, agency, me, inventoryMap, membersList, toast, $ ...). */
(function(){
  const FV = () => firebase.firestore.FieldValue;
  const msg = (id, text, kind) => { const m = $(id); m.textContent = text || ''; m.className = 'status-msg' + (kind ? ' ' + kind : ''); };
  const norm = s => String(s == null ? '' : s).trim();
  const upper = s => norm(s).toUpperCase();

  /* ---------- spreadsheet import (paste, .csv/.tsv, .xlsx) ---------- */
  function parseDelimited(text){
    text = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
    const firstLine = text.split('\n').find(l => l.trim()) || '';
    const delim = firstLine.includes('\t') ? '\t' : (firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',');
    const rows = []; let row = [], cell = '', q = false;
    for(let i = 0; i < text.length; i++){
      const ch = text[i];
      if(q){ if(ch === '"'){ if(text[i+1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if(ch === '"' && cell === '') q = true;
      else if(ch === delim){ row.push(cell); cell = ''; }
      else if(ch === '\n'){ row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    row.push(cell); rows.push(row);
    return rows.map(r => r.map(norm)).filter(r => r.some(Boolean));
  }
  /* Maps columns by a header row when there is one ("Account code", "Qty"...), otherwise by position. */
  function toRecords(rows, fields){
    if(!rows.length) return [];
    const head = rows[0].map(h => h.toLowerCase());
    const idx = {}; let hits = 0;
    fields.forEach((f, pos) => {
      const i = head.findIndex(h => f.names.some(n => h === n || h.includes(n)));
      if(i >= 0 && !Object.values(idx).includes(i)){ idx[f.key] = i; hits++; } else idx[f.key] = pos;
    });
    const body = hits ? rows.slice(1) : rows;
    if(!hits) fields.forEach((f, pos) => { idx[f.key] = pos; });
    return body.map(r => { const o = {}; fields.forEach(f => { o[f.key] = norm(r[idx[f.key]]); }); return o; });
  }
  let xlsxLoading = null;
  function loadXlsx(){
    if(window.XLSX) return Promise.resolve();
    if(!xlsxLoading) xlsxLoading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = res; s.onerror = () => { xlsxLoading = null; rej(new Error('Could not load the Excel reader. Save the sheet as .csv and try again.')); }; document.head.appendChild(s); });
    return xlsxLoading;
  }
  async function readImport(pasteSel, fileSel){
    const f = $(fileSel).files[0];
    if(f){
      if(/\.xlsx?$/i.test(f.name)){
        await loadXlsx();
        const wb = XLSX.read(await f.arrayBuffer(), {type:'array'});
        return parseDelimited(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], {FS:'\t', blankrows:false}));
      }
      return parseDelimited(await f.text());
    }
    return parseDelimited($(pasteSel).value);
  }
  function clearImport(pasteSel, fileSel){ $(pasteSel).value = ''; $(fileSel).value = ''; }
  ['#acct-file','#tray-file','#bio-file'].forEach(sel => $(sel).addEventListener('change', e => {
    const f = e.target.files[0]; const box = e.target.closest('details');
    const ta = box.querySelector('textarea'); if(f) ta.placeholder = `Ready to import ${f.name}. Tap Import.`;
  }));

  /* ---------- 1. name and logos ---------- */
  let branding = {};
  async function loadBrandingDoc(){
    try{ const d = await adb.doc('meta/branding').get(); branding = d.exists ? d.data() : {}; }catch(e){ branding = {}; }
    renderLogos();
  }
  function renderLogos(){
    const shown = TT.cachedBranding() || {};
    document.querySelectorAll('.logo-pick').forEach(box => {
      const k = box.dataset.key;
      const src = branding[k] || shown[k] || (k === 'logo' ? 'icon-192.png' : k === 'bioLogo' ? 'bio-icon-192.png' : '');
      const img = box.querySelector('[data-preview]'); img.hidden = !src; if(src) img.src = src;
      box.querySelector('[data-remove]').hidden = !(branding[k] || shown[k]);
    });
  }
  async function saveBranding(patch, done){
    try{
      await adb.doc('meta/branding').set(patch, {merge:true});
      Object.entries(patch).forEach(([k, v]) => { if(v && typeof v === 'object') delete branding[k]; else branding[k] = v; });
      const b = await TT.loadBranding(db, agency.id); TT.applyBranding(b, 'inv'); renderLogos(); msg('#brand-msg', done, 'ok');
    }catch(e){ console.error(e); msg('#brand-msg', 'Could not save the image. Only admins can change it.', 'err'); }
  }
  document.querySelectorAll('.logo-pick').forEach(box => {
    const k = box.dataset.key;
    box.querySelector('input[type=file]').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = ''; if(!f) return;
      msg('#brand-msg', 'Saving…');
      try{ const data = await TT.imageToData(f, 256); await saveBranding({[k]: data}, 'Saved. Your team sees it next time they open the app.'); }
      catch(err){ msg('#brand-msg', err.message, 'err'); }
    });
    box.querySelector('[data-remove]').addEventListener('click', () => saveBranding({[k]: FV().delete()}, 'Back to the default image.'));
  });
  $('#agency-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = norm($('#agency-name').value);
    if(!name){ msg('#agency-msg', 'Enter the agency name.', 'err'); return; }
    try{ await adb.agencyDoc().update({name, updatedAt: Date.now(), updatedByName: me.name}); msg('#agency-msg', 'Saved.', 'ok'); }
    catch(err){ console.error(err); msg('#agency-msg', 'Could not save. Only admins can change the agency.', 'err'); }
  });

  /* ---------- 2. territories ---------- */
  const storedAccounts = () => ((agency && agency.accounts) || []).map(a => ({c: norm(a.c), n: norm(a.n), t: norm(a.t)})).filter(a => a.c);
  const storedTerrs = () => ((agency && agency.territories) || []).map(norm).filter(Boolean);
  function allTerrs(){
    const m = new Map();
    [...storedTerrs(), ...storedAccounts().map(a => a.t)].forEach(t => { if(t && !m.has(t.toLowerCase())) m.set(t.toLowerCase(), t); });
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  }
  async function saveAgency(patch){ await adb.agencyDoc().update({...patch, updatedAt: Date.now(), updatedByName: me.name}); }
  function renderTerrs(){
    const terrs = allTerrs(), accts = storedAccounts();
    $('#terr-count').textContent = terrs.length ? `${terrs.length}` : '';
    const wrap = $('#terr-chips'); wrap.innerHTML = terrs.length ? '' : '<span class="hint" style="margin:0;">None yet.</span>';
    terrs.forEach(t => {
      const n = accts.filter(a => a.t.toLowerCase() === t.toLowerCase()).length;
      const c = document.createElement('span'); c.className = 'terr-chip';
      c.innerHTML = `<span></span>${n ? `<small>${n}</small>` : ''}<button type="button" aria-label="Remove">×</button>`;
      c.querySelector('span').textContent = t;
      const del = c.querySelector('button');
      del.onclick = async () => {
        if(n && !armed(del, `×  ${n} accounts use it, tap to remove`)) return;
        try{ await saveAgency({territories: storedTerrs().filter(x => x.toLowerCase() !== t.toLowerCase()), ...(n ? {accounts: storedAccounts().map(a => a.t.toLowerCase() === t.toLowerCase() ? {...a, t:''} : a)} : {})}); msg('#terr-msg', `Removed ${t}.`, 'ok'); }
        catch(e){ console.error(e); msg('#terr-msg', 'Could not save.', 'err'); }
      };
      wrap.appendChild(c);
    });
    const sel = $('#acct-new-terr'), cur = sel.value;
    sel.innerHTML = '<option value="">Territory…</option>' + terrs.map(t => `<option>${escapeHtml(t)}</option>`).join('');
    if(cur) sel.value = cur;
  }
  $('#terr-form').addEventListener('submit', async e => {
    e.preventDefault();
    const t = norm($('#terr-new').value); if(!t) return;
    if(allTerrs().some(x => x.toLowerCase() === t.toLowerCase())){ msg('#terr-msg', `${t} is already there.`, 'err'); return; }
    try{ await saveAgency({territories: [...storedTerrs(), t]}); $('#terr-new').value = ''; msg('#terr-msg', `Added ${t}.`, 'ok'); }
    catch(err){ console.error(err); msg('#terr-msg', 'Could not save.', 'err'); }
  });

  /* ---------- 3. accounts ---------- */
  const SHOW = 200;
  function renderAccounts(){
    const accts = storedAccounts(), terrs = allTerrs();
    $('#acct-count').textContent = accts.length ? `${accts.length}` : '';
    const q = norm($('#acct-search').value).toLowerCase();
    const list = accts.map((a, i) => ({...a, i})).filter(a => !q || [a.c, a.n, a.t].join(' ').toLowerCase().includes(q)).sort((a, b) => a.c.localeCompare(b.c));
    const box = $('#acct-table');
    if(box.contains(document.activeElement)) return;   // don't redraw under someone typing
    box.innerHTML = '';
    list.slice(0, SHOW).forEach(a => {
      const r = document.createElement('div'); r.className = 'st-row';
      r.innerHTML = `<input aria-label="Code" maxlength="30"><input aria-label="Name" maxlength="120"><select aria-label="Territory"><option value="">—</option>${terrs.map(t => `<option>${escapeHtml(t)}</option>`).join('')}</select><button type="button" class="del" aria-label="Remove account">×</button>`;
      const [ci, ni] = r.querySelectorAll('input'), ts = r.querySelector('select');
      ci.value = a.c; ni.value = a.n; ts.value = terrs.find(t => t.toLowerCase() === a.t.toLowerCase()) || '';
      const commit = async () => {
        const c = upper(ci.value), n = norm(ni.value), t = ts.value;
        if(!c){ ci.value = a.c; return; }
        if(c === a.c && n === a.n && t === (terrs.find(x => x.toLowerCase() === a.t.toLowerCase()) || '')) return;
        const all = storedAccounts();
        if(c !== a.c && all.some(x => x.c.toUpperCase() === c)){ msg('#acct-msg', `${c} already exists.`, 'err'); ci.value = a.c; return; }
        all[a.i] = {c, n, t};
        try{ await saveAgency({accounts: all}); msg('#acct-msg', `Saved ${c}.`, 'ok'); }catch(e){ console.error(e); msg('#acct-msg', 'Could not save.', 'err'); }
      };
      ci.addEventListener('change', commit); ni.addEventListener('change', commit); ts.addEventListener('change', commit);
      const del = r.querySelector('.del');
      del.onclick = async () => {
        if(!armed(del, '✓')) return;
        try{ await saveAgency({accounts: storedAccounts().filter((x, j) => j !== a.i)}); msg('#acct-msg', `Removed ${a.c}.`, 'ok'); }catch(e){ console.error(e); msg('#acct-msg', 'Could not save.', 'err'); }
      };
      box.appendChild(r);
    });
    if(list.length > SHOW){ const m = document.createElement('div'); m.className = 'st-more'; m.textContent = `Showing ${SHOW} of ${list.length}. Search to find the rest.`; box.appendChild(m); }
  }
  $('#acct-search').addEventListener('input', () => window.renderSetup());
  $('#acct-add').addEventListener('submit', async e => {
    e.preventDefault();
    const c = upper($('#acct-new-code').value), n = norm($('#acct-new-name').value), t = $('#acct-new-terr').value;
    if(!c) return;
    const all = storedAccounts();
    if(all.some(x => x.c.toUpperCase() === c)){ msg('#acct-msg', `${c} already exists. Edit it in the list.`, 'err'); return; }
    try{ await saveAgency({accounts: [...all, {c, n, t}]}); e.target.reset(); $('#acct-new-code').focus(); msg('#acct-msg', `Added ${c}.`, 'ok'); }
    catch(err){ console.error(err); msg('#acct-msg', 'Could not save.', 'err'); }
  });
  $('#acct-import-go').addEventListener('click', async () => {
    try{
      const recs = toRecords(await readImport('#acct-paste', '#acct-file'), [
        {key:'c', names:['code','account code','acct','abbrev','short']},
        {key:'n', names:['name','account name','hospital','facility','description']},
        {key:'t', names:['territory','region','area','terr']}]).filter(r => r.c);
      if(!recs.length){ msg('#acct-msg', 'Nothing to import. Paste rows or pick a file first.', 'err'); return; }
      const all = storedAccounts(), byCode = new Map(all.map((a, i) => [a.c.toUpperCase(), i]));
      let added = 0, updated = 0;
      recs.forEach(r => {
        const c = upper(r.c), i = byCode.get(c);
        if(i === undefined){ all.push({c, n: r.n, t: r.t}); byCode.set(c, all.length - 1); added++; }
        else { all[i] = {c, n: r.n || all[i].n, t: r.t || all[i].t}; updated++; }
      });
      const known = new Set(allTerrs().map(t => t.toLowerCase()));
      const newTerrs = [...new Set(recs.map(r => r.t).filter(t => t && !known.has(t.toLowerCase())))];
      await saveAgency({accounts: all, territories: [...storedTerrs(), ...newTerrs]});
      clearImport('#acct-paste', '#acct-file'); $('#acct-import').open = false;
      msg('#acct-msg', `Imported: ${added} added, ${updated} updated${newTerrs.length ? `, ${newTerrs.length} new territor${newTerrs.length===1?'y':'ies'}` : ''}.`, 'ok');
    }catch(err){ console.error(err); msg('#acct-msg', err.message || 'Could not import.', 'err'); }
  });

  /* ---------- 4. trays ---------- */
  const invRef = () => adb.doc('inventory/main');
  const FP = n => new firebase.firestore.FieldPath('trays', n);
  async function setTray(name, qty){
    const v = qty === '' || qty === null || isNaN(qty) ? null : Math.max(0, parseInt(qty, 10));
    try{ await invRef().update(FP(name), v); }
    catch(e){ if(e && e.code === 'not-found') await invRef().set({trays: {[name]: v}, countMode: 'total'}, {merge:true}); else throw e; }
  }
  function renderTrays(){
    const names = Object.keys(inventoryMap || {}).sort((a, b) => a.localeCompare(b));
    $('#tray-count').textContent = names.length ? `${names.length}` : '';
    const box = $('#tray-table'); if(box.contains(document.activeElement)) return;
    const q = norm($('#tray-search').value).toLowerCase();
    const list = names.filter(n => !q || n.toLowerCase().includes(q));
    box.innerHTML = '';
    list.slice(0, SHOW).forEach(name => {
      const r = document.createElement('div'); r.className = 'st-row tray';
      r.innerHTML = `<span style="font-weight:600; overflow-wrap:anywhere;"></span><input type="number" min="0" step="1" inputmode="numeric" aria-label="Quantity" placeholder="?"><button type="button" class="del" aria-label="Remove tray">×</button>`;
      r.querySelector('span').textContent = name;
      const qi = r.querySelector('input'), q0 = inventoryMap[name]; qi.value = q0 === null || q0 === undefined ? '' : q0;
      qi.addEventListener('change', async () => { try{ await setTray(name, qi.value); msg('#tray-msg', `Saved ${name}.`, 'ok'); }catch(e){ console.error(e); msg('#tray-msg', 'Could not save.', 'err'); } });
      const del = r.querySelector('.del');
      del.onclick = async () => {
        if(!armed(del, '✓')) return;
        try{ await invRef().update(FP(name), FV().delete()); msg('#tray-msg', `Removed ${name}.`, 'ok'); }catch(e){ console.error(e); msg('#tray-msg', 'Could not remove.', 'err'); }
      };
      box.appendChild(r);
    });
    if(list.length > SHOW){ const m = document.createElement('div'); m.className = 'st-more'; m.textContent = `Showing ${SHOW} of ${list.length}. Search to find the rest.`; box.appendChild(m); }
  }
  $('#tray-search').addEventListener('input', () => window.renderSetup());
  $('#tray-add').addEventListener('submit', async e => {
    e.preventDefault();
    const name = upper($('#tray-new-name').value); if(!name) return;
    if(name.includes('.') || name.includes('/')){ /* FieldPath handles these */ }
    const exists = Object.keys(inventoryMap || {}).find(k => k.toUpperCase() === name);
    try{ await setTray(exists || name, $('#tray-new-qty').value); e.target.reset(); $('#tray-new-name').focus(); msg('#tray-msg', exists ? `Updated ${exists}.` : `Added ${name}.`, 'ok'); }
    catch(err){ console.error(err); msg('#tray-msg', 'Could not save.', 'err'); }
  });
  $('#tray-import-go').addEventListener('click', async () => {
    try{
      const recs = toRecords(await readImport('#tray-paste', '#tray-file'), [
        {key:'name', names:['tray','name','set','item','description']},
        {key:'qty', names:['qty','quantity','count','sets','owned','on hand']}]).filter(r => r.name);
      if(!recs.length){ msg('#tray-msg', 'Nothing to import. Paste rows or pick a file first.', 'err'); return; }
      const keys = Object.keys(inventoryMap || {}), trays = {}; let added = 0, updated = 0;
      recs.forEach(r => {
        const name = upper(r.name), ex = keys.find(k => k.toUpperCase() === name);
        const q = r.qty === '' ? null : Math.max(0, parseInt(String(r.qty).replace(/[^\d]/g, ''), 10) || 0);
        trays[ex || name] = q; ex ? updated++ : added++;
      });
      await invRef().set({trays, countMode: 'total'}, {merge:true});
      clearImport('#tray-paste', '#tray-file'); $('#tray-import').open = false;
      msg('#tray-msg', `Imported: ${added} added, ${updated} updated.`, 'ok');
    }catch(err){ console.error(err); msg('#tray-msg', err.message || 'Could not import.', 'err'); }
  });

  /* ---------- 5. biologics stock ---------- */
  const bioId = ref => upper(ref).replace(/\//g, '∕').slice(0, 200) || 'BLANK';
  let bioCount = null;
  async function countBio(){ try{ bioCount = (await adb.collection('bioStock').get()).size; }catch(e){ bioCount = null; } $('#bio-count').textContent = bioCount ? `${bioCount}` : ''; renderSetupChecklist(); }
  $('#bio-import-go').addEventListener('click', async () => {
    try{
      const recs = toRecords(await readImport('#bio-paste', '#bio-file'), [
        {key:'ref', names:['reference','ref','part','catalog','sku','item #']},
        {key:'desc', names:['description','desc','name','product']},
        {key:'type', names:['graft type','type','size group']},
        {key:'qty', names:['qty','quantity','on hand','count']},
        {key:'target', names:['target','par','min']}]).filter(r => r.ref);
      if(!recs.length){ msg('#bio-msg', 'Nothing to import. Paste rows or pick a file first.', 'err'); return; }
      const num = v => v === '' ? undefined : Math.max(0, parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0);
      for(let i = 0; i < recs.length; i += 400){
        const b = db.batch();
        recs.slice(i, i + 400).forEach(r => {
          const d = {ref: upper(r.ref), updatedAt: Date.now(), updatedByName: me.name};
          if(r.desc) d.desc = r.desc; if(r.type) d.type = upper(r.type);
          const q = num(r.qty), t = num(r.target); if(q !== undefined) d.qty = q; if(t !== undefined) d.target = t;
          b.set(adb.doc('bioStock/' + bioId(r.ref)), d, {merge:true});
        });
        await b.commit();
      }
      clearImport('#bio-paste', '#bio-file');
      msg('#bio-msg', `Imported ${recs.length} item${recs.length===1?'':'s'}.`, 'ok'); countBio();
    }catch(err){ console.error(err); msg('#bio-msg', err.message || 'Could not import.', 'err'); }
  });

  /* ---------- 6. team ---------- */
  $('#setup-team-go').addEventListener('click', () => showView('team'));

  /* ---------- whole page + checklist ---------- */
  function steps(){
    return [
      {label:'Logos', done: !!(TT.cachedBranding() || {}).logo && (TT.cachedBranding() || {}).agencyId === (agency && agency.id)},
      {label:'Territories', done: allTerrs().length > 0},
      {label:'Accounts', done: storedAccounts().length > 0},
      {label:'Trays', done: Object.keys(inventoryMap || {}).length > 0},
      {label:'Team', done: (membersList || []).length > 1}
    ];
  }
  let lastKey = '';
  window.renderSetup = function(force){
    if(!agency || !me || !me.isAdmin) return;
    // Only redraw when something changed, so lists keep their scroll position.
    const key = JSON.stringify([agency.id, agency.name, agency.accounts, agency.territories, inventoryMap, $('#acct-search').value, $('#tray-search').value, (membersList||[]).length]);
    if(key === lastKey && !force) return; lastKey = key;
    if(!$('#agency-form').contains(document.activeElement)) $('#agency-name').value = agency.name || '';
    renderTerrs(); renderAccounts(); renderTrays();
    $('#team-count2').textContent = (membersList || []).length ? `${membersList.length}` : '';
    const st = steps(), done = st.filter(s => s.done).length;
    $('#setup-progress').textContent = `${done} of ${st.length} done`;
  };
  let lastAgencyId = null;
  const origShow = window.showView;
  window.showView = function(v){
    origShow(v);
    if(v === 'agency') window.renderSetup(true);
    window.renderSetupChecklist();
    if(v === 'agency' && agency && agency.id !== lastAgencyId){ lastAgencyId = agency.id; loadBrandingDoc(); countBio(); }
  };
  // The tab bar and menus call showView by name, so route them through the wrapper too.
  /* Checklist on the Requests / Add pages until a new agency is set up. */
  window.renderSetupChecklist = function(){
    let box = $('#setup-check');
    const hideKey = agency ? 'tt-setup-hide-' + agency.id : '';
    let hidden = false; try{ hidden = localStorage.getItem(hideKey) === '1'; }catch(e){}
    const st = agency && me && me.isAdmin ? steps() : [];
    const todo = st.filter(s => !s.done && s.label !== 'Logos');
    if(!st.length || !todo.length || hidden || activeViewId() === 'agency'){ if(box) box.remove(); return; }
    if(!box){
      box = document.createElement('div'); box.id = 'setup-check'; box.className = 'setup-check';
      box.innerHTML = `<b></b><ul></ul><div class="row"><button type="button" class="go">Open setup</button><button type="button" class="skip">Hide</button></div>`;
      box.querySelector('.go').onclick = () => showView('agency');
      box.querySelector('.skip').onclick = () => { try{ localStorage.setItem(hideKey, '1'); }catch(e){} box.remove(); };
      const main = document.querySelector('main'); main.insertBefore(box, main.firstChild);
    }
    box.querySelector('b').textContent = `Finish setting up ${agency.name || 'your agency'}`;
    box.querySelector('ul').innerHTML = st.map(s => `<li class="${s.done ? 'done' : 'todo'}">${s.done ? '✓' : '○'} ${s.label}</li>`).join('');
  };
  // Keep Setup and the checklist current as data arrives.
  setInterval(() => { if(activeViewId() === 'agency') window.renderSetup(); window.renderSetupChecklist(); }, 1500);
})();
