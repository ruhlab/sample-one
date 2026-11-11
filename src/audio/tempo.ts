import type { AudioSamples } from './types.ts';
export async function estimateBpm(buffer: AudioSamples,isCurrent: () => boolean=()=>true): Promise<number | null> {
  const sr=buffer.sampleRate,hop=Math.max(1,Math.round(sr/100)),count=Math.floor(buffer.length/hop);
  if(count<250)throw new Error('Use at least 2.5 seconds of rhythmic audio.');
  const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
  const env=new Float32Array(count);let previous=0,energy=0;
  for(let i=0;i<count;i++){
    let sum=0;for(let j=i*hop;j<(i+1)*hop;j++){let sample=0;for(const channel of channels)sample+=Math.abs(channel[j]);sum+=sample/channels.length;}
    const value=sum/hop;env[i]=Math.max(0,value-previous);previous=previous*.85+value*.15;energy+=env[i];
    if(i%1200===1199){await new Promise(resolve=>setTimeout(resolve,0));if(!isCurrent())return null;}
  }
  if(energy/count<0.0001)throw new Error('Not enough rhythmic audio to estimate BPM.');
  const peaks=[];for(let i=1;i<count-1;i++)if(env[i]>env[i-1]&&env[i]>=env[i+1]&&env[i]>energy/count*.8)peaks.push(i);
  if(peaks.length<4)throw new Error('Not enough rhythmic events to estimate BPM.');
  const rate=sr/hop,minLag=Math.max(1,Math.floor(rate*60/200)),maxLag=Math.min(count-2,Math.ceil(rate*60/60));
  let bestLag=0,bestScore=0;
  for(let lag=minLag;lag<=maxLag;lag++){
    let correlation=0,left=0,right=0;
    for(let i=lag;i<count;i++){correlation+=env[i]*env[i-lag];left+=env[i]*env[i];right+=env[i-lag]*env[i-lag];}
    const tempo=60*rate/lag,prior=Math.exp(-.5*Math.pow(Math.log2(tempo/120)/1.2,2));
    const score=correlation/Math.sqrt(left*right||1)*prior;
    if(score>bestScore){bestScore=score;bestLag=lag;}
  }
  if(!bestLag||bestScore<.025)throw new Error('Could not find a reliable tempo. Set BPM manually.');
  return Math.round(60*rate/bestLag*10)/10;
}

