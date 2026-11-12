from pathlib import Path
import numpy as np, soundfile as sf, subprocess

P = Path("/mnt/data")
SR, DUR = 24000, 56
N = SR * DUR
rng = np.random.default_rng(2525)

# The only audio source is our previously synthesized Round 15A prototype.
raw = subprocess.check_output([
    "ffmpeg","-loglevel","error","-i",str(P/"starswarm-round15-A-patrol-momentum.mp3"),
    "-f","f32le","-ac","2","-ar",str(SR),"-"
])
bed = np.frombuffer(raw, dtype="<f4").reshape(-1,2).T.copy()[:,:N]

def hz(midi):
    return 440.0 * 2.0**((midi-69)/12.0)

def ease(x):
    x=np.clip(x,0,1)
    return x*x*(3-2*x)

def add_voice(out, pitch, start, length, amp, seed, pan=.5, attack=.05, release=.35, distant=False):
    i0=max(0,int(start*SR)); i1=min(N,int((start+length)*SR))
    if i1<=i0: return
    q=np.arange(i1-i0,dtype=np.float64)/SR
    rr=np.random.default_rng(seed)
    wobble=0.0014*np.sin(2*np.pi*.48*(q+start)+seed*.13)
    wobble+=0.0006*np.sin(2*np.pi*1.12*(q+start)+seed*.3)
    ph=np.cumsum(hz(pitch)*(1+wobble))*2*np.pi/SR+rr.uniform(0,2*np.pi)
    # The approved palette's inharmonic partials retain the sense of deep space.
    s=np.sin(ph)+.24*np.sin(2*ph+.3)+.16*np.sin(1.4142*ph+.6)+.065*np.sin(3.01*ph)
    if distant:
        s=.76*np.sin(ph)+.22*np.sin(2*ph+.4)+.10*np.sin(1.4142*ph)
    env=ease(q/attack)*ease((length-q)/release)
    env*=.75+.25*np.cos(2*np.pi*(q/length-.23))
    y=(amp*s*env).astype(np.float32)
    out[0,i0:i1]+=y*np.sqrt(2*(1-pan))
    out[1,i0:i1]+=y*np.sqrt(2*pan)

def reflections(x):
    y=x.copy()
    for ch in range(2):
        other=x[1-ch]
        for sec,g in [(0.21+0.06*ch,.12),(.53+.10*ch,.085),(1.03+.11*ch,.046)]:
            k=int(sec*SR)
            y[ch,k:]+=g*other[:-k]
    return y

# Shared harmony: extended, purposefully voice-led, avoiding rapid unrelated chords.
# A 14-bar 4/4 phrase at 120 BPM: 2 seconds/bar.
bpm=120
bar=4*60/bpm
chords=[
    (43,[55,62,65]),(43,[55,60,65]),(46,[53,62,65]),(46,[53,60,65]),
    (41,[53,60,63]),(41,[53,58,63]),(43,[55,60,65]),(43,[55,62,65]),
    (39,[51,58,62]),(39,[51,58,63]),(41,[53,60,63]),(41,[53,60,65]),
    (43,[55,62,65]),(43,[55,60,65])
]
chords = chords * 2 # 56 sec

# Cohesive two-phrase melodic line, with answer/recontextualization in the second half.
motif=[(0,67,1.2), (1.4,65,.55),(2.15,63,1.1),(3.45,65,.55),
       (4.15,67,1.5),(6.1,70,.7),(7.0,68,.75),(8.15,67,1.1),
       (9.4,65,.6),(10.25,63,1.3),(12.0,62,.8),(13.1,65,.7),
       (14.0,67,1.6),(16.15,70,.85),(17.15,68,.75),(18.0,67,1.6),
       (20.0,65,1.5),(22.1,63,.7),(23.0,62,1.6),(25.1,65,.9),(26.2,67,1.7)]
