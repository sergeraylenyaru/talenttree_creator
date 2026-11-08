"""Reader for the Cataclysm 4.3.4 WDBC files used by build_cata_presets.py."""
import struct
from pathlib import Path
class DBC:
 def __init__(self,name):
  self.data=Path('work/sources/dbc434/'+name+'.dbc').read_bytes();magic,self.count,self.fields,self.size,self.string_size=struct.unpack_from('<4s4I',self.data);assert magic==b'WDBC';self.strings=self.data[20+self.count*self.size:];self.rows=[struct.unpack_from('<'+str(self.fields)+'I',self.data,20+i*self.size) for i in range(self.count)];self.by_id={r[0]:r for r in self.rows}
 def text(self,offset):return self.strings[offset:self.strings.find(b'\0',offset)].decode('utf-8')
 def f(self,value):return struct.unpack('<f',struct.pack('<I',value))[0]
