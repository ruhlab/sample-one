export const state = {
  ctx:null,sourceStream:null,sourceType:'',sourceLabel:'',sourceNode:null,analyser:null,mutedNode:null,
  recorder:null,chunks:[],recordStarted:0,recordTimer:null,recordBusy:false,
  bpm:120,tempoRate:1,tempoChangesSpeed:false,bpmGeneration:0,bpmDetecting:false,placement:null,buffer:null,name:'Untitled sample',selection:{start:0,end:0},cursor:0,slices:[],nextId:1,undo:[],
  selectedSliceId:null,selectedSliceEdge:null,tab:'capture',bank:0,padConfig:new Map(),padVoices:new Map(),padPending:new Map(),midi:null,midiLearning:null,heldKeys:new Map(),heldMidi:new Map(),
  originalBuffer:null,fxBase:null,fxChain:[],fxDraft:[],fxRendered:null,fxRenderVersion:0,fxRenderPending:false,fxRenderError:null,fxNextId:1,fxPreview:null,fxPreviewStarting:false,fxPreviewGeneration:0,fxPreviewTimer:null,processing:false,playing:null,transportLoop:false,zoom:1,viewFraction:0,peaks:null,pointer:null,toastTimer:null,frame:0,
};
