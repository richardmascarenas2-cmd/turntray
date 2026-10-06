/* One-time copy of the original single-agency (Portland) data into agencies/{target}.
   Loaded only when the owner taps "Copy data" under Agencies. Reads the old top-level collections and
   writes the same documents, with the same ids, inside the agency. Nothing old is changed or deleted. */
(function(){
  const PORTLAND_ACCOUNTS = [["AHCG","AHCG ADVENTIST HEALTH COLUMBIA GORGE","East"],["ALBANY","ALBANY GENERAL","CRV"],["AMC","Adventist Medical Center","West"],["BS","Building S Salem","SLM"],["CFAC","Clackamas Foot & Ankle Clinic","East"],["CGSC","COLUMBIA GORGE SURGERY CTR.","East"],["CHH","Center for Health and Healing","Central"],["CMH","COLUMBIA MEMORIAL HOSPITAL","North"],["CRSC","Columbia River Surgery Center","West"],["CSS","Center for Specialty Surgery","Central"],["DCH","Doernbechers Children's Hospital","Central"],["EFAA","Elite Foot & Ankle Associates","West"],["EPSC","East Pavilion Surgery Center","West"],["FOUNDATION","KAISER FOUNDATION","East"],["GSH","GOOD SAMARITAN CORVALLIS","CRV"],["HOOD RIVER","PROVIDENCE HOOD RIVER HOSP","East"],["KLICKITAT","KLICKITAT VALLEY HEALTH","East"],["KZR INTERSTATE","KAISER INTERSTATE","EAST"],["KZR SUNNYSIDE","KAISER FOUND. HOSP/SUNNYSIDE ATTN:ACCOUNTS PAYABLE","East"],["KZR SYB","KAISER SUNNYBROOK","East"],["KZR WESTSIDE","KAISER PERMANENTE WESTSIDE MEDICAL CENTER ATT AP","East"],["LAB","LAB at LC","LAB"],["LEB","Lebanon","CRV"],["LEH","Legacy Emanuel Medical Center","West"],["LGS","Legacy Good Samaritan","West"],["LSC","LEGACY SALMON CREEK HOSPITAL","North"],["MHMC","Legacy Mount Hood Medical center","West"],["MLW","Providence Milwaukie","West"],["MOC","Multnomah Orthopedic Clinic","West"],["MPH","LEGACY MERIDIAN PARK HOSP","West"],["MT SCOTT","Mt. Scott Surgery Center","West"],["NBG","Providence Newberg","SLM"],["NBSC","NORTHBANK SURGERY CENTER","SLM"],["NSC","Neaman's Surgery Center","SLM"],["NWASC","Northwest Ambulatory Surgery Center","West"],["OATH WEST","OATH West","Central"],["OHSU - SOR","OHSU - South OR","Central"],["OOSC","Oregon Outpatient Surgery Center","Central"],["OSI","OREGON SURGICAL INSTITUTE","East"],["OSM","Orthopedic & Sports Medicine","West"],["PEARL","Pearl Surgicenter","West"],["PLAZA","Plaza Ambulatory Surgery Center","West"],["PPMC","Providence Portland Medical Center","West"],["PRVM","Providence Milwaukie","West"],["PSC","LONGVIEW SURGERY CENTER dba PACIFIC SURGICAL CENTER","North"],["PWF","PROVIDENCE WILLAMETTE FALLS","East"],["SAL HOS","SALEM HOSPITAL","SLM"],["SAN","Santiam","SLM"],["SEASIDE","Providence Seaside Hospital","West"],["SHN","Sports Health NorthWest",""],["SHRINERS","Shriners","Central"],["SILV","Silverton","SLM"],["SKYLINE","SKYLINE HOSPITAL","SLM"],["SMO","Sports Medicine Oregon","Central"],["SPSC","SOUTH PORTLAND SURGICAL CTR","East"],["SSC","Sunset Surgical Centre",""],["St JOHNS","PEACEHEALTH ST JOHN MEDICAL CENTER","North"],["STV","Providence St. Vincent Hospital","Central"],["SWWASC","S.W. WASHINGTON REG SURG CTR","North"],["SWWMC","PEACEHEALTH SOUTHWEST MEDICAL CENTER","North"],["TCG","TILLAMOOK COUNTY GEN HOSP","North"],["TUALITY","Tuality","Central"],["TVC","THE VANCOUVER CLINIC, INC","North"],["VA","Portland Veteran Affairs","Central"],["WVMC","willamette valley medical center","SLM"],["CRVC","Corvallis Clinic","CRV"],["WLAKE","Waverly Lake Surgery Center","CRV"],["ALBERTY","Alberty Surgery Center","EAST"],["BSM","Beaver Sports Medicine","CRV"],["AO","Advantage Orthopedics","West"]];

  // Top-level collections to copy as they are. requests also brings its photos and comments.
  const FLAT = ['members', 'users', 'prefCards', 'inventory', 'bioStock', 'bioRequests', 'bioNotes', 'bioFiles', 'bioPhotos', 'meta'];

  /* Writes in batches that stay under Firestore's limits (500 writes, ~10 MB per batch). */
  function writer(db){
    let batch = db.batch(), ops = 0, bytes = 0, total = 0;
    async function flush(){ if(!ops) return; await batch.commit(); total += ops; batch = db.batch(); ops = 0; bytes = 0; }
    return {
      async set(ref, data){
        const size = JSON.stringify(data).length + 200;
        if(ops >= 400 || bytes + size > 7e6) await flush();
        batch.set(ref, data); ops++; bytes += size;
      },
      flush, get total(){ return total + ops; }
    };
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
      const snap = await db.collection(name).get();
      for(const d of snap.docs){ await w.set(db.doc(base + name + '/' + d.id), d.data()); docs++; }
      await w.flush();
    }
    // The owner is always an admin of Portland.
    const om = await db.doc('members/' + opts.ownerEmail).get();
    await w.set(db.doc(base + 'members/' + opts.ownerEmail), {...(om.exists ? om.data() : {role: 'inventory'}), admin: true});
    await w.flush();

    say('Reading requests…');
    const reqs = await db.collection('requests').get();
    let i = 0;
    for(const r of reqs.docs){
      i++;
      if(done.has(r.id)) continue;
      if(i % 25 === 0) say(`Copying requests: ${i} of ${reqs.size} (${photos} photos so far)…`);
      await w.set(db.doc(base + 'requests/' + r.id), r.data()); docs++;
      for(const sub of ['comments', 'photos']){
        const s = await db.collection('requests/' + r.id + '/' + sub).get();
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
      const members = await db.collection('members').get();
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
