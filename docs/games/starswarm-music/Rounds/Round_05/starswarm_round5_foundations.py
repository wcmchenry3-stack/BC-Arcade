"""Star Swarm Round 5: entirely procedural, original, foundation-first auditions.
No input recordings, no borrowed melodic phrases. 24000 Hz stereo, 48 seconds.
A: sparse ambiguous sci-fi space bed; B: same bed with independent harmonic development.
"""
from pathlib import Path
import numpy as np, soundfile as sf, subprocess
from scipy.signal import butter, sosfilt
SR=24000; D=48.; N=int(D*SR); t=np.arange(N)/SR; OUT=Path('/mnt/data')

def envelope(a,b,attack=.2,release=1.8):
    return (np.sin(.5*np.pi*np.clip((t-a)/max(attack,.01),0,1))**2 *
            np.sin(.5*np.pi*np.clip((b-t)/max(release,.01),0,1))**2)

def freq(m):return 440*2**((m-69)/12)

def osc(m,a,b,level,seed=0,inharm=0.0,brightness=.1,motion=1.,attack=.2,release=3):
    """Imperfect distant electronic partial stack, not conventional warm pad."""
    rng=np.random.default_rng(seed); result=np.zeros((2,N),dtype=np.float32)
    env=envelope(a,b,attack,release)
    for ch in range(2):
        layer=np.zeros(N,dtype=np.float64)
        for k in range(3):
            drift=.0014*np.sin(2*np.pi*(.047+.014*k+.009*ch)*t+rng.uniform(0,6))
            drift+=.0005*np.sin(2*np.pi*(.137+.031*k)*t+rng.uniform(0,6))
            f0=freq(m)*(1+(.002*(k-1)) + drift*motion)
            ph=2*np.pi*np.cumsum(f0)/SR+rng.uniform(0,6.28)
            # Inharmonic components give an ambiguous sci-fi spectrum without a separable cue
            part=(np.sin(ph)+brightness*np.sin(2*ph+.21)+inharm*np.sin(1.4142*ph+.8))
            layer+=part/(1.5+k*.65)
        result[ch]=level*env*layer.astype(np.float32)
    return result

def texture(seed,lo,hi):
    rng=np.random.default_rng(seed)
    n=rng.standard_normal(N).astype(np.float64)
    n=sosfilt(butter(2,lo,fs=SR,btype='highpass',output='sos'),n)
    n=sosfilt(butter(2,hi,fs=SR,btype='lowpass',output='sos'),n)
    return (n/(np.std(n)+1e-9)).astype(np.float32)

def foundation():
    x=np.zeros((2,N),np.float32)
    # Start in the middle of an active, uneasy sonic landscape. Keep interval ambiguity.
    # Root G, distant semitone A-flat, open fifth D, high uncertain F# (no soothing triad).
    score=[(31,0,48,.103,.05,.17), (43,0,48,.051,.17,.15),
           (50,0,46,.043,.10,.12),(44,0,25,.018,.28,.21),
           (54,0,17,.019,.30,.11),(57,6,27,.019,.30,.12),
           (56,15,43,.020,.31,.15),(51,21,48,.014,.38,.17)]
    for i,(m,a,b,v,ih,br) in enumerate(score):
        x+=osc(m,a,b,v,130+i,inharm=ih,brightness=br,attack=.06 if a==0 else 3.0,release=6)
    # A quiet, continually active low tremor, asynchronous rather than breathing in waves
    for ch in range(2):
        low=texture(500+ch,34,155)
        rng=np.random.default_rng(510+ch)
        seg=np.arange(0,D+1,1.1)
        activity=np.interp(t,seg,rng.uniform(.35,.92,len(seg)))
        x[ch]+=low*activity*.0048
        airy=texture(700+ch,950,6900)
        activity2=np.interp(t,np.arange(0, D+2,1.3),rng.uniform(.15,.83,len(np.arange(0,D+2,1.3))))
        x[ch]+=airy*activity2*.0024
    return x

def evolving(x):
    # One unfolding composition; purposefully developing harmonies without a settled cadence.
    # Metallic/inharmonic color is already in the foundation; no separate 'sci-fi transition'.
    for i,(m,a,b,v,inh) in enumerate([
        (62,0,14,.021,.10),(59,3,16,.018,.13),(61,9,28,.023,.18),
        (65,13,35,.027,.21),(66,19,43,.026,.17),
        (60,26,48,.027,.20),(68,33,48,.023,.14),
        (55,35,48,.034,.09),
    ]):
        x+=osc(m,a,b,v,1400+i,inharm=inh,brightness=.25,attack=.08 if a==0 else 2.5,release=4)
    # Countermovement / unsettled evolution, short overlapping gestures, never a lead tune
    for j,(m,a,b) in enumerate([(70,0,7),(68,6,13),(71,12,21),(69,20,30),(73,28,39),(70,37,48)]):
        x+=osc(m,a,b,.009,1600+j,inharm=.22,brightness=.18,attack=.1 if a==0 else 2.3,release=2.8)
    return x

def space(x,mode):
    rng=np.random.default_rng(3399)
    for ch in range(2):
        dry=x[ch].copy()
        # different distant reflections for each channel, no surf-like periodic cycles
        for delay,gain in [(0.31+.037*ch,.16),(0.89+.19*ch,.11),(2.02+.27*ch,.078),(3.77+.23*ch,.045)]:
            k=round(delay*SR)
            x[ch,k:]+=dry[:-k]*gain
    # Suspenseful long swells without loudness flattening or classic pad breathing
    trajectory=np.interp(t,[0,7,15,23,31,39,48], [0.93,1.05,0.83,1.13,.92,1.16,1.08])
    x*=trajectory[None,:].astype(np.float32)
    x*=envelope(0,D,.025,1.6)[None,:]
    target=.075
    x*=target/(np.sqrt(np.mean(x*x))+1e-9)
    x*=min(1.,.91/(np.max(np.abs(x))+1e-9))
    return x

for kind in ['A','B']:
    x=foundation()
    if kind=='B': x=evolving(x)
    x=space(x,kind)
    name=f'starswarm-round5-{kind}-'+('space-foundation' if kind=='A' else 'living-space')
    wav=OUT/(name+'.wav'); mp3=OUT/(name+'.mp3')
    sf.write(wav,x.T,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
    wav.unlink()
    print(mp3,mp3.stat().st_size,'rms',np.sqrt(np.mean(x*x)),'peak',np.max(np.abs(x)))
