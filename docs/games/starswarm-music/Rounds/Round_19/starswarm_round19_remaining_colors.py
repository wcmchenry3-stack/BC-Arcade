"""Star Swarm Round 19: focused original procedural additions to original Round 17A.
No source BG-1...4 recording is read/sampled. Audition only.
"""
from pathlib import Path
import numpy as np, soundfile as sf, subprocess, tempfile
from scipy.signal import butter, sosfilt
P=Path('/mnt/data'); SR=24000; D=46; N=SR*D
T=np.arange(N,dtype=np.float32)/SR

def decode(path):
    p=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()
def sm(z):
    z=np.clip(z,0,1); return z*z*(3-2*z)
def seg(x,start,end):
    return x[int(start*SR):int(end*SR)]
def ambience(seed,low,high,n):
    g=np.random.default_rng(seed); y=g.normal(0,1,n).astype(np.float32)
    lo=max(10,low);hi=min(high,SR*.46)
    return sosfilt(butter(2,[lo,hi],fs=SR,btype='bandpass',output='sos'),y).astype(np.float32)
def reflect(x,delays):
    for ch in range(2):
        dry=x[ch].copy()
        for sec,g in delays:
            k=int(SR*(sec+(0.12 if ch else 0)))
            x[ch,k:]+=dry[:-k]*g
    return x

# Use SAME bed excerpt as all 3 tests; context is a project-generated ORIGINAL composition.
src=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')
bed=src[:,int(70*SR):int(70*SR)+N].copy()
assert bed.shape==(2,N)

# Astronomical rising sonority: octave-independent partial arcs climb in overlapping sweeps.
# Small streaks use fine/noisy tails; neither is a literal space-gun sound.
def astronomical():
    x=bed.copy(); layer=np.zeros_like(x)
    for k,(start,stop,f0,amp) in enumerate([(8,22,115,.012),(21,39,165,.011)]):
        i=int(start*SR); j=int(stop*SR)
        tt=T[i:j]-start
        prog=tt/(stop-start)
        rise=2**(.82*prog)
        env=sm(tt/2.4)*sm((stop-start-tt)/3.0)
        for h in range(1,7):
            ff=f0*rise*h*(1+.004*np.sin(2*np.pi*(.17+.02*k)*tt+.5*h))
            ph=np.cumsum(ff,dtype=np.float64)*(2*np.pi/SR)+k+.4*h
            partial=(np.sin(ph)*env*amp/h**1.3).astype('float32')
            pan=.5+.36*np.sin(.12*tt+k+.4*h)
            layer[0,i:j]+=partial*np.sqrt(2*(1-pan))
            layer[1,i:j]+=partial*np.sqrt(2*pan)
    rng=np.random.default_rng(1901)
    for k,start in enumerate([13.1,16.3,26.0,35.4]):
        dur=[1.1,.63,1.7,.94][k];i=int(start*SR);j=min(N,i+int(dur*SR));tt=np.arange(j-i)/SR
        # Uneven textured flickers: short, bright then distant; not conventional identical whooshes.
        fil=ambience(1902+k,750+230*k,4100+200*k,j-i)
        glide=1450*2**(-.38*tt/dur)
        ph=np.cumsum(glide)*2*np.pi/SR
        streak=(.7*fil+.15*np.sin(ph))*np.exp(-3.5*tt/dur)*(sm(tt/.08))
        streak*= [.0022,.0014,.0029,.0018][k]
        p=[.18,.82,.65,.25][k]
        layer[0,i:j]+=(streak*np.sqrt(2*(1-p))).astype('float32')
        layer[1,i:j]+=(streak*np.sqrt(2*p)).astype('float32')
    reflect(layer,[(.28,.24),(.87,.17),(1.9,.11)])
    # Make modest headroom for rising arc rather than stack/limit.
    duck=sm((T-12)/3)*sm((36-T)/3)
    x*= (1-.12*duck)[None,:]
    return x+layer

