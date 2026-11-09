"""Round 18: Two original, foreground chorus hypotheses for Star Swarm.
Uses ONLY previously project-generated Star Swarm Round 17 soundtrack as contextual bed.
No licensed BG tracks are read or sampled. These are 44-sec audition MP3s, not release assets.
"""
from pathlib import Path
import numpy as np, soundfile as sf, subprocess, tempfile
from scipy.signal import butter, sosfilt
P=Path('/mnt/data'); SR=24000; DUR=44; N=SR*DUR
t=np.arange(N,dtype=np.float32)/SR
rng=np.random.default_rng(1808)
def decode(path):
    p=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()
def soft(x):
    z=np.clip(x,0,1);return z*z*(3-2*z)
def gaussian(f,mu,width): return np.exp(-0.5*((f-mu)/width)**2)
# A section of the original in-house composition (not the four Pixabay originals).
old=decode(P/'starswarm-round17-A-electromagnetic-expansion.mp3')
start=int(96*SR);bed=old[:,start:start+N].copy()
assert bed.shape==(2,N)
# Composite bed dips 2–3 dB while the choral statement is foregrounded.
gate=soft((t-9)/7)*soft((38-t)/6)
base=bed*(1-.25*gate)[None,:]
# Both are composed with strong, foreground choral peaks, rather than a quiet quiver texture.
# Upper parts use shifting suspended sonorities that don't reproduce reference pitch sequences.
progression=[(0,[50,57,62,65]),(12,[50,58,63,67]),(23,[48,55,62,68]),(34,[50,57,63,69])]
def tone_notes(tt):
    return None

def build(kind):
    rng=np.random.default_rng(1842 if kind=='gathering' else 1877)
    chorus=np.zeros((2,N),dtype=np.float32)
    # Entrance ~0:07, full chorus ~0:17–0:33, then withdraw.
    envelope=soft((t-5)/12)*soft((42-t)/8)
    # Independent sonic body for each individual sustained vocal line and its harmonics.
    # Vocal formant weighting at ~700, 1150, 2400 Hz; B shifts formants over time.
    nvoices=20
    for j in range(nvoices):
        v=j%5;section=(j//5)%4
        note=progression[section][1][v%4]+(12 if j>=12 else 0)
        f0=440*2**((note-69)/12)
        detune=rng.normal(0,4.3) # cents
        ff=f0*2**(detune/1200)
        # Slow, natural oscillator instability + compact synthetic chorus diffusion.
        phase_j=rng.uniform(0,2*np.pi)
        vi=.0017*np.sin(2*np.pi*(4.0+.13*v)*t+phase_j)+.0005*np.sin(2*np.pi*.21*t+phase_j)
        if kind=='electromagnetic':
            vi+=.0022*np.sin(2*np.pi*(5.2+.1*section)*t+.3*v)
        freq=ff*(1+vi)
        phase=np.cumsum(freq,dtype=np.float64)*(2*np.pi/SR)+phase_j
        # Shared choral sonic envelope; per-voice arrival not equal.
        time_j=t-(3.7+.36*j)
        arrival=soft(time_j/(6.5+.2*v))*soft((42.5-t)/(6.5+.2*v))
        move=.83+.15*np.sin(.23*t+1.1*j)
        if kind=='electromagnetic':
            # Time-varying formants and modulation produce an alien-choir sensation.
            f1=700+140*np.sin(.19*t+.2*j)
            f2=1250+220*np.sin(.13*t+section)
            f3=2250+290*np.sin(.18*t+phase_j)
            trem=.74+.19*np.sin(2*np.pi*(4.3+.08*section)*t+phase_j)+.07*np.sin(2*np.pi*8.4*t+j)
        else:
            f1=np.full(N,740,dtype=np.float32);f2=np.full(N,1190,dtype=np.float32);f3=np.full(N,2320,dtype=np.float32)
            trem=.94+.05*np.sin(2*np.pi*.31*t+j)
        signal=np.zeros(N,dtype=np.float32)
        # Bandlimited harmonic bank, explicit vowel formants, no vocal samples.
        for h in range(1,17):
            hz=h*ff
            if hz>6500:break
            amp=(.42*gaussian(hz,f1,240)+.5*gaussian(hz,f2,360)+.55*gaussian(hz,f3,480)+.18)*h**(-1.08)
            signal+=(amp*np.sin(phase*h+.06*j*h)).astype(np.float32)
        p=.5+.30*np.sin(.035*t+1.45*j)
        strength=.018 if kind=='gathering' else .017
        sig=signal*arrival*move*trem*strength
        chorus[0]+=(sig*np.sqrt(2*(1-p))).astype(np.float32)
        chorus[1]+=(sig*np.sqrt(2*p)).astype(np.float32)
    # Harmonically coherent collective swelling *in front* of the bed.
    rise=np.interp(t,[0,6,12,17,22,27,31,35,38,44],[0,0,.5,1,1.06,.88,1.09,.8,.55,0]).astype(np.float32)
    chorus*= (envelope*rise)[None,:]
    # Widely separated, asymmetric reflections; dry signal remains obvious and strong.
    for ch in range(2):
        dry=chorus[ch].copy()
        for delay,gain in [(0.23+ch*.06,.19),(.71+ch*.13,.15),(1.46+ch*.19,.1)]:
            k=int(SR*delay);chorus[ch,k:]+=dry[:-k]*gain
    return base+chorus

a=build('gathering');b=build('electromagnetic')
# Peak match the pair with common scaling; preserve real dynamic contrast.
pk=max(np.abs(a).max(),np.abs(b).max())
gain=.87/pk
for label,x in [('A-gathering-chorus',a),('B-electromagnetic-choir',b)]:
    out=P/('starswarm-round18-'+label+'.mp3')
    with tempfile.NamedTemporaryFile(suffix='.wav') as tf:
        sf.write(tf.name,(x*gain).T,SR,subtype='PCM_16')
        subprocess.run(['ffmpeg','-y','-v','error','-i',tf.name,'-c:a','libmp3lame','-b:a','112k',str(out)],check=True)
    print(label, out.stat().st_size, 'peak',round(float(np.max(np.abs(x*gain))),3), 'rms',round(float(np.sqrt(np.mean((x*gain)**2))),4))
