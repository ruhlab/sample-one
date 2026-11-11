'use strict';
self.onmessage=event=>{
  const {channels,sourceRate,targetRate,taps}=event.data;
  try{
    const outLength=Math.max(1,Math.round(channels[0].length*targetRate/sourceRate));
    const output=channels.map(()=>new Float32Array(outLength));
    const ratio=sourceRate/targetRate,cutoff=Math.min(1,targetRate/sourceRate)*.94,half=taps/2;
    for(let i=0;i<outLength;i++){
      const position=(i+.5)*ratio-.5,center=Math.floor(position);let weightSum=0;
      for(let k=-half+1;k<=half;k++){
        const index=center+k,x=position-index,windowPosition=x/half;
        if(Math.abs(windowPosition)>=1)continue;
        const z=Math.PI*x*cutoff,sinc=Math.abs(z)<1e-10?1:Math.sin(z)/z;
        const window=.42+.5*Math.cos(Math.PI*windowPosition)+.08*Math.cos(2*Math.PI*windowPosition);
        const weight=cutoff*sinc*window;weightSum+=weight;
        const sourceIndex=Math.max(0,Math.min(channels[0].length-1,index));
        for(let c=0;c<channels.length;c++)output[c][i]+=channels[c][sourceIndex]*weight;
      }
      if(Math.abs(weightSum)>1e-10)for(let c=0;c<channels.length;c++)output[c][i]/=weightSum;
    }
    self.postMessage({channels:output},output.map(channel=>channel.buffer));
  }catch(error){self.postMessage({error:error.message});}
};
