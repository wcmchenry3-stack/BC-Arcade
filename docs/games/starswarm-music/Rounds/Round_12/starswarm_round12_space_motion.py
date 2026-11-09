"""Round 12: original procedural sci-fi timbre with two levels of dramatic motion.
No samples from the source references; auditions only, not release assets.
"""
from pathlib import Path
import subprocess
import numpy as np
import soundfile as sf
from scipy.signal import butter,sosfilt
SR=24000; D=56.; N=int(SR*D); T=np.arange(N,dtype=np.float64)/SR; OUT=Path('/mnt/data')

def ramp(a,b):
 u=np.clip((T-a)/max(.0001,b-a),0,1);return u*u*(3-2*u)
def gate(a,b,attack=.15,release=2.): return ramp(a,a+attack)*(1-ramp(b-release,b))
def hz(m):return 440*2**((m-69)/12)
def put(x,m,a,b,level,seed,inharm=.20,brightness=.15,atk=.15,rel=3.,activity=.0):
 """Inharmonic, independently detuned partial voices; activity is moving timbre not new instrument."""
 i0=max(0,int(a*SR));i1=min(N,int(b*SR));tt=T[i0:i1];rng=np.random.default_rng(seed)
 if i1<=i0:return
 u=np.clip((tt-a)/max(.001,atk),0,1);v=np.clip((b-tt)/max(.001,rel),0,1)
 e=(u*u*(3-2*u))*(v*v*(3-2*v))
 for ch in range(2):
  p0=rng.uniform(0,6.28);p1=rng.uniform(0,6.28)
  df=.0032*np.sin(2*np.pi*(.067+.008*ch)*tt+p0)+.0014*np.sin(2*np.pi*(.19+.021*ch)*tt+p1)
  f=hz(m)*(1+df+.0008*(ch-.5));ph=2*np.pi*np.cumsum(f)/SR+rng.uniform(0,6.28)
  tim=.77+.23*np.sin(2*np.pi*(.31+.057*ch)*tt+rng.uniform(0,6.28))
  # Slightly asymmetrical, fast evolving overtone content creates forward motion without drums.
  flutter=1+activity*(.28*np.sin(2*np.pi*.93*tt+.25*ch)+.22*np.sin(2*np.pi*1.63*tt+.7*ch))
  y=np.sin(ph)+brightness*(.75+.25*tim)*np.sin(2*ph+.8)+inharm*(.65+.35*tim)*np.sin(1.41421356*ph+.35)
  x[ch,i0:i1]+=(level*e*flutter*y).astype(np.float32)
def noise(seed,lo,hi):
 rng=np.random.default_rng(seed);n=rng.standard_normal(N)
 n=sosfilt(butter(2,lo,fs=SR,btype='highpass',output='sos'),n)
 n=sosfilt(butter(2,hi,fs=SR,btype='lowpass',output='sos'),n)
 return (n/(np.sqrt(np.mean(n*n))+1e-12)).astype(np.float32)
def bed():
 x=np.zeros((2,N),np.float32)
 # The sci-fi vocabulary approved in R5B: unsettled G, Ab, F#, D, unlike traditional major/minor pads.
 for j,(m,a,b,l,ih) in enumerate([(31,0,56,.084,.11),(43,0,56,.040,.25),(50,0,56,.035,.18),
    (44,0,24,.014,.37),(54,0,18,.016,.29),(56,13,40,.016,.32),(51,29,56,.015,.28)]):
  put(x,m,a,b,l,100+j,ih,brightness=.14,atk=.027 if a==0 else 2.8,rel=4,activity=.14)
 for c in range(2):
  rng=np.random.default_rng(800+c)
  # Gradual irregular texture, rather than breathing/ocean surf.
  knots=np.arange(0,D+2,.71)
  lev=np.interp(T,knots,rng.uniform(.18,1,len(knots)))
  x[c]+=noise(200+c,42,180)*lev*.0036
  knots2=np.arange(0,D+2,1.17)
  lev2=np.interp(T,knots2,rng.uniform(.14,.86,len(knots2)))
  x[c]+=noise(400+c,1150,7600)*lev2*.0020
 return x

def compose(mode):
 x=bed()
 # A's changes are sparse inner-voice trajectories, never warm dominant triads.
 events=[(62,0,9,.025),(60,6,16,.025),(61,12,25,.025),(65,20,34,.026),(63,29,42,.026),(66,39,55,.029),
         (70,1.1,6.3,.008),(68,9.4,13.5,.009),(71,17.7,22.0,.009),(69,29.6,33.7,.009),(73,45.1,50.3,.010)]
 if mode=='B':
  # B is more directed, with contrapuntal rises and controlled registral hand-offs, but same alien spectral palette.
  events += [(59,3,13,.018),(57,12,22,.017),(58,22,32,.017),(55,34,44,.018),(60,44,56,.020),
             (75,5,10,.009),(72,15,20,.009),(76,24,31,.010),(74,35,42,.010),(77,47,54,.011)]
 for k,(m,a,b,v) in enumerate(events):
  put(x,m,a,b,v,1000+k,.23 if k%3 else .35,.16 if k%2 else .21,
      atk=.05 if a<2 else (.55 if mode=='B' else 1.35),rel=2.3,activity=.23 if mode=='A' else .35)
 # Distinct section shape without new pasted-on FX: initial assertion, withdrawal, renewed development.
 if mode=='A':
  points=[(0,1.10),(2,1.09),(7,.91),(10,.68),(13,.72),(19,1.0),(25,1.10),(30,.82),(35,.86),(42,1.10),(49,1.15),(55,1.01),(56,.95)]
 else:
  points=[(0,1.12),(2,1.14),(6,.96),(9,.62),(12,.70),(18,1.07),(23,1.17),(27,.87),(31,.72),(35,.95),(41,1.15),(45,.92),(50,1.24),(54,1.13),(56,.98)]
 x*=np.interp(T,*zip(*points)).astype(np.float32)[None,:]
 # Different quiet and wide reflections for a sense of distance, keeping a defined sonic center.
 for ch in range(2):
  dry=x[ch].copy()
  for delay,gain in [(0.28+.04*ch,.14),(0.85+.15*ch,.105),(1.83+.19*ch,.07),(3.12+.28*ch,.04)]:
   n=int(delay*SR);x[ch,n:]+=gain*dry[:-n]
 x*= (1-ramp(54.7,56))[None,:].astype(np.float32)
 return x

def write(name,arr,gain):
 arr=arr*gain
 wav=OUT/(name+'.wav');mp3=OUT/(name+'.mp3')
 sf.write(wav,arr.T,SR,subtype='PCM_16')
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-c:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
 wav.unlink(); print(name,mp3.stat().st_size,'bytes',round(float(np.sqrt(np.mean(arr**2))),4),'RMS',round(float(np.max(np.abs(arr))),3),'peak')
if __name__=='__main__':
 a=compose('A');b=compose('B')
 # Align to a shared active RMS, preserve dynamic differences; constrain peaks uniformly.
 target=.095
 g=min(target/(np.sqrt(np.mean(a[:,:54*SR]**2))+1e-9),.88/(np.max(np.abs(a))+1e-9),
       target/(np.sqrt(np.mean(b[:,:54*SR]**2))+1e-9),.88/(np.max(np.abs(b))+1e-9))
 write('starswarm-round12-A-living-space-reawakened',a,g)
 write('starswarm-round12-B-cinematic-space-adventure',b,g)
