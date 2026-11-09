"""Star Swarm Round 23: independent 7-minute integrated original-audio rough.

Uses ONLY earlier in-house generated demos, NOT external reference music. The approved
Round 22 blending gestures inform transitions; this is not a gameplay-synced score.
Audition only; does not modify the game, author source assets, or pass release checks.
"""
from pathlib import Path
import numpy as np, soundfile as sf, subprocess, tempfile
from scipy.signal import butter, sosfilt

ROOT=Path('/mnt/data'); SR=24000; DUR=420; N=SR*DUR

def decode(filename):
    p=subprocess.run(['ffmpeg','-v','error','-i',str(ROOT/filename),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()
def ease(x):
    x=np.clip(x,0,1);return x*x*(3-2*x)
def extract(a,at,length):
    out=np.zeros((2,int(length*SR)),np.float32);i=int(at*SR);s=a[:,i:i+out.shape[1]];out[:,:s.shape[1]]=s;return out

def layer(x,clip,at,attack=8,release=9,level=1):
    i=int(at*SR);length=min(clip.shape[1],N-i);t=np.arange(length)/SR
    env=ease(t/attack)*ease((length/SR-t)/release)
    x[:,i:i+length]+=clip[:,:length]*(level*env)[None,:]

def feature(x,clip,at,enter=12,exit=12,weight=.9):
    """Soft, gradual substitution so foreground gestures enter with aural context.
    Underlying bed remains audible; clip itself contains approved musical context.
    """
    i=int(at*SR);length=min(clip.shape[1],N-i);t=np.arange(length)/SR
    w=weight*ease(t/enter)*ease((length/SR-t)/exit)
    x[:,i:i+length]=x[:,i:i+length]*(1-w[None,:])+clip[:,:length]*w[None,:]

def tone(x,midi,start,end,amp,seed=10,mod=.6):
    i=int(start*SR);j=int(end*SR);t=np.arange(j-i,dtype=np.float64)/SR
    freq=440*2**((midi-69)/12);env=ease(t/2)*ease((end-start-t)/4)
    rr=np.random.default_rng(seed)
    for ch in (0,1):
        drift=1+.0007*np.sin(t*.67+seed+ch)+.0023*np.sin(t*.19+ch*1.9)
        ph=np.cumsum(freq*drift)*(2*np.pi/SR)+rr.uniform(0,6.28)
        wav=np.sin(ph)+.20*np.sin(2*ph+.7)+.25*np.sin(1.414*ph)+.08*np.sin(2.61*ph)
        wav*=.89+.11*np.sin(t*.6+ch*.7)+.06*mod*np.sin(t*1.12+seed)
        x[ch,i:j]+=(amp*env*wav).astype('float32')

def shepard(x,start,length,amp=.0028,rate=.11):
    i=int(start*SR);j=int((start+length)*SR)
    t=np.arange(j-i,dtype=np.float64)/SR
    for octave in range(-3,6):
        frequency=290*2**(octave-rate*t)
        weight=np.exp(-.5*(np.log2(frequency/380)/.95)**2)
        env=ease(t/4)*ease((length-t)/4)
        for ch in (0,1):
            ph=np.cumsum(frequency*(1+.0004*ch))*2*np.pi/SR+octave*.82+ch*.5
            x[ch,i:j]+=(amp*weight*env*np.sin(ph)).astype('float32')

def cross_seam(x,sec=8):
    # Preserve the energetic opening but ease its timbre into the end.
    # This is an audition-only PCM seam check; MP3 gapless playback must be tested.
    l=int(sec*SR);w=ease(np.arange(l)/(l-1)).astype(np.float32)
    x[:,-l:]=x[:,-l:]*(1-w)[None,:]+x[:,:l]*w[None,:]
    # Last 0.15sec toward the first instant prevents a hard sample jump.
    q=int(.15*SR);w=ease(np.arange(q)/(q-1));x[:,-q:]=x[:,-q:]*(1-w)[None,:]+x[:,:1]*w[None,:]

def main():
    main=decode('starswarm-round17-A-electromagnetic-expansion.mp3')
    old=decode('starswarm-round21-full-rough.mp3')
    rise=decode('starswarm-round22-A-astronomical-entrance.mp3')
    signalchorus=decode('starswarm-round22-B-signals-to-swarm.mp3')
    chorusB=decode('starswarm-round18-B-electromagnetic-choir.mp3')
    organ=decode('starswarm-round19-B-distant-organ.mp3')
    x=np.zeros((2,N),np.float32)

    # Long original electromagnetic phrases and sound-world, with recycled gestures
    # appearing in altered surroundings rather than copied hard-separated chapters.
    x[:,:230*SR]=extract(main,0,230)
    layer(x,extract(main,122,105),208,attack=19,release=19,level=.74)
    layer(x,extract(main,36,115),289,attack=16,release=25,level=.75)
    layer(x,extract(main,154,50),370,attack=12,release=12,level=.69)
    layer(x,extract(old,315,65),316,attack=16,release=16,level=.53)

    # New contrapuntal trajectories keep the latter half from being repeated static beds.
    events=[(56,216,245,.015),(61,228,266,.017),(65,249,274,.011),
            (58,265,290,.020),(62,281,309,.013),(67,298,334,.011),
            (55,319,349,.020),(63,335,370,.015),(60,358,391,.014),
            (57,379,411,.017),(64,390,418,.014)]
    for k,(note,a,b,v) in enumerate(events):tone(x,note,a,b,v,seed=560+k)
    # Rhythmic, quiet movement. Ensure no quiet gap between long-form phrases.
    tick=235.;k=0;seq=[2.4,3.3,2.0,2.9,3.1];pitch=[44,47,43,50,46,48,45]
    while tick<411:
        if not 333<tick<348:
            tone(x,pitch[k%len(pitch)],tick,min(420,tick+2.4),.0055,seed=1100+k)
        tick+=seq[k%len(seq)];k+=1

    # Newly approved A: 63 sec flowing in and out around the existing score.
    # The Round 22 entrance begins ~11 s into this clip, rising ~20-40 s.
    feature(x,rise,at=72,enter=11,exit=14,weight=.94)
    # Different shorter astronomical appearance late in piece: only a modest
    # distinctive interval, not the same feature twice verbatim.
    feature(x,extract(rise,11,40),at=326,enter=13,exit=15,weight=.54)

    # First chorus: the Round 22 signal->swarm transformation rather than a
    # robotic chapter and a chorus chapter. It enters the composition slowly.
    feature(x,signalchorus,at=155,enter=11,exit=12,weight=.94)
    # Second choir gets an alternate entrance; no duplicated robotic sequence.
    # First quiet organ color establishes a shared harmonic bridge.
    layer(x,extract(organ,0,36),at=269,attack=13,release=17,level=.25)
    feature(x,chorusB,at=293,enter=13,exit=13,weight=.81)
    # Reprise a modest wandering organ color later but keep its timbre elusive.
    layer(x,extract(organ,4,38),at=380,attack=14,release=14,level=.16)

    # Use occasional downward Shepard gestures in unrelated phrases, well separated
    # from foreground astronomical rises. Original first 230s retains prior falls.
    shepard(x,250,20,amp=.0028,rate=.10)
    shepard(x,371,18,amp=.0027,rate=.13)

    # Gentle final/first timbral hand-off. Need final device-specific loop verification.
    cross_seam(x,sec=7)
    peak=float(np.max(np.abs(x))); rms=float(np.sqrt(np.mean(x*x)))
    gain=min(.87/max(peak,1e-9),.087/max(rms,1e-9));x*=gain
    output=ROOT/'starswarm-round23-integrated-rough.mp3'
    with tempfile.NamedTemporaryFile(suffix='.wav') as f:
        sf.write(f.name,x.T,SR,subtype='PCM_16')
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',f.name,'-c:a','libmp3lame','-b:a','112k',str(output)],check=True)
    print(output,output.stat().st_size,'rms',float(np.sqrt(np.mean(x*x))), 'peak',float(np.max(np.abs(x))))
    print('PCM end/start sample discontinuity',float(np.max(np.abs(x[:,-1]-x[:,0]))))

if __name__=='__main__':main()