answer=[(0,68,1.3),(1.5,67,.6),(2.3,65,.95),(3.5,63,.7),
        (4.35,65,1.6),(6.2,67,1.0),(7.4,70,.75),(8.5,72,1.3),
        (10.05,70,.7),(11.0,68,1.15),(12.35,67,1.25),
        (14.0,65,1.0),(15.15,67,.6),(16,68,1.7),
        (18.1,70,1.1),(19.5,68,.65),(20.35,67,1.1),
        (22.0,65,1.25),(23.55,63,.7),(24.5,65,1.3),(26.0,67,1.5)]

def shared_score():
    out=np.zeros((2,N),dtype=np.float32)
    for j,(low,tones) in enumerate(chords):
        t=j*bar
        if t>=D: break
        add_voice(out,low,t,2.45,.008,1100+j,.34 if j%2 else .67,attack=.10,release=.65,distant=True)
        for k,p in enumerate(tones[:2]):
            add_voice(out,p,t+.12+k*.21,2.1,.0055,2100+5*j+k,.27 if k else .72,attack=.45,release=.65,distant=True)
    return out

def melody_voice(out, pts, offset, amp, seedbase, distance=False, alternate=False):
    for i,(t,p,d) in enumerate(pts):
        add_voice(out,p,t+offset,d,amp*(1.1 if i in (0,4,14) else 1),
                  seedbase+i,
                  pan=(.25 if i%2 else .74) if alternate else (.38+.13*np.sin(i*.7)),
                  attack=.10 if not distance else .23,release=.32 if not distance else .68,
                  distant=distance)



D = DUR
shared=shared_score()
A=shared.copy()
melody_voice(A,motif,0,.028,3100)
melody_voice(A,answer,28,.028,4100)
for i,(t,p) in enumerate([(3.0,50),(7.9,53),(12.4,48),(17.4,51),(22.3,50),
                           (31.2,51),(36.2,53),(41.3,48),(47.0,50),(52,55)]):
    add_voice(A,p,t,2.4,.010,5100+i,.2 if i%2 else .8,.18,.8,True)
B=shared.copy()
for off,phrase,seed in [(0,motif,6100),(28,answer,7100)]:
    for i,(t,p,d) in enumerate(phrase):
        is_distant=(i%3!=0)
        add_voice(B,p,off+t,d+.22 if is_distant else d,.026 if not is_distant else .022,
                  seed+i,pan=.2 if i%2 else .8,
                  attack=.23 if is_distant else .07,release=.55 if is_distant else .29,
                  distant=is_distant)
        if i%4==2:
            add_voice(B,p-12,off+t+.29,min(1.55,d+.5),.009,seed+100+i,
                      pan=.78 if i%2 else .22,attack=.25,release=.56,distant=True)
t=np.arange(N)/SR
bed_env=(.52+0.04*np.sin(t*.19)-.04*np.exp(-((t-25)/2.8)**2)).astype(np.float32)
base=bed*bed_env[None,:]
A=base+reflections(A)
B=base+reflections(B)
shared_peak=max(np.max(abs(A)),np.max(abs(B)))
shared_rms=max(np.sqrt(np.mean(A*A)),np.sqrt(np.mean(B*B)))
gain=min(.82/shared_peak,.092/shared_rms)

def encode(name,x):
    target=P/(name+".mp3")
    process=subprocess.Popen([
        "ffmpeg","-y","-loglevel","error","-f","f32le",
        "-ar",str(SR),"-ac","2","-i","pipe:0","-c:a","libmp3lame",
        "-b:a","128k",str(target)
    ],stdin=subprocess.PIPE)
    process.communicate(np.ascontiguousarray((x*gain).T,dtype="<f4").tobytes())
    if process.returncode:
        raise RuntimeError("MP3 encoding failed")
    return target


a=encode("starswarm-round25-A-cinematic-melodic-drive",A)
b=encode("starswarm-round25-B-relentless-cinematic-flow",B)
print(a,b)