"""Round 40: targeted arrangement revision using original project-synthesized stems.
Foundation is Round 38; licensed reference tracks are never used as synthesis sources.
Requires the original Round 18/19/20 generator scripts and the Round 38 original MP3.
"""
from pathlib import Path
import subprocess, numpy as np

ROOT=Path(__file__).resolve().parent
SR=24000; DUR=90.0; N=int(SR*DUR)

def decode(p):
    data=subprocess.run(['ffmpeg','-v','error','-i',str(p),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True).stdout
    return np.frombuffer(data,dtype='<f4').reshape(-1,2).T.copy()

def sm(q):
    q=np.clip(q,0,1);return q*q*(3-2*q)

def original_stem(filename,end_marker,patch,expression):
    source=(ROOT/filename).read_text().split(end_marker,1)[0]
    if patch not in source: raise ValueError('Missing stem extraction patch: '+filename)
    source=source.replace(patch,'src=np.zeros((2,N+120*SR),dtype=np.float32)' if patch.startswith('src=') else 'old=np.zeros((2,N+120*SR),dtype=np.float32)')
    env={'__name__':'round40_stems','__file__':str(ROOT/filename)}
    exec(compile(source,str(ROOT/filename),'exec'),env)
    return np.array(eval(expression,env),dtype=np.float32,copy=True)

bed=decode(ROOT/'starswarm-round38-ninety-second-development.mp3')[:,:N]
assert bed.shape==(2,N)
astro=original_stem('starswarm_round20_spotlight_signals.py','A,B=rise(),signals()',"src=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')",'rise()')
signals=original_stem('starswarm_round20_spotlight_signals.py','A,B=rise(),signals()',"src=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')",'signals()')
chorus_a=original_stem('starswarm_round18_foreground_chorus.py',"a=build('gathering')", "old=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')", "build('gathering')")
chorus_b=original_stem('starswarm_round18_foreground_chorus.py',"a=build('gathering')", "old=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')", "build('electromagnetic')")

out=bed.copy().astype(np.float64)
plan=[]
def add(name,src,src_start,dst_start,length,level=.7,fade_in=2,fade_out=3,duck=.15):
    source=src[:,int(src_start*SR):int((src_start+length)*SR)]
    start=int(dst_start*SR);end=min(N,start+source.shape[1]);source=source[:,:end-start]
    if end<=start: return
    t=np.arange(end-start,dtype=np.float64)/SR
    w=sm(t/fade_in)*sm(((end-start)/SR-t)/fade_out)
    out[:,start:end]*=(1-duck*w)[None,:]
    out[:,start:end]+=level*source*w[None,:]
    plan.append(dict(name=name,start=round(dst_start,1),end=round(end/SR,1),level=level,duck=duck))

# A successful Round 39 astronomical entrance, spotlight and return, retained.
add('astronomical rise',astro,9.,7.,19.,.54,3,4,.45)
# 26-32 is intentionally FOUNDATION ONLY: preserve urgent musical current, but separate signatures.
# Several different machine voices from the approved Round 20B source, rather than one short token.
add('extended robotic signal sequence',signals,12.8,32.,24.5,.69,1.5,2.4,.24)
# Warm-up robotic calls form a lead-in; the main swarm becomes a separate recognizable foreground.
add('gathering swarm chorus',chorus_a,10.,54.,18.5,.59,3.3,3.8,.35)
# Keep the other approved choir: contrasting brief vocal swell, independently recognizable.
add('electromagnetic choir',chorus_b,16.,72.0,9.2,.42,1.4,1.8,.28)

def shepard(start,duration,amp=.027,rate=.15,base=245):
    i=int(start*SR);j=min(N,int((start+duration)*SR));t=np.arange(j-i,dtype=np.float64)/SR
    layer=np.zeros((2,j-i),dtype=np.float64)
    for octv in range(-3,7):
        freq=base*np.exp2(octv-rate*t)
        weight=np.exp(-.5*(np.log2(np.maximum(freq,1)/410)/.9)**2)
        for ch in range(2):
            phase=np.cumsum(freq*(1+.00045*ch))*(2*np.pi/SR)+octv*.93+ch*.48
            layer[ch]+=weight*np.sin(phase)
    env=sm(t/1.5)*sm((duration-t)/1.1)
    # Embedded in the same playing composition, with temporary spectral/level space,
    # not the naked illusion on its own. The music maintains its rhythmic trajectory.
    clear=.34*env
    out[:,i:j]*=(1-clear)[None,:]
    out[:,i:j]+=amp*layer*env[None,:]
    plan.append(dict(name='audible descending Shepard',start=start,end=start+duration,level=amp,duck=.34))

shepard(81.0,9.0)
# Single global gain: retain musical breathing, no short-window compression.
peak=max(float(np.max(np.abs(out))),float(np.max(np.abs(bed))))
rms=max(float(np.sqrt(np.mean(out*out))),float(np.sqrt(np.mean(bed*bed))))
gain=min(.85/peak,.085/rms)
for name,sig,makeup in [('starswarm-round40-A-round39-control.mp3',decode(ROOT/'starswarm-round39-B-active-sci-fi-signatures.mp3')[:,:N],1.0),('starswarm-round40-B-spaced-signatures.mp3',out,1.215)]:
    # normalize integrated levels only after encoding (not short-window leveling).
    target=ROOT/name
    pcm=np.ascontiguousarray((sig*gain*makeup).T,dtype='<f4').tobytes()
    subprocess.run(['ffmpeg','-y','-loglevel','error','-f','f32le','-ar',str(SR),'-ac','2','-i','pipe:0','-c:a','libmp3lame','-b:a','128k',str(target)],input=pcm,check=True)
    print(name,target.stat().st_size,flush=True)
print('PLAN',plan)
