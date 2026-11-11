"""Star Swarm Round 11: two independent 64-second original cinematic sci-fi auditions.
No source-track loading, no borrowed melody. These are nonlooping sketch renders.
"""
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt
import subprocess

SR=24000
D=64.0
N=int(SR*D)
t=np.arange(N,dtype=np.float64)/SR
OUT=Path('/mnt/data')

def smooth(a,b):
    u=np.clip((t-a)/max(1e-5,b-a),0,1)
    return u*u*(3-2*u)

def gate(a,b,atk=.18,rel=1.2): return smooth(a,a+atk)*(1-smooth(b-rel,b))

def hz(m):return 440*2**((m-69)/12)

def voice(m,a,b,amp,seed,grain=.19,drift=.004,atk=.15,rel=1.1,pan=0.,partial=1.0):
    """Dark evolving original electronic timbre, computed only during active note range."""
    rng=np.random.default_rng(seed)
    i0=max(0,int(a*SR)); i1=min(N,int(b*SR)+1)
    out=np.zeros((2,N),np.float32)
    if i1<=i0:return out
    tt=t[i0:i1]
    u=np.clip((tt-a)/max(.01,atk),0,1); v=np.clip((b-tt)/max(.01,rel),0,1)
    e=(u*u*(3-2*u))*(v*v*(3-2*v))
    for ch in range(2):
        det=(ch-.5)*.0028
        mod=1+det+drift*(.65*np.sin(2*np.pi*(.085+.011*ch)*tt+rng.uniform(0,6))+.35*np.sin(2*np.pi*.23*tt+rng.uniform(0,6)))
        p=2*np.pi*np.cumsum(hz(m)*mod)/SR+rng.uniform(0,6)
        tone=np.sin(p)+partial*.26*np.sin(2*p+.3)+.10*np.sin(3*p+.4)+grain*.23*np.sin(1.41421356*p+1.0)
        trem=.89+.11*np.sin(2*np.pi*(.37+ch*.043)*tt+rng.uniform(0,6))
        out[ch,i0:i1]=(tone*e*trem*amp*(1+pan*(1 if ch==1 else -1))).astype(np.float32)
    return out

def filtered_noise(seed,lo,hi):
    rng=np.random.default_rng(seed)
    x=rng.standard_normal(N)
    x=sosfilt(butter(2,lo,fs=SR,btype='highpass',output='sos'),x)
    x=sosfilt(butter(2,hi,fs=SR,btype='lowpass',output='sos'),x)
    return (x/(np.sqrt(np.mean(x*x))+1e-9)).astype(np.float32)

def put_chord(x, pitches, start,end,amp,seed,attack=.25,release=2.8,bright=.8):
    for i,p in enumerate(pitches):
        x+=voice(p,start,end,amp/(len(pitches)**.65),seed+i*17,grain=.27,drift=.003,atk=attack,rel=release,pan=(-.16 if i%2 else .16),partial=bright)

def pulse(x,starts,pitch,seed,amp=.023):
    for i,a in enumerate(starts):
        duration=.35+(.15 if i%3==0 else 0)
        x+=voice(pitch if i%4 else pitch-7,a,a+duration,amp*(.8+.12*(i%3)),seed+i,grain=.44,drift=.006,atk=.008,rel=.21,partial=.8)

def distant_dust(x,seed,volume):
    for ch in range(2):
        n=filtered_noise(seed+ch,210,2900)
        rng=np.random.default_rng(seed+20+ch)
        nodes=np.arange(0,D+2,.65)
        lev=np.interp(t,nodes,rng.uniform(.2,.94,len(nodes)))
        x[ch]+=n*lev*volume

def echoes(x):
    for ch in range(2):
        dry=x[ch].copy()
        for delay, gain in [(0.21+.03*ch,.13),(0.61+.11*ch,.095),(1.7+.15*ch,.073),(3.2+.27*ch,.05)]:
            k=int(delay*SR)
            x[ch,k:]+=dry[:-k]*gain
    return x

def intro_motion(x):
    # Assertive unresolved suspended sonority from sample one; no tranquil fade-up.
    put_chord(x,[43,50,61,66],0,10,.099,100,attack=.027,release=1.4,bright=1.05)
    # A second unresolved register enters during a brief first retreat.
    put_chord(x,[43,53,59,65],7,20,.065,130,attack=.65,release=3,bright=.8)

