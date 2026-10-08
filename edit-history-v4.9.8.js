(() => {
  'use strict';

  let editingEntryPatch = null;
  const originalOpenEntry = window.openEntry;
  const originalSaveEntry = window.saveEntry;

  function modalTitle(text){
    const el=document.getElementById('entryModalTitle');
    if(el)el.textContent=text;
  }

  function resetEditState(){
    editingEntryPatch=null;
    if(entryType)entryType.disabled=false;
    if(entryEquipment)entryEquipment.disabled=false;
    if(repairDowntime)repairDowntime.disabled=false;
  }

  function splitMaintenanceNotes(value){
    const raw=String(value||'');
    const marker=' — ';
    const at=raw.indexOf(marker);
    return at<0 ? {description:raw||'Maintenance',notes:''} : {description:raw.slice(0,at)||'Maintenance',notes:raw.slice(at+marker.length)};
  }

  window.openEntry = function(type,id){
    resetEditState();
    modalTitle('Add Cost');
    return originalOpenEntry(type,id);
  };

  window.editEntryRecord = function(type,id){
    if(!canEdit())return alert('Your role is view-only.');
    const record=type==='maintenance' ? maintenance.find(x=>x.id===id) : type==='repair' ? repairs.find(x=>x.id===id) : null;
    if(!record)return setCloudStatus('That record is no longer available. Refresh and try again.',true);

    editingEntryPatch={type,id};
    modalTitle(type==='maintenance'?'Edit Maintenance':'Edit Repair');
    entryEquipment.innerHTML=assets.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
    entryEquipment.value=record.asset_id;
    entryEquipment.disabled=true;
    entryType.value=type;
    entryType.disabled=true;
    repairDowntime.value='no';
    repairDowntime.disabled=true;

    if(type==='maintenance'){
      const parts=splitMaintenanceNotes(record.notes);
      entryDate.value=record.service_date||today();
      entryCost.value=record.cost??0;
      entryDescription.value=parts.description;
      entryNotes.value=parts.notes;
      repairStatus.value='open';
      repairVendor.value='';
    }else{
      entryDate.value=(record.opened_at||'').slice(0,10)||today();
      entryCost.value=record.cost??0;
      entryDescription.value=record.title||'Repair';
      entryNotes.value=record.description||'';
      repairStatus.value=record.status||'open';
      repairVendor.value=record.vendor||'';
    }

    repairFields.classList.toggle('hidden',type!=='repair');
    formMessage('entry','');
    entryModal.classList.add('open');
  };

  window.saveEntry = async function(){
    if(!editingEntryPatch)return originalSaveEntry();
    if(!canEdit())return alert('Your role is view-only.');

    const aid=entryEquipment.value;
    const type=entryType.value;
    const cost=Number(entryCost.value||0);
    const desc=entryDescription.value.trim()||type;
    const date=entryDate.value||today();
    const notes=entryNotes.value.trim();

    if(type!==editingEntryPatch.type)return formMessage('entry','Entry type cannot be changed while editing.');
    if(!assets.some(a=>a.id===aid))return formMessage('entry','Choose equipment before saving a cost.',entryEquipment);
    if(!Number.isFinite(cost)||cost<0)return formMessage('entry','Enter a valid cost of 0 or more.',entryCost);

    formMessage('entry','');
    try{
      if(type==='maintenance'){
        const existing=maintenance.find(x=>x.id===editingEntryPatch.id);
        if(!existing)throw new Error('Maintenance record no longer exists.');
        await sb('/rest/v1/maintenance_records?id=eq.'+encodeURIComponent(existing.id)+'&workspace_id=eq.'+encodeURIComponent(workspace.id),{
          method:'PATCH',
          headers:{Prefer:'return=minimal'},
          body:JSON.stringify({service_date:date,cost,notes:desc+(notes?' — '+notes:'')})
        });
      }else if(type==='repair'){
        const existing=repairs.find(x=>x.id===editingEntryPatch.id);
        if(!existing)throw new Error('Repair record no longer exists.');
        const status=repairStatus.value;
        const completed=status==='completed';
        await sb('/rest/v1/repairs?id=eq.'+encodeURIComponent(existing.id)+'&workspace_id=eq.'+encodeURIComponent(workspace.id),{
          method:'PATCH',
          headers:{Prefer:'return=minimal'},
          body:JSON.stringify({
            title:desc,
            description:notes||null,
            status,
            opened_at:date+'T12:00:00Z',
            completed_at:completed?(existing.completed_at||date+'T12:00:00Z'):null,
            cost,
            vendor:repairVendor.value.trim()||null,
            updated_at:new Date().toISOString()
          })
        });
      }

      resetEditState();
      closeModal('entryModal');
      await reloadCloud();
      openDetail(aid);
    }catch(e){
      formMessage('entry','Could not save changes: '+e.message);
    }
  };

  window.repairCard = function(r){
    const a=assets.find(x=>x.id===r.asset_id);
    return `<div class="card"><div class="row"><div><div class="kicker">${repairStatusText(r.status)}</div><b>${esc(r.title)}</b><div class="tiny">${a?esc(a.name)+' · ':''}${(r.opened_at||'').slice(0,10)}${r.vendor?' · '+esc(r.vendor):''}</div></div><b>${money(r.cost)}</b></div><div style="height:10px"></div><div class="row"><button class="miniBtn" onclick="openDetail('${r.asset_id}')">View Asset</button><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${canEdit()?`<button class="miniBtn" onclick="editEntryRecord('repair','${r.id}')">Edit</button>`:''}${canEdit()&&r.status!=='completed'?`<button class="btn" onclick="completeRepair('${r.id}')">Complete Repair</button>`:''}</div></div></div>`;
  };

  window.openDetail = function(id){
    currentId=id;
    const a=assets.find(x=>x.id===id);
    if(!a)return;
    const c=assetCosts(id);
    const active=downtime.find(x=>x.asset_id===id&&!x.ended_at);
    const activeRepair=repairs.find(x=>x.asset_id===id&&x.status!=='completed');
    const sch=schedules.filter(x=>x.asset_id===id);
    const hist=[
      ...maintenance.filter(x=>x.asset_id===id).map(x=>({id:x.id,kind:'maintenance',date:x.service_date,type:'Maintenance',title:x.notes||'Maintenance',cost:x.cost})),
      ...repairs.filter(x=>x.asset_id===id).map(x=>({id:x.id,kind:'repair',date:(x.opened_at||'').slice(0,10),type:'Repair',title:x.title,cost:x.cost})),
      ...expenses.filter(x=>x.asset_id===id).map(x=>({id:x.id,kind:'expense',date:x.expense_date,type:'Expense',title:x.description||x.category,cost:x.amount}))
    ].sort((x,y)=>String(y.date).localeCompare(String(x.date)));

    detailContent.innerHTML=`<div class="row"><div><h1>${esc(a.name)}</h1><p class="${a.status}">${statusText(a.status)}</p></div>${canEdit()?`<button class="miniBtn" onclick="editEquipment('${id}')">Edit</button>`:''}</div><p class="sub">${[a.year,a.make,a.model].filter(Boolean).map(esc).join(' ')||esc(a.asset_type||'Equipment')} · ${assetMeter(a)}</p>
    ${(a.vin||a.serial_number||a.purchase_date||a.notes)?`<div class="card">${a.vin?`<div class="row"><span class="muted">VIN</span><b>${esc(a.vin)}</b></div>`:''}${a.serial_number?`<div class="row"><span class="muted">Serial</span><b>${esc(a.serial_number)}</b></div>`:''}${a.purchase_date?`<div class="row"><span class="muted">Purchased</span><b>${a.purchase_date}</b></div>`:''}${a.notes?`<div class="divider"></div><div class="tiny">${esc(a.notes)}</div>`:''}</div>`:''}
    ${activeRepair?`<div class="notice"><div class="kicker">ACTIVE REPAIR · ${repairStatusText(activeRepair.status)}</div><b>${esc(activeRepair.title)}</b><div class="tiny">${activeRepair.vendor?esc(activeRepair.vendor)+' · ':''}${money(activeRepair.cost)}</div>${canEdit()?`<div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="miniBtn" onclick="editEntryRecord('repair','${activeRepair.id}')">Edit Repair</button><button class="btn" onclick="completeRepair('${activeRepair.id}')">Complete Repair</button></div>`:''}</div>`:''}${active?`<div class="notice"><b>Out of Service · ${downtimeDays(active)} day${downtimeDays(active)===1?'':'s'}</b><div class="tiny">${esc(active.reason||'No reason recorded')}</div>${canEdit()?`<br><button class="btn wide" onclick="returnToService('${id}')">Return to Service</button>`:''}</div>`:canEdit()?`<button class="btn secondary wide" onclick="markOut('${id}')">Mark Out of Service</button>`:''}
    <div class="heroCard"><div class="kicker">RECORDED COSTS</div><div class="money">${money(c.m+c.r+c.e)}</div><div class="metricGrid"><div class="metric"><span class="muted">Maintenance</span><b>${money(c.m)}</b></div><div class="metric"><span class="muted">Repairs</span><b>${money(c.r)}</b></div><div class="metric"><span class="muted">Other</span><b>${money(c.e)}</b></div><div class="metric"><span class="muted">Purchase</span><b>${money(a.purchase_cost)}</b></div></div></div>
    <h2>Maintenance Schedule</h2>${canEdit()?`<button class="btn secondary wide" onclick="openService('${id}')">+ Add Schedule</button>`:''}<div style="height:10px"></div>${sch.length?sch.map(s=>scheduleCard(s,true)).join(''):'<div class="empty">No scheduled maintenance yet.</div>'}
    ${canEdit()?`<div class="row" style="margin-top:14px"><button class="btn" onclick="openEntry('maintenance','${id}')">+ Maintenance</button><button class="btn" onclick="openEntry('repair','${id}')">+ Repair</button></div><br><button class="btn secondary wide" onclick="openEntry('expense','${id}')">+ Other Expense</button>`:''}
    <h2>History</h2>${hist.length?hist.map(x=>`<div class="card row"><div><b>${esc(x.title)}</b><div class="tiny">${x.date} · ${x.type}</div></div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end"><b>${money(x.cost)}</b>${canEdit()&&(x.kind==='maintenance'||x.kind==='repair')?`<button class="miniBtn" onclick="editEntryRecord('${x.kind}','${x.id}')">Edit</button>`:''}</div></div>`).join(''):'<div class="empty">No history yet.</div>'}
    <br>${canManageTeam()?`<button class="btn danger wide" onclick="deleteEquipment('${id}')">Delete Equipment</button>`:''}`;
    show('detail');
  };

  document.title='Equipment Cost Book V4.9.10';
  const version=document.querySelector('.versionNote');
  if(version)version.textContent='Equipment Cost Book · V4.9.10';
})();