# Distant organ: stable root but ambiguous upper-partials, band-limited, diffuse; not an exposed pipe stop.
def haunting():
    x=bed.copy();layer=np.zeros_like(x)
    events=[(5,27,51,.013),(11,38,58,.012),(16,41,63,.009),(25,45,70,.006)]
    for k,(start,stop,midi,gain) in enumerate(events):
        i=int(start*SR);j=min(N,int(stop*SR));tt=T[i:j]-start
        f0=440*2**((midi-69)/12)
        env=sm(tt/4)*sm((stop-start-tt)/4)
        drift=1+.0014*np.sin(2*np.pi*.12*tt+k)+.0010*np.sin(2*np.pi*.23*tt+.3*k)
        phase=np.cumsum(f0*drift,dtype=np.float64)*2*np.pi/SR+k*.9
        sig=np.zeros(j-i,dtype=np.float32)
        # Deliberately conceal a conventional organ signature by varying harmonic ratios and air.
        for h,weight in [(1,.52),(2,.16),(3,.31),(4,.08),(5,.12),(7,.07)]:
            amp=weight*(.83+.17*np.sin(.29*tt+h+k))
            sig+=(amp*np.sin(h*phase+.2*h*h)).astype(np.float32)
        p=.45+.25*np.sin(.077*tt+k)
        sig*=env*gain
        layer[0,i:j]+=sig*np.sqrt(2*(1-p))
        layer[1,i:j]+=sig*np.sqrt(2*p)
    # Diffuse distant returns instead of a recognizably dry foreground organ.
    reflect(layer,[(.41,.42),(1.14,.29),(2.5,.24),(3.6,.10)])
    air=ambience(1915,1000,3200,N)
    air*=.00045*(sm((T-9)/7)*sm((44-T)/6))
    layer[0]+=air;layer[1]+=np.roll(air,int(.12*SR))
    x*= (1-.07*sm((T-14)/5)*sm((42-T)/6))[None,:]
    return x+layer

# 'Something lurks': faint irregular preparatory signals then brief inharmonic robotic reply.
def lurking():
    x=bed.copy(); layer=np.zeros_like(x)
    rng=np.random.default_rng(1930)
    # Sparse premonitory tonal ripples, each irregular in timing/timbre.
    for k,(start,dur,f0) in enumerate([(11.2,2.4,165),(17.8,3.3,132),(23.6,2.1,197)]):
        i=int(start*SR);j=min(N,i+int(dur*SR));tt=np.arange(j-i,dtype=np.float32)/SR
        ff=f0*(1-.07*tt/dur+.015*np.sin(2*np.pi*.47*tt+k))
        ph=np.cumsum(ff,dtype=np.float64)*2*np.pi/SR
        e=sm(tt/.28)*sm((dur-tt)/1.2)
        sig=(.67*np.sin(ph)+.18*np.sin(1.73*ph)+.13*np.sin(2.41*ph))*.0035*e
        pan=[.85,.22,.67][k]
        layer[0,i:j]+=(sig*np.sqrt(2*(1-pan))).astype('float32')
        layer[1,i:j]+=(sig*np.sqrt(2*pan)).astype('float32')
    # The reveal is not a one-hit gun; short, uneven machinery-like vowel resonances.
    start=29.;duration=7.6;i=int(start*SR);j=int((start+duration)*SR);tt=np.arange(j-i,dtype=np.float32)/SR
    base=116*(1+.11*np.sin(2*np.pi*.29*tt)+.018*np.sin(2*np.pi*2.2*tt))
    ph=np.cumsum(base,dtype=np.float64)*2*np.pi/SR
    e=sm(tt/1.1)*sm((duration-tt)/1.6)
    cycles=(.72+.18*np.sin(2*np.pi*2.65*tt+.2)+.09*np.sin(2*np.pi*5.1*tt))
    sound=(.63*np.sin(ph)+.29*np.sin(2.32*ph+.3)+.21*np.sin(3.77*ph+.9)+.1*np.sin(5.11*ph))*e*cycles*.010
    p=.5+.37*np.sin(.7*tt)
    layer[0,i:j]+=(sound*np.sqrt(2*(1-p))).astype('float32')
    layer[1,i:j]+=(sound*np.sqrt(2*p)).astype('float32')
    reflect(layer,[(.34,.28),(.96,.23),(1.74,.16)])
    # Not ocean surf: no periodic broadband noise swells.
    duck=.12*sm((T-28)/2)*sm((39-T)/3)
    x*=(1-duck)[None,:]
    return x+layer

a=astronomical();b=haunting();c=lurking()
# Common gain preserves fair relative level, avoiding individual normalization that falsely rewards busier effects.
peak=max(float(np.max(np.abs(y))) for y in [a,b,c]); gain=min(.87/peak,.085/max(float(np.sqrt(np.mean(y*y))) for y in [a,b,c]))
for name,data in [('starswarm-round19-A-astronomical-rises',a),('starswarm-round19-B-distant-organ',b),('starswarm-round19-C-lurking-signal',c)]:
    out=P/(name+'.mp3')
    with tempfile.NamedTemporaryFile(suffix='.wav') as tf:
        sf.write(tf.name,(data*gain).T,SR,subtype='PCM_16')
        subprocess.run(['ffmpeg','-y','-v','error','-i',tf.name,'-c:a','libmp3lame','-b:a','112k',str(out)],check=True)
    print(out.name,out.stat().st_size,'rms',float(np.sqrt(np.mean((data*gain)**2))))
