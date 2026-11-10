/* Sample/One: client-side, single-sample capture and editing workstation. */
'use strict';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'sourceBadge','sourceLabel','connectTab','connectInput','disconnect','inputDevices','inputHint','levelFill','dbLevel',
  'recordBtn','recordLabel','playBtn','playSelectionBtn','stopBtn','loopBtn','recMessage','counter',
  'importBtn','exampleBtn','exportBtn','fileInput','waveCanvas','emptyWave','formatLabel','zoom','zoomLabel','viewScroll',
  'durationStat','startStat','endStat','rangeStat','sampleName','inBtn','outBtn','allBtn',
  'cropBtn','deleteBtn','normalizeBtn','undoBtn','exportSelectionBtn','transientBtn','splitBtn',
  'selectionStart','selectionEnd','reverseBtn','silenceBtn','chopCount','customChopsBtn',
  'transientSensitivity','sensitivityValue','sliceInspector','sliceStart','sliceEnd','auditionSliceBtn','chopUndoBtn',
  'addSliceBtn','clearSlicesBtn','sliceCount','slices','exportZipBtn','dropOverlay','toast',
].map((key) => [key, $(key)]));
const canvas = els.waveCanvas;
const ctx = canvas.getContext('2d', { alpha:false });
const MAX_RECORD_MS = 180_000;
const waveformPadding = {top:29,bottom:31};
const pcmPeakCount = 32_768;
const state = {
  ctx:null,sourceStream:null,sourceType:'',sourceLabel:'',sourceNode:null,analyser:null,mutedNode:null,
  recorder:null,chunks:[],recordStarted:0,recordTimer:null,recordBusy:false,
  buffer:null,name:'Untitled sample',selection:{start:0,end:0},cursor:0,slices:[],nextId:1,undo:[],
  selectedSliceId:null,selectedSliceEdge:null,tab:'capture',bank:0,padConfig:new Map(),padVoices:new Map(),padPending:new Map(),midi:null,midiLearning:null,heldKeys:new Map(),heldMidi:new Map(),
  originalBuffer:null,fxBase:null,fxChain:[],fxDraft:[],fxRendered:null,fxRenderVersion:0,fxRenderPending:false,fxRenderError:null,fxNextId:1,fxPreview:null,fxPreviewStarting:false,fxPreviewGeneration:0,fxPreviewTimer:null,processing:false,playing:null,transportLoop:false,zoom:1,viewFraction:0,peaks:null,pointer:null,toastTimer:null,frame:0,
};

