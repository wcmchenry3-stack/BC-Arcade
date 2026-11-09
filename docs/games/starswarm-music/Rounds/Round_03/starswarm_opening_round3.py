"""Three original 38-second Star Swarm opening studies. No external audio inputs."""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import soundfile as sf
from pathlib import Path
import subprocess
SR=24000; DUR=38; N=SR*DUR; t=np.arange(N)/SR; OUT=Path('/mnt/data')

def lp(x, cutoff): return sosfilt(butter(3,cutoff,fs=SR,output='sos'),x)
def env(start,end,attack=3,release=4):
    up=np.clip((t-start)/attack,0,1);down=np.clip((end-t)/release,0,1)
    return np.sin(np.pi*up/2)**2*np.sin(np.pi*down/2)**2*(t>=start)*(t<end)
def f(note): return 440*2**((note-69)/12)
def synth_note(note,start,end,amp=.04,kind='strings',seed=0):
    hz=f(note); out=np.zeros((2,N)); e=env(start,end, min(3,(end-start)/4),min(5,(end-start)/4))
    rng=np.random.default_rng(seed+note)
    for ch in range(2):
        sig=np.zeros(N)
        for v in range(6 if kind=='strings' else 4):
            det=rng.uniform(-.0032,.0032) if kind=='strings' else rng.uniform(-.0007,.0007)
            wobble=.0004*np.sin(2*np.pi*(.07+.015*v)*t+v+ch)
            phase=2*np.pi*np.cumsum(hz*(1+det+wobble))/SR+rng.uniform(0,6.28)
            h2=.26 if kind=='strings' else .12
            sig+=(np.sin(phase)+h2*np.sin(2*phase+.5)+.07*np.sin(3*phase))/(v+1)**.55
        sig/=5 if kind=='strings' else 3.3
        out[ch]=sig*e*amp
    return out

def ir(seed, decay):
    n=int(SR*4.5);v=np.random.default_rng(seed).standard_normal(n)
    v=lp(v,5500);v[:int(.045*SR)]=0
    v*=np.exp(-np.arange(n)/SR*6.9/decay)
    return v/(np.sqrt(np.sum(v*v))+1e-12)

