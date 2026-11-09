"""Round 15 original Star Swarm auditions. No third-party audio is opened.
A: restrained additional directional movement on Round 14A procedural score.
B: same music with an organic, quivering chorus-like swarm, not an event-timed game cue.
"""
import importlib.util
from pathlib import Path
import numpy as np
import soundfile as sf
import subprocess
from scipy.signal import butter, sosfilt
P=Path('/mnt/data')
spec=importlib.util.spec_from_file_location('round14',P/'starswarm_round14_patrol_swarm.py')
r14=importlib.util.module_from_spec(spec);spec.loader.exec_module(r14)
SR=r14.SR;N=r14.N;D=r14.D;t=r14.t

def add_momentum(x):
    # Stronger, but still background-scale, midrange response figures and clipped pattern.
    pulses=[0.7,2.9,5.0,7.5,10.0,11.8,14.1,16.6,19.0,21.7,23.4,25.9,28.2,30.8,33.2,35.1,37.5,40.2,42.3,44.8,47.1,49.7,52.1]
    pitches=[50,53,48,55,51,54,49,56,52,55,50,57,53,49,56,52,58,54,51,59,55,52,58]
    for k,(a,n) in enumerate(zip(pulses,pitches)):
        r14.voice(x,n,a,min(D,a+2.3),.0078,10100+k,inh=.29,beat=.23,atk=.016,release=1.36)
    # Three very slowly counter-moving harmonic statements, coherent but never fanfare.
    for k,(n,a,b) in enumerate([(66,3.5,16),(69,16,30),(70,29,43),(67,40,55)]):
        r14.voice(x,n,a,b,.012,10200+k,inh=.34,beat=.21,atk=1.4,release=2.7)
    return x

def chorus_swarm(x):
    rng=np.random.default_rng(1515)
    # Ensemble members overlap but have independent entrances, vibrato/rate and stereo drift.
    # Narrow vowel-esque formants make this a quivering distant chorus, not another big pad.
    starts=rng.uniform(15,29,26)
    full=np.zeros_like(x)
    for j,a in enumerate(starts):
        b=min(D-.3, a+rng.uniform(17,29))
        lo,hi=int(a*SR),int(b*SR)
        q=t[lo:hi].astype(np.float64)
        n=int(rng.choice([53,55,56,58,60,61,63,65,67,68]))
        base=r14.pitch(n)*2**(rng.normal(0,0.24)/12)
        att=rng.uniform(1.5,4.0);rel=rng.uniform(2.8,5.2)
        envelope=r14.smooth((q-a)/att)*r14.smooth((b-q)/rel)
        vibrate_hz=rng.uniform(4.8,7.7)
        phase0=rng.uniform(0,2*np.pi)
        freq=base*(1+(.0030+.001*rng.random())*np.sin(2*np.pi*vibrate_hz*q+phase0)+.0025*np.sin(q*.37+j))
        phase=np.cumsum(freq)*2*np.pi/SR+phase0
        # quasi-choir partials softened by changing vowel-formant-like weighting
        vowel=.5+.5*np.sin(2*np.pi*(.065+.004*j)*q+phase0)
        y=(.68*np.sin(phase)+(.32+.13*vowel)*np.sin(2*phase+.2)+(.1+.17*(1-vowel))*np.sin(3*phase+.6)+.08*np.sin(4*phase+1.0))
        # Quiver is tremolo + pitch beating, not sporadic disconnected metallic one-shots.
        quiver= .65 + .21*np.sin(2*np.pi*(5.3+.09*j)*q+phase0)+.14*np.sin(2*np.pi*(.61+.013*j)*q+phase0)
        pan=.5+.36*np.sin(.17*q+.89*j)
        level=rng.uniform(.0017,.0030)
        full[0,lo:hi] += (level*envelope*quiver*y*np.sqrt(2*(1-pan))).astype('float32')
        full[1,lo:hi] += (level*envelope*quiver*y*np.sqrt(2*pan)).astype('float32')
    # The chorus is discovered within the piece, building then loosening, with no sharp cue.
    env=np.interp(t,[0,13,19,27,35,42,48,56],[0,0,.3,.85,1,.75,.26,0]).astype('float32')
    for ch in (0,1):
        dry=full[ch].copy()
        for seconds,gain in [(0.53+.17*ch,.22),(1.27+.21*ch,.19),(2.35+.26*ch,.13)]:
            d=int(seconds*SR);full[ch,d:]+=dry[:-d]*gain
    return x+full*env[None,:]

def encode(name,x,g):
    wav=P/(name+'.wav');mp3=P/(name+'.mp3')
    sf.write(wav,(g*x).T,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
    wav.unlink()
    print(name,mp3.stat().st_size,'rms',round(float(np.sqrt(np.mean((x*g)**2))),5))

if __name__=='__main__':
    x=add_momentum(r14.composition('A'))
    y=chorus_swarm(x.copy())
    # Respect the dynamic envelopes; one fixed shared gain, no flattening or compressor.
    peak=max(float(np.max(np.abs(x))),float(np.max(np.abs(y))))
    g=min(.78/(peak+1e-12),.087/(np.sqrt(np.mean(y*y))+1e-12))
    encode('starswarm-round15-A-patrol-momentum',x,g)
    encode('starswarm-round15-B-quivering-swarm',y,g)
