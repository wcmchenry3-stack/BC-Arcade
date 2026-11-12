"""Round 26: independent from-silence sci-fi score; no earlier audio imported.
Requires numpy, scipy, ffmpeg. Deterministic original composition and synthesis.
Two arrangements test the same harmonic/melodic material with different propulsion.
"""
from pathlib import Path
import numpy as np
from scipy.signal import butter, sosfilt
import subprocess

OUT=Path(__file__).resolve().parent
SR=24000
BPM=118
BEAT=60.0/BPM
BARS=32
DUR=BARS*4*BEAT
N=int(DUR*SR)
rng=np.random.default_rng(2606)
T=np.arange(N)/SR

def hz(n): return 440.0*2**((n-69)/12)
def smoothstep(x):
    x=np.clip(x,0,1)
    return x*x*(3-2*x)

def play(track,note,at,duration,vol,kind='bow',pan=0,attack=.12,release=.35,seed=0):
    s=int(at*SR);e=min(N,int((at+duration)*SR));s=max(s,0)
    if e<=s:return
    t=np.arange(e-s)/SR
    f=hz(note)
    wobble=(.0010*np.sin(2*np.pi*(.49+seed*.009)*t+seed*.7)+.00027*np.sin(2*np.pi*1.13*t+seed))
    phase=np.cumsum(2*np.pi*f*(1+wobble)/SR)
    if kind=='bow':
        wave=(np.sin(phase)+.33*np.sin(2*phase+.15)+.19*np.sin(3*phase+.18)+.10*np.sin(4*phase+.31))
    elif kind=='horn':
        wave=(np.sin(phase)+.52*np.sin(2*phase+.2)+.16*np.sin(3*phase+.32)+.04*np.sin(5*phase))
    elif kind=='glass':
        wave=(np.sin(phase)+.28*np.sin(2.002*phase)+.12*np.sin(2.81*phase+.7))
    elif kind=='bass':
        wave=(np.sin(phase)+.21*np.sin(2*phase)+.08*np.sin(3*phase))
    else:
        wave=np.sin(phase)
    env=smoothstep(t/max(attack,.015))*smoothstep((duration-t)/max(release,.015))
    if kind in ('bow','horn'):
        env*=.86+.14*np.sin(2*np.pi*(.65+seed*.01)*t+.3)
    sig=(vol*wave*env).astype(np.float32)
    angle=(pan+1)*np.pi/4
    track[0,s:e]+=sig*np.cos(angle)
    track[1,s:e]+=sig*np.sin(angle)

# 16 original, voice-led harmonic moves over 32 bars. Each chord gets two bars.
# D minor orbit, brief chromatic uncertainty and an unresolved A tension returning to D.
chords=[
 (38,[57,62,65,69]), (34,[57,62,65,70]), (36,[55,60,64,67]), (33,[55,61,64,69]),
 (38,[57,62,65,69]), (41,[60,65,69,72]), (34,[57,62,65,70]), (33,[55,61,64,69]),
 (38,[57,62,65,69]), (39,[58,63,67,70]), (36,[55,60,64,67]), (33,[55,61,64,69]),
 (34,[57,62,65,70]), (36,[55,60,64,67]), (33,[57,61,64,69]), (33,[55,61,64,69])
]
# Motivic contour with rest, answer and larger return; melody is an ORIGINAL line.
# Each phrase uses (beat within 8-bar block, relative degree in D minor MIDI), no fixed copied source.
phrases=[
 [(0,74,1.65),(2,76,.7),(3,77,1.25),(5.2,76,.75),(6.2,74,1.0),(8,72,1.1),(9.5,74,.65),(10.5,77,1.55),(13,76,.75),(14,74,1.2),
  (16,72,1.1),(17.5,70,.75),(18.5,69,1.6),(21,70,.85),(22,72,1.0),(24,74,1.1),(25.6,77,1.3),(28,76,.65),(29,74,2.2)],
 [(0,77,1.15),(1.6,79,.7),(2.7,81,1.4),(5,79,.9),(6.4,77,1.25),(8.5,76,.9),(9.8,77,.6),(10.8,79,1.4),(13,77,.75),(14.1,76,1.45),
  (16,74,1.3),(18,72,1.0),(19.6,70,1.2),(21.5,72,1.0),(23,74,1.0),(24.6,76,1.4),(27,77,1.0),(28.5,76,1.0),(30,74,1.65)],
 [(0,74,.8),(1,76,.8),(2,77,1.5),(4.5,81,1.3),(6.5,79,1.05),(8,77,1.3),(10,76,.75),(11,74,.75),(12,72,1.35),(14.5,74,1.0),
  (16,77,1.0),(17.5,79,.8),(18.5,81,1.2),(20.7,79,1.05),(22.3,77,1.0),(24,76,.9),(25.4,74,1.1),(27.2,72,.95),(29,74,2.3)],
 [(0,72,1.2),(1.6,74,.8),(2.9,77,1.35),(5,76,.85),(6.2,74,1.0),(8,72,1.0),(9.5,70,.8),(10.8,69,1.0),(12.5,70,1.0),(14,72,1.3),
  (16,74,1.0),(17.5,76,.7),(18.5,77,1.5),(21,76,.75),(22.2,74,1.2),(24,72,1.0),(25.4,74,.7),(26.5,76,1.3),(29,73,2.2)]
]

