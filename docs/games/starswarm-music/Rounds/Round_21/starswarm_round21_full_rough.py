"""Round 21 original rough seven-minute Star Swarm continuous score.
Uses only original synth experiments made for this game, never the third-party BG reference tracks.
Rough creative audition, NOT final master, loop-tested release file or integrated into game.
"""
from pathlib import Path
import subprocess
import numpy as np
import soundfile as sf
from scipy.signal import butter,sosfilt
P=Path('/mnt/data'); SR=24000; DUR=420; N=SR*DUR
rng=np.random.default_rng(2121)

def decode(name):
 p=subprocess.run(['ffmpeg','-v','error','-i',str(P/name),'-ar',str(SR),'-ac','2','-f','f32le','-acodec','pcm_f32le','-'],capture_output=True,check=True)
 return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()
def sm(v):
 v=np.clip(v,0,1); return v*v*(3-2*v)
def paste_with_fades(dest,source,dst,fade=7,scale=1):
 i=int(dst*SR);n=min(source.shape[1],N-i);s=source[:,:n].copy();tt=np.arange(n)/SR
 fade1=sm(tt/fade);fade2=sm((n/SR-tt)/fade)
 dest[:,i:i+n]+=s*(fade1*fade2*scale)[None,:]
def replace_window(dest, source,dst,fade=8,scale=1):
 i=int(dst*SR);n=min(source.shape[1],N-i);t=np.arange(n)/SR
 w=(sm(t/fade)*sm((n/SR-t)/fade)).astype('float32')
 dest[:,i:i+n]=dest[:,i:i+n]*(1-w[None,:])+source[:,:n]*scale*w[None,:]
def add_tone(dest,pitch,a,b,amp,seed,inh=.28,atk=.8,rel=3.,motion=.3):
 i=max(0,int(a*SR));j=min(N,int(b*SR));t=np.arange(i,j,dtype=np.float64)/SR
 if j<=i:return
 f=440*2**((pitch-69)/12);rr=np.random.default_rng(seed)
 env=sm((t-a)/atk)*sm((b-t)/rel)
 for ch in range(2):
  v=f*(1+.0008*np.sin(t*.43+seed)+.0017*np.sin(t*.84+ch*1.73+seed*.01))*(1+.0009*ch)
  ph=np.cumsum(v)*(2*np.pi/SR)+rr.uniform(0,6.28)
  sig=np.sin(ph)+.25*np.sin(2*ph+.8)+inh*np.sin(1.4142*ph+.2)+.09*np.sin(2.61*ph+.4)
  trem=.88+.12*np.sin(t*.6+.13*seed+ch)+motion*.08*np.sin(t*1.37+ch)
  dest[ch,i:j]+=(amp*env*trem*sig).astype('float32')
def add_shepard(dest,a,b,amp=.0038,rate=.115,base=300):
 i=int(a*SR);j=int(b*SR);tt=np.arange(i,j,dtype=np.float64)/SR;v=tt-a
 layer=np.zeros((2,j-i),np.float32)
 for o in range(-3,7):
  fq=base*2**(o-rate*v);weight=np.exp(-.5*(np.log2(fq/410)/.91)**2)
  for ch in range(2):
   ph=np.cumsum(fq*(1+.0005*ch))*(2*np.pi/SR)+o*.93+ch*.48
   layer[ch]+=(weight*np.sin(ph)).astype('float32')
 env=sm(v/4)*sm((b-tt)/4)
 dest[:,i:j]+=layer*(env*amp)[None,:]

