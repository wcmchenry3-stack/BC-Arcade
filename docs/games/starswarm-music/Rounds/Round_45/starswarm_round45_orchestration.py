"""Star Swarm Round 45 – first two-minute signature arrangement over approved Round 44.
Original synthesis only. The older scripts are executed with their original backing nulled;
no licensed recording is ever loaded. Requires numpy, scipy, ffmpeg and included files.
"""
from pathlib import Path
import numpy as np, subprocess
R=Path(__file__).resolve().parent
SR=24000; D=120; N=SR*D

def decode(path):
    p=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()
def ease(x):
    x=np.clip(x,0,1);return x*x*(3-2*x)
def stem(filename,marker,patch,expression):
    text=(R/filename).read_text().split(marker,1)[0]
    assert patch in text,(filename,patch)
    text=text.replace(patch, "src=np.zeros((2,N+120*SR),dtype=np.float32)" if patch.startswith('src=') else "old=np.zeros((2,N+120*SR),dtype=np.float32)")
    env={'__file__':str(R/filename),'__name__':'round45_stem','__builtins__':__builtins__}
    exec(compile(text,filename,'exec'),env)
    return np.asarray(eval(expression,env),dtype=np.float32)

bed=decode(R/'starswarm-round44-seven-minute-ambient-foundation.mp3')[:,:N]
assert bed.shape==(2,N)
astro=stem('starswarm_round20_spotlight_signals.py','A,B=rise(),signals()',"src=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')",'rise()')
robots=stem('starswarm_round20_spotlight_signals.py','A,B=rise(),signals()',"src=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')",'signals()')
chorus=stem('starswarm_round18_foreground_chorus.py',"a=build('gathering')","old=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')","build('gathering')")
choir=stem('starswarm_round18_foreground_chorus.py',"a=build('gathering')","old=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')","build('electromagnetic')")
out=bed.astype(np.float64).copy(); events=[]
def add(label,signal,source_at,at,secs,level,duck,fade_in=2.0,fade_out=2.5):
    i=int(round(at*SR)); j=min(N,i+int(round(secs*SR)))
    q=signal[:,int(round(source_at*SR)):int(round(source_at*SR))+(j-i)].astype(np.float64)
    assert q.shape==(2,j-i),(label,q.shape)
    t=np.arange(j-i)/SR
    w=ease(t/fade_in)*ease((secs-t)/fade_out)
    # All effects fade in/out and open a *limited* pocket in the moving bed.
    # Preserve recognizability without Round 20's near-silence spotlight.
    out[:,i:j]*=1-duck*w[None,:]
    out[:,i:j]+=level*q*w[None,:]
    events.append((label,at,at+secs))

# No major featured overlaps; every foreground element has 14-16 seconds
# of continuous Round 44-only music before the next one starts.
add('astronomical rise',astro,9,10,17,.75,.24,2.2,3.2)
add('varied robotic signals',robots,13,42,18,.76,.22,1.5,2.6)
add('gathering swarm chorus',chorus,11,76,17,.64,.27,2.3,3.0)
add('electromagnetic choir',choir,17,109,10,.73,.24,1.2,2.6)
# Render without normalization of the bed during gaps: exact unchanged Round 44
# passes through foundation-only intervals. One common gain for A/B comparison.
pk=max(np.max(np.abs(bed)),np.max(np.abs(out))); gain=min(1.,.83/pk)
print('events:',events,'peak raw',pk,'common gain',gain,flush=True)
for filename,sound in [('starswarm-round45-A-round44-foundation-control.mp3',bed),('starswarm-round45-B-signature-orchestration.mp3',out)]:
    pcm=np.ascontiguousarray((sound*gain).T,dtype='<f4').tobytes()
    subprocess.run(['ffmpeg','-y','-v','error','-f','f32le','-ar',str(SR),'-ac','2','-i','pipe:0','-c:a','libmp3lame','-b:a','128k',str(R/filename)],input=pcm,check=True)
    print(filename,(R/filename).stat().st_size,flush=True)