def compose(variant):
    x=np.zeros((2,N),np.float32)
    # The low and midrange *are scored together*; no pre-existing recording or ambient bed.
    for j,(root,voicing) in enumerate(chords):
        at=j*8*BEAT
        play(x,root,at,8.4*BEAT,.022,'bass',pan=-.13,attack=.18,release=.7,seed=j)
        for k,n in enumerate(voicing):
            # Sustained harmony not fully static: staggered entrances and gaps, with restrained air.
            if k==3 and (j%3)==1:continue
            play(x,n,at+(k%2)*.19,8.1*BEAT,.009 if k<3 else .0055,'bow',pan=(-.40+.24*k),attack=.45,release=.8,seed=20*j+k)
        # Moving bass harmonically supports the phrase, unlike a constant drone.
        if variant=='A':
            bass_steps=[(0,root),(1.5,root+7),(3.0,root+12),(4.5,root+7),(6,root+3)]
        else:
            bass_steps=[(0,root),(2.0,root+7),(3.3,root+12),(5.0,root+7),(6.75,root+10)]
        for k,(beat,p) in enumerate(bass_steps):
            play(x,p,at+beat*BEAT,(.65 if variant=='A' else 1.05)*BEAT,.018 if variant=='A' else .015,
                 'bass',pan=-.32+.13*(k%3),attack=.03,release=.14,seed=80+j*7+k)
    # Original four evolving phrases, composed INTO the harmony rather than overdubbed on old music.
    for section,phrase in enumerate(phrases):
        base=section*8*4*BEAT
        for i,(beat,n,length_beats) in enumerate(phrase):
            at=base+beat*BEAT
            d=length_beats*BEAT
            if variant=='A':
                play(x,n,at,d,.032 if i%4!=0 else .039,'horn',pan=.04+.14*np.sin(i*.7),attack=.08,release=.19,seed=200+section*30+i)
            else:
                # Evolving hand-offs with the *same* melodic line, nothing harmonically random.
                instr='bow' if (i+section)%3 else 'horn'
                play(x,n,at,d+.07,.030 if instr=='horn' else .033,instr,pan=(-.34 if i%2 else .38),attack=.13,release=.24,seed=300+section*30+i)
            # brief cadential answer only, not continuous 2nd melody clutter
            if i in (4,13,17) and section!=3:
                play(x,n-12,at+.18,min(1.9,d+.35),.008,'glass',pan=-.55 if i%2 else .55,attack=.30,release=.45,seed=500+i+section*30)
    if variant=='B':
        # Gentle counter-movement only at phrase handoffs: do not obscure the primary line.
        for i,(bar,n) in enumerate([(3,65),(7,67),(11,65),(15,64),(19,67),(23,65),(27,64)]):
            play(x,n,bar*4*BEAT+1.5*BEAT,2.5*BEAT,.012,'glass',pan=(-.5 if i%2 else .5),attack=.3,release=.42,seed=610+i)
    # Musical reverb: subtle stereo diffusion of composed material, not a wash imported as foundation.
    dry=x.copy()
    for ch in range(2):
        for delay,gain in [(.19,.070),(.43,.052),(.87,.030)]:
            ds=int((delay+.027*ch)*SR)
            x[ch,ds:]+=dry[1-ch,:-ds]*gain
    # Gentle single track fade on both ends for audition only.
    fade=smoothstep(T/.09)*smoothstep((DUR-T)/.18)
    x*=fade[None,:]
    return x

A=compose('A');B=compose('B')
peak=max(np.max(np.abs(A)),np.max(np.abs(B)))
rms=max(np.sqrt(np.mean(A*A)),np.sqrt(np.mean(B*B)))
gain=min(.88/peak,.095/rms)
for tag,sig in [('A-cinematic-resolve',A),('B-swaying-pursuit',B)]:
    path=OUT/f'starswarm-round26-{tag}.mp3'
    pcm=np.ascontiguousarray((sig*gain).T,dtype='<f4').tobytes()
    cmd=['ffmpeg','-y','-loglevel','error','-f','f32le','-ac','2','-ar',str(SR),'-i','pipe:0','-c:a','libmp3lame','-b:a','128k',str(path)]
    p=subprocess.run(cmd,input=pcm,check=True)
    print(path, path.stat().st_size)
print('seconds', DUR)
