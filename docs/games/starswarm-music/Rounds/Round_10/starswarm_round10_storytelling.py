"""Round 10: two focused original procedural additions to the preferred Round 8B bed.
A is a darkening harmonic *event*. B is an ambiguous distant presence with setup/reveal/afterglow.
No licensed reference audio sampled or transcribed; no game source changes.
"""
from pathlib import Path
import subprocess
import numpy as np
from scipy.signal import butter, sosfilt
ROOT=Path('/mnt/data'); SR=24000; D=58.0; N=int(D*SR)
t=np.arange(N,dtype=np.float64)/SR
rng=np.random.default_rng(410)
def decode(path):
    p=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()[:,:N].astype(np.float64)
def win(start,end,att=3,rel=5):
    a=np.clip((t-start)/att,0,1);b=np.clip((end-t)/rel,0,1)
    return np.sin(a*np.pi/2)**2*np.sin(b*np.pi/2)**2
def note(hz, start, end, amplitude, seed, pan=0, stretch=.0017, harmonics=(1,.34,.11), attack=4,release=5):
    rr=np.random.default_rng(seed)
    wander=stretch*np.sin(2*np.pi*(.023+rr.random()*.019)*t+rr.uniform(0,6.28))
    wander+=stretch*.3*np.sin(2*np.pi*.143*t+rr.uniform(0,6.28))
    s=np.zeros(N)
    for k,a in enumerate(harmonics):
        phase=2*np.pi*np.cumsum(hz*(k+1)*(1+wander+0.0005*k))/SR+rr.uniform(0,6.28)
        s+=a*np.sin(phase)
    e=amplitude*win(start,end,attack,release)
    p=(pan+1)*np.pi/4
    return np.stack([np.cos(p)*s*e,np.sin(p)*s*e])
def room(x):
    out=x.copy()
    for seconds,volume,cross in [(.37,.22,.6),(.91,.17,.8),(1.67,.14,.7),(2.83,.09,.9),(4.2,.05,.75)]:
        k=int(seconds*SR)
        out[:,k:]+=volume*((1-cross)*x[:,:-k]+cross*x[::-1,:-k])
    return out
base=decode(ROOT/'starswarm-round8-B-distant-haunting.mp3')
# A: follow a 4-act tonal dramaturgy. Modest level but moving inner voice is audible.
# First segment inherits G ambiguity. Contrasting dissonant note progressively enters
# and migrates downward, then holds on an unresolved tone rather than settling.
A=np.zeros_like(base)
voice=[
    (196.00,0,21,.014,-.3), (293.66,0,17,.008,.4),
    (207.65,9,34,.013,.25),(277.18,14,37,.009,-.4),
    (185.00,24,48,.013,-.15),(261.63,28,49,.008,.55),
    (174.61,36,58,.012,.25),(220.00,39,58,.007,-.5),
]
for i,(f,a,b,g,p) in enumerate(voice):
    A+=note(f,a,b,g,700+i,p,attack=3.5,release=6,harmonics=(1,.27,.08))
# A moving high inner voice whose semitone changes are intentional and moderately legible.
# Rise initially, then unexpected descending tritone neighborhood: slight destabilization.
for i,(f,a,b) in enumerate([(392,2,13),(415.3,12,24),(369.99,23,34),(349.23,34,45),(329.63,44,58)]):
    A+=note(f,a,b,.0085,760+i,pan=(-1)**i*.38,attack=2.8,release=4,harmonics=(1,.14,.035))
# Draw out contrast and don't compress the dynamic arc.
pressure=np.interp(t,[0,7,15,24,32,41,50,58],[.45,.52,.76,1.,.88,1.15,1.20,1.0])
A=room(A*pressure[None,:])
# B: entirely different mechanism. First a faint irregular inharmonic 'breath' without
# repeating surf envelope; then a distinct, pitched/robotic, diffuse cluster emerging
# from those same frequencies, followed by a fading trace.
B=np.zeros_like(base)
# begin with low-mid beating that subtly foreshadows the motif
for i,(f,a,b,g,p) in enumerate([(141.2,9,45,.007,-.55),(142.6,11,43,.006,.5),(211.9,15,52,.005,.26)]):
    B+=note(f,a,b,g,820+i,p,stretch=.004,harmonics=(1,.20,.07),attack=8,release=11)
# robotic/voice-like waveforms: quiet pitched evolving partials, no harsh random synth hiss
# varying inharmonic peaks create timbral ambiguity (not a recognizable choir).
rr=np.random.default_rng(822)
for i,(ff,fac,pn) in enumerate([(282.4,1.0,-.58),(427.6,.62,.43),(574.1,.40,-.3),(862.4,.22,.62),(1132.3,.13,-.45)]):
    f=ff*(1+.013*np.sin(2*np.pi*(.09+.011*i)*t+i*.9))
    phase=2*np.pi*np.cumsum(f)/SR+i*1.3
    amp=(.80+.20*np.cos(2*np.pi*(.18+.023*i)*t+i))
    # two reveals, second one changes color but remains related
    env=win(25.5,43,3,5)+.40*win(44,56,2.5,5)
    x=fac*.014*np.sin(phase)*amp*env
    theta=(pn+1)*np.pi/4
    B+=np.stack([np.cos(theta)*x,np.sin(theta)*x])
# an unsettling 'answer' at 34 sec that glides subtly and fades into source ambience
for i,(f,a,b,g,p) in enumerate([(296.2,32,47,.008,-.25),(294.1,34,49,.007,.35)]):
    B+=note(f,a,b,g,840+i,p,stretch=.006,attack=2,release=7,harmonics=(1,.31,.06))
# diffuse and distant, with filtered body, avoiding regular noise sweeps
B=sosfilt(butter(2,[85,1700],btype='bandpass',fs=SR,output='sos'),B,axis=1)
B=room(B)
# Keep baseline identical; use same scale for direct comparison.
outputs=[('starswarm-round10-A-dark-turn.mp3',base+A),('starswarm-round10-B-emerging-presence.mp3',base+B)]
peak=max(float(np.max(abs(y))) for _,y in outputs)
scale=min(1,.92/peak)
for name,y in outputs:
    y=(y*scale).astype('<f4')
    p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i','-','-codec:a','libmp3lame','-b:a','128k',str(ROOT/name)],stdin=subprocess.PIPE)
    p.communicate(y.T.tobytes())
    if p.returncode: raise RuntimeError(name)
    print(name, (ROOT/name).stat().st_size, 'RMS', float(np.sqrt(np.mean(y*y))), 'peak',float(np.max(np.abs(y))))
