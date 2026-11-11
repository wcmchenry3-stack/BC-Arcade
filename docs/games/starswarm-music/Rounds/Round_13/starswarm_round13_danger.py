"""Round 13: two original story/momentum treatments of approved Round 12B timbre.
References are used for high-level creative guidance only, never read or sampled.
"""
from pathlib import Path
import importlib.util
import numpy as np
import soundfile as sf
import subprocess

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('r12', HERE/'starswarm_round12_space_motion.py')
r12=importlib.util.module_from_spec(spec); spec.loader.exec_module(r12)
SR=r12.SR; N=r12.N; T=r12.T


def envelope(a,b,att=.2,rel=.8):
    return r12.ramp(a,a+att)*(1-r12.ramp(b-rel,b))

def pitch(m): return 440*2**((m-69)/12)

def ostinato(y,variant):
    """A: restrained irregular pulse; silence and timbral movement rather than drum."""
    if variant=='A':
        starts=[2.2,4.8,7.9,10.3,12.8,15.5,19.1,21.4,24.2,27.8,30.3,33.2,36.5,40.5,43.1,45.9,49.6,52.2]
        notes=[43,50,44,43,47,50,44,51,43,48,50,44,47,51,43,44,47,50]
    else:
        starts=[3.8,7.1,10.6,14.8,20.5,25.9,32.3,38.2,44.1,49.8]
        notes=[43,44,50,47,44,51,47,50,44,43]
    for idx,(s,m) in enumerate(zip(starts,notes)):
        dur=(1.5 if variant=='A' else 3.7)
        end=min(55,s+dur)
        n0=int(SR*s);n1=int(SR*end)
        tt=T[n0:n1]-s
        if n1<=n0: continue
        phase=2*np.pi*pitch(m)*(tt+.005*np.sin(2*np.pi*.23*tt))
        airy=np.sin(phase)+.22*np.sin(1.414*phase+.6)+.12*np.sin(2.007*phase)
        trem=1+.16*np.sin(2*np.pi*(1.9 if variant=='A' else .8)*tt)
        e=np.minimum(1,tt/.20)**2*np.minimum(1,(end-s-tt)/.65)**2
        l=.020 if variant=='A' else .022
        for c in range(2):
            delay=int((.037*c)*SR)
            start=n0+delay; stop=min(N,n1+delay)
            if stop>start:y[c,start:stop]+=l*airy[:stop-start]*e[:stop-start]*trem[:stop-start]

def suspense(y,variant):
    """Use timing and changes in relative roles for actual anticipation and a meaningful arrival."""
    # A: surging pressure + alternating pulse; B: narrative withdrawal/arrival and unresolved reach.
    harmonic=[
      (54,8.5,23.2,.018),   # pitch obliqueness (F# against G)
      (56,16.0,33.0,.020),  # semitone pressure
      (58,27.0,39.0,.018),  # unresolved higher F#/G proximity
      (65,35.0,52.7,.019),
    ] if variant=='A' else [
      (56,10,22,.017),
      (61,18,30,.019),
      (63,29,44,.019),
      (66,40,54.8,.021),
    ]
    for i,(m,a,b,l) in enumerate(harmonic):
        r12.put(y,m,a,b,l,2610+i,inharm=.30,brightness=.15,atk=2.0,rel=2.8,activity=.24)
    # Unresolved upper replies, increasingly forward, but not a pasted-on spaceship cue.
    replies=([(67,13,18,.010),(69,24,28,.011),(70,35,39,.014),(74,46,51,.014)] if variant=='A' else
             [(67,7,12,.010),(71,22,27,.013),(72,39,44,.014),(75,49,54,.013)])
    for i,(m,a,b,l) in enumerate(replies):
        r12.put(y,m,a,b,l,2810+i,inharm=.33,brightness=.22,atk=.6,rel=1.9,activity=.25)
    # Foreground trading: momentary retreat before threat develops rather than constant loudness rise.
    knots=([(0,1),(5,1),(10,.82),(12,.57),(15,.71),(20,1.03),(27,1.05),(31,.63),(34,.82),(40,1.11),(45,.70),(48,.94),(53,1.08),(56,1)] if variant=='A' else
           [(0,1),(9,1),(14,.69),(17,.54),(21,.96),(25,1.09),(29,.86),(34,.63),(38,.78),(43,1.16),(47,.91),(50,1.20),(54,1.05),(56,1)])
    y*=np.interp(T,*zip(*knots)).astype(np.float32)[None,:]
    return y

def render(variant):
    # Maintain same approved Round 12 B synthesis and harmonic vocabulary; modify movement only.
    y=r12.compose('B')
    ostinato(y,variant)
    suspense(y,variant)
    # Restore original natural long-distance room with subtle reflections for added voices.
    y*=np.float32(.80)
    return y

if __name__=='__main__':
    a=render('A'); b=render('B')
    rms=lambda z: float(np.sqrt(np.mean(z[:,:53*SR]**2)))
    g=min(.087/max(rms(a),rms(b)),.84/max(float(np.max(np.abs(a))),float(np.max(np.abs(b)))))
    for label,x in [('A-forward-motion',a),('B-ominous-journey',b)]:
        p=HERE/f'starswarm-round13-{label}'
        sf.write(str(p)+'.wav',(x*g).T,SR,subtype='PCM_16')
        subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(p)+'.wav','-c:a','libmp3lame','-b:a','128k',str(p)+'.mp3'],check=True)
        (HERE/(p.name+'.wav')).unlink()
        print(p.name, 'rms',round(rms(x*g),4),'peak',round(float(np.max(np.abs(x*g))),3),'size',Path(str(p)+'.mp3').stat().st_size)
