import type { ZipEntry } from './types.ts';
function crc32(bytes: Uint8Array): number {
  let crc=-1;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0);}
  return (crc^-1)>>>0;
}
// Minimal, standards-compliant uncompressed ZIP writer: no external JS dependencies.
function buildZip(entries: ZipEntry[]): Blob {
  const encoder=new TextEncoder();const sections=[],central=[];let offset=0;
  for(const entry of entries){
    const name=encoder.encode(entry.name),data=entry.data,crc=crc32(data);
    const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(8,0,true);
    l.setUint32(14,crc,true);l.setUint32(18,data.byteLength,true);l.setUint32(22,data.byteLength,true);
    l.setUint16(26,name.length,true);local.set(name,30);
    sections.push(local,data);
    const header=new Uint8Array(46+name.length),h=new DataView(header.buffer);
    h.setUint32(0,0x02014b50,true);h.setUint16(4,20,true);h.setUint16(6,20,true);
    h.setUint16(8,0x0800,true);h.setUint32(16,crc,true);
    h.setUint32(20,data.byteLength,true);h.setUint32(24,data.byteLength,true);
    h.setUint16(28,name.length,true);h.setUint32(42,offset,true);header.set(name,46);
    central.push(header);offset+=local.byteLength+data.byteLength;
  }
  const directoryBytes=central.reduce((a,x)=>a+x.byteLength,0);
  const end=new Uint8Array(22),v=new DataView(end.buffer);
  v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);
  v.setUint16(10,entries.length,true);v.setUint32(12,directoryBytes,true);v.setUint32(16,offset,true);
  return new Blob([...sections,...central,end],{type:'application/zip'});
}

export {buildZip};
