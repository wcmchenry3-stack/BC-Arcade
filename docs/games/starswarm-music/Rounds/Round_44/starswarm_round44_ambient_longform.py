#!/usr/bin/env python3
"""Star Swarm Round 44: seven-minute original, foundation-only ambient score.
Uses Round 42.8's synthesized tonal vocabulary, develops seven unique harmonic
regions with sparse recurring lead phrases; no signature effects, samples,
or existing MP3/WAV input. Requires numpy/scipy/soundfile and ffmpeg.
"""
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve
import subprocess

SR=24000
SEG=63.0
OVER=3.5
COUNT=7
DUR=SEG*COUNT-OVER*(COUNT-1)
L=int(SEG*SR); O=int(OVER*SR)
OUT=Path(__file__).resolve().parent
rng=np.random.default_rng(440042)

def hz(n): return 440.0*2.0**((n-69)/12)
def smooth(x): x=np.clip(x,0,1); return x*x*(3-2*x)
def fade(t,start,end,atk=4.,rel=5.):
    return smooth((t-start)/atk)*smooth((end-t)/rel)*((t>=start)&(t<=end))
def hp(x, cutoff):
    return sosfilt(butter(2,cutoff,fs=SR,output='sos',btype='highpass'),x,axis=0)

# Seven RELATED, DIFFERENT harmonic/melodic passages. Open pedal/fifths,
# minor/add9/sus/shimmer; no cadential hymn progressions, no pulse or drums.
# Values are MIDI notes: pad voicings include some held fourths/ninths.
REGIONS=[
  dict(name='Persistent horizon',ped=28,pads=[[40,47,57,62],[40,47,59,64],[40,47,57,66],[40,47,59,62]],lead=[(9,15,71),(29,36,74),(50,56,73)],energy=.94),
  dict(name='Spectral expansion',ped=28,pads=[[40,47,59,66],[40,47,61,64],[40,47,57,62],[40,47,61,69]],lead=[(5,11,76),(35,42,73),(51,58,74)],energy=.98),
  dict(name='Dark current',ped=26,pads=[[38,45,55,62],[38,45,57,64],[38,45,55,60],[38,45,57,65]],lead=[(16,23,69),(43,50,72)],energy=.85),
  dict(name='Undercurrent',ped=31,pads=[[43,50,57,64],[43,50,59,66],[43,50,61,69],[43,50,57,66]],lead=[(7,13,74),(30,37,78),(48,54,76)],energy=1.03),
  dict(name='New pressure',ped=29,pads=[[41,48,58,65],[41,48,60,67],[41,48,58,63],[41,48,60,70]],lead=[(13,20,75),(39,46,79)],energy=1.05),
  dict(name='Distant resolve',ped=26,pads=[[38,45,57,64],[38,45,59,66],[38,45,55,62],[38,45,57,60]],lead=[(8,14,72),(34,41,74)],energy=.86),
  dict(name='Return without cadence',ped=28,pads=[[40,47,59,64],[40,47,57,62],[40,47,59,66],[40,47,57,62]],lead=[(15,21,74),(37,44,76),(52,58,71)],energy=1.01),
]

