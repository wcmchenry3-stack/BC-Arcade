"""Round 24: two music BED prototypes for Star Swarm, no licensed input recordings.
Reuses only project-original Round 15A procedural audio; adds original motion treatments.
A: irregular electromagnetic ostinato; B: quicker harmonic movement and countermelody.
Not a mastered in-game score, event-synced cue, or release asset.
"""
from pathlib import Path
import numpy as np, soundfile as sf, subprocess
from scipy.signal import butter, sosfilt
P=Path(__file__).resolve().parent
SR=24000
D=56
N=D*SR
T=np.arange(N,dtype=np.float64)/SR
rng=np.random.default_rng(2401)

def decode(path):
    raw=subprocess.check_output(['ffmpeg','-loglevel','error','-i',str(path),'-f','f32le','-ac','2','-ar',str(SR),'-'])
    x=np.frombuffer(raw,dtype='<f4').reshape(-1,2).T.copy()
    return x[:,:N]

def sm(x):
    x=np.clip(x,0,1)
    return x*x*(3-2*x)

def f(note):return 440*2**((note-69)/12)

def note(x,pitch,start,duration,amp,seed,attack=.035,rel=.38,darker=0.27,pan=0.5,hold=False):
    i0=int(max(0,start)*SR); i1=min(N,int((start+duration)*SR))
    if i1<=i0:return
    local=np.arange(i1-i0,dtype=np.float64)/SR
    globalt=local+start
    rand=np.random.default_rng(seed)
    vib=.0018*np.sin(2*np.pi*.39*globalt+.71*seed)+.00095*np.sin(2*np.pi*1.19*globalt+.1*seed)
    frequency=f(pitch)*(1+vib)
    phase=np.cumsum(frequency)*(2*np.pi/SR)+rand.uniform(0,2*np.pi)
    y=np.sin(phase)+.29*np.sin(2*phase+.4)+darker*np.sin(1.41421356*phase+.61)+.09*np.sin(2.71*phase)
    if hold:
        envelope=sm(local/attack)*sm((duration-local)/rel)
    else:
        envelope=sm(local/attack)*(.28+.72*np.exp(-local/(duration*.42)))*sm((duration-local)/rel)
    y*=amp*envelope
    x[0,i0:i1]+=(y*np.sqrt(2*(1-pan))).astype('float32')
    x[1,i0:i1]+=(y*np.sqrt(2*pan)).astype('float32')

def echo(x,amount=.11):
    out=x.copy()
    for ch in (0,1):
        dry=x[1-ch]
        for sec,g in ((.13+.08*ch,.08),(.37+.1*ch,.055),(.81+.13*ch,.045)):
            k=int(sec*SR);out[ch,k:]+=dry[:-k]*(g*amount/.11)
    return out

def common():
    # The source is OUR OWN independently generated prototype, not one of four third-party tracks.
    bed=decode(P/'starswarm-round15-A-patrol-momentum.mp3')
    # Let new pulses/voices speak without abandoning the reference's mysterious, dark-space voice.
    bed*=.57
    # Small evolving gain pattern rather than blanket compressor; keep forward motion through dips.
    movement=np.interp(T,[0,6,12,18,24,31,38,44,50,56],[1.05,.87,.98,.82,1.06,.83,1.04,.78,1.07,.91])
    return bed*movement[None,:].astype('float32')

def make_a():
    x=common()
    # Dark irregular four-beat-ish phrase in a low-mid register, approximately 108 BPM but displaced.
    # Intent is drive, not a drum-loop or metronome; vary omissions and passing notes.
    base=[43,46,50,48,42,46,51,48,43,47,51,49,41,46,50,48]
    beat=60/108
    for k in range(int(D/beat)+1):
        a=k*beat+(0.10 if k%8 in (3,7) else 0)
        if a>D-.18 or (k%16 in (5,13)):continue
        n=base[k%16]
        level=.0135 if k%4==0 else .0088 if k%2 else .011
        note(x,n,a,.78,level,12000+k,.012,.26,.42,.25 if k%2 else .72)
    # Occasional corresponding upper-register answer (not on every beat).
    for k,(a,n) in enumerate([(2.5,65),(7.1,63),(11.2,68),(16.3,66),(22.1,70),(26.9,67),(31.5,65),(36.9,71),(43.0,69),(48.7,72)]):
        note(x,n,a,3.3,.012,12500+k,.35,1.5,.35,.22 if k%2 else .8,True)
    return echo(x)

def make_b():
    x=common()
    # Same palette, more changes of harmonic gravity every ~4 seconds, less explicit pulse.
    # Harmonic centers are deliberately unresolved/suspended and never a conventional cheerful march.
    centers=[(0,43,[53,60,65]),(4,42,[54,59,63]),(8,46,[56,61,67]),(12,41,[51,57,64]),
             (16,45,[55,62,68]),(20,43,[53,60,66]),(24,47,[57,63,69]),(28,44,[54,61,67]),
             (32,42,[52,58,65]),(36,46,[56,63,70]),(40,41,[53,60,66]),(44,45,[55,61,68]),
             (48,44,[54,62,69]),(52,43,[53,60,65])]
    for j,(a,low,chord) in enumerate(centers):
        note(x,low,a,4.6,.018,13000+j,.08,1.1,.42,.34 if j%2 else .67,True)
        note(x,chord[0],a+.38,3.7,.012,13100+j,.10,.95,.31,.76 if j%2 else .23,True)
        note(x,chord[1],a+1.05,3.2,.010,13200+j,.07,.8,.44,.35 if j%2 else .65,True)
        note(x,chord[2],a+2.05,2.4,.011,13300+j,.06,.66,.28,.8 if j%2 else .2,True)
    # Unrelenting, swaying higher inner movement with increasingly urgent interruptions.
    times=np.arange(.55,D-.2,.96)
    steps=[64,67,65,70,68,66,72,69,67,73,70,68]
    for k,a in enumerate(times):
        if k%11 in (6,7):continue
        n=steps[(k+(k//9))%len(steps)]
        note(x,n,float(a),1.35,.0065 if k%3 else .010,14000+k,.035,.48,.29,.18 if k%2 else .82)
    return echo(x)

def save(name,x):
    # Shared scaling, no dynamic compression; protect transients and don't crush musical breathing.
    wav=P/(name+'.wav'); dest=P/(name+'.mp3')
    sf.write(str(wav),x.T,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(wav),'-c:a','libmp3lame','-b:a','128k',str(dest)],check=True)
    wav.unlink()
    return dest

if __name__=='__main__':
    a=make_a(); b=make_b()
    maxpeak=max(np.max(abs(a)),np.max(abs(b)))
    maxrms=max(np.sqrt(np.mean(a*a)),np.sqrt(np.mean(b*b)))
    gain=min(.8/maxpeak,.094/maxrms)
    print('shared gain',gain)
    for name,x in [('starswarm-round24-A-electromagnetic-pulse',a),('starswarm-round24-B-relentless-harmonic-motion',b)]:
        path=save(name,x*gain)
        print(path,path.stat().st_size,'rms',np.sqrt(np.mean((x*gain)**2)))