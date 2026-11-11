export function createFxChain({state,$,audioContext,clamp,duration,renderEffect,renderSlices,snapshot,stopEffectPreview,startEffectPreview,stopPlayback,stretchPitch,convertSampleRate,toast,updatePeaks,updateUI,livePlayhead}) {
function editorValue(id,min,max){
  const el=$(id),value=Number(el.value);
  if(el.value===''||!Number.isFinite(value)||value<min||value>max)throw new Error(`${el.labels?.[0]?.textContent.trim()||id}: enter a value from ${min} to ${max}.`);
  return value;
}
const effectOrder=['quality','pitch','eq','reverb','delay','distortion','compressor'];
const effectControls={
  quality:{},
  eq:{eqLowFreq:['lowFreq',1],eqLowGain:['lowGain',1],eqLowMidFreq:['lowMidFreq',1],eqLowMidGain:['lowMidGain',1],eqLowMidQ:['lowMidQ',1],eqMidFreq:['midFreq',1],eqMidGain:['midGain',1],eqMidQ:['midQ',1],eqHighMidFreq:['highMidFreq',1],eqHighMidGain:['highMidGain',1],eqHighMidQ:['highMidQ',1],eqHighFreq:['highFreq',1],eqHighGain:['highGain',1]},
  pitch:{pitchSemitones:['semitones',1],pitchCents:['cents',1]},
  reverb:{reverbDecay:['decay',1],reverbPredelay:['predelay',1000],reverbTone:['tone',1],reverbMix:['mix',100]},
  delay:{delayTime:['time',1000],delayFeedback:['feedback',100],delayTone:['tone',1],delayMix:['mix',100]},
  distortion:{distDrive:['drive',1],distTone:['tone',1],distBits:['bits',1],distDownsample:['downsample',1],distMix:['mix',100]},
  compressor:{compThreshold:['threshold',1],compRatio:['ratio',1],compKnee:['knee',1],compAttack:['attack',1000],compRelease:['release',1000],compMakeup:['makeup',1],compMix:['mix',100],vinylComp:['vinylComp',100],vinylNoise:['vinylNoise',100],vinylWow:['vinylWow',100],vinylLevel:['vinylLevel',100],compLowThreshold:['lowThreshold',1],compMidThreshold:['midThreshold',1],compHighThreshold:['highThreshold',1],compLowCross:['lowCross',1],compHighCross:['highCross',1]},
};
function readEffectSettings(kind,root: any=document){
  const $=id=>root===document?document.getElementById(id):root.querySelector(`[data-original-id="${id}"]`)||root.querySelector(`#${id}`);
  const editorValue=(id,min,max)=>{const el=$(id),value=Number(el.value);if(el.value===''||!Number.isFinite(value)||value<min||value>max)throw new Error(`Invalid ${id}.`);return value;};
  if(kind==='quality')return {rate:Number($('resampleRate').value),taps:Number($('resampleQuality').value)};
  if(kind==='eq'){const values={};for(const [id,[key]] of Object.entries(effectControls.eq)){const field=$(id);values[key]=editorValue(id,Number(field.min),Number(field.max));}return values;}
  if(kind==='pitch')return {semitones:editorValue('pitchSemitones',-12,12),cents:editorValue('pitchCents',-100,100)};
  if(kind==='reverb')return {type:$('reverbType').value,decay:editorValue('reverbDecay',.1,8),predelay:editorValue('reverbPredelay',0,250)/1000,tone:editorValue('reverbTone',200,20000),mix:editorValue('reverbMix',0,100)/100};
  if(kind==='delay')return {type:$('delayType').value,time:editorValue('delayTime',1,2000)/1000,feedback:editorValue('delayFeedback',0,90)/100,tone:editorValue('delayTone',200,20000),mix:editorValue('delayMix',0,100)/100};
  if(kind==='distortion')return {type:$('distType').value,drive:editorValue('distDrive',0,36),tone:editorValue('distTone',200,20000),bits:Math.round(editorValue('distBits',2,16)),downsample:Math.round(editorValue('distDownsample',1,32)),mix:editorValue('distMix',0,100)/100};
  return {type:$('compType').value,lowThreshold:editorValue('compLowThreshold',-100,0),midThreshold:editorValue('compMidThreshold',-100,0),highThreshold:editorValue('compHighThreshold',-100,0),lowCross:editorValue('compLowCross',40,1000),highCross:editorValue('compHighCross',1000,12000),vinylComp:editorValue('vinylComp',0,100)/100,vinylNoise:editorValue('vinylNoise',0,100)/100,vinylWow:editorValue('vinylWow',0,100)/100,vinylLevel:editorValue('vinylLevel',0,100)/100,threshold:editorValue('compThreshold',-100,0),ratio:editorValue('compRatio',1,20),knee:editorValue('compKnee',0,40),attack:editorValue('compAttack',0,1000)/1000,release:editorValue('compRelease',0,1000)/1000,makeup:editorValue('compMakeup',0,24),mix:editorValue('compMix',0,100)/100};
}
const fxNames={quality:'Quality / resample',pitch:'Pitch',eq:'5-band EQ',reverb:'Reverb',delay:'Delay',distortion:'Distortion',compressor:'Compressor'};
const fxTemplates: Record<string, HTMLDetailsElement>={};
function setupEffectChain(){
  const mapping={quality:'qualityApplyBtn',pitch:'pitchApplyBtn',eq:'eqApplyBtn',reverb:'reverbApplyBtn',delay:'delayApplyBtn',distortion:'distortionApplyBtn',compressor:'compApplyBtn'};
  const exportBox=document.createElement('div');exportBox.className='editor-section editor-settings';
  exportBox.append($('exportDepth').closest('label'),$('exportChannels').closest('label'));
  document.querySelector('.editor-actions').append(exportBox);
  for(const [kind,id] of Object.entries(mapping)){
    const template=$(id).closest('details');fxTemplates[kind]=template.cloneNode(true);template.remove();
    fxTemplates[kind].querySelectorAll('button').forEach(button=>button.remove());
    if(kind==='quality')fxTemplates[kind].querySelectorAll('p').forEach(p=>p.remove());
  }
  const header=document.querySelector('.fx-header');
  const add=document.createElement('select');add.id='fxAdd';add.className='field';add.setAttribute('aria-label','Add FX');
  add.innerHTML='<option value="">Add FX…</option>'+effectOrder.map(kind=>`<option value="${kind}">${fxNames[kind]}</option>`).join('');header.append(add);
  const list=document.createElement('div');list.id='fxList';header.after(list);
  const status=document.createElement('p');status.id='fxStatus';status.setAttribute('role','status');status.className='text-[11px] text-[#8da0a3] mt-2';list.after(status);
  const footer=$('fxApplyChainBtn').parentElement;footer.nextElementSibling?.remove();
  add.addEventListener('change',()=>{if(!add.value)return;const kind=add.value;add.value='';
    const root=fxTemplates[kind];if(kind==='quality')setTemplateRate(root,state.fxBase.sampleRate);
    const settings=readEffectSettings(kind,root);state.fxDraft.push({id:state.fxNextId++,type:kind,enabled:true,settings});syncEffectControls();queueFxRender();
  });
}
function setTemplateRate(root,rate){const select=root.querySelector('#resampleRate');if(![...select.options].some(o=>Number(o.value)===rate)){const o=document.createElement('option');o.value=String(rate);o.textContent=String(rate);select.append(o);}select.value=String(rate);}
function syncEffectControls(){
  const list=$('fxList');if(!list)return;
  const openCards=new Map([...list.querySelectorAll('details[data-fx-id]')].map(card=>[card.dataset.fxId,card.open]));
  list.replaceChildren();
  for(const [index,effect] of state.fxDraft.entries()){
    const card=fxTemplates[effect.type].cloneNode(true) as HTMLDetailsElement;card.open=openCards.get(String(effect.id))??true;card.dataset.fxId=String(effect.id);
    card.querySelectorAll<HTMLElement>('[id]').forEach(el=>{el.dataset.originalId=el.id;el.id=`fx-${effect.id}-${el.id}`;});
    card.querySelectorAll<HTMLLabelElement>('label[for]').forEach(el=>el.htmlFor=`fx-${effect.id}-${el.htmlFor}`);
    const field=(id: string)=>card.querySelector<HTMLInputElement>(`[data-original-id="${id}"]`);
    if(effect.type==='quality')setTemplateRateForCard(card,effect.settings.rate);
    for(const [id,[key,multiplier]] of Object.entries(effectControls[effect.type]) as [string, [string, number]][]){field(id).value=String(effect.settings[key]*multiplier);field(id+'Slider').value=field(id).value;}
    const selectIds={quality:['resampleQuality','taps'],reverb:['reverbType','type'],delay:['delayType','type'],distortion:['distType','type'],compressor:['compType','type']};
    if(selectIds[effect.type]){const [id,key]=selectIds[effect.type];field(id).value=String(effect.settings[key]);}
    const summary=card.querySelector('summary');summary.classList.add('fx-card-summary');summary.textContent='';
    const title=document.createElement('span');title.className='fx-card-title';title.textContent=`${index+1}. ${fxNames[effect.type]}`;
    const actions=document.createElement('div');actions.className='fx-card-actions';
    const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn btn-quiet btn-sm';b.textContent=label;b.setAttribute('aria-label',`${label} ${fxNames[effect.type]}`);b.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();fn();});actions.append(b);return b;};
    const iconButton=(button,icon,label)=>{button.classList.add('transport-icon');button.title=label;button.setAttribute('aria-label',`${label} ${fxNames[effect.type]}`);button.innerHTML=`<svg aria-hidden="true"><use href="#${icon}"></use></svg>`;};
    const handle=button('⋮⋮',()=>{});handle.classList.add('fx-drag-handle');handle.draggable=true;handle.setAttribute('aria-label',`Drag to reorder ${fxNames[effect.type]}`);handle.title='Drag to reorder';
    let dragging=false;
    handle.addEventListener('dragstart',e=>{
      dragging=true;
      const rect=summary.getBoundingClientRect(),preview=document.createElement('canvas');
      const scale=window.devicePixelRatio||1,width=Math.max(160,Math.round(rect.width)),height=44;
      preview.width=Math.round(width*scale);preview.height=Math.round(height*scale);
      preview.style.width=`${width}px`;preview.style.height=`${height}px`;
      const image=preview.getContext('2d');image.scale(scale,scale);
      image.fillStyle='#161d21';image.fillRect(0,0,width,height);
      image.strokeStyle='#60746b';image.strokeRect(.5,.5,width-1,height-1);
      image.textBaseline='middle';image.font='bold 13px system-ui, sans-serif';
      image.fillStyle='#a6b8b2';image.fillText('⋮⋮',10,height/2);
      image.fillStyle='#eef4f0';image.fillText(`${index+1}. ${fxNames[effect.type]}`,34,height/2,Math.max(20,width-115));
      image.font='11px system-ui, sans-serif';image.textAlign='right';image.fillStyle=effect.enabled?'#c3ef7a':'#8b9b9e';
      image.fillText(effect.enabled?'ON':'BYPASSED',width-12,height/2);
      e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(effect.id));
      e.dataTransfer.setDragImage(preview,Math.max(0,Math.min(width,e.clientX-rect.left)),height/2);
      requestAnimationFrame(()=>{if(dragging)card.classList.add('fx-dragging');});
    });
    handle.addEventListener('dragend',()=>{dragging=false;card.classList.remove('fx-dragging');});
    const bypass=button(effect.enabled?'On':'Bypassed',()=>{effect.enabled=!effect.enabled;syncEffectControls();queueFxRender();});bypass.classList.add('btn-loop');bypass.setAttribute('aria-pressed',String(effect.enabled));iconButton(bypass,'ic-power',effect.enabled?'Bypass':'Enable');
    button('↑',()=>moveFx(index,index-1));button('↓',()=>moveFx(index,index+1));
    const reset=button('Reset',()=>{const root=fxTemplates[effect.type];if(effect.type==='quality')setTemplateRate(root,state.fxBase.sampleRate);effect.settings=readEffectSettings(effect.type,root);syncEffectControls();queueFxRender();});iconButton(reset,'ic-reset','Reset');
    const remove=button('Remove',()=>{state.fxDraft.splice(index,1);syncEffectControls();queueFxRender();});iconButton(remove,'ic-trash','Remove');summary.append(handle,title,actions);
    const changed=()=>{try{effect.settings=readEffectSettings(effect.type,card);if(effect.type==='compressor')updateCompressorVisibility(card,field('compType').value);queueFxRender();}catch{}};
    for(const id of Object.keys(effectControls[effect.type])){const input=field(id),slider=field(id+'Slider');
      slider.addEventListener('input',()=>{const step=Number(input.step)||1,min=Number(input.min);input.value=String(Math.round(clamp(min+Math.round((Number(slider.value)-min)/step)*step,min,Number(input.max))*1000)/1000);slider.value=input.value;changed();});
      input.addEventListener('input',()=>{if(input.value!==''&&Number(input.value)>=Number(input.min)&&Number(input.value)<=Number(input.max)){slider.value=input.value;changed();}});
      input.addEventListener('change',()=>{input.value=input.value!==''&&Number.isFinite(Number(input.value))?String(clamp(Number(input.value),Number(input.min),Number(input.max))):slider.value;slider.value=input.value;changed();});
    }
    card.querySelectorAll('select').forEach(el=>el.addEventListener('change',()=>{
      if(effect.type==='compressor'&&el.dataset.originalId==='compType'){
        const presets={vca:[4,6,10,100],variablemu:[2,24,25,300],digital:[4,0,5,100],opto:[3,20,10,350],fet:[8,6,1,50]};
        const preset=presets[el.value];if(preset)for(const [id,value] of [['compRatio',preset[0]],['compKnee',preset[1]],['compAttack',preset[2]],['compRelease',preset[3]]]){field(id).value=String(value);field(id+'Slider').value=String(value);}
      }changed();
    }));
    if(effect.type==='compressor')updateCompressorVisibility(card,field('compType').value);
    card.addEventListener('dragover',e=>e.preventDefault());card.addEventListener('drop',e=>{e.preventDefault();const from=state.fxDraft.findIndex(f=>String(f.id)===e.dataTransfer.getData('text/plain'));moveFx(from,index);});
    list.append(card);
  }
  updateUI();
}
function setTemplateRateForCard(card,rate){const select=card.querySelector('[data-original-id="resampleRate"]');if(![...select.options].some(o=>Number(o.value)===rate)){const o=document.createElement('option');o.value=String(rate);o.textContent=String(rate);select.append(o);}select.value=String(rate);}
function updateCompressorVisibility(card,type){card.querySelectorAll('[data-comp-mode]').forEach(el=>el.hidden=el.dataset.compMode==='general'?type==='vinyl303':el.dataset.compMode==='single'?['vinyl303','multiband'].includes(type):el.dataset.compMode!==type);}
function moveFx(from,to){if(from<0||to<0||to>=state.fxDraft.length||from===to)return;state.fxDraft.splice(to,0,state.fxDraft.splice(from,1)[0]);syncEffectControls();queueFxRender();}
async function renderChain(base,chain,tempoRate=state.tempoRate){let output=base;if(Math.abs(tempoRate-1)>1e-9)output=await stretchPitch(output,0,output.length,{speed:tempoRate,semitones:0,cents:0});for(const effect of chain){if(!effect.enabled)continue;const p=effect.settings;if(effect.type==='pitch'){if(p.semitones||p.cents)output=await stretchPitch(output,0,output.length,{...p,speed:1});}else if(effect.type==='quality')output=await convertSampleRate(output,p.rate,p.taps);else output=await renderEffect(output,0,output.length,effect.type,p);}return output;}
function queueFxRender(){
  const version=++state.fxRenderVersion;state.fxRenderPending=true;state.fxRenderError=null;clearTimeout(state.fxPreviewTimer);$('fxStatus').textContent='Preparing preview…';updateUI();
  state.fxPreviewTimer=setTimeout(async()=>{const base=state.fxBase,chain=structuredClone(state.fxDraft);try{await audioContext();const output=await renderChain(base,chain);if(version!==state.fxRenderVersion||base!==state.fxBase)return;state.fxRendered=output;state.fxRenderPending=false;$('fxStatus').textContent='Preview ready';
    if(state.fxPreview){const p=state.fxPreview,position=livePlayhead(),start=p.uiStart,end=p.uiEnd;stopEffectPreview();startEffectPreview(start,end,position);}
  }catch(error){if(version!==state.fxRenderVersion)return;state.fxRenderPending=false;state.fxRenderError=error;$('fxStatus').textContent=`Preview error: ${error.message}`;}finally{if(version===state.fxRenderVersion)updateUI();}},180);
}
async function commitEffectChain(){
  if(!state.fxBase||state.processing||state.fxRenderPending||state.fxRenderError)return;
  const next=structuredClone(state.fxDraft),base=state.fxBase;state.processing=true;stopEffectPreview();stopPlayback();updateUI();
  try{const output=state.fxRendered||await renderChain(base,next);if(state.fxBase!==base)throw new Error('The sample changed while processing.');const oldDuration=duration(),scale=oldDuration?output.duration/oldDuration:1;snapshot();state.buffer=output;state.fxChain=next;
    if(Math.abs(scale-1)>1e-9){for(const slice of state.slices){slice.start*=scale;slice.end*=scale;}state.selection={start:state.selection.start*scale,end:state.selection.end*scale};state.cursor*=scale;}updatePeaks();renderSlices();toast('Effect chain applied. The source remains available.');
  }catch(error){toast(`Unable to apply effects: ${error.message}`);}finally{state.processing=false;updateUI();}
}

return {fxTemplates,setupEffectChain,syncEffectControls,renderChain,queueFxRender,commitEffectChain};
}