def render(i, region):
    t=np.arange(L,dtype=np.float64)/SR
    stereo=np.zeros((L,2),np.float32)
    # Four overlapping drifting pad clouds with a minimum of three notes per layer.
    bounds=[(0,21),(15,37),(31,54),(47,63.5)]
    for k,((a,b),notes) in enumerate(zip(bounds,region['pads'])):
        lo=max(0,int((a-3)*SR));hi=min(L,int((b+3)*SR));tt=t[lo:hi]
        env=fade(tt,a-3,b+3,6.,7.)
        # Subtract any overpowering melodic middle voice from foreground.
        for j,m in enumerate(notes):
            freq=hz(m)
            phase=2*np.pi*freq*(tt+.0032*np.sin(2*np.pi*(.022+.003*j)*tt+i*.61))
            phase2=2*np.pi*freq*(1.003+(.00025*i%3))*tt + .7*k+1.07*j
            src=(.55*np.sin(phase)+.30*np.sin(phase2)+(.052+.043*np.sin(.11*tt+.7*j+i*.2))*np.sin(2*phase+.9)+.014*np.sin(3*phase2))
            evolving=.77+.23*np.sin(2*np.pi*(.035+.004*j)*tt + k*.98 + i*.47+j*.75)
            # Pedal / fifth components kept stronger than high choral overtones.
            amount=(.87 if j<2 else .44) * (1.0+.055*np.sin(.4*i+k))
            pan=np.clip(.5+.25*np.sin(2*np.pi*.0096*tt+j*2.2+k*.88+i*.3),.16,.84)
            signal=src*env*evolving*amount
            stereo[lo:hi,0]+=(signal*(1-pan)).astype(np.float32)
            stereo[lo:hi,1]+=(signal*pan).astype(np.float32)
    stereo=hp(stereo,108)
    # Continuous, non-marching bass field: breathing rather than accented pulses.
    ped=region['ped']
    drone=(np.sin(2*np.pi*hz(ped)*t+.7*np.sin(2*np.pi*.033*t+i*.4)) +
           .20*np.sin(2*np.pi*hz(ped+12)*t+.24*np.sin(2*np.pi*.097*t)))
    drone=(.079*(.80+.20*np.sin(2*np.pi*(.058+.002*i)*t+.65*i))*drone).astype(np.float32)
    # Genuinely sparse foreground: 2-3 individual held notes per 63s region.
    lead=np.zeros(L,np.float32)
    for j,(a,b,n) in enumerate(region['lead']):
        lo=int(a*SR);hi=min(int(b*SR),L);tt=t[lo:hi];dt=tt-a
        depth=.0031*smooth((dt-.75)/2.25)
        vib=depth/(2*np.pi*4.9)*np.sin(2*np.pi*4.9*dt + .45*j+i*.2)
        phase=2*np.pi*hz(n)*(dt+vib)
        shape=(.76+.24*np.sin(np.pi*np.clip(dt/(b-a),0,1)))*fade(tt,a,b,1.5,1.9)
        bright=.025+.015*np.sin(.7*dt+i*.37)
        timbre=.79*np.sin(phase)+.14*np.sin(2*phase+.25)+bright*np.sin(3*phase+.8)
        lead[lo:hi]+=(.100*shape*timbre).astype(np.float32)
    # Filtered airy grain: evolving, no foreground spaceship signatures.
    grain=rng.standard_normal((L,2)).astype(np.float32)
    grain=hp(grain,800)
    grain=sosfilt(butter(2,3200,fs=SR,output='sos'),grain,axis=0)
    grain*=((.43+.57*np.sin(2*np.pi*.025*t+.4*i)**2)*.007)[:,None].astype(np.float32)
    dry=(stereo + .49*lead[:,None] + .77*drone[:,None] + grain).astype(np.float32)
    # Room response rendered per section. The 3.5s overlap assures audible
    # atmosphere persists across the independently evolving score sections.
    wet=np.zeros_like(dry)
    for ch in (0,1):
        length=int(4.*SR); impulse=np.zeros(length,np.float32)
        for off,g in ((.10,.15),(.17,.11),(.29,.09),(.45,.07),(.62,.045)):
            impulse[int((off+.013*ch)*SR)]+=g
        noise=rng.standard_normal(length).astype(np.float32)
        noise=sosfilt(butter(1,3100,fs=SR,output='sos'),noise)
        z=np.arange(length)/SR
        impulse+=.00255*(noise*np.exp(-z/1.42)*smooth((z-.05)/.15)).astype(np.float32)
        wet[:,ch]=fftconvolve(dry[:,1-ch],impulse,mode='full')[:L]
    mix=hp(.82*dry+.73*hp(wet,160),37)
    mix*=region['energy']
    return mix.astype(np.float32)

def main():
    final=np.zeros((int(DUR*SR),2),np.float32)
    # Blend sections with equal-power overlap; never hard-reset atmosphere.
    for i,region in enumerate(REGIONS):
        s=render(i,region)
        start=i*(L-O)
        if i>0:
            u=np.linspace(0,np.pi/2,O,endpoint=False)
            final[start:start+O]=(final[start:start+O]*np.cos(u)[:,None]+s[:O]*np.sin(u)[:,None]).astype(np.float32)
            final[start+O:start+L]=s[O:]
        else: final[:L]=s
        print(f'Rendered section {i+1}/7: {region["name"]}',flush=True)
    # Current version is a rough, deliberately NOT marked as gapless-loop ready.
    fade_in=int(1.1*SR);fade_out=int(1.6*SR)
    final[:fade_in]*=np.linspace(0,1,fade_in)[:,None]
    final[-fade_out:]*=np.linspace(1,0,fade_out)[:,None]
    peak=float(np.max(np.abs(final)))
    final*=.352/max(peak,1e-8)
    wav=OUT/'starswarm-round44-seven-minute-ambient-foundation.wav'
    mp3=OUT/'starswarm-round44-seven-minute-ambient-foundation.mp3'
    sf.write(wav,final,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
    print(f'Saved {mp3}: duration={DUR}s, pre-normalization peak={peak:.4f}',flush=True)
if __name__=='__main__':main()
