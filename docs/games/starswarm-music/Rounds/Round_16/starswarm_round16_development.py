"""Round 16: ~2m40s original Star Swarm musical-development sketches.
A: extended electromagnetic composition, based on approved 15A opening.
B: identical composition with a restrained descending Shepard-Risset gesture.
Uses only in-house synthesized material; prior *original* Round15A sketch reused to retain first 44s.
Not a final loop/game asset. No reference/source audio is read.
"""
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly
import subprocess

P=Path('/mnt/data'); SR=24000; DUR=160.; N=int(DUR*SR); t=np.arange(N,dtype=np.float32)/SR
rng=np.random.default_rng(1616)
def sm(v):
    v=np.clip(v,0,1);return v*v*(3-2*v)
def hz(note):return 440*2**((note-69)/12)
def write_tone(x, note,a,b,amp,seed=0,inh=.25,atk=.3,rel=2.,freqdrift=.0008,pan=.1,beat=.16):
    i=max(0,int(a*SR));j=min(N,int(b*SR));
    if j<=i:return
    q=t[i:j].astype(np.float64); rr=np.random.default_rng(seed+321);env=sm((q-a)/max(.001,atk))*sm((b-q)/max(.001,rel))
    for ch in range(2):
        fr=hz(note)*(1+.0018*ch+freqdrift*np.sin(q*.7+seed)+freqdrift*.45*np.sin(q*1.53+ch*2+seed))
        ph=np.cumsum(fr)*(2*np.pi/SR)+rr.uniform(0,np.pi*2)
        sh=.76+.24*np.sin(q*.59+seed*.3+ch*.67)
        yy=np.sin(ph)+.23*sh*np.sin(ph*2+.8)+inh*sh*np.sin(ph*1.4142+.2)+.07*np.sin(ph*2.71+1.4)
        trem=1+beat*(.32*np.sin(2*np.pi*.8*q+seed*.47)+.24*np.sin(2*np.pi*1.34*q+ch*.8))
        x[ch,i:j]+=(amp*env*trem*yy*(1+pan*(ch-.5))).astype('float32')
def hiss(x,seed,a,b,amp,lo,hi):
    rr=np.random.default_rng(seed);i=int(a*SR);j=min(N,int(b*SR));m=j-i
    if m<=0:return
    for ch in range(2):
        y=rr.standard_normal(m).astype('float32')
        y=sosfilt(butter(2,lo,fs=SR,btype='highpass',output='sos'),y)
        y=sosfilt(butter(2,hi,fs=SR,btype='lowpass',output='sos'),y).astype('float32')
        y/=max(np.sqrt(np.mean(y*y)),1e-10)
        q=t[i:j];l=.7+.3*np.sin(.47*q+.8*ch)+.13*np.sin(1.67*q+2*ch)
        env=sm((q-a)/3.5)*sm((b-q)/4.0)
        x[ch,i:j]+=amp*y*l*env

def space_environment():
    x=np.zeros((2,N),dtype='float32')
    # Sustainable, evolving sci-fi foundation: partly inharmonic, wide and living.
    for k,(pitch,amp) in enumerate([(31,.059),(43,.037),(50,.021),(44,.014),(54,.012)]):
        write_tone(x,pitch,0,DUR,amp,810+k,inh=.24+.07*(k%3),atk=.03,rel=3.,beat=.15)
    for k,(note,a,b,amp) in enumerate([(32,44,97,.026),(45,48,91,.017),(51,67,120,.018),
                                      (34,89,137,.028),(47,96,154,.018),(29,123,159,.016),
                                      (52,116,158,.015)]):
        write_tone(x,note,a,b,amp,920+k,inh=.32,atk=5,rel=6,beat=.21)
    for seed,a,b,amp,lo,hi in [(993,0,DUR,.00105,75,390),(995,2,DUR,.0007,1000,5100)]:
        hiss(x,seed,a,b,amp,lo,hi)
    return x

