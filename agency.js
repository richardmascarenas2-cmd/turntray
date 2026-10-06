/* TurnTray agencies: which agency each person belongs to, and where that agency's data lives.
   Shared by index.html and bio.html. Keep in sync with richies.rules.

   Firestore layout
     directory/{email}                 -> {agencyId}   which agency a person belongs to (one per person)
     agencies/{agencyId}               -> {name, status: 'pending'|'active'|'rejected', accounts:[{c,n,t}], ...}
     agencies/{agencyId}/members/...   team list (was members/...)
     agencies/{agencyId}/requests/...  and every other collection the app uses, unchanged inside */
(function(){
  const OWNER_EMAIL = 'richardmascarenas2@gmail.com';
  const VIEW_KEY = 'tt-owner-agency';   // the owner can open any agency; remembered on this device

  const lower = s => String(s||'').trim().toLowerCase();
  const isOwnerEmail = email => lower(email) === OWNER_EMAIL;

  /* doc()/collection() that point inside one agency. Everything else (batch, transactions) uses db as before. */
  function scoped(db, agencyId){
    const base = 'agencies/' + agencyId + '/';
    return {
      agencyId,
      doc: p => db.doc(base + p),
      collection: p => db.collection(base + p),
      agencyDoc: () => db.doc('agencies/' + agencyId)
    };
  }

  /* Works out where a signed-in person goes.
     Returns {state, agencyId, agency, member}
       state 'active'   -> open the agency
             'pending'  -> their agency application is waiting for approval
             'rejected' -> their agency application wasn't approved
             'none'     -> not in any agency yet (ask an admin to add them, or apply) */
  async function resolve(db, user){
    const email = lower(user.email);
    const owner = isOwnerEmail(email);
    let agencyId = null;
    // The hourly Google Sheet sync (?sync) always writes to the owner's own agency, never one they're just viewing.
    const syncing = new URLSearchParams(location.search).has('sync');
    if(owner && !syncing){ try{ agencyId = localStorage.getItem(VIEW_KEY) || null; }catch(e){} }
    if(!agencyId){
      try{ const d = await db.doc('directory/' + email).get(); if(d.exists) agencyId = d.data().agencyId || null; }
      catch(e){ console.warn('directory', e); }
    }
    // The owner always gets in: with no agency of their own yet, they land in an empty admin
    // agency from which they can approve agencies and open any of them.
    if(!agencyId && owner){
      agencyId = 'turntray-admin';
      try{
        const ref = db.doc('agencies/' + agencyId);
        if(!(await ref.get()).exists) await ref.set({name:'TurnTray admin', status:'active', accounts:[], createdByEmail:email, createdAt:Date.now()});
      }catch(e){ console.warn('admin agency', e); }
    }
    if(!agencyId) return {state:'none'};
    let agency = null;
    try{ const a = await db.doc('agencies/' + agencyId).get(); if(a.exists) agency = {id:agencyId, ...a.data()}; }
    catch(e){ console.warn('agency', e); }
    if(!agency){
      if(owner){ try{ localStorage.removeItem(VIEW_KEY); }catch(e){} }
      return {state:'none', agencyId};
    }
    let member = null;
    try{ const m = await db.doc('agencies/' + agencyId + '/members/' + email).get(); if(m.exists) member = m.data(); }
    catch(e){ console.warn('member', e); }
    const status = agency.status || 'pending';
    if(owner) return {state:'active', agencyId, agency, member};
    if(status === 'pending') return {state:'pending', agencyId, agency, member};
    if(status !== 'active') return {state:'rejected', agencyId, agency, member};
    if(!member) return {state:'none', agencyId};
    return {state:'active', agencyId, agency, member};
  }

  /* Owner only: open a different agency on this device. */
  function ownerOpen(agencyId){
    try{ if(agencyId) localStorage.setItem(VIEW_KEY, agencyId); else localStorage.removeItem(VIEW_KEY); }catch(e){}
    location.reload();
  }

  /* An agency's accounts as [code, name, territory] rows (the shape the app has always used). */
  function accountsOf(agency){
    return ((agency && agency.accounts) || []).map(a => [String(a.c||''), String(a.n||''), String(a.t||'')]).filter(a => a[0]);
  }
  /* "CODE, Name, Territory" lines <-> stored accounts. */
  function accountsToText(agency){
    return accountsOf(agency).map(a => a.filter((x,i) => i<2 || x).join(', ')).join('\n');
  }
  function accountsFromText(text){
    const seen = new Set(), out = [];
    String(text||'').split(/\r?\n/).forEach(line => {
      const parts = line.split(/\t|,/).map(s => s.trim());
      const c = parts[0]; if(!c || seen.has(c.toUpperCase())) return;
      seen.add(c.toUpperCase());
      out.push({c, n: parts[1] || '', t: parts.slice(2).join(', ').trim()});
    });
    return out;
  }

  /* Put the agency's name everywhere the page shows it (elements with data-agency-name). */
  function brand(agency){
    const name = (agency && agency.name) || 'TurnTray';
    document.querySelectorAll('[data-agency-name]').forEach(el => { el.textContent = name; });
  }

  function slugify(name){
    const s = lower(name).normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
    return s || 'agency';
  }

  /* Someone signs up a new agency. It waits as "pending" until the owner approves it. */
  async function applyForAgency(db, user, form){
    const email = lower(user.email);
    const agencyId = slugify(form.agencyName) + '-' + Math.random().toString(36).slice(2,6);
    const now = Date.now();
    const b = db.batch();
    b.set(db.doc('agencies/' + agencyId), {
      name: form.agencyName.trim(), status: 'pending', region: (form.region||'').trim(), phone: (form.phone||'').trim(),
      note: (form.note||'').trim(), createdByEmail: email, createdByName: form.yourName.trim(), createdAt: now, accounts: []
    });
    b.set(db.doc('directory/' + email), {agencyId, addedAt: now, addedBy: email});
    b.set(db.doc('agencies/' + agencyId + '/members/' + email), {name: form.yourName.trim(), admin: true, role: 'inventory', territories: [], addedBy: email, addedAt: now});
    await b.commit();
    return agencyId;
  }

  /* Leave a pending or rejected application so the person can apply again or be added elsewhere. */
  async function withdraw(db, user){
    await db.doc('directory/' + lower(user.email)).delete();
  }

  /* Admins add someone to their agency. Fails if that email already belongs to a different agency. */
  async function addMember(db, agencyId, email, data){
    email = lower(email);
    const b = db.batch();
    b.set(db.doc('directory/' + email), {agencyId, addedAt: Date.now()}, {merge:true});
    b.set(db.doc('agencies/' + agencyId + '/members/' + email), data, {merge:true});
    try{ await b.commit(); }
    catch(e){
      if(e && e.code === 'permission-denied'){ const err = new Error(`${email} already belongs to another agency on TurnTray. They need to be removed there first.`); err.code = 'other-agency'; throw err; }
      throw e;
    }
  }
  async function removeMember(db, agencyId, email){
    email = lower(email);
    const b = db.batch();
    b.delete(db.doc('agencies/' + agencyId + '/members/' + email));
    b.delete(db.doc('directory/' + email));
    try{ await b.commit(); }
    catch(e){
      // Their directory entry already points elsewhere (or is gone): just take them off this team.
      if(e && e.code === 'permission-denied') await db.doc('agencies/' + agencyId + '/members/' + email).delete();
      else throw e;
    }
  }

  window.TT = { OWNER_EMAIL, isOwnerEmail, scoped, resolve, ownerOpen, accountsOf, accountsToText, accountsFromText, brand, applyForAgency, withdraw, addMember, removeMember };
})();
