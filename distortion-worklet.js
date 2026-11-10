class DistortionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [{name:'drive',defaultValue:0,minValue:0,maxValue:36,automationRate:'k-rate'},{name:'bits',defaultValue:8,minValue:2,maxValue:16,automationRate:'k-rate'},{name:'downsample',defaultValue:1,minValue:1,maxValue:32,automationRate:'k-rate'},{name:'mode',defaultValue:0,minValue:0,maxValue:3,automationRate:'k-rate'}];}
  constructor(){super();this.phase=0;this.held=[];}
  process(inputs,outputs,parameters){
    const input=inputs[0],output=outputs[0];if(!output.length)return true;
    const gain=Math.pow(10,parameters.drive[0]/20),bits=Math.round(parameters.bits[0]),step=Math.pow(2,bits-1),downsample=Math.round(parameters.downsample[0]),mode=Math.round(parameters.mode[0]);
    for(let i=0;i<output[0].length;i++){
      const sampleNow=this.phase===0;
      for(let c=0;c<output.length;c++){
        const x=(input[c]||input[0])?.[i]||0;let y;
        if(mode===0)y=Math.tanh(x*gain);
        else if(mode===1)y=Math.max(-1,Math.min(1,x*gain));
        else if(mode===2){const z=x*gain;y=(2/Math.PI)*Math.asin(Math.sin(z*Math.PI/2));}
        else {if(sampleNow)this.held[c]=Math.max(-1,Math.min(1,Math.round(x*gain*step)/step));y=this.held[c]||0;}
        output[c][i]=y;
      }
      this.phase=(this.phase+1)%downsample;
    }
    return true;
  }
}
registerProcessor('sample-one-distortion',DistortionProcessor);
