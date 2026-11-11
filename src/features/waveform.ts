const waveformPadding = {top:29,bottom:31};
export function createWaveformFeature({state,canvas,ctx,els,duration,clamp,range,selectedSlice,livePlayhead,clock}) {
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
  // 4/4 grid: bars, beats, sixteenth notes, and triplet subdivisions.
  ctx.font='10px ui-monospace, SFMono-Regular, Menlo, monospace';ctx.textAlign='left';
  const subdivision=60/state.bpm/12, pixels=subdivision/width*w;
  const stride=pixels>=4?1:pixels*3>=4?3:pixels*12>=4?12:48;
  const first=Math.max(0,Math.ceil(start/subdivision/stride)*stride),last=Math.floor(end/subdivision);
  for(let i=first;i<=last;i+=stride){
    const t=i*subdivision,x=xForTime(t,w),bar=i%48===0,beat=i%12===0,sixteenth=i%3===0;
    ctx.strokeStyle=bar?'#607a70':beat?'#40574f':sixteenth?'#30453e':'#1d302b';
    ctx.lineWidth=bar?1.3:1;ctx.beginPath();ctx.moveTo(x,23);ctx.lineTo(x,h-22);ctx.stroke();
    if(bar){ctx.fillStyle='#8da39a';ctx.fillText(`${Math.floor(i/48)+1}`,Math.min(x+5,w-20),16);}
  }
  const drag=state.pointer?.kind==='placement'?state.pointer:null,dragOffset=drag?.delta||0;
  const placementFactor=state.placement?duration()/state.fxBase.duration/state.fxBase.sampleRate:0;
  const originalStart=state.placement?state.placement.start*placementFactor:0,originalEnd=state.placement?state.placement.end*placementFactor:duration();
  const previewStart=originalStart+(drag?.edge==='end'?0:dragOffset),previewEnd=originalEnd+(drag?.edge==='start'?0:dragOffset);
  const previewScale=drag?.edge?(previewEnd-previewStart)/(originalEnd-originalStart):1;
  const mapPreview=time=>previewStart+(time-originalStart)*previewScale;
  const [selectionStart,selectionEnd]=range();
  const selStart=clamp(mapPreview(selectionStart),0,duration()),selEnd=clamp(mapPreview(selectionEnd),0,duration());
  const sx=xForTime(selStart,w),ex=xForTime(selEnd,w);
  ctx.fillStyle='#bce77913';ctx.fillRect(sx,22,ex-sx,h-43);
  const focused=state.tab==='chop'?selectedSlice():null;
  if(focused){const left=xForTime(focused.start,w),right=xForTime(focused.end,w);ctx.fillStyle='#e8aa812c';ctx.fillRect(left,22,right-left,h-44);}
  const {lo,hi}=drag?.clipPeaks||state.peaks;const n=lo.length;
  const peakStart=drag?.clipPeaks?state.placement.start*placementFactor:0;
  const peakDuration=drag?.clipPeaks?(state.placement.end-state.placement.start)*placementFactor:duration();
  const amplitude=(h-72)*.43;
  const step=Math.max(1,Math.ceil(w/1800));
  ctx.lineWidth=Math.max(1,step);
  for(let x=0;x<w;x+=step){
    const t0=start+x/w*width,t1=start+(x+step)/w*width;
    const sourceStart=originalStart+(t0-previewStart)/previewScale-peakStart,sourceEnd=originalStart+(t1-previewStart)/previewScale-peakStart;
    if(sourceEnd<=0||sourceStart>=peakDuration)continue;
    const a=clamp(Math.floor(sourceStart/peakDuration*n),0,n-1),b=clamp(Math.ceil(sourceEnd/peakDuration*n),a+1,n);
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
    for(const t of [mapPreview(slice.start),mapPreview(slice.end)]){
      const x=xForTime(t,w);if(x<0||x>w)continue;
      ctx.beginPath();ctx.moveTo(x,22);ctx.lineTo(x,h-22);ctx.stroke();
      if(state.tab==='chop'){ctx.fillStyle=active?'#ffd2a6':'#e8aa81';ctx.fillRect(x-(active?4:3),22,active?8:6,active?11:8);}
    }
  }
  // The strip below the waveform is a dedicated drag handle for the sound.
  if(state.tab==='editor'&&state.placement){
    const left=xForTime(previewStart,w),right=xForTime(previewEnd,w);
    const barLeft=Math.max(0,left),barRight=Math.min(w,right);
    if(barRight>barLeft){ctx.fillStyle='#718e5e';ctx.fillRect(barLeft,h-20,barRight-barLeft,14);ctx.fillStyle='#d5edae';if(left>=0&&left<=w)ctx.fillRect(left,h-20,5,14);if(right>=0&&right<=w)ctx.fillRect(right-5,h-20,5,14);ctx.fillStyle='#e9f4df';ctx.textAlign='center';if(barRight-barLeft>55)ctx.fillText('⋮⋮  SOUND', (barLeft+barRight)/2,h-9);ctx.textAlign='left';}
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

return {viewport,timeAtPixel,xForTime,drawWave,animate};
}