def make(name,mode):
    x=np.zeros((2,N)); pad=('strings' if mode!=1 else 'organ')
    # Contrast derived from original, independently authored, no transcribed sequences.
    if mode in (0,3,4):
        # Immediate rising luminous suspended architecture, dark undertone comes later.
        notes=[(48,0,35,.085),(55,0,32,.052),(62,0,19,.041),(64,1,12,.03),
               (67,4,26,.036),(71,9,31,.032),(65,15,37,.035),(60,20,38,.052),(56,24,38,.04)]
        bass=(36,0,37,.085)
        if mode==3:  # Opening impact: immediate luminous upper entrance, early suspended height
            notes=[(48,0,35,.087),(55,0,32,.056),(62,0,19,.044),
                   (64,0,13,.042),(67,0.7,26,.04),(71,4.5,31,.034),
                   (65,15,37,.035),(60,20,38,.052),(56,24,38,.04)]
            bass=(36,0,37,.093)
        elif mode==4:  # Stronger progression: evolving early suspended colour, preserve later pivot
            notes=[(48,0,35,.084),(55,0,32,.052),(62,0,19,.038),
                   (64,1,12,.027),(69,2.0,8.8,.035),(67,4,26,.036),
                   (66,6.5,14,.031),(71,9,31,.032),(65,15,37,.035),
                   (60,20,38,.052),(56,24,38,.04)]
    elif mode==1:
        # Deliberately austere haunting organ/register, restrained but expressive suspension.
        notes=[(50,0,36,.075),(57,0,32,.06),(62,0,22,.04),(69,2,13,.035),
               (65,9,30,.045),(60,14,36,.04),(56,21,38,.043),(64,25,38,.035)]
        bass=(38,0,36,.07)
    else:
        # Beauty and underlying alien dissonance; two-stage uncertain presence -> inharmonic reveal.
        notes=[(45,0,38,.085),(52,0,29,.063),(59,0,24,.04),(64,2,22,.036),
               (67,8,29,.036),(63,15,34,.027),(58,21,38,.045),(53,25,38,.035)]
        bass=(33,0,37,.072)
    for j,(m,a,b,v) in enumerate(notes):x+=synth_note(m,a,b,v,pad,100+j*13)
    m,a,b,amp=bass
    basssig=(np.sin(2*np.pi*f(m)*t)+.22*np.sin(2*np.pi*2*f(m)*t))*env(a,b,4,5)*amp
    x+=basssig
    # Three very distant synthetic harmonic glints; not regular whooshes.
    for j,(at,pitch,scale) in enumerate([(7.5,87,.011),(18.2,82,.012),(29.3,89,.009)]):
        dur=4.5; ix=(t>=at)&(t<at+dur)
        sh=np.zeros(N);u=t[ix]-at
        sh[ix]=np.sin(2*np.pi*f(pitch)*u+2*np.sin(2*np.pi*.21*u))*np.sin(np.pi*u/dur)**2
        x[j%2]+=sh*scale
    # Atmospheric undercurrent with no regular surf-like amplitude sweeps.
    for ch in (0,1):
        rng=np.random.default_rng(3000+ch)
        ambient=lp(rng.standard_normal(N),2800)
        ambient=ambient/(np.std(ambient)+1e-9)
        movement=.55+.15*np.sin(2*np.pi*.039*t+ch*2)+.12*np.sin(2*np.pi*.071*t+ch*.9)
        x[ch]+=.0045*ambient*movement*env(0,38,4,4)
    if mode==2:
        # Forewarning: faint inharmonic oscillations emerge 25–31 s, no periodic wash.
        warn=env(23,34,6,4)
        for ch in (0,1):
            w=(np.sin(2*np.pi*(102.7+ch*.45)*t)+.4*np.sin(2*np.pi*(171.2+ch*.25)*t+1.2))
            x[ch]+=.012*warn*w
        # Robotic reveal: filtered angular FM harmonic cluster, drifting pitch and irregular gait.
        idx=(t>31)&(t<36);u=t[idx]-31
        local=np.zeros(N);p=2*np.pi*(145*u+11*u**2)+5*np.sin(2*np.pi*(4.7*u+.3*u*u))
        gate=(.62+.38*np.sin(2*np.pi*(7.1*u+.14*u*u)))
        local[idx]=(.65*np.sin(p)+.25*np.sin(1.51*p))*gate*np.sin(np.pi*u/5)**2
        x[0]+=.028*local;x[1]+=.018*np.roll(local,int(.021*SR))
    # Independent long, subtly filtered decays instead of universal giant washes.
    for ch in (0,1):
        wet=fftconvolve(x[ch],ir(710+ch,3.1 if mode==1 else 3.9))[:N]
        x[ch]+=.15*wet
    if mode==3:
        # Low-level high suspended shimmer only in the first six seconds: a clear opening invitation.
        e=env(0.2,9,0.45,4)
        for ch in (0,1):
            mod=1+.05*np.sin(2*np.pi*.19*t+ch)
            x[ch]+=.0095*e*mod*np.sin(2*np.pi*f(83)*t+ch*.9)
    if mode==4:
        # Mild transient swell leading into the existing ~10 second pivot, no extra SFX.
        x*= (1 + .11*np.exp(-((t-8.8)/3.6)**2))[None,:]
    # natural phrase-scale breathing; no loudness levelling
    x*= (.77+.20*np.sin(np.pi*np.clip(t/35,0,1))**2 + .08*np.sin(2*np.pi*t/19))[None,:]
    # Gentle fade to stop as standalone audition, not a loop
    x*=env(0,38,.5,2)[None,:]
    x*=.84/max(np.max(abs(x)),1e-8)
    tmp=OUT/(name+'.wav');final=OUT/(name+'.mp3')
    sf.write(tmp,x.T,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(tmp),'-codec:a','libmp3lame','-b:a','128k',str(final)],check=True)
    tmp.unlink();print(final,final.stat().st_size)

for mode,name in ((3,'starswarm-round3-A1-immediate-arrival'),(4,'starswarm-round3-A2-harmonic-development')): make(name,mode)
