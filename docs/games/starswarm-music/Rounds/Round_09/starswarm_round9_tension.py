"""Round 9: controlled tension auditions built on approved Round 8B.
Original synthesized additions only. No licensed reference audio or samples.
These are prototypes and are not meant to loop or ship in the game.
"""
from pathlib import Path
import subprocess
import numpy as np
from scipy.signal import butter, sosfilt

ROOT=Path('/mnt/data'); SR=24000; D=75.0; N=int(SR*D)
t=np.arange(N,dtype=np.float64)/SR

def decode(path):
    p=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()[:,:N].astype(np.float64)

def smooth_gate(start,end,attack=4,release=5):
    x=np.clip((t-start)/attack,0,1)
    y=np.clip((end-t)/release,0,1)
    return np.sin(x*np.pi/2)**2*np.sin(y*np.pi/2)**2

def synth(freq, start, end, gain, seed, harmonics=(1,.35,.14), drift=.002, attack=6, release=9, pan=0):
    rng=np.random.default_rng(seed)
    wobble=drift*np.sin(2*np.pi*(.037+.011*rng.random())*t+rng.uniform(0,6.28))
    wobble+=drift*.4*np.sin(2*np.pi*.117*t+rng.uniform(0,6.28))
    envelope=smooth_gate(start,end,attack,release)*gain
    sig=np.zeros(N)
    for i,amp in enumerate(harmonics):
        f=(i+1)*freq*(1+.0012*i)
        ph=2*np.pi*np.cumsum(f*(1+wobble))/SR+rng.uniform(0,6.28)
        sig+=amp*np.sin(ph)
    # gently different response at each speaker instead of a fake panning sweep
    lg=np.cos((pan+1)*np.pi/4); rg=np.sin((pan+1)*np.pi/4)
    return np.stack([sig*envelope*lg,sig*envelope*rg])

def diffuse(y, taps):
    z=y.copy()
    for delay,amp,cross in taps:
        k=int(delay*SR)
        if k>=N:continue
        z[:,k:]+=amp*((1-cross)*y[:,:-k]+cross*y[::-1,:-k])
    return z

base=decode(ROOT/'starswarm-round8-B-distant-haunting.mp3')
# A: gather pressure, inharmonic close intervals slowly overlapping; gentle low tension
A=np.zeros_like(base)
for args in [
    (98.00,17,67,.009,901,(1,.16,.06),.0015,8,12,-.1),
    (103.83,29,70,.011,902,(1,.24,.06),.0018,8,13,.20),
    (155.56,37,73,.0065,903,(1,.13,.05),.0012,9,9,-.35),
    (146.83,48,75,.0062,904,(1,.16,.06),.0014,7,9,.36),
    (196.00,52,75,.0042,905,(1,.12,.04),.0015,7,9,-.22),
]:
    A+=synth(*args)
# swells, not a regular wave; contrast from a restrained ascent over last 30 sec
intensity=np.interp(t,[0,12,25,37,48,60,71,75],[0,0,.18,.32,.48,.72,.78,.45])
A*=intensity[None,:]
A=diffuse(A,[(.28,.20,.35),(.89,.15,.60),(2.4,.10,.80)])
# a little low tension with beating partials, but avoid bass overloading headphones
low=np.sin(2*np.pi*(49.0*t+.05*np.sin(.08*t)))+ .58*np.sin(2*np.pi*49.34*t+1.4)
A+=np.stack([low,low*.84])*smooth_gate(28,75,12,8)[None,:]*.006

# B: uncertainty, negative space, small seemingly unrelated far-off harmonic traces
B=np.zeros_like(base)
for args in [
    (164.81,17,43,.007,981,(1,.09,.04),.0024,7,10,-.60),
    (174.61,33,59,.008,982,(1,.10,.07),.0031,6,10,.61),
    (123.47,48,75,.009,983,(1,.12,.03),.0018,10,9,-.44),
    (116.54,54,75,.006,984,(1,.16,.05),.0021,8,10,.47),
]:
    B+=synth(*args)
# dry vs distant: slow isolated arrivals with high frequency suppressed and long offset reflections
sos=butter(2,[100,1250],btype='bandpass',fs=SR,output='sos')
B=sosfilt(sos,B,axis=1)
B=diffuse(B,[(.52,.24,.65),(1.62,.22,.85),(3.33,.13,.75),(5.15,.09,1.)])
# Sparse moment of 'absence' made by gently lowering the *added* layers, not ducking core approved bed
silence_curve=np.interp(t,[0,17,27,33,39,45,53,58,64,73,75],[0,0,.55,.95,.17,.40,.75,.10,.65,.8,.65])
B*=silence_curve[None,:]

# Both preserve base entirely; choose modest added amounts, shared maximum scale, no leveling.
yA=base+A
yB=base+B
common_peak=max(np.max(abs(yA)),np.max(abs(yB)))
scale=min(1.,.93/common_peak)
for name,y in [('starswarm-round9-A-gathering-threat.mp3',yA),('starswarm-round9-B-unseen-presence.mp3',yB)]:
    y=np.asarray(y*scale,dtype='<f4')
    p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i','-','-codec:a','libmp3lame','-b:a','128k',str(ROOT/name)],stdin=subprocess.PIPE)
    p.communicate(y.T.tobytes())
    if p.returncode:raise RuntimeError('ffmpeg failed')
    print(name, (ROOT/name).stat().st_size, 'RMS', round(float(np.sqrt(np.mean(y*y))),5), 'peak',round(float(np.max(abs(y))),4))