def main():
 original=decode('starswarm-round17-A-electromagnetic-expansion.mp3')
 r16=decode('starswarm-round16-B-shepard-descent.mp3')
 x=np.zeros((2,N),dtype='float32')
 # Storybed: approved 17A, then an extended arc utilizing newly composed continuation,
 # altered chord register, evolving drones and purposeful near-return to the opening motif.
 x[:,:min(original.shape[1],230*SR)]=original[:,:min(original.shape[1],230*SR)]
 # Bridge after 230: overlapping original, newly adapted procedural material (not third-party files).
 def segment(src,start,dur):return src[:,int(start*SR):int((start+dur)*SR)]
 # Extra composition through ~420: source excerpts are locally recontextualized, not independent finished tracks concatenated.
 paste_with_fades(x,segment(original,142,86),220,fade=12,scale=.88)
 paste_with_fades(x,segment(r16,49,105),290,fade=11,scale=.88)
 paste_with_fades(x,segment(original,2,48),372,fade=12,scale=.87)
 # New original harmonic voices and contrasts add coherent continuity and new development.
 notes=[(59,223,249,.015),(64,235,265,.013),(57,251,279,.023),(61,266,302,.022),
        (66,280,309,.017),(62,294,323,.019),(65,314,342,.022),(68,334,358,.019),
        (61,355,378,.022),(56,372,400,.025),(62,389,414,.015),(59,400,419,.009)]
 for k,(note,a,b,amp) in enumerate(notes):add_tone(x,note,a,b,amp,6400+k,inh=.28,atk=3,rel=5)
 # Lower pulsation in the latter half gives a new phrase direction.
 cur=231.;idx=0;pattern=[2.9,2.2,3.3,1.8,2.6,3.1];pitch=[43,47,44,50,46,49,45]
 while cur<406:
  if not 296<cur<320:
   add_tone(x,pitch[idx%len(pitch)],cur,min(DUR,cur+2.2),.0065 if 330<cur<370 else .010,7000+idx,inh=.35,atk=.06,rel=1.6)
  cur+=pattern[idx%len(pattern)];idx+=1
 # Feature A: astronomical spotlight, around ~1:18: preserve rise->fade->bed return from approved experiment.
 astro=decode('starswarm-round20-A-astronomical-spotlight.mp3')
 replace_window(x,astro,70,fade=7.5,scale=.86)
 # Feature swarm chorus A, near ~2:34. Distinct from original 'something approaches' earlier.
 chorusA=decode('starswarm-round18-A-gathering-chorus.mp3')
 replace_window(x,chorusA,143,fade=8,scale=.85)
 # A mysterious signal stretch after a deliberate harmonic withdrawal around 3:29.
 sig=decode('starswarm-round20-B-signals-in-the-dark.mp3')
 replace_window(x,sig,215,fade=9,scale=.78)
 # Distant organ (previously approved). A softened organ timbre enriches a different region.
 organ=decode('starswarm-round19-B-distant-organ.mp3')
 replace_window(x,organ,263,fade=8,scale=.88)
 # Contrasting electromagnetic choir well later in the composition.
 chorusB=decode('starswarm-round18-B-electromagnetic-choir.mp3')
 replace_window(x,chorusB,325,fade=9,scale=.84)
 # Selected Shepard falls: first approved original source includes occurrences near 68,123,190;
 # additional later phrase at 305s (not near astronomical rises at 80-105s / chorus peaks).
 add_shepard(x,298,315,amp=.0035,rate=.125,base=260)
 # Subtle fresh upper-register color in latter half, without another distinct named effect.
 for k,(pitch,a,b,amp) in enumerate([(75,238,247,.007),(73,274,282,.008),(77,293,301,.006),
                                     (74,316,324,.007),(79,362,369,.007),(76,386,393,.007)]):
  add_tone(x,pitch,a,b,amp,8000+k,inh=.21,atk=.9,rel=2.1)
 # Trim far end to a musical reprisal; short overlap of final and starting gesture to test loop continuity.
 # Blend last 7 s into opening 7 s, in reverse timeline of source phrase start for endpoint matching.
 L=int(7*SR);w=sm(np.arange(L)/(L-1)).astype('float32')
 # Incoming loop segment plays its own 0..7s arc through the seam, phase-aware soft handover.
 x[:,-L:]=x[:,-L:]*(1-w[None,:])+x[:,:L]*w[None,:]
 # end at the first sample instead of 7s so the actual wrap has tiny sample discontinuity.
 # This short final taper to initial signal is only an audition seam, not final phase-matched seamless loop.
 n=int(.20*SR);w2=sm(np.arange(n)/(n-1)).astype('float32')
 x[:,-n:]=x[:,-n:]*(1-w2[None,:])+np.tile(x[:,0:1],(1,n))*w2[None,:]
 # Preserve dynamic contrasts, conservative global scaling (not 3-second loudness normalization).
 peak=np.max(np.abs(x));rms=np.sqrt(np.mean(x*x));gain=min(.90/peak,.09/rms)
 x*=gain
 wav=P/'starswarm-round21-full-rough.wav';out=P/'starswarm-round21-full-rough.mp3'
 sf.write(wav,x.T,SR,subtype='PCM_16')
 subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(wav),'-c:a','libmp3lame','-b:a','112k',str(out)],check=True)
 wav.unlink()
 print('Output',out,'bytes',out.stat().st_size,'duration',DUR,'rms',np.sqrt(np.mean(x*x)),'peak',np.max(np.abs(x)))
 print('Seam max step:',np.max(np.abs(x[:,-1]-x[:,0])))
if __name__=='__main__':main()