def into_unknown():
    x=np.zeros((2,N),np.float32)
    intro_motion(x)
    # Low-level rhythmic articulation that remains music, not battle drums.
    pulse(x,[.35,1.4,2.3,4.1,5.1,7.4,9.1],43,200,.021)
    # Deliberate musical withdrawal 10-14; a new unresolved high color appears out of it.
    put_chord(x,[45,52,60,64],13,29,.080,250,attack=1.2,release=3.0)
    put_chord(x,[46,53,58,68],22,36,.082,280,attack=.5,release=3.3)
    # Low foundation changes while upper voices climb in contrary motion.
    put_chord(x,[39,46,56,63],33,48,.089,310,attack=.7,release=3)
    put_chord(x,[41,48,59,65],43,60,.107,350,attack=.4,release=2.5)
    put_chord(x,[43,50,60,67],56,64,.084,390,attack=.3,release=1.3)
    for i,(m,a,b) in enumerate([(72,2.2,6.8),(70,12,16),(73,18.6,24),(75,27,32),(71,37,43),(76,49,55),(74,58,64)]):
        x+=voice(m,a,b,.0115,500+i,grain=.33,atk=.12,rel=1.1,pan=.45 if i%2 else -.4)
    pulse(x,[15.2,16.7,18.2,20.6,23.1,25.6,28.1,29.2,32.5,35.2,37.4,40.1,43.1,45.2,46.9,49.0,51.2,52.6,54.4,57.2,58.5,60.3],46,630,.017)
    distant_dust(x,4100,.0013)
    # Dynamic *retreat* by scaling all layers; then a fresh surge and a second breath.
    x*=np.interp(t,[0,2,6,10,12,15,21,28,33,36,44,52,57,63,64],[1.12,1.10,.96,.57,.59,.86,1.02,.82,1.10,.69,.94,1.18,.86,1.08,1.0]).astype(np.float32)[None,:]
    return x

def storm():
    x=np.zeros((2,N),np.float32)
    # Immediate dark kinetic unison; distinct from A's opening harmony and path.
    put_chord(x,[38,45,56,62],0,11,.098,1200,attack=.025,release=1.6,bright=.95)
    put_chord(x,[40,47,57,63],8,22,.086,1250,attack=.35,release=2.9,bright=1.0)
    put_chord(x,[42,49,58,65],19,34,.089,1300,attack=.3,release=3)
    put_chord(x,[41,48,59,64],29,44,.092,1350,attack=.35,release=3)
    put_chord(x,[44,51,61,67],40,57,.105,1400,attack=.3,release=3)
    put_chord(x,[43,50,60,66],52,64,.094,1450,attack=.3,release=1.3)
    # Offset irregular sixteenth-like propulsion, never a repeating drum loop.
    times=[.1,.9,1.8,2.7,3.85,5.2,6.4,7.6,9.0,10.1,11.0,12.1,13.5,14.4,15.6,17.1,18.5,20,21,22.1,23.4,24.7,26.5,27.4,29,30.1,31.3,32.2,34,35,36,37.1,38.4,39.6,40.8,41.7,43.4,44.6,46.1,47.2,48.4,49.8,51.1,52.8,54.2,55.5,57.0,58.4,60,61.4,62.6]
    pulse(x,times,38,1550,.018)
    # Slow, widely spaced ascending responses (not a borrowed melody), more foreground than A.
    for i,(m,a,b) in enumerate([(68,3,7),(70,10,15),(73,16,20),(71,24,29),(75,31,35),(72,39,43),(78,46,52),(76,57,62)]):
        x+=voice(m,a,b,.015,1700+i,grain=.41,atk=.15,rel=1.6,pan=(-.45 if i%2 else .45))
    distant_dust(x,5100,.001)
    x*=np.interp(t,[0,4,9,14,18,22,27,31,35,40,45,50,54,60,64],[1.10,1.06,.79,.85,1.04,.83,.97,.63,.82,1.11,.92,1.10,.70,1.18,1.0]).astype(np.float32)[None,:]
    return x

def render(name,fn):
    x=fn()
    x=echoes(x)
    # Preserve strong entry, short conservative tail: no whole-recording slow fade-in.
    x*= (1-smooth(63.15,64))[None,:].astype(np.float32)
    # Master by short-term active RMS, not peak-only. Equal target for A and B.
    active=x[:,int(.5*SR):int(58*SR)]
    target=.112
    x*=target/(np.sqrt(np.mean(active*active))+1e-12)
    x*=min(1.,.92/(np.max(np.abs(x))+1e-12))
    wav=OUT/(name+'.wav'); mp3=OUT/(name+'.mp3')
    sf.write(wav,x.T,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
    wav.unlink()
    print(name,mp3.stat().st_size,'rms',round(float(np.sqrt(np.mean(x*x))),5),'first5',round(float(np.sqrt(np.mean(x[:,:5*SR]**2))),5),'peak',round(float(np.max(abs(x))),5))

if __name__=='__main__':
    render('starswarm-round11-A-into-the-unknown',into_unknown)
    render('starswarm-round11-B-gathering-storm',storm)
