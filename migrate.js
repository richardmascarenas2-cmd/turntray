/* One-time copy of the original single-agency (Portland) data into agencies/{target}.
   Loaded only when the owner taps "Copy data" under Agencies. Reads the old top-level collections and
   writes the same documents, with the same ids, inside the agency. Nothing old is changed or deleted. */
(function(){
  const PORTLAND_ACCOUNTS = [["AHCG","AHCG ADVENTIST HEALTH COLUMBIA GORGE","East"],["ALBANY","ALBANY GENERAL","CRV"],["AMC","Adventist Medical Center","West"],["BS","Building S Salem","SLM"],["CFAC","Clackamas Foot & Ankle Clinic","East"],["CGSC","COLUMBIA GORGE SURGERY CTR.","East"],["CHH","Center for Health and Healing","Central"],["CMH","COLUMBIA MEMORIAL HOSPITAL","North"],["CRSC","Columbia River Surgery Center","West"],["CSS","Center for Specialty Surgery","Central"],["DCH","Doernbechers Children's Hospital","Central"],["EFAA","Elite Foot & Ankle Associates","West"],["EPSC","East Pavilion Surgery Center","West"],["FOUNDATION","KAISER FOUNDATION","East"],["GSH","GOOD SAMARITAN CORVALLIS","CRV"],["HOOD RIVER","PROVIDENCE HOOD RIVER HOSP","East"],["KLICKITAT","KLICKITAT VALLEY HEALTH","East"],["KZR INTERSTATE","KAISER INTERSTATE","EAST"],["KZR SUNNYSIDE","KAISER FOUND. HOSP/SUNNYSIDE ATTN:ACCOUNTS PAYABLE","East"],["KZR SYB","KAISER SUNNYBROOK","East"],["KZR WESTSIDE","KAISER PERMANENTE WESTSIDE MEDICAL CENTER ATT AP","East"],["LAB","LAB at LC","LAB"],["LEB","Lebanon","CRV"],["LEH","Legacy Emanuel Medical Center","West"],["LGS","Legacy Good Samaritan","West"],["LSC","LEGACY SALMON CREEK HOSPITAL","North"],["MHMC","Legacy Mount Hood Medical center","West"],["MLW","Providence Milwaukie","West"],["MOC","Multnomah Orthopedic Clinic","West"],["MPH","LEGACY MERIDIAN PARK HOSP","West"],["MT SCOTT","Mt. Scott Surgery Center","West"],["NBG","Providence Newberg","SLM"],["NBSC","NORTHBANK SURGERY CENTER","SLM"],["NSC","Neaman's Surgery Center","SLM"],["NWASC","Northwest Ambulatory Surgery Center","West"],["OATH WEST","OATH West","Central"],["OHSU - SOR","OHSU - South OR","Central"],["OOSC","Oregon Outpatient Surgery Center","Central"],["OSI","OREGON SURGICAL INSTITUTE","East"],["OSM","Orthopedic & Sports Medicine","West"],["PEARL","Pearl Surgicenter","West"],["PLAZA","Plaza Ambulatory Surgery Center","West"],["PPMC","Providence Portland Medical Center","West"],["PRVM","Providence Milwaukie","West"],["PSC","LONGVIEW SURGERY CENTER dba PACIFIC SURGICAL CENTER","North"],["PWF","PROVIDENCE WILLAMETTE FALLS","East"],["SAL HOS","SALEM HOSPITAL","SLM"],["SAN","Santiam","SLM"],["SEASIDE","Providence Seaside Hospital","West"],["SHN","Sports Health NorthWest",""],["SHRINERS","Shriners","Central"],["SILV","Silverton","SLM"],["SKYLINE","SKYLINE HOSPITAL","SLM"],["SMO","Sports Medicine Oregon","Central"],["SPSC","SOUTH PORTLAND SURGICAL CTR","East"],["SSC","Sunset Surgical Centre",""],["St JOHNS","PEACEHEALTH ST JOHN MEDICAL CENTER","North"],["STV","Providence St. Vincent Hospital","Central"],["SWWASC","S.W. WASHINGTON REG SURG CTR","North"],["SWWMC","PEACEHEALTH SOUTHWEST MEDICAL CENTER","North"],["TCG","TILLAMOOK COUNTY GEN HOSP","North"],["TUALITY","Tuality","Central"],["TVC","THE VANCOUVER CLINIC, INC","North"],["VA","Portland Veteran Affairs","Central"],["WVMC","willamette valley medical center","SLM"],["CRVC","Corvallis Clinic","CRV"],["WLAKE","Waverly Lake Surgery Center","CRV"],["ALBERTY","Alberty Surgery Center","EAST"],["BSM","Beaver Sports Medicine","CRV"],["AO","Advantage Orthopedics","West"]];

  // Top-level collections to copy as they are. requests also brings its photos and comments.
  const FLAT = ['members', 'users', 'prefCards', 'inventory', 'bioStock', 'bioRequests', 'bioNotes', 'bioFiles', 'bioPhotos', 'meta'];

  /* Writes in batches that stay under Firestore's limits (500 writes, ~10 MB per batch). */
  function writer(db){
    let batch = db.batch(), ops = [], bytes = 0, total = 0;
    async function flush(){
      if(!ops.length) return;
      try{ await batch.commit(); }
      catch(e){
        // Find the record that was refused, so the error says what it was.
        for(const [ref, data] of ops){
          try{ await ref.set(data); }
          catch(e2){
            // Photos can't be overwritten; one already copied by an earlier run is fine to skip.
            const ex = await ref.get().catch(()=>null);
            if(ex && ex.exists && /\/(photos|bioPhotos)\//.test(ref.path)) continue;
            const err = new Error(`${e2.message || e2} (writing ${ref.path})`); err.code = e2.code; throw err; }
        }
      }
      total += ops.length; batch = db.batch(); ops = []; bytes = 0;
    }
    return {
      async set(ref, data){
        const size = JSON.stringify(data).length + 200;
        if(ops.length >= 400 || bytes + size > 7e6) await flush();
        batch.set(ref, data); ops.push([ref, data]); bytes += size;
      },
      flush, get total(){ return total + ops.length; }
    };
  }

  /* Reads that name what they were reading if they're refused. */
  async function read(q, label){
    try{ return await q.get(); }
    catch(e){ const err = new Error(`${e.message || e} (reading ${label})`); err.code = e.code; throw err; }
  }

  async function copyLegacy(db, target, opts){
    const say = (opts && opts.onProgress) || (()=>{});
    const base = 'agencies/' + target + '/';
    const doneKey = 'tt-migrate-done-' + target;
    let done = new Set();
    try{ done = new Set(JSON.parse(localStorage.getItem(doneKey) || '[]')); }catch(e){}
    const markDone = id => { done.add(id); try{ localStorage.setItem(doneKey, JSON.stringify([...done])); }catch(e){} };

    // The agency record itself.
    const aref = db.doc('agencies/' + target);
    const existing = await aref.get();
    const agencyData = {status: 'active', approvedAt: Date.now(), migratedAt: Date.now()};
    if(!existing.exists || !existing.data().name) agencyData.name = target === 'portland' ? 'Arthrex Portland' : 'Arthrex Portland (trial copy)';
    if(!existing.exists || !(existing.data().accounts || []).length) agencyData.accounts = PORTLAND_ACCOUNTS.map(([c,n,t]) => ({c, n, t}));
    if(!existing.exists){ agencyData.createdByEmail = opts.ownerEmail; agencyData.createdAt = Date.now(); }
    await aref.set(agencyData, {merge: true});

    const w = writer(db);
    let docs = 0, photos = 0;

    for(const name of FLAT){
      say(`Copying ${name}…`);
      const snap = await read(db.collection(name), name);
      for(const d of snap.docs){ await w.set(db.doc(base + name + '/' + d.id), d.data()); docs++; }
      await w.flush();
    }
    // The owner is always an admin of Portland.
    const om = await read(db.doc('members/' + opts.ownerEmail), 'members/' + opts.ownerEmail);
    await w.set(db.doc(base + 'members/' + opts.ownerEmail), {...(om.exists ? om.data() : {role: 'inventory'}), admin: true});
    await w.flush();

    say('Reading requests…');
    const reqs = await read(db.collection('requests'), 'requests');
    let i = 0;
    for(const r of reqs.docs){
      i++;
      if(done.has(r.id)) continue;
      if(i % 25 === 0) say(`Copying requests: ${i} of ${reqs.size} (${photos} photos so far)…`);
      await w.set(db.doc(base + 'requests/' + r.id), r.data()); docs++;
      for(const sub of ['comments', 'photos']){
        const s = await read(db.collection('requests/' + r.id + '/' + sub), 'requests/' + r.id + '/' + sub);
        for(const d of s.docs){ await w.set(db.doc(base + 'requests/' + r.id + '/' + sub + '/' + d.id), d.data()); if(sub === 'photos') photos++; else docs++; }
      }
      await w.flush();
      markDone(r.id);
    }
    await w.flush();

    // Point everyone on the Portland team at this agency when they sign in.
    let directory = 0;
    if(opts.sendTeam){
      say('Sending the team to the new agency…');
      const members = await read(db.collection('members'), 'members');
      const emails = new Set(members.docs.map(d => d.id.toLowerCase()));
      emails.add(opts.ownerEmail.toLowerCase());
      for(const email of emails){ await w.set(db.doc('directory/' + email), {agencyId: target, addedAt: Date.now(), addedBy: 'migration'}); directory++; }
      await w.flush();
    }
    try{ localStorage.removeItem(doneKey); }catch(e){}
    return {docs, photos, directory};
  }

  window.TTMigrate = {copyLegacy};
})();
