export function createEditorFeature({state,els,range,duration,clamp,snapshot,stopEffectPreview,stopPlayback,stopPads,renderChain,queueFxRender,stretchPitch,updateUI,updatePeaks,renderSlices,toast,MAX_RECORD_MS}) {
// Destructive edits operate on the source before the applied FX chain. Render the
// new source first, then commit the edit atomically so a failed render loses nothing.
async function editSource(mode){
  if(!state.buffer||!state.fxBase||state.processing)return;
  const oldBuffer=state.buffer,base=state.fxBase,[start,end]=range();
  const sourceStart=clamp(start/oldBuffer.duration*base.duration,0,base.duration);
  const sourceEnd=clamp(end/oldBuffer.duration*base.duration,0,base.duration);
  const a=clamp(Math.floor(sourceStart*base.sampleRate),0,base.length);
  const b=clamp(Math.ceil(sourceEnd*base.sampleRate),a,base.length);
  if(mode!=='normalize'&&(end-start<.01||b-a<2))return;
  if(mode==='delete'&&end-start>=oldBuffer.duration-.005)return;
  let gain=1;
  if(mode==='normalize'){
    let peak=0;for(let c=0;c<base.numberOfChannels;c++){const data=base.getChannelData(c);for(let i=0;i<data.length;i++)peak=Math.max(peak,Math.abs(data[i]));}
    if(peak<.000001){toast('There is no audible signal to normalize.');return;}
    gain=.98/peak;if(Math.abs(gain-1)<.001){toast('Source audio is already normalized.');return;}
  }
  stopEffectPreview();stopPlayback();clearTimeout(state.fxPreviewTimer);state.fxRenderVersion++;state.fxRenderPending=false;state.processing=true;updateUI();
  try{
    const length=mode==='crop'?b-a:mode==='delete'?base.length-(b-a):base.length;
    const source=state.ctx.createBuffer(base.numberOfChannels,Math.max(1,length),base.sampleRate);
    for(let c=0;c<base.numberOfChannels;c++){
      const src=base.getChannelData(c),dst=source.getChannelData(c);
      if(mode==='crop')dst.set(src.subarray(a,b));
      else if(mode==='delete'){dst.set(src.subarray(0,a));dst.set(src.subarray(b),a);}
      else {dst.set(src);if(mode==='reverse'){for(let i=a;i<b;i++)dst[i]=src[b-1-(i-a)];}else if(mode==='silence')dst.fill(0,a,b);else for(let i=0;i<src.length;i++)dst[i]=src[i]*gain;}
    }
    const output=await renderChain(source,structuredClone(state.fxChain));
    if(state.fxBase!==base||state.buffer!==oldBuffer)throw new Error('The sample changed while processing.');
    const oldPlacement=state.placement||{start:0,end:base.length};
    let placement={...oldPlacement};
    if(mode==='crop')placement={start:clamp(oldPlacement.start-a,0,source.length),end:clamp(oldPlacement.end-a,0,source.length)};
    else if(mode==='delete'){
      const afterDelete=frame=>frame<=a?frame:frame>=b?frame-(b-a):a;
      placement={start:afterDelete(oldPlacement.start),end:afterDelete(oldPlacement.end)};
    }else if(mode==='reverse')placement={start:Math.min(oldPlacement.start,a),end:Math.max(oldPlacement.end,b)};
    if(placement.end<=placement.start)placement={start:0,end:source.length};
    // Keep audio outside the timeline when editing its visible portion.
    if(mode!=='crop'&&mode!=='delete'&&oldPlacement.clip){
      const clip=state.ctx.createBuffer(source.numberOfChannels,placement.end-placement.start,source.sampleRate);
      for(let c=0;c<source.numberOfChannels;c++){
        const data=clip.getChannelData(c),visibleStart=Math.max(0,placement.start),visibleEnd=Math.min(source.length,placement.end);
        data.set(oldPlacement.clip.getChannelData(c),oldPlacement.start-placement.start);
        if(visibleEnd>visibleStart)data.set(source.getChannelData(c).subarray(visibleStart,visibleEnd),visibleStart-placement.start);
      }
      placement.clip=clip;
    }else{
      placement.start=clamp(placement.start,0,source.length);placement.end=clamp(placement.end,placement.start,source.length);
      const clip=state.ctx.createBuffer(source.numberOfChannels,placement.end-placement.start,source.sampleRate);
      for(let c=0;c<source.numberOfChannels;c++)clip.getChannelData(c).set(source.getChannelData(c).subarray(placement.start,placement.end));
      placement.clip=clip;
    }
    // An edit changes the source audio, so future stretches start from this edited version.
    delete placement.stretchSource;
    snapshot();state.fxBase=source;state.buffer=output;state.fxRendered=null;state.placement=placement;
    if(mode==='crop'||mode==='delete'){
      state.slices=[];state.cursor=mode==='crop'?0:clamp(sourceStart/source.duration*output.duration,0,output.duration);
      state.selection={start:0,end:output.duration};state.zoom=1;state.viewFraction=0;els.zoom.value='1';els.viewScroll.value='0';
    }else if(oldBuffer.duration){
      const scale=output.duration/oldBuffer.duration;state.selection={start:start*scale,end:end*scale};state.cursor*=scale;
      for(const slice of state.slices){slice.start*=scale;slice.end*=scale;}
    }
    updatePeaks();renderSlices();
    const message={crop:'Cropped to selection.',delete:'Deleted selected audio.',reverse:'Reversed selection.',silence:'Silenced selection.',normalize:'Normalized source to −0.2 dBFS.'};
    toast(`${message[mode]} Applied FX remain editable.`);
  }catch(error){toast(`Unable to edit source: ${error.message}`);}
  finally{state.processing=false;queueFxRender();updateUI();}
}
// Placement uses source-frame boundaries, so silence is explicit in playback and export.
async function setSoundPlacement(timelineSeconds,startSeconds){
  if(!state.fxBase||!state.buffer||!state.placement||state.processing)return;
  const base=state.fxBase,oldBuffer=state.buffer,old=state.placement,sr=base.sampleRate,ratio=oldBuffer.duration/base.duration;
  if(!Number.isFinite(timelineSeconds)||!Number.isFinite(startSeconds)||timelineSeconds<=0){toast('Enter a valid timeline length and sound start.');updateUI();return;}
  const length=Math.round(timelineSeconds/ratio*sr),first=Math.round(startSeconds/ratio*sr),soundLength=old.end-old.start;
  if(length<1||length>sr*MAX_RECORD_MS/1000||first+soundLength<=0||first>=length){toast('Keep some sound inside the timeline (maximum 3 minutes).');updateUI();return;}
  const delta=(first-old.start)/sr*ratio;
  if(state.slices.some(slice=>slice.start+delta< -1e-7||slice.end+delta>timelineSeconds+1e-7)){toast('Move or resize the timeline so every slice stays inside it.');updateUI();return;}
  if(length===base.length&&first===old.start){updateUI();return;}
  stopEffectPreview();stopPlayback();stopPads();clearTimeout(state.fxPreviewTimer);state.fxRenderVersion++;state.fxRenderPending=false;state.processing=true;updateUI();
  try{
    const source=state.ctx.createBuffer(base.numberOfChannels,length,sr);
    let clip=old.clip;
    if(!clip){clip=state.ctx.createBuffer(base.numberOfChannels,soundLength,sr);for(let c=0;c<base.numberOfChannels;c++)clip.getChannelData(c).set(base.getChannelData(c).subarray(old.start,old.end));}
    const clipStart=Math.max(0,-first),clipEnd=Math.min(soundLength,length-first),destination=Math.max(0,first);
    for(let c=0;c<base.numberOfChannels;c++)source.getChannelData(c).set(clip.getChannelData(c).subarray(clipStart,clipEnd),destination);
    const output=await renderChain(source,structuredClone(state.fxChain));
    if(state.fxBase!==base||state.buffer!==oldBuffer)throw new Error('The sample changed while processing.');
    snapshot();state.fxBase=source;state.buffer=output;state.placement={start:first,end:first+soundLength,clip,stretchSource:old.stretchSource};state.fxRendered=null;
    const actualDelta=(first-old.start)/sr*(output.duration/source.duration);
    for(const slice of state.slices){slice.start=clamp(slice.start+actualDelta,0,output.duration);slice.end=clamp(slice.end+actualDelta,0,output.duration);}
    state.selection={start:clamp(state.selection.start+actualDelta,0,output.duration),end:clamp(state.selection.end+actualDelta,0,output.duration)};
    state.cursor=clamp(state.cursor+actualDelta,0,output.duration);
    updatePeaks();renderSlices();toast('Sound positioned on the timeline.');
  }catch(error){toast(`Unable to position sound: ${error.message}`);}
  finally{state.processing=false;queueFxRender();updateUI();}
}
// Stretch the sound itself, retaining its un-stretched source for later adjustments.
async function stretchSound(edge,targetTime){
  if(!state.fxBase||!state.buffer||!state.placement||state.processing)return;
  const base=state.fxBase,oldBuffer=state.buffer,old=state.placement,sr=base.sampleRate,ratio=oldBuffer.duration/base.duration;
  const target=Math.round(targetTime/ratio*sr),first=edge==='start'?target:old.start,last=edge==='end'?target:old.end;
  const length=last-first,previousLength=old.end-old.start;
  if(!Number.isFinite(targetTime)||length<Math.max(2,Math.round(sr*.015))||length>sr*MAX_RECORD_MS/1000||last<=0||first>=base.length){toast('Keep at least 15 ms of sound on the timeline.');return;}
  if(first===old.start&&last===old.end)return;
  const oldStart=old.start/sr*ratio,newStart=first/sr*ratio,scale=length/previousLength;
  const map=time=>newStart+(time-oldStart)*scale;
  if(state.slices.some(slice=>map(slice.start)<-1e-7||map(slice.end)>oldBuffer.duration+1e-7)){toast('Adjust the sound so every slice stays inside the timeline.');return;}
  stopEffectPreview();stopPlayback();stopPads();clearTimeout(state.fxPreviewTimer);state.fxRenderVersion++;state.fxRenderPending=false;state.processing=true;updateUI();
  try{
    let original=old.stretchSource||old.clip;
    if(!original){original=state.ctx.createBuffer(base.numberOfChannels,previousLength,sr);for(let c=0;c<base.numberOfChannels;c++)original.getChannelData(c).set(base.getChannelData(c).subarray(old.start,old.end));}
    const clip=length===original.length?original:await stretchPitch(original,0,original.length,{speed:original.length/length,semitones:0,cents:0});
    const source=state.ctx.createBuffer(base.numberOfChannels,base.length,sr),clipStart=Math.max(0,-first),clipEnd=Math.min(clip.length,base.length-first);
    for(let c=0;c<base.numberOfChannels;c++)source.getChannelData(c).set(clip.getChannelData(c).subarray(clipStart,clipEnd),Math.max(0,first));
    const output=await renderChain(source,structuredClone(state.fxChain));
    if(state.fxBase!==base||state.buffer!==oldBuffer)throw new Error('The sample changed while processing.');
    snapshot();state.fxBase=source;state.buffer=output;state.fxRendered=null;state.placement={start:first,end:first+clip.length,clip,stretchSource:original};
    const outputRatio=output.duration/oldBuffer.duration,actualScale=clip.length/previousLength;
    const mapOutput=time=>clamp((newStart+(time-oldStart)*actualScale)*outputRatio,0,output.duration);
    for(const slice of state.slices){slice.start=mapOutput(slice.start);slice.end=mapOutput(slice.end);}
    state.selection={start:mapOutput(state.selection.start),end:mapOutput(state.selection.end)};state.cursor=mapOutput(state.cursor);
    updatePeaks();renderSlices();toast('Sound tempo adjusted. The grid BPM is unchanged.');
  }catch(error){toast(`Unable to stretch sound: ${error.message}`);}
  finally{state.processing=false;queueFxRender();updateUI();}
}
function crop(){return editSource('crop');}
function deleteRegion(){return editSource('delete');}
function processSelection(mode){return editSource(mode);}

return {editSource,setSoundPlacement,stretchSound,crop,deleteRegion,processSelection};
}