# Distinct compositional states based on the sound vocabulary, not cut-paste repeating 15A.
# 0–45: retain exact Round15A (except minor codec differences); 45–90: shadow/suspension.
# 90–121: moment of uncertainty, thinning voices; 121–160: renewed resolve.
def compose():
    x=space_environment()
    # Movement from the approved opening's pitch world, but transforms after 44 s.
    mid=[(59,36,51,.018),(61,43,58,.030),(64,49,67,.023),(60,57,71,.028),
         (55,65,82,.025),(58,73,93,.031),(63,83,103,.021),(66,95,113,.016),
         (61,107,122,.025),(68,121,135,.032),(65,128,144,.030),(69,136,154,.026),
         (64,148,160,.028)]
    for k,(n,a,b,v) in enumerate(mid):write_tone(x,n,a,b,v,1000+k,inh=.27,atk=1.4,rel=3.8,beat=.14)
    # Lower-register irregular pulses signal purposeful military motion and do not form a drumbeat.
    times=[];tm=42.3;k=0
    while tm<157:
        # slow during uncertainty, then firmer during resolve
        step=[2.2,2.8,1.7,3.0,2.15][k%5]*(1.38 if 90<tm<120 else .9 if tm>121 else 1)
        times.append(tm);tm+=step;k+=1
    scale=[43,47,42,45,49,44,46,50,43,47,45,48]
    for k,a in enumerate(times):
        # pulsing remains active through sparse passages, but less frontal
        v=.0085 if 90<a<119 else (.012 if a>=121 else .0096)
        write_tone(x,scale[k%len(scale)],a,min(DUR,a+2.5),v,1200+k,inh=.35,atk=.018,rel=1.9,beat=.2)
    # Shorter upper-register responses that move independently of the long pad harmony.
    upper=[(73,47,52,.011),(74,56,63,.010),(71,70,78,.012),(77,82,91,.012),
           (75,96,102,.008),(72,110,117,.010),(78,124,130,.010),(76,133,139,.014),
           (80,144,151,.011),(77,153,159,.009)]
    for k,(n,a,b,amp) in enumerate(upper):write_tone(x,n,a,b,amp,1400+k,inh=.24,atk=1.2,rel=2.4)
    # One muted, elusive organ-like thread: not a traditional recognizable pipe organ.
    for k,(n,a,b) in enumerate([(56,52,77),(54,75,105),(57,118,151)]):
        write_tone(x,n,a,b,.0105,1450+k,inh=.05,atk=5.,rel=7.,beat=.09)
    # The ambient bed isn't reduced to silence: quieter foreground in suspense passage.
    dynamics=np.interp(t,[0,43,57,72,86,94,109,120,130,143,154,160],
                       [1.0,1.0,.92,1.09,1.03,.74,.83,.98,1.15,1.07,1.23,.76])
    x*=dynamics.astype('float32')[None,:]
    # Long diffuse reflections in the same space; all from original synthesis.
    for ch in range(2):
        dry=x[ch].copy()
        for delay,gain in [(0.37+ch*.09,.10),(1.08+ch*.13,.076),(2.08+ch*.32,.047)]:
            d=int(delay*SR);x[ch,d:]+=dry[:-d]*gain
    # Preserve the *approved 15A opening* exactly for 0–43.5; crossfade into continuous new harmony.
    path=P/'starswarm-round15-A-patrol-momentum.mp3'
    rr=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','f32le','-acodec','pcm_f32le','-ac','2','-ar',str(SR),'-'],capture_output=True,check=True)
    old=np.frombuffer(rr.stdout,dtype='<f4').reshape(-1,2).T.copy()
    length=min(old.shape[1],int(48*SR)); start=int(43.5*SR); stop=int(48*SR)
    # Continuation derives from same key/register/timbre palette; crossfade avoids hard reset.
    x[:,:start]=old[:,:start]
    xx=np.arange(stop-start,dtype='float32')/(stop-start)
    c=np.cos(xx*np.pi/2)**2
    x[:,start:stop]=old[:,start:stop]*c[None,:]+x[:,start:stop]*(1-c[None,:])
    # gentle audition-only ending
    x*=sm((DUR-t)/2.)[None,:]
    return x

def shepard_descent(x):
    # Moving octave layers with cyclical pitch and stationary spectral center; subtle, optional.
    # This is an apparent continuous descent, not the explicit stepwise melody discussed separately.
    start=123.;end=147.;i=int(start*SR);j=int(end*SR)
    q=t[i:j].astype(np.float64); duration=end-start
    phase_oct=-(q-start)*.135  # a touch over three octaves through its 24s span
    extra=np.zeros((2,j-i),np.float32)
    for octv in range(-4,6):
        semis=phase_oct+octv
        freq=220.*2.**semis
        # spectral bell fixed in absolute frequency, so octave components recycle smoothly
        weight=np.exp(-.5*(np.log2(freq/450.)/.92)**2)
        for ch in range(2):
            f=freq*(1+.0005*ch)
            ph=np.cumsum(f)*(2*np.pi/SR)+octv*1.143+ch*.83
            extra[ch]+=(weight*np.sin(ph)).astype('float32')
    env=sm((q-start)/5.0)*sm((end-q)/5.)
    # In low-mid mix, no added harsh whistling: the listener can assess its utility.
    extra*= (env*.0058)[None,:]
    x[:,i:j]+=extra
    return x

def encode(name,x):
    wav=P/(name+'.wav');mp3=P/(name+'.mp3')
    sf.write(wav,x.T,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(wav),'-c:a','libmp3lame','-b:a','112k',str(mp3)],check=True)
    wav.unlink()
    print(name,'duration',DUR,'bytes',mp3.stat().st_size,'rms',float(np.sqrt(np.mean(x*x))), 'max',float(np.max(np.abs(x))))

if __name__=='__main__':
    a=compose();b=shepard_descent(a.copy());peak=max(np.abs(a).max(),np.abs(b).max())
    common=min(.92/peak,.085/np.sqrt(np.mean(a*a)))
    a*=common;b*=common
    encode('starswarm-round16-A-electromagnetic-journey',a)
    encode('starswarm-round16-B-shepard-descent',b)
