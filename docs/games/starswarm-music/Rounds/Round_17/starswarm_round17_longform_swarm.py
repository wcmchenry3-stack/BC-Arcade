"""Round 17: original longer musical arc + separate test of BG-2-inspired quivery chorus.
No use of the four licensed BG reference recordings. Existing project-owned Round16B used
as the preserved foundation; newly rendered continuation and independent chorus tests.
Audition-only, not a seamless game release master.
"""
from pathlib import Path
import numpy as np, soundfile as sf, subprocess
from scipy.signal import butter, sosfilt
import importlib.util
P=Path('/mnt/data'); SR=24000
spec=importlib.util.spec_from_file_location('r16',P/'starswarm_round16_development.py')
r16=importlib.util.module_from_spec(spec);spec.loader.exec_module(r16)

def decode(path):
    a=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-acodec','pcm_f32le','-'],capture_output=True,check=True)
    return np.frombuffer(a.stdout,dtype='<f4').reshape(-1,2).T.copy()

def smooth(x):
    return np.clip(x,0,1)**2*(3-2*np.clip(x,0,1))

def render_long():
    D=230.;N=int(D*SR); t=np.arange(N)/SR
    # Preserve all approved Round16B up to 2:32; move naturally into a new section.
    old=decode(P/'starswarm-round16-B-shepard-descent.mp3')
    x=np.zeros((2,N),np.float32)
    end=int(155*SR); cross0=int(150*SR); x[:,:cross0]=old[:,:cross0]
    # Use r16's original synth algorithm on the extension, continuing its exact inharmonic vocabulary.
    r16.DUR=D;r16.N=N;r16.t=t.astype('float32')
    ext=np.zeros_like(x)
    # Existing foundation sustains under a more reflective interval, then opens up again.
    for k,(note,amp) in enumerate([(31,.045),(43,.027),(50,.019),(44,.010),(54,.009)]):
        r16.write_tone(ext,note,146,D,amp,2001+k,inh=.24+.06*(k%3),atk=3,rel=4,beat=.18)
    harmony=[(57,151,172,.021),(60,159,182,.028),(63,169,188,.027),
             (58,177,197,.018),(65,188,210,.030),(62,194,218,.027),
             (69,205,226,.023),(66,214,230,.024),(72,216,229,.010)]
    for k,(n,a,b,v) in enumerate(harmony):
        r16.write_tone(ext,n,a,b,v,2110+k,inh=.29,atk=2.1,rel=4.6,beat=.2)
    # A pulse can briefly retreat but never disappears: this is arcade BGM.
    q=153.;j=0; pat=[2.1,2.7,1.8,2.6,2.2,3.0]
    tones=[43,47,45,50,44,49,46,51,43,48]
    while q<226:
        r16.write_tone(ext,tones[j%len(tones)],q,min(D,q+2.2),
                       .0075 if 172<q<189 else .0120,2300+j,inh=.33,atk=.03,rel=1.8,beat=.25)
        q+=pat[j%len(pat)];j+=1
    # Independently shifting airy upper material, not pasted-in astronomical one-shots.
    for k,(n,a,b,v) in enumerate([(75,158,164,.009),(73,167,174,.009),(77,183,190,.010),
                                    (74,199,208,.009),(80,215,223,.012)]):
        r16.write_tone(ext,n,a,b,v,2400+k,inh=.27,atk=.9,rel=3.1,beat=.22)
    # Subtle noise/space from same procedural palette as Round16.
    r16.hiss(ext,2501,145,D,.0009,75,420)
    r16.hiss(ext,2502,145,D,.00055,1050,4800)
    # Longer diffuse reflections preserved throughout the extension.
    for ch in range(2):
        dry=ext[ch].copy()
        for dsec,g in [(0.39+.08*ch,.10),(1.12+.11*ch,.076),(2.12+.23*ch,.043)]:
            d=int(SR*dsec);ext[ch,d:]+=dry[:-d]*g
    curve=np.interp(t,[0,150,170,185,204,219,230],[1,1,1.06,.83,1.12,1.18,.75]).astype('float32')
    ext*=curve[None,:]
    stop=int(155*SR)
    tt=np.linspace(0,1,stop-cross0,endpoint=False);fade=smooth(tt)
    x[:,cross0:stop]=old[:,cross0:stop]*(1-fade[None,:])+ext[:,cross0:stop]*fade[None,:]
    x[:,stop:]=ext[:,stop:]
    # Two additional restrained Shepard falls, each different from approved Round16B 2:03–2:27.
    for start,end,amp,rate,base in [(68,82,.0038,.115,300.),(190,204,.0045,.15,250.)]:
        i=int(start*SR);k=int(end*SR);tt=t[i:k];s=(tt-start)
        layer=np.zeros((2,k-i),np.float32)
        for octv in range(-3,7):
            freq=base*2**(octv-rate*s)
            weight=np.exp(-.5*(np.log2(freq/410)/.91)**2)
            for ch in range(2):
                ph=np.cumsum(freq*(1+.0005*ch))*(2*np.pi/SR)+octv*.93+ch*.48
                layer[ch]+=(weight*np.sin(ph)).astype('float32')
        envelope=smooth(s/3.8)*smooth((end-tt)/3.8)
        x[:,i:k]+=layer*(envelope*amp)[None,:]
    x*=smooth((D-t)/2.3)[None,:]
    return x

