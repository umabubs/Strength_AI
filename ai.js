'use strict';
/* Machine-guide beta. Works without an API by manual selection. */
(() => {
  const cataloguePromise = fetch('./machines.json').then(r => { if (!r.ok) throw Error('Machine catalogue unavailable'); return r.json(); });
  const settingsKey='my-strength-ai-beta-settings';
  let photoData=null, fileName='', suggested=null, machineList=[], busy=false, choice=null;
  function settings(){try{return JSON.parse(localStorage.getItem(settingsKey))||{}}catch{return {}}}
  function clean(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function el(sel){return document.querySelector(sel)}
  function page(){return `<section class="ai-page">
   <span class="kicker">MY STRENGTH · EXPERIMENTAL</span><h1>AI Machine Guide</h1>
   <p class="subtitle">Scan a gym machine, confirm the suggested match, learn how to use it and add the exercise to your actual workout.</p>
   <div class="ai-alert"><b>Beta:</b> Only four machine types are supported. AI suggestions may be incorrect. Confirm the equipment and follow its own instructions and safety labels. No form analysis, rep counting or body-photo tracking is included yet.</div>
   <div class="ai-columns" style="margin-top:15px">
    <section class="ai-card"><h2>1. Scan a machine</h2>
     <div class="ai-controls"><label class="ai-btn ai-btn-primary" for="ai-camera">Take photo</label><input class="ai-file" id="ai-camera" type="file" accept="image/*" capture="environment"><label class="ai-btn" for="ai-upload">Choose photo</label><input class="ai-file" id="ai-upload" type="file" accept="image/*"></div>
     <img id="ai-preview" class="ai-photo" alt="Photo you chose" hidden>
     <p class="ai-muted" id="ai-photo-caption">Frame the complete machine, including any printed label. Avoid including other gym members.</p>
     <button class="ai-btn ai-btn-primary" id="ai-scan" type="button" disabled>Identify machine with AI</button>
     <p id="ai-status" class="ai-muted" role="status">Select a photo to begin, or choose a machine below without AI.</p>
     <div id="ai-suggestions"></div>
     </section>
    <section class="ai-card"><h2>2. Learn & add to workout</h2><div id="ai-guide"><p class="ai-muted">Choose one of the supported machines to see verified guidance.</p></div></section>
   </div>
   <section class="ai-card"><h2>Choose a machine manually</h2><div id="ai-catalogue" class="ai-machine-choice"></div></section>
   <details class="ai-card"><summary><b>Connect to Cloudflare AI</b></summary>
    <p class="ai-muted">Use the public URL of your own Cloudflare Worker. Do not enter your OpenAI API key here. That key belongs in Cloudflare's secret settings.</p>
    <label for="ai-endpoint">Worker URL</label><input id="ai-endpoint" class="ai-field" type="url" placeholder="https://my-strength-ai.your-subdomain.workers.dev" autocomplete="url">
    <label for="ai-code">Private beta access code (not your API key)</label><input id="ai-code" class="ai-field" type="password" placeholder="Access code you configured in Cloudflare" autocomplete="off">
    <button class="ai-btn ai-btn-primary" id="ai-save-settings" type="button">Save connection on this device</button>
    <p class="ai-muted">The access code is stored on this device, so use a separate, replaceable beta code. Public launch requires user authentication, rate limiting and abuse controls.</p>
   </details>
  </section>`}
  function status(message){const n=el('#ai-status'); if(n)n.textContent=message}
  function renderGuide(machine){choice=machine;const n=el('#ai-guide');if(!n)return;
    n.replaceChildren(); const title=document.createElement('h3');title.textContent=machine.name;n.append(title);
    const muscles=document.createElement('div');machine.muscles.forEach(m=>{const p=document.createElement('span');p.className='ai-pill';p.textContent=m;muscles.append(p)});n.append(muscles);
    const h=document.createElement('h3');h.textContent='Setup and technique';n.append(h);
    const ol=document.createElement('ol');machine.steps.forEach(x=>{let li=document.createElement('li');li.textContent=x;ol.append(li)});n.append(ol);
    const caution=document.createElement('p');caution.className='ai-alert';caution.textContent='Check the placard and safety catches on your actual machine. Manufacturer settings vary. These steps are general guidance.';n.append(caution);
    if(machine.animated && customElements.get('exercise-motion')){const animation=document.createElement('exercise-motion');animation.dataset.machine=machine.id;n.append(animation)}else{const image=document.createElement('img');image.className='ai-guide-illustration';image.src='./images/'+machine.image;image.alt=machine.name+' demonstration';n.append(image)}
    const ref=document.createElement('p');const link=document.createElement('a');link.href=machine.source;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Exercise guide reference';ref.append(link);n.append(ref);
    const add=document.createElement('button');add.className='ai-btn ai-btn-primary';add.type='button';add.textContent='Add to my workout';add.onclick=()=>{if(typeof window.MyStrengthAddMachine==='function')window.MyStrengthAddMachine(machine.exercise);};n.append(add);
    n.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function showResult(result){const target=el('#ai-suggestions');if(!target)return;target.replaceChildren();
    const id=result.machine;
    const selected=machineList.find(x=>x.id===id);
    const p=document.createElement('p');p.className='ai-muted';p.textContent=selected?`Tentative match: ${selected.name}. Confirm this looks like your equipment.`:'AI could not confidently identify one of the four supported machines. Select manually or take another photo.';target.append(p);
    if(selected){const btn=document.createElement('button');btn.type='button';btn.className='ai-btn ai-btn-primary';btn.textContent='Confirm '+selected.name;btn.onclick=()=>renderGuide(selected);target.append(btn)}
    if(result.alternatives?.length){const wrap=document.createElement('div');wrap.className='ai-machine-choice';result.alternatives.forEach(id=>{const m=machineList.find(x=>x.id===id);if(!m)return;const btn=document.createElement('button');btn.className='ai-btn';btn.textContent=m.name;btn.onclick=()=>renderGuide(m);wrap.append(btn)});target.append(wrap)}
  }
  async function changeFile(f){if(!f)return;photoData=null;const btn=el('#ai-scan');if(btn)btn.disabled=true;status('Preparing the photo…');
    try{
      if(!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type)&&!/^image\//.test(f.type))throw Error('Please choose an image file.');
      if(f.size>20*1024*1024)throw Error('Please choose an image smaller than 20 MB.');
      let bitmap=await createImageBitmap(f);
      let scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      photoData=canvas.toDataURL('image/jpeg',.78);fileName=f.name;
      const preview=el('#ai-preview');preview.src=photoData;preview.hidden=false;
      el('#ai-photo-caption').textContent='Image ready. It will be sent to your configured Cloudflare Worker only when you tap Identify.';
      btn.disabled=false;status('Photo ready. Tap Identify machine with AI.');
    }catch(err){status(err.message||'Could not read this photo. Try JPEG or PNG.')}
  }
  async function scan(){if(!photoData||busy)return;const config=settings();if(!config.endpoint){status('Set up your Cloudflare Worker URL below first. You can still choose a machine manually.');return}
    if(!config.code){status('Enter the private beta access code in the Cloudflare connection settings.');return}
    let url;try{url=new URL(config.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error();}catch{status('Enter a valid HTTPS Worker URL.');return}
    busy=true;el('#ai-scan').disabled=true;status('Asking your AI to identify the machine…');
    try{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25000);
      let response;try{response=await fetch(url.href.replace(/\/$/,'')+'/scan',{method:'POST',headers:{'Content-Type':'application/json','X-MyStrength-Access':config.code},body:JSON.stringify({image:photoData}),signal:controller.signal})}finally{clearTimeout(timeout)}
      const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||`AI service returned ${response.status}`);
      if(!body||!(body.machine===null||typeof body.machine==='string')||!Array.isArray(body.alternatives))throw Error('Unexpected AI response');
      showResult(body);status(body.machine?'AI suggestion ready. Please verify it before use.':'No reliable machine match. Choose from the catalogue below.');
    }catch(err){status(err.name==='AbortError'?'The scan timed out. Try again.':(err.message==='Failed to fetch'?'Could not connect to Cloudflare. Check the Worker URL and its CORS setting.':err.message))}
    finally{busy=false;const btn=el('#ai-scan');if(btn)btn.disabled=!photoData}
  }
  async function mounted(){
    try{machineList=await cataloguePromise}catch{status('Machine guide could not load.');return}
    if(!el('#ai-catalogue'))return;
    const cat=el('#ai-catalogue');cat.replaceChildren();machineList.forEach(m=>{const button=document.createElement('button');button.className='ai-btn';button.type='button';button.textContent=m.name;button.onclick=()=>renderGuide(m);cat.append(button)});
    const s=settings();el('#ai-endpoint').value=s.endpoint||'';el('#ai-code').value=s.code||'';
    for(const id of ['#ai-camera','#ai-upload'])el(id).onchange=e=>{const file=e.target.files?.[0];e.target.value='';if(file)changeFile(file)};
    el('#ai-scan').onclick=scan;
    el('#ai-save-settings').onclick=()=>{let endpoint=el('#ai-endpoint').value.trim().replace(/\/$/,'');let code=el('#ai-code').value.trim();
      if(endpoint){try{const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error()}catch{status('Enter a valid HTTPS URL without credentials or query parameters.');return}}
      localStorage.setItem(settingsKey,JSON.stringify({endpoint,code}));status('Cloudflare connection settings saved on this device.');};
    if(choice)renderGuide(choice);
    if(photoData){el('#ai-preview').src=photoData;el('#ai-preview').hidden=false;el('#ai-scan').disabled=false;el('#ai-photo-caption').textContent='Photo ready.'}
  }
  window.MyStrengthAI={page,mounted};
})();
