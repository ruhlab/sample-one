export function createCaptureFeature({state,els,updateUI,audioContext,toast,stopPlayback,loadSample,secs,clock,MAX_RECORD_MS}) {
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
    } as DisplayMediaStreamOptions);
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
async function connectInput(id?: string){
  if(!navigator.mediaDevices?.getUserMedia){toast('Audio inputs require a modern browser on localhost or HTTPS.');return;}
  try{
    const constraints: MediaTrackConstraints={echoCancellation:false,noiseSuppression:false,autoGainControl:false};
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
    const options: MediaRecorderOptions={};
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


return {releaseSource,connectTab,connectInput,stopRecording,toggleRecording};
}
