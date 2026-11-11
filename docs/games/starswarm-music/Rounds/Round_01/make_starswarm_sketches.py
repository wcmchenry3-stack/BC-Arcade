"""Original procedural Star Swarm sketches; no input samples used."""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.ndimage import gaussian_filter1d
import soundfile as sf
import subprocess, pathlib
SR=24000
rng=np.random.default_rng(20261108)
OUT=pathlib.Path('/mnt/data')

def filt(x,typ,fc,order=3):
    return sosfilt(butter(order,fc,typ,fs=SR,output='sos'),x)
def smooth(x,sec):return gaussian_filter1d(x,max(1,int(SR*sec)),mode='nearest')
def ar(t,start,end,att=3,rel=4):
    return np.clip((t-start)/att,0,1)**1.3*np.clip((end-t)/rel,0,1)**1.3*(t>=start)*(t<=end)
def wave(freq,t,ph=0):return np.sin(2*np.pi*freq*t+ph)
def colored(n,low,high,seed):
    r=np.random.default_rng(seed).standard_normal(n)
    return filt(filt(r,'highpass',low),'lowpass',high)
def ir(seed,decay=3.9):
    g=np.random.default_rng(seed); n=int(5*SR);t=np.arange(n)/SR
    a=g.standard_normal(n)*np.exp(-t*6.9/decay)
    a=filt(a,'lowpass',4600); a[:int(.038*SR)]=0
    a/=np.sqrt(np.sum(a*a))+1e-8
    return a

def make(name,immersive=True,ominous=False):
    D=49 if ominous else 66;n=int(D*SR); t=np.arange(n)/SR
    bass=np.zeros(n); tonal=np.zeros((2,n)); atmos=np.zeros((2,n)); highlights=np.zeros((2,n))
    # A pedal that never switches abruptly, layered in fifths and octaves.
    root=65.406 if not ominous else 49.0
    bass+=.11*wave(root/2,t)*ar(t,0,D,5,7)
    bass+=.05*wave(root,t)*ar(t,0,D,6,6)
    if ominous: bass += .08*wave(36.7,t)*ar(t,5,D-2,7,6)
    # Slowly changing, suspended harmonies. Different voices enter at distinct times.
    notes=[(root*2,0,D-2,.050),(root*3,0,39,.044),(root*4,3,51,.025),
           (root*2*2**(2/12),7,34,.025),(root*2*2**(7/12),24,D-1,.031),
           (root*2*2**(3/12),30,D-1,.036)]
    if ominous:notes=[(root*2,0,D,.036),(root*3,3,D,.020),(root*4,11,D,.021),(root*2*2**(1/12),23,D,.029)]
    for j,(f,start,end,amp) in enumerate(notes):
        envelope=ar(t,start,end,6 if not ominous else 10,7)
        for ch in range(2):
            s=np.zeros(n)
            for k in range(5 if immersive else 3):
                det=(k-2)*(.0016 if immersive else .0005)
                phase=(j*2+k*.7+ch*.31)
                movement=(.65+.35*np.sin(2*np.pi*(.043+.004*k+.002*j)*t+phase)) if immersive else 1
                s+=wave(f*(1+det),t,phase)*movement/(1+k*.9)
                s+=.15*wave(2*f*(1+det),t,phase+1.1)*movement/(1+k)
            tonal[ch]+=amp*envelope*s/(5 if immersive else 3)
    # Air field and distributed broad-band drone: organic, slow, independent motion.
    for ch in range(2):
        x=colored(n,90,5500,900+ch)
        x=x/(np.std(x)+1e-8)
        a=np.sin(2*np.pi*(.052+ch*.009)*t+ch*1.7)
        b=np.sin(2*np.pi*(.011+ch*.006)*t+ch*.4)
        breath=(.65+.35*a)*(.78+.22*b) if immersive else (.94+.06*a)
        atmos[ch]+=(.012 if immersive else .003)*x*breath*ar(t,0,D,8,6)
        air=colored(n,2500,9500,980+ch);air/=np.std(air)+1e-8
        atmos[ch]+=(.006 if immersive else .001)*air*(.5+.5*np.sin(2*np.pi*.022*t+ch))*ar(t,9,D,10,6)
    # Distant passing glints with curved trails and different lengths, not identical repeated swooshes.
    for j,(at,dur,amp) in enumerate(([(17,4.3,.008),(33,6.2,.012),(51,3.7,.006)] if not ominous else [(19,6,.007),(37,8,.012)])):
        u=np.arange(int(dur*SR))/SR; idx=int(at*SR);sz=min(len(u),n-idx)
        u=u[:sz];v=np.random.default_rng(510+j).standard_normal(sz)
        v=filt(filt(v,'highpass',650),'lowpass',6500)
        v/=np.std(v)+1e-8
        trail=np.sin(np.pi*u/dur)**2*np.exp(-u/dur)
        pan=(u/dur)
        for ch in range(2):highlights[ch,idx:idx+sz]+=amp*trail*v*(1-pan if ch==0 else pan)
    if ominous:
        # Long hush, then a distant uncertain presence; no clockwork breath or constant noise.
        for at,dur,gain in [(17,9,.035),(34,8,.028)]:
            idx=int(at*SR); sz=min(int(dur*SR),n-idx);u=np.arange(sz)/SR
            noise=colored(sz,90,800,410+at);noise/=np.std(noise)+1e-8
            wav=(wave(97,u)*.45+noise*.55)*np.sin(np.pi*u/dur)**2
            for ch in range(2):highlights[ch,idx:idx+sz]+=gain*wav*(.8 if ch==0 else .45)
    # Three *distinct* reverb environments, with distant return more prominent in immersive mix.
    dry=tonal+atmos+highlights
    wet=np.zeros_like(dry)
    for ch in range(2):
        h=ir(129+ch,5.0 if immersive else 2.1)
        wet[ch]=fftconvolve(dry[ch],h,mode='full')[:n]
    stereo=dry+(.27 if immersive else .10)*wet
    stereo+=bass[None,:]
    # broad gradual dynamic arc, not a short-term loudness leveller.
    arc=.75+.22*np.sin(2*np.pi*(t/D)*.8-.8)
    if not ominous: arc+=.14*np.exp(-.5*((t-51)/7)**2)
    stereo*=arc
    # create safe peak while keeping natural swells.
    peak=np.max(np.abs(stereo));stereo*=.82/max(peak,1e-8)
    wav=OUT/f'{name}.wav';mp3=OUT/f'{name}.mp3'
    sf.write(wav,stereo.T,SR,subtype='PCM_16')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
    wav.unlink()
    print(mp3, mp3.stat().st_size,round(D,1),flush=True)

make('starswarm-sketch-A-cinematic-foundation',False)
make('starswarm-sketch-B-living-void',True)
make('starswarm-sketch-C-distant-presence',True,True)
