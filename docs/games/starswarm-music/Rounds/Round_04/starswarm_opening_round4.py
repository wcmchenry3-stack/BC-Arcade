"""Round 4: Original Star Swarm 'already alive' concept sketches. Standalone, no sample inputs."""
import numpy as np
from scipy.signal import butter,sosfilt,fftconvolve
from pathlib import Path
import soundfile as sf,subprocess
SR=24000; DUR=38; N=SR*DUR; t=np.arange(N)/SR; OUT=Path('/mnt/data')
def f(n):return 440*2**((n-69)/12)
def fade(a,b,attack=.3,release=2):
    up=np.sin(np.pi/2*np.clip((t-a)/attack,0,1))**2
    dn=np.sin(np.pi/2*np.clip((b-t)/release,0,1))**2
    return up*dn*(t>=a)*(t<b)
def tone(note,a,b,amp=.05,seed=1,clarity=.35):
    rng=np.random.default_rng(seed); out=np.zeros((2,N),dtype=np.float32)
    e=fade(a,b,.3 if a<=0 else 1.6,2.8)
    for ch in range(2):
        sig=np.zeros(N,dtype=np.float32)
        for v in range(4):
            det=rng.uniform(-.002,.002)
            wobble=.0007*np.sin(2*np.pi*(.11+v*.013)*t+v+ch)
            phase=2*np.pi*np.cumsum(f(note)*(1+det+wobble))/SR+rng.uniform(0,6.28)
            sig+=(np.sin(phase)+clarity*np.sin(2*phase+.2)+.1*np.sin(3*phase))/(v+1)**.8
        out[ch]=(sig/3)*amp*e
    return out
def noise_band(seed,low=300,high=5500):
    rng=np.random.default_rng(seed)
    raw=rng.standard_normal(N)
    hp=sosfilt(butter(2,low,btype='highpass',fs=SR,output='sos'),raw)
    return sosfilt(butter(2,high,btype='lowpass',fs=SR,output='sos'),hp)
def glint(x,at,dur=5,amp=.012,seed=1):
    u=np.clip(t-at,0,dur)
    a=fade(at,at+dur,.3,2)
    # angular non-regular metallic harmonic object, emerges from background not shot noise
    frequency=390+44*np.sin(2*np.pi*.31*u)+16*np.sin(2*np.pi*.79*u)
    ph=2*np.pi*np.cumsum(frequency)/SR
    sig=(np.sin(ph+2.0*np.sin(2*np.pi*3.3*u))+.38*np.sin(ph*1.61))*a
    x[0]+=amp*sig;x[1]+=.8*amp*np.roll(sig,251)
def render(mode):
    x=np.zeros((2,N),dtype=np.float32)
    if mode=='motion':
        # Start inside a moving, dissonance-tinged suspended harmony: the low root is already present.
        notes=[(43,0,37,.087),(50,0,35,.052),(57,0,14,.055),(62,0,17,.036),
               (59,0,9,.026),(60,3,14,.042),(64,7,19,.028),(65,10,25,.045),
               (56,14,30,.037),(53,18,37,.041),(60,24,38,.047),(68,26,38,.030)]
        for k,(n,a,b,v) in enumerate(notes):x+=tone(n,a,b,v,300+k)
        # understated urgent repeated inner motion, not drums: phrases are asymmetrical and fade in/out
        for k,(a,n,dur) in enumerate([(0,69,2.3),(2.1,67,2.4),(4.6,65,3.1),(7.8,68,3.1),(11,66,4),(15.8,65,4.8),(21.2,63,5)]):
            x+=tone(n,a,a+dur,.010,900+k,clarity=.55)
        glint(x,10.3,6.2,.016,1001)
        glint(x,27.4,5,.009,1002)
    else:
        # Recompose the hopeful/twisted later A2 material as a phrase already underway.
        notes=[(48,0,34,.067),(55,0,36,.053),(62,0,21,.039),(65,0,20,.043),
               (56,0,13,.028),(68,2,16,.035),(60,4,25,.033),(66,8,23,.034),
               (71,12,29,.039),(61,16,36,.043),(53,19,38,.045),(58,25,38,.043),
               (73,28,38,.027)]
        for k,(n,a,b,v) in enumerate(notes):x+=tone(n,a,b,v,1100+k)
        # rising/falling counterline creates a question, without a conventional lead melody
        for k,(a,n) in enumerate([(0,74),(3.5,71),(7.1,69),(11.1,73),(15,70),(20,68),(24,71)]):
            x+=tone(n,a,a+6,.013,1400+k,clarity=.22)
        glint(x,11.2,6,.011,1500)
    # Motion within space.  This is irregular granular air, not a surf-like swell.
    for ch in (0,1):
        n=noise_band(2900+ch,350,7400);n/=np.std(n)+1e-9
        rng=np.random.default_rng(3000+ch)
        anchors=np.arange(0,DUR+2,2)
        levels=rng.uniform(.3,1,len(anchors))
        movement=np.interp(t,anchors,levels)
        x[ch]+=.0029*n*movement
        # subtle periodic-free reverberant echoes with irregular delays
        dry=x[ch].copy()
        for delay,gain in [(0.19,.11),(0.47,.09),(1.13,.07),(2.07,.055)]:
            d=int(delay*SR);x[ch,d:]+=dry[:-d]*gain
    # Motional macro dynamics, no leveling
    x*= (0.82+.1*np.sin(2*np.pi*(t/24+.17))+.05*np.sin(2*np.pi*t/7.9))[None,:]
    x*=fade(0,DUR,.07,1.2)[None,:]
    # Loudness-match approximately using RMS, with safe peak
    target=.079
    x*=target/(np.sqrt(np.mean(x*x))+1e-9)
    x*=min(1,.91/(np.max(np.abs(x))+1e-9))
    name='starswarm-round4-'+('A-already-in-motion' if mode=='motion' else 'B-beyond-the-horizon')
    wav=OUT/(name+'.wav');mp3=OUT/(name+'.mp3')
    sf.write(wav,x.T,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
    wav.unlink();print(mp3,mp3.stat().st_size)
for m in ('motion','horizon'):render(m)
