import { assets } from '../assets.ts';
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
  if(!distortionModules.has(ac))distortionModules.set(ac,ac.audioWorklet.addModule(assets.distortion).catch(error=>{distortionModules.delete(ac);throw error;}));
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

export {createEqStage,setEqStage,createReverbStage,setReverbStage,createDelayStage,setDelayStage,createDistortionStage,setDistortionStage,createCompressorStage,setCompressorStage};