const clamp = (x,a,b) => Math.min(b,Math.max(a,x));
const duration = () => state.buffer ? state.buffer.duration : 0;
const secs = (v) => `${(Number.isFinite(v) ? v : 0).toFixed(2)} s`;
function clock(seconds) {
  const cs = Math.max(0,Math.floor(seconds*100));
  return `${String(Math.floor(cs/6000)).padStart(2,'0')}:${String(Math.floor((cs%6000)/100)).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;
}
function toast(message) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('show');
  state.toastTimer = setTimeout(()=>els.toast.classList.remove('show'),3900);
}
async function audioContext() {
  if (!state.ctx || state.ctx.state==='closed') state.ctx=new (window.AudioContext || window.webkitAudioContext)();
  if (state.ctx.state==='suspended') await state.ctx.resume();
  return state.ctx;
}
function updateUI() {
  const has = Boolean(state.buffer);
  const source = Boolean(state.sourceStream);
  const recording = state.recorder?.state==='recording';
  const busy = recording || state.recordBusy || state.processing;
  const playing = Boolean(state.playing);
  const span=has?Math.max(0,state.selection.end-state.selection.start):0;
  const effectsActive=Boolean(state.fxPreview)||state.fxChain.some(effect=>effect.enabled);
  els.sourceBadge.classList.toggle('connected',source&&!recording);
  els.sourceBadge.classList.toggle('rec-live',recording);
  els.sourceLabel.textContent=recording?'Recording audio':source?state.sourceLabel:'Source disconnected';
  els.recordBtn.disabled=(!source&&!recording)||state.recordBusy;
  els.recordBtn.classList.toggle('recording',recording);
  els.recordLabel.textContent=recording?'Stop recording':'Record sample';
  els.connectTab.disabled=busy;
  els.connectInput.disabled=busy;
  els.inputDevices.disabled=busy;
  els.disconnect.disabled=!source||busy;
  els.playBtn.disabled=!has||busy;
  els.playSelectionBtn.disabled=!has||busy||span<0.01;
  els.stopBtn.disabled=!playing&&!recording&&!state.fxPreview&&!state.fxPreviewStarting;
  document.querySelectorAll('[data-process]').forEach(button=>button.disabled=!has||busy);
  els.exportBtn.disabled=!has||busy;
  els.exampleBtn.disabled=busy;els.importBtn.disabled=busy;
  els.exportSelectionBtn.disabled=!has||busy||span<0.01;
  els.zoom.disabled=!has;
  els.inBtn.disabled=!has||busy;
  els.outBtn.disabled=!has||busy;
  els.allBtn.disabled=!has||busy;
  els.cropBtn.disabled=!has||busy||effectsActive||span<0.01||(span>=duration()-0.005);
  els.deleteBtn.disabled=!has||busy||effectsActive||span<0.01||(span>=duration()-0.005);
  els.normalizeBtn.disabled=!has||busy||effectsActive;
  for(const input of [els.selectionStart,els.selectionEnd]){input.disabled=!has||busy;input.max=String(duration());}
  if(document.activeElement!==els.selectionStart)els.selectionStart.value=has?state.selection.start.toFixed(3):'';
  if(document.activeElement!==els.selectionEnd)els.selectionEnd.value=has?state.selection.end.toFixed(3):'';
  for(const button of [els.reverseBtn,els.silenceBtn])button.disabled=!has||busy||effectsActive||span<0.01;
  $('fxAdd').disabled=!has||busy;
  $('fxApplyChainBtn').disabled=!has||busy||state.fxRenderPending||Boolean(state.fxRenderError);
  $('fxDiscardBtn').disabled=!has||busy;$('fxResetBtn').disabled=!has||busy;
  document.querySelectorAll('#fxList input, #fxList select, #fxList button').forEach(el=>el.disabled=!has||busy);
  els.customChopsBtn.disabled=!has||busy;els.chopCount.disabled=!has||busy;
  els.undoBtn.disabled=!state.undo.length||busy;els.chopUndoBtn.disabled=!state.undo.length||busy;
  els.transientSensitivity.disabled=!has||busy;
  els.transientBtn.disabled=!has||busy;
  els.splitBtn.disabled=!has||busy;
  els.addSliceBtn.disabled=!has||busy||span<0.01;
  els.clearSlicesBtn.disabled=!state.slices.length||busy;
  els.exportZipBtn.disabled=!state.slices.length||busy;
  document.querySelectorAll('[data-chops]').forEach(el=>el.disabled=!has||busy);
  els.emptyWave.style.display=has||recording?'none':'flex';
  els.durationStat.textContent=secs(duration());
  els.startStat.textContent=secs(has?state.selection.start:0);
  els.endStat.textContent=secs(has?state.selection.end:0);
  els.rangeStat.textContent=secs(span);
  els.formatLabel.textContent=has?`${state.buffer.sampleRate.toLocaleString()} Hz · ${state.buffer.numberOfChannels===1?'Mono':state.buffer.numberOfChannels===2?'Stereo':state.buffer.numberOfChannels+' ch'} · ${clock(duration())}`:'No audio loaded';
  els.sliceCount.textContent=String(state.slices.length);
  els.recMessage.textContent=recording?'Capturing live audio…':source?'Source ready · press Record':'Connect a source to record';
  els.zoomLabel.textContent=`${state.zoom}×`;
  els.viewScroll.classList.toggle('hidden',!has||state.zoom===1);
}

async function releaseSource() {
  if (state.sourceStream) state.sourceStream.getTracks().forEach(track=>track.stop());
  try {state.sourceNode?.disconnect();state.analyser?.disconnect();state.mutedNode?.disconnect();}catch{}
  state.sourceStream=null;state.sourceNode=null;state.analyser=null;state.mutedNode=null;
  state.sourceType='';state.sourceLabel='';
  els.inputDevices.classList.add('hidden');els.inputHint.textContent='Nothing connected · all processing stays on this device';
  els.levelFill.style.width='0%';els.dbLevel.textContent='— dB';
  updateUI();
}
async function connectedStream(stream,type,label){
  const audio=stream.getAudioTracks();
  if (!audio.length){
    stream.getTracks().forEach(t=>t.stop());
    throw new Error('No audio track was shared. For Chrome tabs, enable “Also share tab audio” in the sharing dialog.');
  }
  await releaseSource();
  const ac=await audioContext();
  state.sourceStream=stream;state.sourceType=type;state.sourceLabel=label;
  state.sourceNode=ac.createMediaStreamSource(new MediaStream(audio));
  state.analyser=ac.createAnalyser();state.analyser.fftSize=2048;state.analyser.smoothingTimeConstant=0.7;
  state.mutedNode=ac.createGain();state.mutedNode.gain.value=0;
  state.sourceNode.connect(state.analyser);
  state.analyser.connect(state.mutedNode);
  state.mutedNode.connect(ac.destination);
  const active=stream;
  for(const track of stream.getTracks()){
    track.addEventListener('ended',()=>{
      if(state.sourceStream!==active) return;
      if(state.recorder?.state==='recording') stopRecording();
      releaseSource();
      toast('Audio sharing ended. Connect again to record.');
    },{once:true});
  }
  els.inputHint.textContent=type==='tab'?'Sharing audio only · video is not recorded':'Audio input connected · use headphones to avoid feedback';
  updateUI();
}
async function connectTab(){
  if(!navigator.mediaDevices?.getDisplayMedia){toast('Screen/tab audio capture is not supported in this browser. Try Chrome or Edge.');return;}
  try{
    // getDisplayMedia requires video:true, even though ONLY the audio track is recorded.
    const stream=await navigator.mediaDevices.getDisplayMedia({
      video:true,audio:true,systemAudio:'include',selfBrowserSurface:'exclude',surfaceSwitching:'include'
    });
    await connectedStream(stream,'tab','Shared tab / screen');
    toast('Audio source connected. Start playback in the shared tab, then press Record.');
  }catch(error){ if(error.name!=='NotAllowedError'&&error.name!=='AbortError') toast(error.message||'Unable to capture that source.'); }
}
async function populateInputs(selectedId){
  try {
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
    els.inputDevices.replaceChildren();
    for(let i=0;i<devices.length;i++){
      const option=document.createElement('option');
      option.value=devices[i].deviceId;option.textContent=devices[i].label||`Audio input ${i+1}`;
      els.inputDevices.appendChild(option);
    }
    const matching=devices.find(d=>d.deviceId===selectedId);
    if(matching) els.inputDevices.value=matching.deviceId;
    els.inputDevices.classList.toggle('hidden',!devices.length);
  }catch{els.inputDevices.classList.add('hidden');}
}
async function connectInput(id){
  if(!navigator.mediaDevices?.getUserMedia){toast('Audio inputs require a modern browser on localhost or HTTPS.');return;}
  try{
    const constraints={echoCancellation:false,noiseSuppression:false,autoGainControl:false};
    if(id) constraints.deviceId={exact:id};
    const stream=await navigator.mediaDevices.getUserMedia({audio:constraints});
    const settings=stream.getAudioTracks()[0].getSettings();
    await connectedStream(stream,'input',stream.getAudioTracks()[0].label||'Audio input');
    await populateInputs(settings.deviceId);
    toast('Audio input connected. Press Record to capture a sample.');
  }catch(error){ if(error.name!=='NotAllowedError') toast(error.message||'Unable to access audio input.'); }
}

function stopRecording(){
  if(state.recorder?.state==='recording')state.recorder.stop();
  clearInterval(state.recordTimer);state.recordTimer=null;
  updateUI();
}
async function toggleRecording(){
  if(state.recorder?.state==='recording'){stopRecording();return;}
  if(!state.sourceStream){toast('Connect a browser tab or audio input first.');return;}
  if(!window.MediaRecorder){toast('MediaRecorder is unavailable in this browser.');return;}
  if(state.recordBusy)return;
  try{
    stopPlayback();
    await audioContext();
    const stream=new MediaStream(state.sourceStream.getAudioTracks());
    const options={};
    const types=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'];
    const type=types.find(type=>MediaRecorder.isTypeSupported(type));
    if(type) options.mimeType=type;
    const recorder=new MediaRecorder(stream,options);
    state.recorder=recorder;state.chunks=[];state.recordStarted=performance.now();
    recorder.ondataavailable=(event)=>{if(event.data?.size)state.chunks.push(event.data);};
    recorder.onerror=()=>toast('The recording failed. Please try reconnecting the source.');
    recorder.onstop=async()=>{
      state.recordBusy=true;
      clearInterval(state.recordTimer);state.recordTimer=null;
      updateUI();
      const chunks=state.chunks;state.chunks=[];
      try{
        if(!chunks.length)throw new Error('No audio was captured.');
        const blob=new Blob(chunks,{type:recorder.mimeType||chunks[0].type});
        const ac=await audioContext();
        const decoded=await ac.decodeAudioData(await blob.arrayBuffer());
        if(!decoded.length)throw new Error('Recording is empty.');
        loadSample(decoded,`Recording ${new Date().toLocaleTimeString().replaceAll(':','-')}`);
        toast(`Recording loaded · ${secs(decoded.duration)} · drag to select a region.`);
      }catch(error){toast(`Recording could not be loaded: ${error.message}. Check that the source is playing.`);}
      finally{
        state.recordBusy=false;
        if(state.recorder===recorder)state.recorder=null;
        updateUI();
      }
    };
    recorder.start(250);
    state.recordTimer=setInterval(()=>{
      const elapsed=performance.now()-state.recordStarted;
      els.counter.textContent=clock(elapsed/1000);
      if(elapsed>=MAX_RECORD_MS){stopRecording();toast('Recording stopped at the 3-minute safety limit.');}
    },70);
    updateUI();
  }catch(error){state.recorder=null;toast(error.message||'Unable to start audio recording.');updateUI();}
}

function snapshot(){
  if(!state.buffer)return;
  state.undo.push({buffer:state.buffer,fxBase:state.fxBase,fxChain:structuredClone(state.fxChain),fxDraft:structuredClone(state.fxDraft),name:state.name,slices:state.slices.map(s=>({...s})),selection:{...state.selection},cursor:state.cursor});
  if(state.undo.length>8)state.undo.shift();
}
function stopPlayback(){
  if(state.playing){
    const item=state.playing;state.playing=null;
    try{item.node.onended=null;item.node.stop(0);}catch{}
    try{item.node.disconnect();item.gain.disconnect();}catch{}
    updateUI();
  }
}
function updatePeaks(){
  if(!state.buffer){state.peaks=null;return;}
  const buffer=state.buffer,n=buffer.length;
  const count=Math.min(pcmPeakCount,n);
  const lo=new Float32Array(count),hi=new Float32Array(count);
  const channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,i)=>buffer.getChannelData(i));
  for(let i=0;i<count;i++){
    let min=1,max=-1;
    const begin=Math.floor(i*n/count),end=Math.max(begin+1,Math.floor((i+1)*n/count));
    for(let x=begin;x<end;x++){
      let v=0;for(const channel of channels)v+=channel[x];v/=channels.length;
      if(v<min)min=v;if(v>max)max=v;
    }
    lo[i]=min;hi[i]=max;
  }
  state.peaks={lo,hi};
}
function loadSample(buffer,name){
  stopPads();state.padConfig.clear();state.bank=0;state.selectedSliceId=null;state.selectedSliceEdge=null;
  stopPlayback();
  stopEffectPreview();clearTimeout(state.fxPreviewTimer);state.originalBuffer=buffer;state.fxBase=buffer;state.fxChain=[];state.fxDraft=[];state.fxRendered=null;state.fxRenderVersion++;state.fxRenderPending=false;state.fxRenderError=null;$('fxStatus').textContent='';
  state.buffer=buffer;setResampleRate(buffer.sampleRate);syncEffectControls();
  state.name=name||'Untitled sample';
  els.sampleName.value=state.name;
  state.selection={start:0,end:buffer.duration};
  state.cursor=0;state.slices=[];state.nextId=1;state.undo=[];
  state.zoom=1;state.viewFraction=0;
  els.zoom.value='1';els.viewScroll.value='0';
  updatePeaks();renderSlices();updateUI();
  els.counter.textContent=clock(buffer.duration);
}
function range(){
  return [clamp(state.selection.start,0,duration()),clamp(state.selection.end,0,duration())];
}
function selectRange(start,end){
  const d=duration();
  state.selection={start:clamp(Math.min(start,end),0,d),end:clamp(Math.max(start,end),0,d)};
  updateUI();
}
async function playRange(start,end,options={}){
  if(!state.buffer)return;
  stopEffectPreview();stopPlayback();
  start=clamp(start,0,duration());end=clamp(end,0,duration());
  if(end-start<0.005)return;
  try{
    const ac=await audioContext();
    const node=ac.createBufferSource();node.buffer=options.slice?sliceBuffer(options.slice):state.buffer;
    const gain=ac.createGain();gain.gain.value=0.86;
    node.connect(gain);gain.connect(ac.destination);
    const offset=clamp(options.offset??start,start,end-0.001);
    const loop=Boolean(options.transport&&state.transportLoop);
    const item={node,gain,start,end,offset,loop,transport:Boolean(options.transport),startedAt:ac.currentTime};
    state.playing=item;state.cursor=offset;
    node.onended=()=>{
      if(state.playing===item){state.cursor=end;state.playing=null;try{node.disconnect();gain.disconnect();}catch{}updateUI();}
    };
    const bufferOffset=options.slice?offset-start:offset;
    if(loop){node.loop=true;node.loopStart=options.slice?0:start;node.loopEnd=options.slice?node.buffer.duration:end;node.start(0,bufferOffset);}
    else node.start(0,bufferOffset,Math.min(end-offset,node.buffer.duration-bufferOffset));
    updateUI();
  }catch(error){toast(error.message||'Cannot play this audio.');}
}
function playTransport(start,end){
  if(state.tab==='editor'){stopEffectPreview();startEffectPreview(start,end);}
  else playRange(start,end,{transport:true});
}
function livePlayhead(){
  if(state.fxPreview)return previewPosition(state.fxPreview)/state.fxPreview.ratio;
  if(!state.playing)return state.cursor;
  const item=state.playing,elapsed=Math.max(0,state.ctx.currentTime-item.startedAt);
  if(item.loop)return item.start+((item.offset-item.start+elapsed)%(item.end-item.start));
  return Math.min(item.end,item.offset+elapsed);
}
function extractBuffer(input,start,end){
  const a=clamp(Math.floor(start*input.sampleRate),0,input.length);
  const b=clamp(Math.ceil(end*input.sampleRate),a+1,input.length);
  const out=state.ctx.createBuffer(input.numberOfChannels,b-a,input.sampleRate);
  for(let c=0;c<input.numberOfChannels;c++)out.getChannelData(c).set(input.getChannelData(c).subarray(a,b));
  return out;
}
function setResampleRate(rate){
  const select=$('resampleRate')||fxTemplates.quality?.querySelector('#resampleRate');if(!select)return;if(![...select.options].some(option=>Number(option.value)===rate)){const option=document.createElement('option');option.value=String(rate);option.textContent=String(rate);select.appendChild(option);}select.value=String(rate);
}
async function convertSampleRate(input,targetRate,taps){
  if(targetRate===input.sampleRate)return input;
  const channels=Array.from({length:input.numberOfChannels},(_,c)=>input.getChannelData(c).slice());
  const worker=new Worker('./resample-worker.js');
  try{
    const data=await new Promise((resolve,reject)=>{worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data.channels);worker.onerror=event=>reject(new Error(event.message||'Resampler failed.'));worker.postMessage({channels,sourceRate:input.sampleRate,targetRate,taps},channels.map(channel=>channel.buffer));});
    const out=state.ctx.createBuffer(input.numberOfChannels,data[0].length,targetRate);for(let c=0;c<data.length;c++)out.getChannelData(c).set(data[c]);return out;
  }finally{worker.terminate();}
}
function sliceBuffer(slice){
  const input=state.buffer,sr=input.sampleRate,a=clamp(Math.floor(slice.start*sr),0,input.length-1),b=clamp(Math.ceil(slice.end*sr),a+1,input.length),length=b-a,out=state.ctx.createBuffer(input.numberOfChannels,length,sr);
  const fadeIn=Math.min(length,Math.round((slice.fadeIn||0)*sr)),fadeOut=Math.min(length,Math.round((slice.fadeOut||0)*sr));
  for(let c=0;c<input.numberOfChannels;c++){
    const src=input.getChannelData(c),dst=out.getChannelData(c);
    for(let i=0;i<length;i++){const inGain=fadeIn>0?Math.min(1,i/Math.max(1,fadeIn-1)):1,outGain=fadeOut>0?Math.min(1,(length-1-i)/Math.max(1,fadeOut-1)):1;dst[i]=src[a+i]*Math.min(inGain,outGain);}
  }
  return out;
}
function crop(){
  if(!state.buffer)return;
  const [start,end]=range();if(end-start<.01||end-start>=duration()-.005)return;
  snapshot();stopPlayback();
  state.buffer=extractBuffer(state.buffer,start,end);
  state.slices=[];state.selection={start:0,end:duration()};state.cursor=0;
  state.zoom=1;state.viewFraction=0;els.zoom.value=1;els.viewScroll.value=0;
  state.fxBase=state.buffer;state.fxRendered=null;queueFxRender();updatePeaks();renderSlices();updateUI();toast('Cropped to selection. Undo is available.');
}
function deleteRegion(){
  if(!state.buffer)return;
  const [start,end]=range();
  if(end-start<.01||end-start>=duration()-.005)return;
  snapshot();stopPlayback();
  const input=state.buffer,sr=input.sampleRate;
  const a=Math.floor(start*sr),b=Math.ceil(end*sr),left=Math.max(1,input.length-(b-a));
  const out=state.ctx.createBuffer(input.numberOfChannels,left,sr);
  for(let c=0;c<input.numberOfChannels;c++){
    const dst=out.getChannelData(c),src=input.getChannelData(c);
    dst.set(src.subarray(0,Math.min(a,left)),0);
    if(a<left)dst.set(src.subarray(b,b+(left-a)),a);
  }
  state.buffer=out;state.slices=[];state.cursor=clamp(start,0,duration());
  state.selection={start:0,end:duration()};
  state.zoom=1;state.viewFraction=0;els.zoom.value=1;els.viewScroll.value=0;
  state.fxBase=state.buffer;state.fxRendered=null;queueFxRender();updatePeaks();renderSlices();updateUI();toast('Deleted selected audio and closed the gap.');
}
function processSelection(mode){
  if(!state.buffer)return;
  const input=state.buffer,[start,end]=range(),a=clamp(Math.floor(start*input.sampleRate),0,input.length),b=clamp(Math.ceil(end*input.sampleRate),0,input.length),length=b-a;
  if(length<2)return;
  snapshot();stopPlayback();
  const out=state.ctx.createBuffer(input.numberOfChannels,input.length,input.sampleRate);
  for(let c=0;c<input.numberOfChannels;c++){
    const src=input.getChannelData(c),dst=out.getChannelData(c);dst.set(src);
    for(let i=0;i<length;i++){
      if(mode==='reverse')dst[a+i]=src[b-1-i];
      else if(mode==='silence')dst[a+i]=0;

    }
  }
  state.buffer=out;state.fxBase=out;state.fxRendered=null;queueFxRender();updatePeaks();renderSlices();updateUI();toast(`${mode==='reverse'?'Reverse':'Silence'} applied to selection.`);
}
function editorValue(id,min,max){
  const el=$(id),value=Number(el.value);
  if(el.value===''||!Number.isFinite(value)||value<min||value>max)throw new Error(`${el.labels?.[0]?.textContent.trim()||id}: enter a value from ${min} to ${max}.`);
  return value;
}
const effectOrder=['quality','pitch','eq','reverb','delay','distortion','compressor'];
const effectControls={
  quality:{},
  eq:{eqLowFreq:['lowFreq',1],eqLowGain:['lowGain',1],eqLowMidFreq:['lowMidFreq',1],eqLowMidGain:['lowMidGain',1],eqLowMidQ:['lowMidQ',1],eqMidFreq:['midFreq',1],eqMidGain:['midGain',1],eqMidQ:['midQ',1],eqHighMidFreq:['highMidFreq',1],eqHighMidGain:['highMidGain',1],eqHighMidQ:['highMidQ',1],eqHighFreq:['highFreq',1],eqHighGain:['highGain',1]},
  pitch:{pitchSemitones:['semitones',1],pitchCents:['cents',1],stretchSpeed:['speed',100]},
  reverb:{reverbDecay:['decay',1],reverbPredelay:['predelay',1000],reverbTone:['tone',1],reverbMix:['mix',100]},
  delay:{delayTime:['time',1000],delayFeedback:['feedback',100],delayTone:['tone',1],delayMix:['mix',100]},
  distortion:{distDrive:['drive',1],distTone:['tone',1],distBits:['bits',1],distDownsample:['downsample',1],distMix:['mix',100]},
  compressor:{compThreshold:['threshold',1],compRatio:['ratio',1],compKnee:['knee',1],compAttack:['attack',1000],compRelease:['release',1000],compMakeup:['makeup',1],compMix:['mix',100],vinylComp:['vinylComp',100],vinylNoise:['vinylNoise',100],vinylWow:['vinylWow',100],vinylLevel:['vinylLevel',100],compLowThreshold:['lowThreshold',1],compMidThreshold:['midThreshold',1],compHighThreshold:['highThreshold',1],compLowCross:['lowCross',1],compHighCross:['highCross',1]},
};
function readEffectSettings(kind,root=document){
  const $=id=>root===document?document.getElementById(id):root.querySelector(`[data-original-id="${id}"]`)||root.querySelector(`#${id}`);
  const editorValue=(id,min,max)=>{const el=$(id),value=Number(el.value);if(el.value===''||!Number.isFinite(value)||value<min||value>max)throw new Error(`Invalid ${id}.`);return value;};
  if(kind==='quality')return {rate:Number($('resampleRate').value),taps:Number($('resampleQuality').value)};
  if(kind==='eq'){const values={};for(const [id,[key]] of Object.entries(effectControls.eq)){const field=$(id);values[key]=editorValue(id,Number(field.min),Number(field.max));}return values;}
  if(kind==='pitch')return {semitones:editorValue('pitchSemitones',-12,12),cents:editorValue('pitchCents',-100,100),speed:editorValue('stretchSpeed',50,200)/100};
  if(kind==='reverb')return {type:$('reverbType').value,decay:editorValue('reverbDecay',.1,8),predelay:editorValue('reverbPredelay',0,250)/1000,tone:editorValue('reverbTone',200,20000),mix:editorValue('reverbMix',0,100)/100};
  if(kind==='delay')return {type:$('delayType').value,time:editorValue('delayTime',1,2000)/1000,feedback:editorValue('delayFeedback',0,90)/100,tone:editorValue('delayTone',200,20000),mix:editorValue('delayMix',0,100)/100};
  if(kind==='distortion')return {type:$('distType').value,drive:editorValue('distDrive',0,36),tone:editorValue('distTone',200,20000),bits:Math.round(editorValue('distBits',2,16)),downsample:Math.round(editorValue('distDownsample',1,32)),mix:editorValue('distMix',0,100)/100};
  return {type:$('compType').value,lowThreshold:editorValue('compLowThreshold',-100,0),midThreshold:editorValue('compMidThreshold',-100,0),highThreshold:editorValue('compHighThreshold',-100,0),lowCross:editorValue('compLowCross',40,1000),highCross:editorValue('compHighCross',1000,12000),vinylComp:editorValue('vinylComp',0,100)/100,vinylNoise:editorValue('vinylNoise',0,100)/100,vinylWow:editorValue('vinylWow',0,100)/100,vinylLevel:editorValue('vinylLevel',0,100)/100,threshold:editorValue('compThreshold',-100,0),ratio:editorValue('compRatio',1,20),knee:editorValue('compKnee',0,40),attack:editorValue('compAttack',0,1000)/1000,release:editorValue('compRelease',0,1000)/1000,makeup:editorValue('compMakeup',0,24),mix:editorValue('compMix',0,100)/100};
}
const fxNames={quality:'Quality / resample',pitch:'Pitch / time',eq:'5-band EQ',reverb:'Reverb',delay:'Delay',distortion:'Distortion',compressor:'Compressor'};
const fxTemplates={};
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
  const list=$('fxList');if(!list)return;list.replaceChildren();
  for(const [index,effect] of state.fxDraft.entries()){
    const card=fxTemplates[effect.type].cloneNode(true);card.open=true;card.dataset.fxId=String(effect.id);
    card.querySelectorAll('[id]').forEach(el=>{el.dataset.originalId=el.id;el.id=`fx-${effect.id}-${el.id}`;});
    card.querySelectorAll('label[for]').forEach(el=>el.htmlFor=`fx-${effect.id}-${el.htmlFor}`);
    const field=id=>card.querySelector(`[data-original-id="${id}"]`);
    if(effect.type==='quality')setTemplateRateForCard(card,effect.settings.rate);
    for(const [id,[key,multiplier]] of Object.entries(effectControls[effect.type])){field(id).value=String(effect.settings[key]*multiplier);field(id+'Slider').value=field(id).value;}
    const selectIds={quality:['resampleQuality','taps'],reverb:['reverbType','type'],delay:['delayType','type'],distortion:['distType','type'],compressor:['compType','type']};
    if(selectIds[effect.type]){const [id,key]=selectIds[effect.type];field(id).value=String(effect.settings[key]);}
    const summary=card.querySelector('summary');summary.textContent=`${index+1}. ${fxNames[effect.type]}`;
    const actions=document.createElement('div');actions.className='fx-card-actions';
    const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn btn-quiet btn-sm';b.textContent=label;b.setAttribute('aria-label',`${label} ${fxNames[effect.type]}`);b.addEventListener('click',fn);actions.append(b);return b;};
    const handle=button('⋮⋮',()=>{});handle.classList.add('fx-drag-handle');handle.draggable=true;handle.setAttribute('aria-label',`Drag to reorder ${fxNames[effect.type]}`);handle.title='Drag to reorder';
    handle.addEventListener('dragstart',e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(effect.id));});
    const bypass=button(effect.enabled?'On':'Bypassed',()=>{effect.enabled=!effect.enabled;syncEffectControls();queueFxRender();});bypass.setAttribute('aria-pressed',String(effect.enabled));
    button('↑',()=>moveFx(index,index-1));button('↓',()=>moveFx(index,index+1));
    button('Reset',()=>{const root=fxTemplates[effect.type];if(effect.type==='quality')setTemplateRate(root,state.fxBase.sampleRate);effect.settings=readEffectSettings(effect.type,root);syncEffectControls();queueFxRender();});
    button('Remove',()=>{state.fxDraft.splice(index,1);syncEffectControls();queueFxRender();});summary.after(actions);
    const changed=()=>{try{effect.settings=readEffectSettings(effect.type,card);if(effect.type==='compressor')updateCompressorVisibility(card,field('compType').value);queueFxRender();}catch{}};
    for(const id of Object.keys(effectControls[effect.type])){const input=field(id),slider=field(id+'Slider');
      slider.addEventListener('input',()=>{const step=Number(input.step)||1,min=Number(input.min);input.value=String(Math.round(clamp(min+Math.round((Number(slider.value)-min)/step)*step,min,Number(input.max))*1000)/1000);slider.value=input.value;changed();});
      input.addEventListener('input',()=>{if(input.value!==''&&Number(input.value)>=Number(input.min)&&Number(input.value)<=Number(input.max)){slider.value=input.value;changed();}});
      input.addEventListener('change',()=>{input.value=input.value!==''&&Number.isFinite(Number(input.value))?String(clamp(Number(input.value),Number(input.min),Number(input.max))):slider.value;slider.value=input.value;changed();});
    }
    card.querySelectorAll('select').forEach(el=>el.addEventListener('change',()=>{
      if(effect.type==='compressor'&&el===field('compType')){
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
async function renderChain(base,chain){let output=base;for(const effect of chain){if(!effect.enabled)continue;const p=effect.settings;if(effect.type==='pitch'){if(p.semitones||p.cents||p.speed!==1)output=await stretchPitch(output,0,output.length,p);}else if(effect.type==='quality')output=await convertSampleRate(output,p.rate,p.taps);else output=await renderEffect(output,0,output.length,effect.type,p);}return output;}
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
const eqBands=[['low','lowshelf'],['lowMid','peaking'],['mid','peaking'],['highMid','peaking'],['high','highshelf']];
function createEqStage(ac){
  const node={input:ac.createGain(),output:ac.createGain()};let previous=node.input;
  eqBands.forEach(([name,type],index)=>{const filter=ac.createBiquadFilter();filter.type=type;node['filter'+index]=filter;previous.connect(filter);previous=filter;});previous.connect(node.output);return node;
}
function setEqStage(ac,node,effect,smooth){
  const p=effect?.settings,active=Boolean(effect?.enabled&&p);
  eqBands.forEach(([name,type],i)=>{const filter=node['filter'+i];if(p){setAudioParam(filter.frequency,Math.min(p[name+'Freq'],ac.sampleRate/2-1),ac,smooth);if(type==='peaking')setAudioParam(filter.Q,p[name+'Q'],ac,smooth);}setAudioParam(filter.gain,active?p[name+'Gain']:0,ac,smooth);});
}
const reverbProfiles={
  room:{early:[.007,.012,.019,.027,.038],earlyGain:.8,build:.008,tail:.75},
  hall:{early:[.031,.047,.067,.089,.113],earlyGain:.35,build:.08,tail:1},
  chamber:{early:[.011,.018,.029,.043,.059],earlyGain:.6,build:.025,tail:.9},
  plate:{early:[.003,.008,.013,.021,.032],earlyGain:.25,build:.002,tail:1.1},
};
function reverbImpulse(ac,decay,type){
  const profile=reverbProfiles[type]||reverbProfiles.hall,sr=ac.sampleRate,length=Math.max(1,Math.round(sr*decay)),impulse=ac.createBuffer(2,length,sr);
  for(let c=0;c<2;c++){
    const data=impulse.getChannelData(c);let seed=1234567+c*34567;
    for(let i=0;i<length;i++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const t=i/sr,build=1-Math.exp(-t/profile.build),envelope=Math.exp(-6.9078*t/decay);
      data[i]=(seed/2147483648-1)*build*envelope*profile.tail;
    }
    // Distinct early reflections add a sense of size ahead of the diffuse tail.
    for(let i=0;i<profile.early.length;i++){
      const index=Math.round((profile.early[i]+c*.0017)*sr);
      if(index<length)data[index]+=profile.earlyGain*(i%2?-1:1)*Math.exp(-profile.early[i]*5)*Math.sqrt(sr*.008);
    }
    let energy=0;for(const value of data)energy+=value*value;
    const gain=energy>0?.8/Math.sqrt(energy):0;for(let i=0;i<length;i++)data[i]*=gain;
  }
  return impulse;
}
function setAudioParam(param,value,ac,smooth){if(smooth)param.setTargetAtTime(value,ac.currentTime,.01);else param.value=value;}
function createReverbStage(ac){
  const node={input:ac.createGain(),output:ac.createGain(),dry:ac.createGain(),wet:ac.createGain(),predelay:ac.createDelay(.3),convolver:ac.createConvolver(),filter:ac.createBiquadFilter(),signature:null};
  node.wet.gain.value=0;node.convolver.normalize=false;node.filter.type='lowpass';
  node.input.connect(node.dry).connect(node.output);node.input.connect(node.predelay).connect(node.convolver).connect(node.filter).connect(node.wet).connect(node.output);
  return node;
}
function setReverbStage(ac,node,effect,smooth){
  const p=effect?.settings,active=Boolean(effect?.enabled&&p),mix=active?p.mix:0;
  setAudioParam(node.dry.gain,1-mix,ac,smooth);setAudioParam(node.wet.gain,mix,ac,smooth);if(!active)return;
  setAudioParam(node.predelay.delayTime,p.predelay,ac,smooth);setAudioParam(node.filter.frequency,Math.min(p.tone,ac.sampleRate/2),ac,smooth);
  const signature=`${p.type||'hall'}:${p.decay}`;
  if(node.signature!==signature){node.convolver.buffer=reverbImpulse(ac,p.decay,p.type||'hall');node.signature=signature;}
}
function createDelayStage(ac){
  const node={input:ac.createGain(),output:ac.createGain(),dry:ac.createGain(),wet:ac.createGain(),stereo:ac.createGain(),split:ac.createChannelSplitter(2),merge:ac.createChannelMerger(2),
    inputLL:ac.createGain(),inputRL:ac.createGain(),inputRR:ac.createGain(),left:ac.createDelay(2.1),right:ac.createDelay(2.1),filterL:ac.createBiquadFilter(),filterR:ac.createBiquadFilter(),shapeL:ac.createWaveShaper(),shapeR:ac.createWaveShaper(),feedbackLL:ac.createGain(),feedbackRR:ac.createGain(),feedbackLR:ac.createGain(),feedbackRL:ac.createGain()};
  node.wet.gain.value=0;node.stereo.channelCount=2;node.stereo.channelCountMode='explicit';node.stereo.channelInterpretation='speakers';node.filterL.type=node.filterR.type='lowpass';
  node.input.connect(node.dry).connect(node.output);node.input.connect(node.stereo).connect(node.split);
  node.split.connect(node.inputLL,0);node.inputLL.connect(node.left);node.split.connect(node.inputRL,1);node.inputRL.connect(node.left);node.split.connect(node.inputRR,1);node.inputRR.connect(node.right);
  node.left.connect(node.filterL).connect(node.shapeL);node.right.connect(node.filterR).connect(node.shapeR);
  node.shapeL.connect(node.merge,0,0);node.shapeR.connect(node.merge,0,1);node.merge.connect(node.wet).connect(node.output);
  node.shapeL.connect(node.feedbackLL).connect(node.left);node.shapeR.connect(node.feedbackRR).connect(node.right);
  node.shapeL.connect(node.feedbackLR).connect(node.right);node.shapeR.connect(node.feedbackRL).connect(node.left);
  for(const name of ['inputLL','inputRL','inputRR','feedbackLL','feedbackRR','feedbackLR','feedbackRL'])node[name].gain.value=0;
  node.left.delayTime.value=node.right.delayTime.value=.25;
  return node;
}
const tapeCurve=Float32Array.from({length:2049},(_,i)=>Math.tanh((i/1024-1)*1.5)/1.5);
function setDelayStage(ac,node,effect,smooth){
  const p=effect?.settings,active=Boolean(effect?.enabled&&p),mix=active?p.mix:0;
  setAudioParam(node.dry.gain,1-mix,ac,smooth);setAudioParam(node.wet.gain,mix,ac,smooth);if(!active)return;
  const type=p.type||'digital',ping=type==='pingpong',tape=type==='tape',tone=Math.min(p.tone,ac.sampleRate/2,type==='analog'?3500:tape?4800:ac.sampleRate/2);
  for(const delay of [node.left,node.right])setAudioParam(delay.delayTime,p.time,ac,smooth);
  for(const filter of [node.filterL,node.filterR])setAudioParam(filter.frequency,tone,ac,smooth);
  for(const shaper of [node.shapeL,node.shapeR])if((shaper.curve!==null)!==tape)shaper.curve=tape?tapeCurve:null;
  for(const [name,value] of Object.entries({inputLL:ping?.5:1,inputRL:ping?.5:0,inputRR:ping?0:1,feedbackLL:ping?0:p.feedback,feedbackRR:ping?0:p.feedback,feedbackLR:ping?p.feedback:0,feedbackRL:ping?p.feedback:0}))setAudioParam(node[name].gain,value,ac,smooth);
}
const distortionModules=new WeakMap();
async function createDistortionStage(ac){
  if(!distortionModules.has(ac))distortionModules.set(ac,ac.audioWorklet.addModule('./distortion-worklet.js').catch(error=>{distortionModules.delete(ac);throw error;}));
  await distortionModules.get(ac);
  const node={input:ac.createGain(),output:ac.createGain(),dry:ac.createGain(),wet:ac.createGain(),filter:ac.createBiquadFilter(),processor:new AudioWorkletNode(ac,'sample-one-distortion',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',channelInterpretation:'speakers'})};
  node.wet.gain.value=0;node.filter.type='lowpass';node.input.connect(node.dry).connect(node.output);node.input.connect(node.processor).connect(node.filter).connect(node.wet).connect(node.output);return node;
}
function setDistortionStage(ac,node,effect,smooth){
  const p=effect?.settings,active=Boolean(effect?.enabled&&p),mix=active?p.mix:0;
  setAudioParam(node.dry.gain,1-mix,ac,smooth);setAudioParam(node.wet.gain,mix,ac,smooth);if(!active)return;
  const modes={soft:0,hard:1,fold:2,crusher:3};
  for(const [key,value] of Object.entries({drive:p.drive,bits:p.bits,downsample:p.downsample,mode:modes[p.type]??0}))setAudioParam(node.processor.parameters.get(key),value,ac,false);
  setAudioParam(node.filter.frequency,Math.min(p.tone,ac.sampleRate/2),ac,smooth);
}
const muCompressorCurve=Float32Array.from({length:2049},(_,i)=>Math.tanh((i/1024-1)*1.15)/1.15);
const fetCompressorCurve=Float32Array.from({length:2049},(_,i)=>Math.tanh((i/1024-1)*1.5)/1.5);
const vinylCurve=Float32Array.from({length:2049},(_,i)=>Math.tanh((i/1024-1)*1.4)/1.4);
function createCompressorStage(ac){
  const node={input:ac.createGain(),output:ac.createGain(),dry:ac.createGain(),wet:ac.createGain(),compressor:ac.createDynamicsCompressor(),gain:ac.createGain(),cleanShape:ac.createWaveShaper(),cleanGain:ac.createGain(),
    mbLow1:ac.createBiquadFilter(),mbLow2:ac.createBiquadFilter(),mbHigh1:ac.createBiquadFilter(),mbHigh2:ac.createBiquadFilter(),mbMid1:ac.createBiquadFilter(),mbMid2:ac.createBiquadFilter(),mbTop1:ac.createBiquadFilter(),mbTop2:ac.createBiquadFilter(),mbCompLow:ac.createDynamicsCompressor(),mbCompMid:ac.createDynamicsCompressor(),mbCompHigh:ac.createDynamicsCompressor(),mbMakeup:ac.createGain(),mbSelect:ac.createGain(),
    vinylHighpass:ac.createBiquadFilter(),vinylLowpass:ac.createBiquadFilter(),vinylCompressor:ac.createDynamicsCompressor(),vinylSlowCompressor:ac.createDynamicsCompressor(),vinylFastBlend:ac.createGain(),vinylSlowBlend:ac.createGain(),vinylMakeup:ac.createGain(),vinylShape:ac.createWaveShaper(),vinylDirect:ac.createGain(),vinylDelayed:ac.createGain(),vinylDelay:ac.createDelay(.03),vinylLevel:ac.createGain(),vinylSelect:ac.createGain(),
    noise:ac.createBufferSource(),noiseGain:ac.createGain(),wow:ac.createOscillator(),wowGain:ac.createGain(),flutter:ac.createOscillator(),flutterGain:ac.createGain()};
  node.wet.gain.value=0;node.vinylSelect.gain.value=0;node.mbSelect.gain.value=0;node.noiseGain.gain.value=0;node.wowGain.gain.value=0;node.flutterGain.gain.value=0;
  node.vinylHighpass.type='highpass';node.vinylHighpass.frequency.value=40;node.vinylLowpass.type='lowpass';node.vinylLowpass.frequency.value=Math.min(9500,ac.sampleRate/2);node.vinylShape.curve=vinylCurve;node.vinylDelay.delayTime.value=.005;
  node.input.connect(node.dry).connect(node.output);node.input.connect(node.compressor).connect(node.gain).connect(node.cleanShape).connect(node.cleanGain).connect(node.wet);
  for(const name of ['mbLow1','mbLow2','mbMid1','mbMid2']){node[name].type='lowpass';node[name].Q.value=Math.SQRT1_2;}
  for(const name of ['mbHigh1','mbHigh2','mbTop1','mbTop2']){node[name].type='highpass';node[name].Q.value=Math.SQRT1_2;}
  node.input.connect(node.mbLow1).connect(node.mbLow2).connect(node.mbCompLow).connect(node.mbMakeup);
  node.input.connect(node.mbHigh1).connect(node.mbHigh2);node.mbHigh2.connect(node.mbMid1).connect(node.mbMid2).connect(node.mbCompMid).connect(node.mbMakeup);
  node.mbHigh2.connect(node.mbTop1).connect(node.mbTop2).connect(node.mbCompHigh).connect(node.mbMakeup);node.mbMakeup.connect(node.mbSelect).connect(node.wet);
  node.input.connect(node.vinylHighpass);node.noise.connect(node.noiseGain).connect(node.vinylHighpass);
  node.vinylHighpass.connect(node.vinylLowpass);node.vinylFastBlend.gain.value=.72;node.vinylSlowBlend.gain.value=.28;
  node.vinylLowpass.connect(node.vinylCompressor).connect(node.vinylFastBlend).connect(node.vinylMakeup);
  node.vinylLowpass.connect(node.vinylSlowCompressor).connect(node.vinylSlowBlend).connect(node.vinylMakeup);node.vinylMakeup.connect(node.vinylShape);
  node.vinylShape.connect(node.vinylDirect).connect(node.vinylLevel);node.vinylShape.connect(node.vinylDelay).connect(node.vinylDelayed).connect(node.vinylLevel);
  node.vinylLevel.connect(node.vinylSelect).connect(node.wet);node.wet.connect(node.output);
  const noise=ac.createBuffer(1,Math.round(ac.sampleRate*8),ac.sampleRate),data=noise.getChannelData(0);let seed=746231,filtered=0,click=0;
  for(let i=0;i<data.length;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const white=seed/2147483648-1;
    filtered=.93*filtered+.07*white;
    if((seed&131071)===0)click=white*.8;
    data[i]=white*.18+filtered*.45+click;click*=.92;
  }
  node.noise.buffer=noise;node.noise.loop=true;node.noise.start();node.wow.frequency.value=.55;node.flutter.frequency.value=6.3;
  node.wow.connect(node.wowGain).connect(node.vinylDelay.delayTime);node.flutter.connect(node.flutterGain).connect(node.vinylDelay.delayTime);node.wow.start();node.flutter.start();
  return node;
}
function setCompressorStage(ac,node,effect,smooth){
  const p=effect?.settings,active=Boolean(effect?.enabled&&p),vinyl=active&&p.type==='vinyl303',multiband=active&&p.type==='multiband',mix=active?p.mix:0;
  setAudioParam(node.dry.gain,1-mix,ac,smooth);setAudioParam(node.wet.gain,mix,ac,smooth);setAudioParam(node.cleanGain.gain,active&&!vinyl&&!multiband?1:0,ac,smooth);setAudioParam(node.vinylSelect.gain,vinyl?1:0,ac,smooth);setAudioParam(node.mbSelect.gain,multiband?1:0,ac,smooth);
  setAudioParam(node.noiseGain.gain,vinyl?(p.vinylNoise||0)*.04:0,ac,smooth);
  if(!active)return;
  if(multiband){
    const low=Math.min(p.lowCross??250,ac.sampleRate/2-2),high=Math.min(Math.max(p.highCross??2500,low+1),ac.sampleRate/2-1);
    for(const id of ['mbLow1','mbLow2','mbHigh1','mbHigh2'])setAudioParam(node[id].frequency,low,ac,smooth);
    for(const id of ['mbMid1','mbMid2','mbTop1','mbTop2'])setAudioParam(node[id].frequency,high,ac,smooth);
    for(const [name,threshold] of [['mbCompLow',p.lowThreshold??p.threshold],['mbCompMid',p.midThreshold??p.threshold],['mbCompHigh',p.highThreshold??p.threshold]]){const comp=node[name];comp.threshold.value=threshold;comp.ratio.value=p.ratio;comp.knee.value=p.knee;comp.attack.value=p.attack;comp.release.value=p.release;}
    setAudioParam(node.mbMakeup.gain,Math.pow(10,p.makeup/20),ac,smooth);
  }else if(!vinyl){
    const type=p.type||'clean',curve=type==='variablemu'?muCompressorCurve:type==='fet'?fetCompressorCurve:null;
    if(node.cleanShape.curve!==curve)node.cleanShape.curve=curve;
    node.compressor.threshold.value=p.threshold;node.compressor.ratio.value=p.ratio;node.compressor.knee.value=p.knee;node.compressor.attack.value=p.attack;node.compressor.release.value=p.release;setAudioParam(node.gain.gain,Math.pow(10,p.makeup/20),ac,smooth);
  }else{
    const amount=p.vinylComp??.6,wow=p.vinylWow??0;
    node.vinylCompressor.threshold.value=-8-amount*34;node.vinylCompressor.ratio.value=1+amount*11;node.vinylCompressor.knee.value=6;node.vinylCompressor.attack.value=.003;node.vinylCompressor.release.value=.08+(1-amount)*.07;
    node.vinylSlowCompressor.threshold.value=-8-amount*34;node.vinylSlowCompressor.ratio.value=1+amount*7;node.vinylSlowCompressor.knee.value=10;node.vinylSlowCompressor.attack.value=.015;node.vinylSlowCompressor.release.value=.3+(1-amount)*.15;
    setAudioParam(node.vinylMakeup.gain,Math.pow(10,(amount*3)/20),ac,smooth);setAudioParam(node.vinylLevel.gain,p.vinylLevel??.8,ac,smooth);
    setAudioParam(node.vinylDirect.gain,wow>0?0:1,ac,smooth);setAudioParam(node.vinylDelayed.gain,wow>0?1:0,ac,smooth);
    setAudioParam(node.wowGain.gain,wow*.0025,ac,smooth);setAudioParam(node.flutterGain.gain,wow*.0004,ac,smooth);
  }
}
let stretchModulePromise;
function stretchModule(){
  if(!stretchModulePromise)stretchModulePromise=import('./signalsmith-stretch.mjs').then(module=>module.default).catch(error=>{stretchModulePromise=null;throw new Error(`Pitch/time engine unavailable: ${error.message}`);});
  return stretchModulePromise;
}
async function stretchPitch(input,a,b,settings){
  const sr=input.sampleRate,length=b-a,outLength=Math.max(2,Math.round(length/settings.speed));
  if(outLength>length&&input.length-length+outLength>sr*MAX_RECORD_MS/1000)throw new Error('The resulting sample exceeds 3 minutes.');
  const offline=new OfflineAudioContext(input.numberOfChannels,outLength,sr),factory=await stretchModule();
  const node=await factory(offline,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[input.numberOfChannels]});
  await node.addBuffers(Array.from({length:input.numberOfChannels},(_,c)=>input.getChannelData(c).slice(a,b)));
  await node.schedule({active:true,input:0,output:0,rate:settings.speed,semitones:settings.semitones+settings.cents/100});
  node.connect(offline.destination);return offline.startRendering();
}
function previewPosition(preview){const elapsed=Math.max(0,preview.ac.currentTime-preview.startedAt),position=preview.offset+elapsed;return preview.loop?preview.start+((position-preview.start)%(preview.end-preview.start)):Math.min(preview.end,position);}
function schedulePreview(preview){const position=livePlayhead(),start=preview.uiStart,end=preview.uiEnd;stopEffectPreview();startEffectPreview(start,end,position);}
async function startEffectPreview(start,end,seek=start){
  if(!state.fxBase||state.processing)return;const generation=++state.fxPreviewGeneration;state.fxPreviewStarting=true;updateUI();
  try{stopPlayback();stopPads();const ac=await audioContext(),buffer=state.fxRendered||state.buffer;if(generation!==state.fxPreviewGeneration||state.tab!=='editor')return;
    const ratio=buffer.duration/duration(),a=clamp(start*ratio,0,buffer.duration),b=clamp(end*ratio,a,buffer.duration),offset=clamp(seek*ratio,a,Math.max(a,b-.001));if(b-a<.005)return;
    const source=ac.createBufferSource(),gain=ac.createGain();source.buffer=buffer;gain.gain.value=.86;source.connect(gain);gain.connect(ac.destination);source.loop=state.transportLoop;source.loopStart=a;source.loopEnd=b;
    const preview={ac,source,gain,start:a,end:b,offset,origin:0,startedAt:ac.currentTime,loop:state.transportLoop,uiStart:start,uiEnd:end,ratio};state.fxPreview=preview;
    source.onended=()=>{if(state.fxPreview===preview){state.cursor=end;stopEffectPreview();}};
    if(source.loop)source.start(0,offset);else source.start(0,offset,b-offset);
  }catch(error){toast(`Unable to play effects: ${error.message}`);}finally{state.fxPreviewStarting=false;updateUI();}
}
function stopEffectPreview(){state.fxPreviewGeneration++;const preview=state.fxPreview;if(!preview)return;state.fxPreview=null;try{preview.source.onended=null;preview.source.stop();preview.source.disconnect();preview.gain.disconnect();}catch{}updateUI();}
async function renderEffect(input,a,b,kind,p){
  if((kind==='reverb'||kind==='delay'||kind==='distortion')&&input.numberOfChannels>2)throw new Error('Reverb, delay and distortion support mono or stereo samples.');
  const sr=input.sampleRate,length=b-a,channels=(kind==='reverb'||kind==='delay'||kind==='distortion'||(kind==='compressor'&&p.type==='vinyl303'))?2:input.numberOfChannels,offline=new OfflineAudioContext(channels,length,sr);
  const part=offline.createBuffer(input.numberOfChannels,length,sr);
  for(let c=0;c<input.numberOfChannels;c++)part.getChannelData(c).set(input.getChannelData(c).subarray(a,b));
  const source=offline.createBufferSource();source.buffer=part;
  if(kind==='eq'){
    const node=createEqStage(offline);setEqStage(offline,node,{enabled:true,settings:p},false);source.connect(node.input);node.output.connect(offline.destination);
  }else if(kind==='reverb'||kind==='delay'){
    const node=kind==='reverb'?createReverbStage(offline):createDelayStage(offline);
    if(kind==='reverb')setReverbStage(offline,node,{enabled:true,settings:p},false);else setDelayStage(offline,node,{enabled:true,settings:p},false);
    source.connect(node.input);node.output.connect(offline.destination);
  }else if(kind==='distortion'){
    const node=await createDistortionStage(offline);setDistortionStage(offline,node,{enabled:true,settings:p},false);source.connect(node.input);node.output.connect(offline.destination);
  }else{
    const node=createCompressorStage(offline);setCompressorStage(offline,node,{enabled:true,settings:p},false);source.connect(node.input);node.output.connect(offline.destination);
  }
  source.start();return offline.startRendering();
}
function normalize(){
  if(!state.buffer)return;
  const input=state.buffer;let peak=0;
  for(let c=0;c<input.numberOfChannels;c++){
    const data=input.getChannelData(c);
    for(let i=0;i<data.length;i++)peak=Math.max(peak,Math.abs(data[i]));
  }
  if(peak<.000001){toast('There is no audible signal to normalize.');return;}
  const target=.98/peak;
  if(Math.abs(target-1)<.001){toast('Audio is already normalized.');return;}
  snapshot();stopPlayback();
  const out=state.ctx.createBuffer(input.numberOfChannels,input.length,input.sampleRate);
  for(let c=0;c<input.numberOfChannels;c++){
    const src=input.getChannelData(c),dst=out.getChannelData(c);
    for(let i=0;i<src.length;i++)dst[i]=src[i]*target;
  }
  state.buffer=out;state.fxBase=out;state.fxRendered=null;queueFxRender();updatePeaks();updateUI();toast('Peak normalized to −0.2 dBFS.');
}
function undo(){
  const item=state.undo.pop();if(!item)return;
  stopPlayback();
  Object.assign(state,{buffer:item.buffer,fxBase:item.fxBase,fxChain:item.fxChain,name:item.name,slices:item.slices,selection:item.selection,cursor:item.cursor});
  stopEffectPreview();state.fxDraft=structuredClone(item.fxDraft||state.fxChain);state.fxRendered=null;syncEffectControls();queueFxRender();
  els.sampleName.value=state.name;
  state.zoom=1;state.viewFraction=0;els.zoom.value=1;els.viewScroll.value=0;
  updatePeaks();renderSlices();updateUI();toast('Last edit undone.');
}

function makeSlice(start,end){
  if(end-start<0.015)return null;
  return {id:state.nextId++,start,end,fadeIn:0,fadeOut:0,name:`Slice ${String(state.nextId-1).padStart(2,'0')}`};
}
function selectedSlice(){return state.slices.find(slice=>slice.id===state.selectedSliceId)||null;}
function selectSlice(id,edge=null){
  state.selectedSliceId=id;state.selectedSliceEdge=edge;
  const slice=selectedSlice();if(slice)state.cursor=edge?slice[edge]:slice.start;
  renderSlices();
}
function linkedBoundaries(time){return state.slices.flatMap(slice=>['start','end'].filter(edge=>Math.abs(slice[edge]-time)<1e-7).map(edge=>({id:slice.id,edge,time:slice[edge]})));}
function moveBoundaries(linked,value){
  let min=0,max=duration();
  for(const item of linked){const slice=state.slices.find(s=>s.id===item.id);if(!slice)continue;if(item.edge==='start')max=Math.min(max,slice.end-.015);else min=Math.max(min,slice.start+.015);}
  const t=clamp(value,min,max);
  for(const item of linked){const slice=state.slices.find(s=>s.id===item.id);if(slice)slice[item.edge]=t;}
  return t;
}
function renderSlices(){
  const ids=new Set(state.slices.map(slice=>slice.id));
  for(const id of state.padConfig.keys())if(!ids.has(id))state.padConfig.delete(id);
  for(const id of state.padVoices.keys())if(!ids.has(id))stopPad(id);
  state.bank=Math.min(state.bank,Math.max(0,Math.ceil(state.slices.length/16)-1));
  renderPads();
  const selected=selectedSlice();if(!selected){state.selectedSliceId=null;state.selectedSliceEdge=null;}
  els.sliceInspector.hidden=!selected;
  if(selected){
    if(document.activeElement!==els.sliceStart)els.sliceStart.value=selected.start.toFixed(3);
    if(document.activeElement!==els.sliceEnd)els.sliceEnd.value=selected.end.toFixed(3);
    els.sliceStart.max=String(duration());els.sliceEnd.max=String(duration());
    for(const edge of ['In','Out']){const value=Math.round((selected['fade'+edge]||0)*1000),max=Math.max(1,Math.round((selected.end-selected.start)*1000));els.sliceInspector.querySelector('#sliceFade'+edge).max=max;els.sliceInspector.querySelector('#sliceFade'+edge+'Slider').max=max;els.sliceInspector.querySelector('#sliceFade'+edge).value=String(Math.min(value,max));els.sliceInspector.querySelector('#sliceFade'+edge+'Slider').value=String(Math.min(value,max));}
  }
  const container=els.slices;container.replaceChildren();
  if(!state.slices.length){
    const empty=document.createElement('div');empty.className='flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-[#39464b] text-center text-[12px] text-[#687f84]';
    empty.textContent='Your slices will appear here';container.appendChild(empty);
  }
  state.slices.forEach((slice,index)=>{
    const row=document.createElement('div');row.className='slice-row'+(slice.id===state.selectedSliceId?' active':'');
    const detail=document.createElement('button');detail.className='min-w-0 text-left';detail.type='button';
    const title=document.createElement('div');title.className='text-[12px] font-bold text-[#d8e9dc]';title.textContent=`${String(index+1).padStart(2,'0')} · ${slice.name}`;
    const time=document.createElement('div');time.className='time mt-1 text-[10px] text-[#80979a]';time.textContent=`${secs(slice.start)} → ${secs(slice.end)}   (${secs(slice.end-slice.start)})`;
    detail.append(title,time);
    detail.setAttribute('aria-label',`Select ${slice.name}`);detail.addEventListener('click',()=>selectSlice(slice.id));
    const actions=document.createElement('div');actions.className='flex gap-1';
    const audition=document.createElement('button');audition.className='mini';audition.type='button';audition.textContent='▶';audition.title='Play slice';audition.setAttribute('aria-label',`Play ${slice.name}`);audition.addEventListener('click',()=>{selectSlice(slice.id);playRange(slice.start,slice.end,{slice});});
    const rename=document.createElement('button');rename.className='mini';rename.type='button';rename.textContent='✎';rename.title='Rename slice';rename.setAttribute('aria-label',`Rename ${slice.name}`);
    rename.addEventListener('click',()=>{
      const input=document.createElement('input');input.className='field slice-rename';input.type='text';input.maxLength=65;input.value=slice.name;input.setAttribute('aria-label',`New name for ${slice.name}`);
      detail.replaceWith(input);input.focus();input.select();let finished=false;
      const finish=save=>{
        if(finished)return;finished=true;
        const name=input.value.trim();
        if(save&&name&&name!==slice.name){snapshot();slice.name=name;}
        renderSlices();
      };
      input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();finish(true);}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);}});
      input.addEventListener('blur',()=>finish(true));
    });
    const wav=document.createElement('button');wav.className='mini';wav.type='button';wav.textContent='WAV';wav.title='Download this slice';wav.setAttribute('aria-label',`Export ${slice.name}`);
    wav.addEventListener('click',()=>exportWav(slice.start,slice.end,`${state.name}-${slice.name}`,slice));
    const remove=document.createElement('button');remove.className='mini';remove.type='button';remove.title='Remove slice';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${slice.name}`);
    remove.addEventListener('click',()=>{snapshot();state.slices=state.slices.filter(s=>s.id!==slice.id);renderSlices();updateUI();});
    actions.append(audition,rename,wav,remove);row.append(detail,actions);
    if(slice.id===state.selectedSliceId)row.appendChild(els.sliceInspector);
    row.dataset.id=String(slice.id);container.appendChild(row);
  });
  updateUI();
}
function highlightSlice(id){
  els.slices.querySelectorAll('.slice-row').forEach(row=>row.classList.toggle('active',row.dataset.id===String(id)));
}
function addSlice(){
  if(!state.buffer)return;
  const [a,b]=range();const s=makeSlice(a,b);
  if(!s){toast('Select at least 15 ms of audio.');return;}
  snapshot();state.slices.push(s);state.slices.sort((a,b)=>a.start-b.start);
  renderSlices();toast('Selection added to the slice library.');
}
function equalChops(count){
  if(!state.buffer)return;
  const [start,end]=range(),len=(end-start)/count;
  if(len<.015){toast('Selection is too short for that many slices.');return;}
  snapshot();state.slices=[];
  for(let i=0;i<count;i++)state.slices.push(makeSlice(start+i*len,start+(i+1)*len));
  renderSlices();toast(`Created ${count} equal slices from the selection.`);
}
function splitAtCursor(){
  if(!state.buffer)return;
  const at=state.cursor;
  const slices=state.slices.length?state.slices:[{start:0,end:duration()}];
  const index=slices.findIndex(s=>s.start+.015<at&&s.end-.015>at);
  if(index<0){toast('Move the playhead inside a slice to split it.');return;}
  snapshot();
  const current=slices[index];
  const a=makeSlice(current.start,at),b=makeSlice(at,current.end);
  state.slices.splice(index,1,a,b);renderSlices();toast('Slice split at playhead.');
}
function transientChops(){
  if(!state.buffer)return;
  const input=state.buffer, [start,end]=range(),sr=input.sampleRate;
  const win=Math.max(64,Math.round(sr*.012)); // 12 ms RMS analysis window
  const begin=Math.floor(start*sr),finish=Math.ceil(end*sr);
  const channels=Array.from({length:Math.min(2,input.numberOfChannels)},(_,i)=>input.getChannelData(i));
  const levels=[];
  for(let i=begin;i<finish;i+=win){
    const stop=Math.min(i+win,finish);let sum=0;
    for(let j=i;j<stop;j++){
      let sample=0;for(let k=0;k<channels.length;k++)sample+=channels[k][j];sample/=channels.length;
      sum+=sample*sample;
    }
    levels.push(Math.sqrt(sum/Math.max(1,stop-i)));
  }
  if(levels.length<2){toast('Not enough audio to detect transients.');return;}
  const sorted=[...levels].sort((a,b)=>a-b);
  const p80=sorted[Math.floor(sorted.length*.8)]||0;
  const sensitivity=Number(els.transientSensitivity.value)/100;
  const floor=Math.max(.004+(1-sensitivity)*.022,p80*(.13+(1-sensitivity)*.3));
  const rise=2.25-sensitivity,attack=1.30-sensitivity*.28;
  const onsets=[start];let previous=start;
  // This is a lightweight energy-onset heuristic, not a full spectral-flux detector.
  for(let i=3;i<levels.length-1;i++){
    const prior=(levels[i-1]+levels[i-2]+levels[i-3])/3;
    const now=levels[i];const t=start+(i*win/sr);
    if(t-previous<.095)continue;
    if(now>floor&&now>prior*rise&&now>levels[i-1]*attack){
      onsets.push(t);previous=t;
      if(onsets.length>=32)break;
    }
  }
  if(onsets.length===1){toast('No strong transients found. Try equal slices or a more percussive sample.');return;}
  snapshot();state.slices=[];
  for(let i=0;i<onsets.length;i++){
    const s=makeSlice(onsets[i],onsets[i+1]??end);
    if(s)state.slices.push(s);
  }
  renderSlices();toast(`Detected ${state.slices.length} transient-based slices.`);
}

function wavBytes(buffer,start=0,end=buffer.duration){
  const mono=$('exportChannels').value==='mono',channels=mono?1:buffer.numberOfChannels,sr=buffer.sampleRate,depth=Number($('exportDepth').value),bytesPerSample=depth/8;
  const a=clamp(Math.floor(start*sr),0,buffer.length-1),b=clamp(Math.ceil(end*sr),a+1,buffer.length),frames=b-a,byteCount=frames*channels*bytesPerSample;
  const paddedByteCount=byteCount+(byteCount&1),bytes=new Uint8Array(44+paddedByteCount),view=new DataView(bytes.buffer),fourCC=(offset,value)=>{for(let i=0;i<4;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  fourCC(0,'RIFF');view.setUint32(4,36+paddedByteCount,true);fourCC(8,'WAVE');fourCC(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,depth===32?3:1,true);view.setUint16(22,channels,true);
  view.setUint32(24,sr,true);view.setUint32(28,sr*channels*bytesPerSample,true);view.setUint16(32,channels*bytesPerSample,true);view.setUint16(34,depth,true);fourCC(36,'data');view.setUint32(40,byteCount,true);
  const data=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));let offset=44;
  for(let i=a;i<b;i++)for(let c=0;c<channels;c++){
    let sample=0;if(mono){for(const channel of data)sample+=Number.isFinite(channel[i])?channel[i]:0;sample/=data.length;}else sample=Number.isFinite(data[c][i])?data[c][i]:0;
    if(depth===8)view.setUint8(offset,Math.round((clamp(sample,-1,1)+1)*127.5));
    else if(depth===32)view.setFloat32(offset,sample,true);
    else if(depth===24){const value=sample<0?Math.round(clamp(sample,-1,1)*8388608):Math.round(clamp(sample,-1,1)*8388607);view.setUint8(offset,value&255);view.setUint8(offset+1,(value>>8)&255);view.setUint8(offset+2,(value>>16)&255);}
    else view.setInt16(offset,sample<0?Math.round(clamp(sample,-1,1)*32768):Math.round(clamp(sample,-1,1)*32767),true);
    offset+=bytesPerSample;
  }
  return bytes;
}
function safeName(value){return (value||'sample').replace(/[^\w .-]+/g,'-').trim().replace(/\s+/g,'-').slice(0,65)||'sample';}
function download(bytes,name,type){
  const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');
  link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30_000);
}
function exportWav(start=0,end=duration(),name=state.name,slice=null){
  if(!state.buffer)return;
  try{
    const bytes=slice?wavBytes(sliceBuffer(slice)):wavBytes(state.buffer,start,end);
    download(bytes,`${safeName(name)}.wav`,'audio/wav');
  }catch(error){toast(`Export failed: ${error.message}`);}
}
function crc32(bytes){
  let crc=-1;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0);}
  return (crc^-1)>>>0;
}
// Minimal, standards-compliant uncompressed ZIP writer: no external JS dependencies.
function buildZip(entries){
  const encoder=new TextEncoder();const sections=[],central=[];let offset=0;
  for(const entry of entries){
    const name=encoder.encode(entry.name),data=entry.data,crc=crc32(data);
    const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(8,0,true);
    l.setUint32(14,crc,true);l.setUint32(18,data.byteLength,true);l.setUint32(22,data.byteLength,true);
    l.setUint16(26,name.length,true);local.set(name,30);
    sections.push(local,data);
    const header=new Uint8Array(46+name.length),h=new DataView(header.buffer);
    h.setUint32(0,0x02014b50,true);h.setUint16(4,20,true);h.setUint16(6,20,true);
    h.setUint16(8,0x0800,true);h.setUint32(16,crc,true);
    h.setUint32(20,data.byteLength,true);h.setUint32(24,data.byteLength,true);
    h.setUint16(28,name.length,true);h.setUint32(42,offset,true);header.set(name,46);
    central.push(header);offset+=local.byteLength+data.byteLength;
  }
  const directoryBytes=central.reduce((a,x)=>a+x.byteLength,0);
  const end=new Uint8Array(22),v=new DataView(end.buffer);
  v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);
  v.setUint16(10,entries.length,true);v.setUint32(12,directoryBytes,true);v.setUint32(16,offset,true);
  return new Blob([...sections,...central,end],{type:'application/zip'});
}
function exportSlicesZip(){
  if(!state.buffer||!state.slices.length)return;
  try{
    const entries=state.slices.map((s,i)=>({
      name:`${String(i+1).padStart(2,'0')}-${safeName(s.name)}.wav`,data:wavBytes(sliceBuffer(s))
    }));
    download(buildZip(entries),`${safeName(state.name)}-slices.zip`,'application/zip');
    toast(`Exported ${entries.length} WAV slices as ZIP.`);
  }catch(error){toast(`Unable to export slices: ${error.message}`);}
}

async function importAudio(file){
  if(!file)return;
  if(!/\.(wav|mp3|m4a|aac|flac|ogg|webm|aiff?|opus)$/i.test(file.name)&&!file.type.startsWith('audio/')){
    toast('Choose an audio file (WAV, MP3, FLAC, OGG, M4A, or similar).');return;
  }
  try{
    const ac=await audioContext();
    const buffer=await ac.decodeAudioData(await file.arrayBuffer());
    loadSample(buffer,file.name.replace(/\.[^.]+$/,''));
    toast(`Loaded ${file.name}. Drag across the waveform to select a region.`);
  }catch(error){toast(`The browser could not decode this file: ${error.message}`);}
  els.fileInput.value='';
}

function viewport(){
  const d=duration();if(!d)return {start:0,end:1,width:1};
  const width=d/state.zoom,start=(d-width)*state.viewFraction;
  return {start,end:start+width,width};
}
function timeAtPixel(x,width){
  const v=viewport();return clamp(v.start+clamp(x/width,0,1)*v.width,0,duration());
}
function xForTime(t,width){
  const v=viewport();return ((t-v.start)/v.width)*width;
}
function fitCanvas(){
  const rect=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
  const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {w:rect.width,h:rect.height};
}
function drawWave(){
  if(state.tab!=='editor'&&state.tab!=='chop')return;
  const {w,h}=fitCanvas(),center=(h+waveformPadding.top-waveformPadding.bottom)/2;
  ctx.fillStyle='#0f181a';ctx.fillRect(0,0,w,h);
  // Horizontal amplitude guides.
  ctx.strokeStyle='#263439';ctx.lineWidth=1;
  for(const f of [-1,-.5,0,.5,1]){
    const y=center-f*(h-72)*.46;
    ctx.beginPath();ctx.moveTo(0,Math.round(y)+.5);ctx.lineTo(w,y+.5);ctx.stroke();
  }
  if(!state.buffer){
    if(state.analyser){
      const data=new Uint8Array(state.analyser.fftSize);state.analyser.getByteTimeDomainData(data);
      ctx.strokeStyle='#92ba74';ctx.lineWidth=1.8;ctx.beginPath();
      for(let x=0;x<w;x++){
        const index=Math.floor(x/w*(data.length-1));const v=(data[index]-128)/128;
        const y=center-v*(h-70)*.42;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
    return;
  }
  const {start,end,width}=viewport();
  // Divide the full sample into 48 equal parts; every third and twelfth line is stronger.
  ctx.font='10px ui-monospace, SFMono-Regular, Menlo, monospace';ctx.textAlign='left';
  for(let i=0;i<=48;i++){
    const t=duration()*i/48;if(t<start||t>end)continue;
    const x=xForTime(t,w),major=i%12===0,medium=i%3===0;
    ctx.strokeStyle=major?'#607a70':medium?'#40574f':'#263b35';
    ctx.lineWidth=major?1.3:1;ctx.beginPath();ctx.moveTo(x,23);ctx.lineTo(x,h-22);ctx.stroke();
    if(major){ctx.fillStyle='#8da39a';ctx.fillText(`${Number(t.toFixed(2))}s`,Math.min(x+5,w-36),16);}
  }
  const [selStart,selEnd]=range();
  const sx=xForTime(selStart,w),ex=xForTime(selEnd,w);
  ctx.fillStyle='#bce77913';ctx.fillRect(sx,22,ex-sx,h-43);
  const focused=state.tab==='chop'?selectedSlice():null;
  if(focused){const left=xForTime(focused.start,w),right=xForTime(focused.end,w);ctx.fillStyle='#e8aa812c';ctx.fillRect(left,22,right-left,h-44);}
  const {lo,hi}=state.peaks;const n=lo.length;
  const amplitude=(h-72)*.43;
  const step=Math.max(1,Math.ceil(w/1800));
  ctx.lineWidth=Math.max(1,step);
  for(let x=0;x<w;x+=step){
    const t0=start+x/w*width,t1=start+(x+step)/w*width;
    const a=clamp(Math.floor(t0/duration()*n),0,n-1),b=clamp(Math.ceil(t1/duration()*n),a+1,n);
    let min=1,max=-1;
    for(let i=a;i<b;i++){min=Math.min(min,lo[i]);max=Math.max(max,hi[i]);}
    const inSelection=t0>=selStart&&t0<=selEnd;
    ctx.strokeStyle=inSelection?'#c3ef7a':'#6a8b7d';
    ctx.beginPath();ctx.moveTo(x+.5,center-max*amplitude);ctx.lineTo(x+.5,center-min*amplitude);ctx.stroke();
  }
  ctx.strokeStyle='#c3ef7a';ctx.lineWidth=1.5;
  for(const t of [selStart,selEnd]){
    const x=xForTime(t,w);
    if(x>=-3&&x<=w+3){ctx.beginPath();ctx.moveTo(x,22);ctx.lineTo(x,h-22);ctx.stroke();if(state.tab==='editor'){ctx.fillStyle='#c3ef7a';ctx.fillRect(x-3,22,6,8);}}
  }
  // Chop markers are magenta vertical guides.
  for(const slice of state.slices){
    const active=state.tab==='chop'&&slice.id===state.selectedSliceId;ctx.lineWidth=active?2:1;ctx.strokeStyle=active?'#ffd2a6':'#e8aa81aa';
    for(const t of [slice.start,slice.end]){
      const x=xForTime(t,w);if(x<0||x>w)continue;
      ctx.beginPath();ctx.moveTo(x,22);ctx.lineTo(x,h-22);ctx.stroke();
      if(state.tab==='chop'){ctx.fillStyle=active?'#ffd2a6':'#e8aa81';ctx.fillRect(x-(active?4:3),22,active?8:6,active?11:8);}
    }
  }
  // Cursor / playhead.
  const cursorX=xForTime(livePlayhead(),w);
  if(cursorX>=0&&cursorX<=w){
    ctx.strokeStyle='#ffffff';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(cursorX,0);ctx.lineTo(cursorX,h);ctx.stroke();
    ctx.fillStyle='#f7f9e9';ctx.beginPath();ctx.moveTo(cursorX-5,0);ctx.lineTo(cursorX+5,0);ctx.lineTo(cursorX,9);ctx.fill();
  }
  ctx.fillStyle='#7b9294';ctx.fillRect(0,h-22,w,1);
  ctx.fillStyle='#8da19d';ctx.textAlign='left';ctx.fillText(clock(start),8,h-7);ctx.textAlign='right';ctx.fillText(clock(end),w-8,h-7);
}
function animate(){
  if(state.analyser){
    const samples=new Float32Array(state.analyser.fftSize);state.analyser.getFloatTimeDomainData(samples);
    let rms=0;for(let i=0;i<samples.length;i++)rms+=samples[i]*samples[i];rms=Math.sqrt(rms/samples.length);
    const db=20*Math.log10(Math.max(.000001,rms));
    els.dbLevel.textContent=`${Math.round(db)} dB`;
    els.levelFill.style.width=`${clamp((db+65)/65*100,0,100)}%`;
  }
  if(state.playing||state.fxPreview)els.counter.textContent=clock(livePlayhead());
  drawWave();
  state.frame=requestAnimationFrame(animate);
}
function wirePairedControl(id,onChange=()=>{}){
  const input=$(id),slider=$(id+'Slider');
  slider.addEventListener('input',()=>{const step=Number(input.step)||1,min=Number(input.min),rounded=min+Math.round((Number(slider.value)-min)/step)*step;input.value=String(Math.round(clamp(rounded,min,Number(input.max))*1000)/1000);slider.value=input.value;onChange();});
  input.addEventListener('input',()=>{
    const value=Number(input.value);
    if(input.value!==''&&Number.isFinite(value)&&value>=Number(input.min)&&value<=Number(input.max)){slider.value=input.value;onChange();}
  });
  input.addEventListener('change',()=>{
    const value=Number(input.value);
    input.value=input.value!==''&&Number.isFinite(value)?String(clamp(value,Number(input.min),Number(input.max))):slider.value;
    slider.value=input.value;onChange();
  });
}
function wireEvents(){
  document.addEventListener('dblclick',event=>{
    const slider=event.target;
    if(!(slider instanceof HTMLInputElement)||slider.type!=='range'||slider.disabled)return;
    slider.value=slider.defaultValue;
    slider.dispatchEvent(new Event('input',{bubbles:true}));
    slider.dispatchEvent(new Event('change',{bubbles:true}));
  });
  els.connectTab.addEventListener('click',connectTab);
  els.connectInput.addEventListener('click',()=>connectInput());
  els.inputDevices.addEventListener('change',()=>connectInput(els.inputDevices.value));
  els.disconnect.addEventListener('click',releaseSource);
  els.recordBtn.addEventListener('click',toggleRecording);
  els.playBtn.addEventListener('click',()=>playTransport(0,duration()));
  els.playSelectionBtn.addEventListener('click',()=>playTransport(...range()));
  els.loopBtn.addEventListener('click',()=>{
    const item=state.playing,offset=item?.transport?livePlayhead():null;
    state.transportLoop=!state.transportLoop;els.loopBtn.setAttribute('aria-pressed',String(state.transportLoop));
    if(state.fxPreview)schedulePreview(state.fxPreview);
    else if(item?.transport)playRange(item.start,item.end,{transport:true,offset});
  });
  els.stopBtn.addEventListener('click',()=>{if(state.recorder?.state==='recording')stopRecording();stopEffectPreview();stopPlayback();});
  els.importBtn.addEventListener('click',()=>els.fileInput.click());
  els.exampleBtn.addEventListener('click',async()=>{
    try{
      const response=await fetch('./drum.wav');
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      await importAudio(new File([await response.blob()],'drum.wav',{type:'audio/wav'}));
    }catch(error){toast(`Could not load example: ${error.message}`);}
  });
  els.fileInput.addEventListener('change',()=>importAudio(els.fileInput.files?.[0]));
  els.exportBtn.addEventListener('click',()=>exportWav());
  els.exportSelectionBtn.addEventListener('click',()=>exportWav(...range(),`${state.name}-selection`));
  els.sampleName.addEventListener('input',()=>{state.name=els.sampleName.value||'Untitled sample';});
  els.inBtn.addEventListener('click',()=>selectRange(Math.min(state.cursor,state.selection.end),state.selection.end));
  els.outBtn.addEventListener('click',()=>selectRange(state.selection.start,Math.max(state.cursor,state.selection.start)));
  els.allBtn.addEventListener('click',()=>selectRange(0,duration()));
  els.cropBtn.addEventListener('click',crop);
  els.deleteBtn.addEventListener('click',deleteRegion);
  els.normalizeBtn.addEventListener('click',normalize);
  $('fxResetBtn').addEventListener('click',()=>{state.fxDraft=[];syncEffectControls();queueFxRender();});
  $('fxApplyChainBtn').addEventListener('click',commitEffectChain);
  $('fxDiscardBtn').addEventListener('click',()=>{state.fxDraft=structuredClone(state.fxChain);syncEffectControls();queueFxRender();});
  for(const [button,mode] of [[els.reverseBtn,'reverse'],[els.silenceBtn,'silence']])button.addEventListener('click',()=>processSelection(mode));
  for(const [input,edge] of [[els.selectionStart,'start'],[els.selectionEnd,'end']])input.addEventListener('change',()=>{
    const value=Number(input.value);if(!state.buffer||input.value===''||!Number.isFinite(value)){input.value=state.buffer?state.selection[edge].toFixed(3):'';return;}
    const time=clamp(value,0,duration());
    if(edge==='start')selectRange(Math.min(time,state.selection.end),state.selection.end);
    else selectRange(state.selection.start,Math.max(time,state.selection.start));
    input.value=state.selection[edge].toFixed(3);
  });
  $('exportDepth').addEventListener('change',updateUI);$('exportChannels').addEventListener('change',updateUI);
  for(const edge of ['In','Out']){
    const id='sliceFade'+edge;wirePairedControl(id);
    for(const control of [$(id),$(id+'Slider')])control.addEventListener('change',()=>{const slice=selectedSlice();if(!slice)return;const value=clamp(Number($(id).value)||0,0,slice.end-slice.start>0?(slice.end-slice.start)*1000:0)/1000;if(Math.abs((slice['fade'+edge]||0)-value)>1e-9){snapshot();slice['fade'+edge]=value;}});
  }
  els.customChopsBtn.addEventListener('click',()=>{const count=Number(els.chopCount.value);if(!Number.isInteger(count)||count<2||count>128){toast('Choose a slice count from 2 to 128.');return;}equalChops(count);});
  els.undoBtn.addEventListener('click',undo);els.chopUndoBtn.addEventListener('click',undo);
  els.transientSensitivity.addEventListener('input',()=>{els.sensitivityValue.textContent=`${els.transientSensitivity.value}%`;});
  els.auditionSliceBtn.addEventListener('click',()=>{const slice=selectedSlice();if(slice)playRange(slice.start,slice.end,{slice});});
  for(const [input,edge] of [[els.sliceStart,'start'],[els.sliceEnd,'end']])input.addEventListener('change',()=>{
    const slice=selectedSlice(),value=Number(input.value);
    if(!slice||input.value===''||!Number.isFinite(value)){if(slice)input.value=slice[edge].toFixed(3);return;}
    if(Math.abs(value-slice[edge])<1e-9){input.value=slice[edge].toFixed(3);return;}
    const linked=linkedBoundaries(slice[edge]);snapshot();stopPlayback();
    state.cursor=moveBoundaries(linked,value);state.selectedSliceEdge=edge;
    state.slices.sort((a,b)=>a.start-b.start);input.value=slice[edge].toFixed(3);renderSlices();
  });
  document.querySelectorAll('[data-chops]').forEach(el=>el.addEventListener('click',()=>equalChops(Number(el.dataset.chops))));
  els.addSliceBtn.addEventListener('click',addSlice);
  els.splitBtn.addEventListener('click',splitAtCursor);
  els.transientBtn.addEventListener('click',transientChops);
  els.clearSlicesBtn.addEventListener('click',()=>{if(state.slices.length){snapshot();state.slices=[];renderSlices();}});
  els.exportZipBtn.addEventListener('click',exportSlicesZip);
  els.zoom.addEventListener('input',()=>{
    const previous=viewport(),[start,end]=range(),d=duration();
    const hasRegion=end-start>0.01&&end-start<d-0.005;
    const anchor=hasRegion?(start+end)/2:clamp(state.cursor,0,d);
    const position=anchor>=previous.start&&anchor<=previous.end?(anchor-previous.start)/previous.width:0.5;
    state.zoom=Number(els.zoom.value);
    const width=d/state.zoom,available=d-width;
    state.viewFraction=available>0?clamp((anchor-position*width)/available,0,1):0;
    els.viewScroll.value=String(Math.round(state.viewFraction*1000));updateUI();
  });
  els.viewScroll.addEventListener('input',()=>{state.viewFraction=Number(els.viewScroll.value)/1000;});
  function markerAt(x,width){
    const markers=[];
    if(state.tab==='chop'){
      for(const slice of state.slices)for(const edge of ['start','end'])markers.push({kind:'slice',time:slice[edge],id:slice.id,edge});
    }else if(state.tab==='editor'){
      for(const edge of ['start','end'])markers.push({kind:'selection',time:state.selection[edge],edge});
    }
    return markers.map(marker=>({...marker,distance:Math.abs(xForTime(marker.time,width)-x)})).filter(marker=>marker.distance<=8).sort((a,b)=>a.distance-b.distance||Number(b.id===state.selectedSliceId)-Number(a.id===state.selectedSliceId))[0]||null;
  }
  canvas.addEventListener('pointerdown',(event)=>{
    if(!state.buffer)return;
    const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,marker=markerAt(x,rect.width);
    const linked=marker?.kind==='slice'?linkedBoundaries(marker.time):[];
    if(marker?.kind==='slice')selectSlice(marker.id,marker.edge);
    state.pointer={id:event.pointerId,anchorX:x,anchorTime:timeAtPixel(x,rect.width),marker,linked,moved:false,snapshotTaken:false,originalSelection:{...state.selection}};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',(event)=>{
    if(!state.buffer)return;
    const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,p=state.pointer;
    if(!p){canvas.style.cursor=markerAt(x,rect.width)?'ew-resize':'crosshair';return;}
    if(p.id!==event.pointerId)return;
    if(Math.abs(x-p.anchorX)>4)p.moved=true;
    if(!p.moved)return;
    const time=timeAtPixel(x,rect.width);
    if(p.marker?.kind==='selection'){
      const t=clamp(p.marker.time+time-p.anchorTime,0,duration());
      if(p.marker.edge==='start')selectRange(Math.min(t,state.selection.end),state.selection.end);
      else selectRange(state.selection.start,Math.max(t,state.selection.start));
    }else if(p.marker?.kind==='slice'){
      if(!p.snapshotTaken){snapshot();p.snapshotTaken=true;stopPlayback();}
      state.cursor=moveBoundaries(p.linked,p.marker.time+time-p.anchorTime);
      const slice=selectedSlice();if(slice){els.sliceStart.value=slice.start.toFixed(3);els.sliceEnd.value=slice.end.toFixed(3);}
    }else{selectRange(p.anchorTime,time);state.cursor=p.anchorTime;}
  });
  const endPointer=(event)=>{
    const p=state.pointer;if(!p||p.id!==event.pointerId)return;
    if(event.type==='pointercancel'){
      if(p.marker?.kind==='selection')state.selection=p.originalSelection;
      if(p.marker?.kind==='slice'&&p.snapshotTaken){for(const item of p.linked){const slice=state.slices.find(s=>s.id===item.id);if(slice)slice[item.edge]=item.time;}state.undo.pop();}
    }else if(!p.moved&&!p.marker){const rect=canvas.getBoundingClientRect(),time=timeAtPixel(event.clientX-rect.left,rect.width);state.cursor=time;if(state.tab==='chop'){const slice=state.slices.find(s=>time>=s.start&&time<s.end);if(slice){selectSlice(slice.id);state.cursor=time;}}}
    if(p.marker?.kind==='slice'&&p.moved){state.slices.sort((a,b)=>a.start-b.start);renderSlices();}
    if(event.type==='pointerup'&&!p.moved&&p.marker?.kind==='slice'){const input=p.marker.edge==='start'?els.sliceStart:els.sliceEnd;input.focus();input.select();}
    state.pointer=null;updateUI();
  };
  canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);
  canvas.addEventListener('pointerleave',()=>{if(!state.pointer)canvas.style.cursor='crosshair';});
  canvas.addEventListener('dblclick',()=>{if(state.buffer)selectRange(0,duration());});
  document.addEventListener('keydown',event=>{
    const tag=event.target?.tagName;
    if(['INPUT','TEXTAREA','SELECT'].includes(tag)||event.target?.isContentEditable||event.repeat)return;
    if(tag==='BUTTON'&&(event.code==='Space'||event.code==='Enter'))return;
    if(state.tab==='play'){
      if(event.key==='Escape'){stopPads();stopPlayback();return;}
      if(event.ctrlKey||event.metaKey||event.altKey)return;
      const index=padKeys.indexOf(event.code);
      if(index>=0){event.preventDefault();const slice=visibleSlices()[index];if(slice){state.heldKeys.set(event.code,slice.id);triggerPad(slice.id);}return;}
    }
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo();return;}
    if(event.code==='Space'){event.preventDefault();if(state.fxPreview||state.fxPreviewStarting){stopEffectPreview();updateUI();}else if(state.playing)stopPlayback();else playTransport(...range());}
    if(event.key==='Escape'){stopEffectPreview();stopPlayback();}
    if(state.tab!=='play'&&event.key.toLowerCase()==='r'&&state.sourceStream)toggleRecording();
  });
  document.addEventListener('keyup',event=>{const id=state.heldKeys.get(event.code);if(id!==undefined){state.heldKeys.delete(event.code);releasePad(id);}});
  window.addEventListener('blur',stopPads);
  let dragDepth=0;
  window.addEventListener('dragenter',event=>{if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();dragDepth++;els.dropOverlay.classList.add('active');});
  window.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
  window.addEventListener('dragleave',event=>{if(!event.dataTransfer?.types.includes('Files'))return;dragDepth=Math.max(0,dragDepth-1);if(dragDepth===0)els.dropOverlay.classList.remove('active');});
  window.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;els.dropOverlay.classList.remove('active');if(event.dataTransfer?.files?.[0])importAudio(event.dataTransfer.files[0]);});
  window.addEventListener('pagehide',()=>{stopEffectPreview();stopPads();stopPlayback();state.sourceStream?.getTracks().forEach(t=>t.stop());});
}

const padKeys=['Digit1','Digit2','Digit3','Digit4','KeyQ','KeyW','KeyE','KeyR','KeyA','KeyS','KeyD','KeyF','KeyZ','KeyX','KeyC','KeyV'];
const padLabels=['1','2','3','4','Q','W','E','R','A','S','D','F','Z','X','C','V'];
const visibleSlices=()=>state.slices.slice(state.bank*16,state.bank*16+16);
function configFor(id){
  if(!state.padConfig.has(id))state.padConfig.set(id,{mode:'one-shot',midi:null});
  return state.padConfig.get(id);
}
function updatePadLights(){
  document.querySelectorAll('.pad-trigger[data-id]').forEach(button=>{
    const active=state.padVoices.has(Number(button.dataset.id));
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
}
function stopPad(id){
  state.padPending.delete(id);
  const voice=state.padVoices.get(id);
  if(!voice)return;
  state.padVoices.delete(id);
  try{voice.node.onended=null;voice.node.stop();voice.node.disconnect();voice.gain.disconnect();}catch{}
  updatePadLights();
}
function stopPads(){
  state.padPending.clear();
  for(const id of [...state.padVoices.keys()])stopPad(id);
  state.heldKeys.clear();state.heldMidi.clear();
}
async function triggerPad(id){
  const slice=visibleSlices().find(item=>item.id===id);
  if(!slice||!state.buffer||state.tab!=='play'||state.recorder?.state==='recording'||state.recordBusy)return;
  const config=configFor(id);
  if(config.mode==='loop'&&(state.padVoices.has(id)||state.padPending.has(id))){stopPad(id);return;}
  stopPad(id);
  const token={};state.padPending.set(id,token);
  try{
    const ac=await audioContext();
    if(state.padPending.get(id)!==token||state.tab!=='play'||!visibleSlices().some(s=>s.id===id))return;
    state.padPending.delete(id);
    const node=ac.createBufferSource(),gain=ac.createGain();
    node.buffer=sliceBuffer(slice);gain.gain.value=.86;node.connect(gain);gain.connect(ac.destination);
    const voice={node,gain};state.padVoices.set(id,voice);
    node.onended=()=>{if(state.padVoices.get(id)===voice){state.padVoices.delete(id);updatePadLights();}try{node.disconnect();gain.disconnect();}catch{}};
    if(config.mode==='loop'){node.loop=true;node.loopStart=0;node.loopEnd=node.buffer.duration;node.start(0);}
    else node.start(0);
    updatePadLights();
  }catch(error){state.padPending.delete(id);toast(error.message||'Cannot play this slice.');}
}
function releasePad(id){if(configFor(id).mode==='gate')stopPad(id);}
function padWaveform(slice){
  if(!state.peaks||!state.buffer)return null;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 120 100');svg.setAttribute('preserveAspectRatio','none');
  svg.setAttribute('aria-hidden','true');svg.classList.add('pad-wave');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  const {lo,hi}=state.peaks,n=lo.length,first=clamp(Math.floor(slice.start/duration()*n),0,n-1),last=clamp(Math.ceil(slice.end/duration()*n),first+1,n);
  let d='';
  for(let x=0;x<120;x++){
    const a=Math.min(last-1,first+Math.floor(x*(last-first)/120)),b=Math.min(last,Math.max(a+1,first+Math.ceil((x+1)*(last-first)/120)));
    let min=1,max=-1;for(let i=a;i<b;i++){min=Math.min(min,lo[i]);max=Math.max(max,hi[i]);}
    d+=`M${x+.5} ${50-max*36}V${50-min*36}`;
  }
  path.setAttribute('d',d);path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','.8');path.setAttribute('fill','none');svg.appendChild(path);
  return svg;
}
function renderPads(){
  const grid=$('pad-grid');if(!grid)return;
  const slices=visibleSlices(),banks=Math.max(1,Math.ceil(state.slices.length/16));
  $('bank-label').textContent=`Bank ${state.bank+1} / ${banks}`;
  $('bank-prev').disabled=state.bank===0;$('bank-next').disabled=state.bank>=banks-1;
  grid.replaceChildren();
  for(let i=0;i<16;i++){
    const slice=slices[i],card=document.createElement('div');card.className='pad-card';
    const trigger=document.createElement('button');trigger.type='button';trigger.className='pad-trigger';trigger.disabled=!slice;
    trigger.setAttribute('aria-label',slice?`Play ${slice.name}, key ${padLabels[i]}`:`Empty pad ${padLabels[i]}`);
    const key=document.createElement('span');key.className='pad-key';key.textContent=padLabels[i];
    const top=document.createElement('span');top.className='pad-top';top.appendChild(key);
    const name=document.createElement('span');name.className='pad-name';name.textContent=slice?slice.name:'Empty';trigger.append(top,name);card.appendChild(trigger);
    if(slice){
      const waveform=padWaveform(slice);if(waveform)trigger.prepend(waveform);
      trigger.dataset.id=String(slice.id);trigger.setAttribute('aria-pressed','false');
      trigger.addEventListener('pointerdown',event=>{event.preventDefault();trigger.setPointerCapture(event.pointerId);triggerPad(slice.id);});
      trigger.addEventListener('pointerup',()=>releasePad(slice.id));trigger.addEventListener('pointercancel',()=>releasePad(slice.id));
      trigger.addEventListener('keydown',event=>{if(event.code==='Space'||event.code==='Enter'){if(!event.repeat){event.preventDefault();triggerPad(slice.id);}}});
      trigger.addEventListener('keyup',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();releasePad(slice.id);}});
      const config=configFor(slice.id),controls=document.createElement('div');controls.className='pad-controls';
      if(config.midi){
        const note=config.midi.note,names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
        const midi=document.createElement('span');midi.className='pad-midi';midi.textContent=`${names[note%12]}${Math.floor(note/12)-1} · ${config.midi.channel+1}`;
        midi.title=`MIDI note ${note}, channel ${config.midi.channel+1}`;top.appendChild(midi);
        trigger.setAttribute('aria-label',`Play ${slice.name}, key ${padLabels[i]}, MIDI note ${note}, channel ${config.midi.channel+1}`);
      }
      const select=document.createElement('select');select.className='field';select.setAttribute('aria-label',`Playback mode for ${slice.name}`);
      for(const [value,label] of [['one-shot','One-shot'],['loop','Loop'],['gate','Gate']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);}
      select.value=config.mode;select.addEventListener('change',()=>{stopPad(slice.id);config.mode=select.value;});
      const learn=document.createElement('button');learn.type='button';learn.className='btn btn-quiet btn-sm'+(state.midiLearning===slice.id?' learning':'');learn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 6v7m4-7v7m4-7v7M8 13h8"/></svg>';learn.title=state.midiLearning===slice.id?'Listening for MIDI note':'MIDI learn';learn.setAttribute('aria-label',`Learn MIDI note for ${slice.name}`);
      learn.addEventListener('click',()=>learnMidi(slice.id));
      const clear=document.createElement('button');clear.type='button';clear.className='btn btn-quiet btn-sm';clear.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 10v7m4-7v7"/></svg>';clear.title='Clear MIDI note';clear.disabled=!config.midi;clear.setAttribute('aria-label',`Clear MIDI note for ${slice.name}`);
      clear.addEventListener('click',()=>{config.midi=null;renderPads();});
      controls.append(select,learn,clear);card.appendChild(controls);
    }
    grid.appendChild(card);
  }
  updatePadLights();
}
async function learnMidi(id){
  if(!navigator.requestMIDIAccess){toast('MIDI is not supported in this browser. Try Chrome or Edge on a secure connection.');return;}
  state.midiLearning=id;renderPads();
  try{
    if(!state.midi){state.midi=await navigator.requestMIDIAccess();state.midi.onstatechange=connectMidiInputs;}
    connectMidiInputs();
    if(!state.midi.inputs.size)toast('Connect a MIDI controller, then play a note.');
  }catch(error){state.midiLearning=null;renderPads();toast('MIDI access was denied or unavailable.');}
}
function connectMidiInputs(){if(state.midi)for(const input of state.midi.inputs.values())input.onmidimessage=handleMidi;}
function handleMidi(event){
  const [status,note,velocity]=event.data,kind=status&0xf0,channel=status&15;
  if(kind!==0x90&&kind!==0x80)return;
  const down=kind===0x90&&velocity>0, key=`${event.target.id}:${channel}:${note}`;
  if(down&&state.midiLearning!==null){
    const id=state.midiLearning;state.midiLearning=null;
    if(state.slices.some(slice=>slice.id===id)){configFor(id).midi={channel,note};}
    renderPads();return;
  }
  if(!down){const ids=state.heldMidi.get(key)||[];state.heldMidi.delete(key);ids.forEach(releasePad);return;}
  if(state.tab!=='play'||state.heldMidi.has(key))return;
  const ids=visibleSlices().filter(slice=>{const midi=configFor(slice.id).midi;return midi&&midi.channel===channel&&midi.note===note;}).map(slice=>slice.id);
  state.heldMidi.set(key,ids);ids.forEach(triggerPad);
}
function selectTab(tab){
  if(state.tab==='play'&&tab!=='play')stopPads();
  if(state.tab==='editor'&&tab!=='editor')stopEffectPreview();
  if(state.tab!==tab){state.midiLearning=null;stopPlayback();}
  state.tab=tab;
  for(const name of ['capture','editor','chop','play']){
    const selected=name===tab,button=$(`tab-${name}`);button.classList.toggle('active',selected);button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$(`view-${name}`).hidden=!selected;
  }
  if(tab==='play')renderPads();
  if(tab==='editor'||tab==='chop'){const panel=$(`view-${tab}`);panel.prepend($('wave-panel'));requestAnimationFrame(drawWave);}
}
function setupViews(){
  $('capture-actions').append(els.recordBtn,els.importBtn,els.exampleBtn,els.recMessage,els.counter);
  const tabs=['capture','editor','chop','play'];
  tabs.forEach((tab,index)=>{
    const button=$(`tab-${tab}`);button.addEventListener('click',()=>selectTab(tab));
    button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();selectTab(tabs[next]);$(`tab-${tabs[next]}`).focus();});
  });
  $('bank-prev').addEventListener('click',()=>{stopPads();state.midiLearning=null;state.bank--;renderPads();});
  $('bank-next').addEventListener('click',()=>{stopPads();state.midiLearning=null;state.bank++;renderPads();});
  $('pads-stop').addEventListener('click',stopPads);
}

setupEffectChain();
setupViews();
wireEvents();
updateUI();
renderSlices();
if(!navigator.mediaDevices){els.inputHint.textContent='Capture requires a secure context (localhost / HTTPS)';}
animate();
