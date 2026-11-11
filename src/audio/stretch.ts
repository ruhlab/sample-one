import { assets } from '../assets.ts';
const MAX_RECORD_MS = 180000;
let stretchModulePromise;
function stretchModule(){
  if(!stretchModulePromise)stretchModulePromise=import(assets.stretch).then(module=>module.default).catch(error=>{stretchModulePromise=null;throw new Error(`Pitch/time engine unavailable: ${error.message}`);});
  return stretchModulePromise;
}
async function stretchPitch(input,a,b,settings){
  const sr=input.sampleRate,length=b-a,outLength=Math.max(2,Math.round(length/settings.speed));
  if(outLength>length&&input.length-length+outLength>sr*MAX_RECORD_MS/1000)throw new Error('The resulting sample exceeds 3 minutes.');
  // Warm the processor on silence so its initial latency is settled before the audio begins.
  const maxPreroll=sr,offline=new OfflineAudioContext(input.numberOfChannels,outLength+maxPreroll,sr),factory=await stretchModule();
  const node=await factory(offline,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[input.numberOfChannels]});
  const latency=await node.latency(),preroll=Math.ceil(latency*sr)+256;
  if(!Number.isFinite(latency)||latency<0||preroll>maxPreroll)throw new Error('Pitch/time processor latency is unsupported.');
  const inputPreroll=Math.round(preroll*settings.speed);
  await node.addBuffers(Array.from({length:input.numberOfChannels},(_,c)=>{
    const data=new Float32Array(inputPreroll+length);data.set(input.getChannelData(c).subarray(a,b),inputPreroll);return data;
  }));
  await node.schedule({active:true,input:0,output:0,rate:settings.speed,semitones:settings.semitones+settings.cents/100});
  node.connect(offline.destination);
  const rendered=await offline.startRendering(),output=offline.createBuffer(input.numberOfChannels,outLength,sr);
  for(let c=0;c<input.numberOfChannels;c++)output.getChannelData(c).set(rendered.getChannelData(c).subarray(preroll,preroll+outLength));
  return output;
}

export {stretchPitch};
