"""Star Swarm Round 20 — foreground astronomical rise and robotic sequence auditions.
Entirely original synthetic additions over the project's original Round 17A bed.
No third-party reference tracks are read, sampled or transcribed. Audition-only.
"""
from pathlib import Path
import numpy as np, subprocess, tempfile, soundfile as sf
from scipy.signal import butter, sosfilt
P=Path('/mnt/data'); SR=24000; D=48; N=SR*D
T=np.arange(N,dtype=np.float32)/SR

def sm(x):
    z=np.clip(x,0.,1.); return z*z*(3-2*z)
def decode(path):
    p=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()
def bp_noise(seed,lo,hi,n):
    gen=np.random.default_rng(seed); noise=gen.normal(0,1,n).astype(np.float32)
    return sosfilt(butter(2,[lo,hi],fs=SR,btype='bandpass',output='sos'),noise).astype(np.float32)
def add_pan(dest, sig, i, p):
    j=min(i+len(sig),N); sig=sig[:j-i];
    if np.isscalar(p):
        dest[0,i:j]+=sig*np.sqrt(2*(1-p));dest[1,i:j]+=sig*np.sqrt(2*p)
    else:
        p=p[:j-i];dest[0,i:j]+=sig*np.sqrt(2*(1-p));dest[1,i:j]+=sig*np.sqrt(2*p)
def echo(layer):
    for c in range(2):
        dry=layer[c].copy()
        for sec,g in [(0.21,.20),(0.63,.15),(1.4,.11),(2.3,.07)]:
            lag=int(SR*(sec+(0.08 if c else 0)))
            layer[c,lag:]+=dry[:-lag]*g
    return layer

# Project-generated original Round 17A excerpt, no reference/source recording.
src=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')
base=src[:,int(72*SR):int(72*SR)+N].copy()
assert base.shape==(2,N)

def rise():
    """Main harmony actively withdraws so upward astronomical gesture temporarily owns the foreground."""
    layer=np.zeros_like(base)
    # Distinctive, spacious polyphonic upward movement rather than endless descending Shepard effect.
    # Two related overlapping lines, more than doubling frequency; use soft leading harmonics and airy overtones.
    for k,(start,dur,freq,amp,octaves) in enumerate([(9.,16.5,120.,.058,1.15),(14.5,13.0,182.,.035,.85)]):
        i=int(start*SR);j=min(N,int((start+dur)*SR));tt=T[i:j]-start; progress=tt/dur
        f=freq*np.exp2(octaves*sm(progress))*(1+.0017*np.sin(2*np.pi*.23*tt+.4*k))
        phase=np.cumsum(f,dtype=np.float64)*(2*np.pi/SR)
        env=sm(tt/2.3)*sm((dur-tt)/3.5)
        for h in [1,2,3,4,5,6]:
            spectral=(1/h**1.25)*(1+.08*np.sin(2*np.pi*(.16+.015*h)*tt+.8*h))
            sig=(np.sin(phase*h+.6*h)*env*spectral*amp).astype(np.float32)
            pan=.5+.32*np.sin(.23*tt+1.3*k+.4*h)
            add_pan(layer,sig,i,pan)
    # Sparse bright trails as short, independently positioned spatial events (not prominent gunfire).
    for k,(start,dur) in enumerate([(18.4,.7),(23.0,1.0),(27.2,.55)]):
        i=int(start*SR);j=min(N,int((start+dur)*SR));tt=T[i:j]-start
        airy=bp_noise(2010+k,1000,4300,j-i)
        freq=1900*np.exp2(-.45*tt/dur)
        ph=np.cumsum(freq)*2*np.pi/SR
        sig=(.005*airy+.002*np.sin(ph))*sm(tt/.08)*np.exp(-4*tt/dur)
        add_pan(layer,sig.astype(np.float32),i,[.13,.82,.42][k])
    echo(layer)
    # Dramatic dip: almost nothing but rise is present at the peak, then deliberate return.
    spotlight=sm((T-9)/3.8)*sm((31.5-T)/5.)
    gain=1-.86*spotlight
    return base*gain[None,:]+layer

