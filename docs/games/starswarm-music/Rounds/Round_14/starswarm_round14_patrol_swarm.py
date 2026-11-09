"""Round 14: original procedural armed-patrol sci-fi score auditions.
Inspired by narrative and abstract audiovisual qualities, no third party source audio used.
Two 56s treatments: readiness and restrained dread, versus approaching swarm presence.
"""
from pathlib import Path
import numpy as np, soundfile as sf, subprocess
from scipy.signal import butter,sosfilt
SR=24000; DUR=56; D=DUR; N=SR*DUR; t=np.arange(N,dtype=np.float32)/SR; out=Path('/mnt/data')
def smooth(x): x=np.clip(x,0,1);return x*x*(3-2*x)
def gate(a,b,attack=.25,release=2.5): return smooth((t-a)/attack)*smooth((b-t)/release)
def pitch(n): return 440.*2**((n-69)/12)
def voice(x,n,a,b,level,seed,det=.018,inh=.27,beat=.0,atk=.25,release=2.6,wide=.13):
    i0=max(0,int(a*SR));i1=min(N,int(b*SR));q=t[i0:i1];rng=np.random.default_rng(seed);ln=len(q)
    if not ln:return
    e=smooth((q-a)/atk)*smooth((b-q)/release)
    for ch in (0,1):
        wobble=det*(.45*np.sin(q*.36+seed*.2+ch)+.25*np.sin(q*1.21+ch*1.8))
        f=pitch(n)*(1+.0015*ch+wobble*.022)
        ph=np.cumsum(f,dtype=np.float64)*(2*np.pi/SR)+rng.uniform(0,6.28)
        shimmer=.65+.35*np.sin(2*np.pi*(.27+ch*.07)*q+seed)
        y=(np.sin(ph)+.25*shimmer*np.sin(2*ph+.7)+inh*shimmer*np.sin(1.4142*ph+.4)+.10*np.sin(2.72*ph+1.1))
        pulse=1+beat*(.55*np.sin(2*np.pi*.91*q+seed*.7)+.25*np.sin(2*np.pi*1.73*q+ch))
        x[ch,i0:i1]+=(e*level*y*pulse*(1+wide*(ch-.5))).astype(np.float32)
def filtered(seed,low,high):
    rng=np.random.default_rng(seed);y=rng.standard_normal(N).astype(np.float32)
    y=sosfilt(butter(2,low,fs=SR,btype='highpass',output='sos'),y)
    y=sosfilt(butter(2,high,fs=SR,btype='lowpass',output='sos'),y)
    return y.astype(np.float32)/(np.sqrt(np.mean(y*y))+1e-12)
def foundation():
    x=np.zeros((2,N),np.float32)
    # The original, immediately recognizable unsettled space palette; not a recording copy.
    for j,(n,level,inh) in enumerate([(31,.071,.15),(43,.042,.30),(50,.035,.22),(44,.017,.38),(54,.013,.26)]):
        voice(x,n,0,D,level,120+j,inh=inh,beat=.19,atk=.05,release=.7)
    for ch in (0,1):
        rng=np.random.default_rng(220+ch)
        knots=np.arange(0,D+2,.91);level=np.interp(t,knots,rng.uniform(.22,.81,len(knots)))
        x[ch]+=filtered(360+ch,70,310)*level*.00165
        knots2=np.arange(0,D+2,1.39);level2=np.interp(t,knots2,rng.uniform(.25,.85,len(knots2)))
        x[ch]+=filtered(380+ch,940,5700)*level2*.00115
    return x

def composition(which):
    x=foundation()
    # Assertive patrol/military resolve, but uneasy suspended phrasing rather than a heroic triad.
    notes=[(62,0,8,.034),(66,2,7,.021),(61,8,15,.024),(59,13,21,.031),
           (63,19,27,.031),(68,25,34,.032),(64,30,39,.032),
           (60,36,46,.034),(65,42,54,.038),
           (73,1,5,.012),(71,10,15,.012),(75,20,25,.013),(72,29,34,.014),(77,42,49,.013)]
    for k,(n,a,b,v) in enumerate(notes): voice(x,n,a,b,v,420+k,inh=.22+.05*(k%3),beat=.20,atk=.09 if a<2 else .45,release=2.0)
    # A metrical sense of intent, but no literal drums. Irregular taps are pitched through the very same sci-fi synthesis.
    for k,a in enumerate([0.2,2.0,4.2,7.2,9.4,11.0,13.9,16.3,18.1,21.5,23.7,26.4,29.0,31.2,34.5,37.6,40.0,43.1,45.3,48.5,51.2]):
        voice(x,[43,47,42,45][k%4],a,a+2.3,.011 if which=='A' else .009,710+k,inh=.34,beat=.18,atk=.012,release=1.8)
    # Some decisive movement then deliberate restraint, without pausing actual game action.
    env=[(0,1.09),(3,1.15),(7,.91),(11,.74),(15,.86),(20,1.10),(24,1.18),(28,.89),(32,.75),(36,.93),(42,1.16),(47,1.08),(52,1.21),(55,1.08),(56,.92)]
    x*=np.interp(t,*zip(*env)).astype(np.float32)[None,:]
    if which=='B':
        # The swarm is NOT a conventional identifiable chorus. Detuned members emerge with
        # staggered entrances, independent spatial drift and gradual formant-like filtering.
        sw=np.zeros_like(x)
        rng=np.random.default_rng(1414)
        for j in range(16):
            n=int(rng.choice([55,56,58,61,62,65,68,70,73,74]))
            a=float(rng.uniform(16,31));b=float(min(D-.5,a+rng.uniform(14,28)))
            voice(sw,n,a,b,float(rng.uniform(.0018,.0045)),820+j,
                  inh=float(rng.uniform(.25,.50)),beat=float(rng.uniform(.08,.26)),
                  atk=float(rng.uniform(2.5,5)),release=float(rng.uniform(2.5,5)),wide=.45)
        # Staggered chorus gathers then retreats, leaving several voices unresolved.
        crescendo=np.interp(t,[0,13,20,28,35,42,47,56],[0,0,.30,.58,1.0,.81,.24,.1]).astype(np.float32)
        x+=sw*crescendo[None,:]*1.5
    # Distinct ambient reflections; keep dry detail and actionable foreground alive.
    for ch in (0,1):
        dry=x[ch].copy()
        for delay,gain in [(0.29+.07*ch,.13),(0.87+.16*ch,.105),(1.66+.27*ch,.078),(2.95+.39*ch,.045)]:
            d=int(delay*SR);x[ch,d:]+=dry[:-d]*gain
    x*=smooth((D-t)/1.1)[None,:]
    return x

def write(which,x,g):
    name='starswarm-round14-'+which+('-armed-patrol' if which=='A' else '-swarm-contact')
    wav=out/(name+'.wav');mp3=out/(name+'.mp3');sf.write(wav,(x*g).T,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(wav),'-c:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
    wav.unlink();print(mp3,'bytes=',mp3.stat().st_size,'rms=',round(float(np.sqrt(np.mean((x*g)**2))),4))
if __name__=='__main__':
    a=composition('A');b=composition('B')
    g=min(.088/(np.sqrt(np.mean(a[:,:53*SR]**2))+1e-9),.088/(np.sqrt(np.mean(b[:,:53*SR]**2))+1e-9),.80/(max(float(np.max(abs(a))),float(np.max(abs(b))))+1e-9))
    write('A',a,g);write('B',b,g)
