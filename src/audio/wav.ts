import type { AudioSamples, WavOptions } from './types.ts';
const clamp=(x: number,a: number,b: number)=>Math.min(b,Math.max(a,x));
export function encodeWav(buffer: AudioSamples,start=0,end=buffer.duration,{mono=false,depth=16}: WavOptions={}): Uint8Array {
  const channels=mono?1:buffer.numberOfChannels,sr=buffer.sampleRate,bytesPerSample=depth/8;
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