def signals():
    """Clearly audible strange foreground robotic phrases, with several different gestures."""
    layer=np.zeros_like(base)
    # Prepare with a recognizable repeated, displaced calling pattern (not 'surf' periodic broadband noise).
    events=[
        # start,dur,f0,brightness,kind,amp,pan
        (8.8,3.1,148.,.25,0,.035,.22),
        (13.7,4.4,110.,.55,1,.045,.79),
        (19.2,3.8,176.,.85,2,.050,.30),
        (24.0,5.2,95.,.75,3,.069,.66),
        (30.3,3.5,213.,.90,2,.061,.82),
        (34.5,5.3,132.,.42,1,.060,.37),
    ]
    for k,(start,dur,f0,bright,kind,amp,pan) in enumerate(events):
        i=int(start*SR);j=min(N,int((start+dur)*SR));tt=T[i:j]-start; p=tt/dur
        # Small, structurally different contours: pitch searches, stepped metallic phrases, modulated alien vocal tones.
        if kind==0: f=f0*(1-.13*p+.028*np.sin(2*np.pi*2.2*tt))
        elif kind==1: f=f0*(1+.11*sm((tt-.5)/1.5)-.18*sm((tt-2.)/1.5))*(1+.016*np.sin(2*np.pi*4.3*tt))
        elif kind==2: f=f0*(1+.17*sm((tt-.4)/1.0))*(1+.04*np.sin(2*np.pi*(.7+1.4*p)*tt))
        else: f=f0*(1-.08*p)*(1+.018*np.sin(2*np.pi*6.0*tt))
        phase=np.cumsum(f,dtype=np.float64)*2*np.pi/SR
        env=sm(tt/.18)*sm((dur-tt)/.7)
        # Inharmonic, formant-like synthetic energy distinct from a pure sine or conventional choir.
        sig=(.50*np.sin(phase)+(.22+.23*bright)*np.sin(1.73*phase+.4)+
             (.15+.22*bright)*np.sin(2.46*phase+.7)+.20*bright*np.sin(3.91*phase+.2))
        # Crisp, varied spectral activity with a stable sense of machinery; no wave-type noise envelopes.
        trem=(.84+.16*np.sin(2*np.pi*(3.0+.7*kind)*tt+k*.5))
        sig=(sig*env*trem*amp).astype(np.float32)
        moving=pan+.09*np.sin(2*np.pi*.22*tt+k)
        add_pan(layer,sig,i,np.clip(moving,.07,.93))
        if k in [2,3,4]:
            digital=bp_noise(2060+k,1500,4300,j-i)
            digital*=.005*env*(.4+.6*np.sin(2*np.pi*(4.+k)*tt)**2)
            add_pan(layer,digital.astype(np.float32),i,1-pan)
    echo(layer)
    # Accompaniment withdraws almost entirely in the strongest portion; no 'add effect at top' problem.
    duck=sm((T-10)/5)*sm((42-T)/5)
    bed_gain=1-.74*duck
    return base*bed_gain[None,:]+layer

A,B=rise(),signals()
# Both tests share final gain so lower levels do not bias the comparison.
max_peak=max(float(np.max(np.abs(y))) for y in [A,B]); gain=min(.90/max_peak,1.6)
for name,data in [('starswarm-round20-A-astronomical-spotlight',A),('starswarm-round20-B-signals-in-the-dark',B)]:
    dest=P/(name+'.mp3')
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        sf.write(tmp.name,(data*gain).T,SR,subtype='PCM_16')
        subprocess.run(['ffmpeg','-y','-v','error','-i',tmp.name,'-c:a','libmp3lame','-b:a','112k',str(dest)],check=True)
    if name.endswith("signals-in-the-dark"):
        with tempfile.NamedTemporaryFile(suffix=".mp3") as raised:
            subprocess.run(["ffmpeg","-y","-v","error","-i",str(dest),"-af","volume=1.3dB","-c:a","libmp3lame","-b:a","112k",raised.name],check=True)
            dest.write_bytes(Path(raised.name).read_bytes())
    print(dest, 'bytes',dest.stat().st_size,'pre-level RMS',float(np.sqrt(np.mean((data*gain)**2))))
