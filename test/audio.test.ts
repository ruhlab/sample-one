import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/audio/wav.ts';
import { estimateBpm } from '../src/audio/tempo.ts';
import { calculatePeaks } from '../src/features/peaks.ts';
import { buildZip } from '../src/audio/zip.ts';

function audio(channels,sampleRate=8000){
  return {numberOfChannels:channels.length,sampleRate,length:channels[0].length,duration:channels[0].length/sampleRate,getChannelData:index=>channels[index]};
}

test('WAV export writes the requested depth, channel count and sample data',()=>{
  const input=audio([Float32Array.from([1,0]),Float32Array.from([-1,0])]);
  const bytes=encodeWav(input,0,input.duration,{mono:true,depth:16}),view=new DataView(bytes.buffer);
  assert.equal(view.getUint16(22,true),1);assert.equal(view.getUint32(24,true),8000);
  assert.equal(view.getUint16(34,true),16);assert.equal(view.getUint32(40,true),4);assert.equal(view.getInt16(44,true),0);
});

test('tempo detection estimates a regular beat and rejects silence',async()=>{
  const data=new Float32Array(8000*8);
  for(let frame=0;frame<data.length;frame+=4000)for(let j=0;j<120;j++)data[frame+j]=.9*Math.exp(-j/25);
  assert.ok(Math.abs((await estimateBpm(audio([data])))-120)<3);
  await assert.rejects(estimateBpm(audio([new Float32Array(8000*4)])),/rhythmic audio/);
});

test('waveform peaks retain the minimum and maximum signal values',()=>{
  const peaks=calculatePeaks(audio([Float32Array.from([-1,.5,.25,1])]));
  assert.deepEqual([...peaks.lo],[-1,.5,.25,1]);assert.deepEqual([...peaks.hi],[-1,.5,.25,1]);
});

test('slice archives contain valid ZIP headers and entry names',async()=>{
  const zip=buildZip([{name:'test.wav',data:new Uint8Array([1,2,3])}]);const bytes=new Uint8Array(await zip.arrayBuffer());
  const view=new DataView(bytes.buffer);assert.equal(view.getUint32(0,true),0x04034b50);
  assert.equal(new TextDecoder().decode(bytes.subarray(30,38)),'test.wav');assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
});