def swarm_base():
    old=decode(P/'starswarm-round16-B-shepard-descent.mp3')
    # Select existing 65 second passage with a stable original space bed. Not original BG sources.
    i=int(38*SR); L=int(65*SR)
    x=old[:,i:i+L].copy()
    if x.shape[1]<L: raise RuntimeError('Missing foundation')
    tt=np.arange(L)/SR
    return x,tt

def add_quiver(x,tt,variant):
    # Two genuinely different ensemble motion hypotheses:
    # A: shared phase-linked, periodically tightening chorus beating (~3-5 Hz).
    # B: independent flocking subgroups with offset quiver and moving harmonic colors.
    N=x.shape[1];rng=np.random.default_rng(1717 if variant=='coherent' else 1718)
    chorus=np.zeros_like(x)
    base_notes=[60,67,72,63,70,75,58,65,70,61,68,73]
    members=24
    for j in range(members):
        note=base_notes[j%len(base_notes)]
        start=7+rng.uniform(-2,5)+(j%4)*.35
        stop=min(63,start+rng.uniform(31,45))
        a=max(0,int(start*SR));b=min(N,int(stop*SR));q=tt[a:b]
        if b<=a:continue
        root=440*2**((note-69)/12)*2**(rng.normal(0,.075)/12)
        group=j%4
        if variant=='coherent':
            rate=3.8+.35*np.sin(.09*q)+.06*group
            # Members compress and loosen together, generating a clearly shared quivery mass.
            trem_phase=2*np.pi*(3.85*q+.22*np.sin(.13*q))+group*.2+rng.normal(0,.15)
        else:
            rate=3.3+.6*np.sin(.1*q+group)
            trem_phase=2*np.pi*((3.1+.28*group)*q+.38*np.sin(.16*q+group))+group*1.1
        vibrato=np.sin(2*np.pi*(4.1+.06*j)*q+j*.37)+.2*np.sin(2*np.pi*.61*q+group)
        fr=root*(1+.0036*vibrato)
        ph=np.cumsum(fr)*(2*np.pi/SR)+j*.9
        fm=.5+.5*np.sin(.6*q+group*.7)
        yy=.72*np.sin(ph)+(.21+.07*fm)*np.sin(2*ph+.2)+(.095+.08*(1-fm))*np.sin(3*ph+.5)+.045*np.sin(4*ph+.6)
        trem=.62+.23*np.sin(trem_phase)+.11*np.sin(2*trem_phase+1.3)+.045*np.sin(.35*q+j*.2)
        e=smooth((q-start)/5)*smooth((stop-q)/7)
        pan=.5+.32*np.sin(.15*q+j*1.31)
        gain=.0026 if variant=='coherent' else .0022
        chorus[0,a:b]+=(yy*gain*trem*e*np.sqrt(2*(1-pan))).astype('float32')
        chorus[1,a:b]+=(yy*gain*trem*e*np.sqrt(2*pan)).astype('float32')
    for ch in range(2):
        dry=chorus[ch].copy()
        for dsec,gain in [(0.46+.12*ch,.25),(1.17+.21*ch,.19),(2.04+.2*ch,.12)]:
            d=int(dsec*SR);chorus[ch,d:]+=dry[:-d]*gain
    # Multiple contrasting waves of chorus character, not a single generic pad fade.
    env=np.interp(tt,[0,5,10,17,24,28,33,42,47,54,61,65],[0,0,.25,.9,.55,.2,.56,.97,.45,.67,.16,0]).astype('float32')
    return x+chorus*env[None,:]

def encode(name,x,g):
    out=P/(name+'.mp3')
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.wav') as tf:
        sf.write(tf.name,(x*g).T,SR,subtype='PCM_16')
        subprocess.run(['ffmpeg','-y','-v','error','-i',tf.name,'-c:a','libmp3lame','-b:a','112k',str(out)],check=True)
    print(out.name, out.stat().st_size,'duration',round(x.shape[1]/SR,1))

if __name__=='__main__':
    long=render_long()
    x,tt=swarm_base();a=add_quiver(x.copy(),tt,'coherent');b=add_quiver(x.copy(),tt,'flocking')
    # One gain for short variants, separate conservative gain for long; do not normalize dynamic windows.
    g=min(.89/(max(np.abs(a).max(),np.abs(b).max())+1e-10),.086/(np.sqrt(np.mean(x*x))+1e-10))
    gl=min(.89/(np.abs(long).max()+1e-10),.085/(np.sqrt(np.mean(long*long))+1e-10))
    encode('starswarm-round17-A-electromagnetic-expansion',long,gl)
    encode('starswarm-round17-B1-coherent-quiver',a,g)
    encode('starswarm-round17-B2-flocking-chorus',b,g)
