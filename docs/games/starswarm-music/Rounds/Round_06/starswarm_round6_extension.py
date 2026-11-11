"""Round 6: preserve Round 5B's approved opening; extend with original evolving harmony.
Requires prior Round 5 source (for reusable procedural synthesis functions) and its B MP3.
All added sound is synthesized, no third-party/source references are read.
"""
from pathlib import Path
import subprocess
import numpy as np
import soundfile as sf

OUT=Path('/mnt/data')
R5=OUT/'starswarm_round5_foundations.py'
BASE=OUT/'starswarm-round5-B-living-space.mp3'
SR=24000
D=49.
N=int(D*SR)
t=np.arange(N)/SR
# Import only the generic synthesis utilities; don't trigger the previous file's rendering.
src=R5.read_text().split("for kind in ['A','B']:")[0]
ns={'__name__':'starswarm_generic','__file__':str(R5)}
exec(compile(src,str(R5),'exec'),ns)
ns.update(D=D,N=N,t=t)
osc=ns['osc']; texture=ns['texture']

# The continuation keeps the distinctive unstable partials and deep register of Round 5B.
# Its chordal centre drifts away from G/Ab toward a more cinematic ambiguous Eb/C/Db/F#
# palette, then leaves the mystery unresolved. No standalone sci-fi signals.
x=np.zeros((2,N),np.float32)
parts=[
    (31,0,43,.085,.08,.17,1.5,8), # continuing G low foundation, thins away
    (43,0,35,.047,.17,.15,1.5,7),
    (50,0,19,.043,.10,.12,1.5,6),
    (44,0,15,.020,.23,.20,1.5,6),
    (55,0,22,.026,.16,.24,1.2,7), # G3 common thread
    (63,3,29,.022,.21,.24,3.0,5), # Eb4 arrival
    (60,10,38,.026,.19,.26,3.0,7), # C4 adds questioning color
    (49,17,57,.041,.25,.17,4.0,7), # Db3 enters slowly
    (56,19,60,.023,.18,.22,4.0,8), # Ab3 connection
    (66,24,60,.018,.24,.26,4.0,7), # F#4 keeps suspension
    (46,29,60,.020,.12,.13,3.5,7), # Bb2 dark widening
    (51,34,60,.017,.27,.24,4.0,7), # Eb3
]
for i,(m,a,b,v,ih,br,att,rel) in enumerate(parts):
    x+=osc(m,a,b,v,3000+i,inharm=ih,brightness=br,attack=att,release=rel)
# A few purposeful, quiet line movements integrated into the sustained sound.
# These are not a foreground melody; different layers move on their own schedule.
for j,(m,a,b,v) in enumerate([
    (68,0,8,.012),(69,6,16,.011),(66,15,25,.013),
    (70,22,32,.013),(73,30,42,.014),(71,38,58,.012),
]):
    x+=osc(m,a,b,v,4100+j,inharm=.21,brightness=.22,
           attack=1.2 if a==0 else 2.5,release=4)
for ch in range(2):
    rng=np.random.default_rng(550+ch)
    low=texture(5100+ch,34,155)
    knots=np.arange(0,D+2,1.1)
    activity=np.interp(t,knots,rng.uniform(.32,.88,len(knots)))
    x[ch]+=low*activity*.0043
    high=texture(5200+ch,950,6900)
    knots=np.arange(0,D+2,1.5)
    activity=np.interp(t,knots,rng.uniform(.10,.68,len(knots)))
    x[ch]+=high*activity*.0017
# Reverb/reflections akin to R5B; deliberately no periodic surf-like modulation.
for ch in range(2):
    dry=x[ch].copy()
    for delay,gain in [(0.31+.037*ch,.16),(0.89+.19*ch,.11),(2.02+.27*ch,.078),(3.77+.23*ch,.045)]:
        k=round(delay*SR)
        x[ch,k:]+=dry[:-k]*gain
trajectory=np.interp(t,[0,7,14,21,29,37,49], [1.04,1.11,.92,1.19,.94,1.16,1.02])
x*=trajectory[None,:].astype(np.float32)
# No fade-in/out: this is an ongoing environment, not a self-contained clip.

def decode_mp3(path):
    p=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(path),
        '-f','f32le','-acodec','pcm_f32le','-ac','2','-ar',str(SR),'-'],capture_output=True,check=True)
    data=np.frombuffer(p.stdout,dtype='<f4')
    return data.reshape(-1,2).T.copy()
base=decode_mp3(BASE)
# Keep exact decoded approved B up to 44 seconds; only fade the final 4 sec into continuation.
join_start=44.
join_samples=int(join_start*SR)
fade_samples=int(4.0*SR)
# Initial continuation sits in broadly the same soundscape; match level over held material.
ref=np.sqrt(np.mean(base[:,int(32*SR):int(44*SR)]**2))
cont=np.sqrt(np.mean(x[:,:int(12*SR)]**2))
x*=ref/(cont+1e-10)
y=np.zeros((2,join_samples+N),np.float32)
y[:,:join_samples]=base[:,:join_samples]
p=np.linspace(0,1,fade_samples,endpoint=False,dtype=np.float32)
a=np.cos(p*np.pi/2);b=np.sin(p*np.pi/2)
y[:,join_samples:join_samples+fade_samples]=base[:,join_samples:join_samples+fade_samples]*a[None,:]+x[:,:fade_samples]*b[None,:]
y[:,join_samples+fade_samples:]=x[:,fade_samples:]
# 93s; 0-44s is decoded-identical to approved B.
peak=np.max(np.abs(y))
if peak>.94:y*=.94/peak
name=OUT/'starswarm-round6-B-living-space-extended.mp3'
wav=name.with_suffix('.wav')
sf.write(wav,y.T,SR,subtype='PCM_16')
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k',str(name)],check=True)
wav.unlink()
print('created',name,'duration',len(y[0])/SR,'size',name.stat().st_size,'rms',np.sqrt(np.mean(y*y)), 'peak',np.max(np.abs(y)))
