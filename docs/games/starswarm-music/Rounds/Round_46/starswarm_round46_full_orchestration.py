"""Star Swarm Round 46: seven-minute creative orchestration of accepted Round 44 bed.
Source stems resynthesized from original project generators with the prior backing muted.
First two minutes taken from explicitly approved Round 45 mix, with a short edge blend.
Never samples licensed originals. Requires numpy scipy ffmpeg and bundled source files.
This is an audition, not mastered loop or in-game SFX mix.
"""
from pathlib import Path
import numpy as np, subprocess, json
from scipy.signal import resample_poly
R=Path(__file__).resolve().parent
SR=24000; D=420; N=SR*D

def decode(path):
    p=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()

def ease(v):
    v=np.clip(v,0,1);return v*v*(3-2*v)

def stem(filename, marker, patch, expression):
    source=(R/filename).read_text().split(marker,1)[0]
    assert patch in source, (filename,patch)
    # These originals have a backing mp3; replace it with silence of sufficient length
    # before executing only their original effect synthesis functions.
    replacement="src=np.zeros((2,N+120*SR),dtype=np.float32)" if patch.startswith('src=') else "old=np.zeros((2,N+120*SR),dtype=np.float32)"
    source=source.replace(patch,replacement)
    env={'__file__':str(R/filename),'__name__':'round46_stems','__builtins__':__builtins__}
    exec(compile(source,filename,'exec'),env)
    result=np.asarray(eval(expression,env),dtype=np.float32)
    print('Generated',filename,expression,result.shape,flush=True)
    return result

bed=decode(R/'starswarm-round44-seven-minute-ambient-foundation.mp3')[:,:N]
assert bed.shape==(2,N)
first=decode(R/'starswarm-round45-B-signature-orchestration.mp3')[:,:120*SR]
assert first.shape==(2,120*SR)
astro=stem('starswarm_round20_spotlight_signals.py','A,B=rise(),signals()',"src=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')",'rise()')
robots=stem('starswarm_round20_spotlight_signals.py','A,B=rise(),signals()',"src=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')",'signals()')
swarm=stem('starswarm_round18_foreground_chorus.py',"a=build('gathering')","old=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')","build('gathering')")
choir=stem('starswarm_round18_foreground_chorus.py',"a=build('gathering')","old=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')","build('electromagnetic')")
organ=stem('starswarm_round19_remaining_colors.py','a=astronomical()',"src=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')",'haunting()')

out=bed.astype(np.float64).copy()
# Approved 0:00–2:00 treatment is used *as mastered for the prior audition*.
# Last 0.7s blends back into unchanged Round 44 to avoid an MP3-boundary seam.
blend=int(.7*SR);boundary=120*SR
out[:,:boundary-blend]=first[:,:boundary-blend]
weight=ease(np.linspace(0,1,blend,endpoint=False))
out[:,boundary-blend:boundary]=first[:,boundary-blend:boundary]*(1-weight)[None,:]+bed[:,boundary-blend:boundary]*weight[None,:]
plan=[dict(name='Round 45 approved first two minutes',start=0,end=120)]

def add(name,src,src_start,at,duration,level,duck,fi=2.,fo=2.8,pitch=1.0,pan_offset=0.):
    i=int(round(at*SR));j=min(N,i+int(round(duration*SR)))
    n=j-i
    start=int(round(src_start*SR)); source=src[:,start:]
    if pitch!=1.0:
        # Slight transpose and speed difference, original generator voice only;
        # modest changes serve thematic context, not an exact replay.
        # polyphase ratio output length / input length
        if pitch==1.06: source=resample_poly(source,50,53,axis=1)
        elif pitch==.94: source=resample_poly(source,50,47,axis=1)
        elif pitch==1.04: source=resample_poly(source,25,26,axis=1)
        elif pitch==.96: source=resample_poly(source,25,24,axis=1)
        else: raise ValueError('unsupported pitch')
    assert source.shape[1]>=n,(name,source.shape,n)
    s=source[:,:n].astype(np.float64).copy()
    if pan_offset:
        # Subtle stereo perspective variation in recurring signatures.
        mid=.5*(s[0]+s[1]);side=.5*(s[0]-s[1]);s[0]=mid+side*(1+pan_offset);s[1]=mid-side*(1-pan_offset)
    t=np.arange(n,dtype=np.float64)/SR
    w=ease(t/fi)*ease((duration-t)/fo)
    out[:,i:j]*=(1-duck*w)[None,:]
    out[:,i:j]+=level*s*w[None,:]
    plan.append(dict(name=name,start=at,end=round(at+duration,2),variation={'source_start':src_start,'pitch':pitch,'level':level,'duck':duck}))

def shepard(at,duration,amp=.025,rate=.15,base=245.,duck=.32):
    i=int(round(at*SR));j=int(round((at+duration)*SR));t=np.arange(j-i,dtype=np.float64)/SR
    layer=np.zeros((2,j-i),np.float64)
    # Preserves the distinctive audible Round 40 octave-streaming descending illusion.
    for octv in range(-3,7):
        freq=base*np.exp2(octv-rate*t)
        weight=np.exp(-.5*(np.log2(np.maximum(freq,1.)/410.)/.9)**2)
        for ch in (0,1):
            ph=np.cumsum(freq*(1+.00045*ch))*(2*np.pi/SR)+octv*.93+ch*.48
            layer[ch]+=weight*np.sin(ph)
    env=ease(t/1.6)*ease((duration-t)/1.6)
    out[:,i:j]*=(1-duck*env)[None,:]
    out[:,i:j]+=amp*layer*env[None,:]
    plan.append(dict(name='audible descending Shepard',start=at,end=at+duration,variation={'amp':amp,'rate':rate,'base':base,'duck':duck}))

# Longer-form follow-through, revisiting known original signature families in
# different duration, contour/source offsets, register and dynamic context.
# At least 15 s between featured event windows; no rise directly beside Shepard.
shepard(136,13,amp=.029,rate=.125,base=245,duck=.35)   # first Shepard ~109 s after rise
add('distant organ color',organ,14,166,15,.65,.12,3.5,4.)
add('robotic signals – altered call sequence',robots,18,198,16,.71,.19,2.0,3.2,pitch=1.06)
add('astronomical rise – second higher arc',astro,11,233,17,.69,.25,2.4,3.4,pitch=1.04)
add('gathering swarm – darker reprise',swarm,16,266,16,.66,.27,2.5,3.0,pitch=.94)
add('electromagnetic choir – changed register',choir,13,300,15,.73,.24,2.4,3.3,pitch=1.06)
shepard(333,14,amp=.029,rate=.11,base=215,duck=.35)
add('robotic signals – final fragmented dialogue',robots,20,364,15,.70,.20,1.8,2.8,pitch=.96)
add('gathering swarm – shorter return',swarm,19,394,13,.62,.24,2.7,3.2,pitch=1.06)
# Leave 13s foundation-only until end of rough; no final impact sound or cadence.
# NOTE: actual Round 44 rough fades in/out; seamless loop is a separate acceptance gate.
maxpeak=max(float(np.max(np.abs(out))),float(np.max(np.abs(bed))))
# A global safety scalar only if absolutely necessary (not independent section leveling).
gain=min(1.0,.91/maxpeak)
out*=gain
print('Peak',maxpeak,'global safety gain',gain,'events',json.dumps(plan),flush=True)
for name,x in [('starswarm-round46-seven-minute-signature-mix.mp3',out)]:
    cmd=['ffmpeg','-y','-v','error','-f','f32le','-ar',str(SR),'-ac','2','-i','pipe:0','-c:a','libmp3lame','-b:a','128k',str(R/name)]
    subprocess.run(cmd,input=np.ascontiguousarray(x.T,dtype='<f4').tobytes(),check=True)
(R/'round46_cues.json').write_text(json.dumps({'events':plan,'safety_gain':gain},indent=2))
