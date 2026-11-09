"""Round 22 original-project-audio transition auditions; no licensed reference recordings.
This is an arrangement experiment, not a final score, mastering pass, or game asset.
Requires prior project-generated Round 17A, 20A/B and 18A MP3 auditions.
"""
from pathlib import Path
import numpy as np, soundfile as sf, subprocess, tempfile
P=Path('/mnt/data'); SR=24000

def dec(name):
 p=subprocess.run(['ffmpeg','-v','error','-i',str(P/name),'-ac','2','-ar',str(SR),'-f','f32le','-'],capture_output=True,check=True)
 return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()
def sm(x):
 z=np.clip(x,0,1);return z*z*(3-2*z)
def seg(a,start,length):
 i=int(start*SR);n=int(length*SR);y=np.zeros((2,n),np.float32); part=a[:,i:i+n];y[:,:part.shape[1]]=part;return y

def render(name,y,goal_rms=.088):
 # one global gain: do not destroy dynamics with window normalization
 peak=np.max(np.abs(y));rms=float(np.sqrt(np.mean(y*y)));gain=min(.89/max(peak,1e-8),goal_rms/max(rms,1e-8))
 y=y*gain
 out=P/name
 with tempfile.NamedTemporaryFile(suffix='.wav') as t:
  sf.write(t.name,y.T,SR,subtype='PCM_16')
  subprocess.run(['ffmpeg','-y','-v','error','-i',t.name,'-c:a','libmp3lame','-b:a','112k',str(out)],check=True)
 print(name,round(y.shape[1]/SR,2),out.stat().st_size,'rms',round(float(np.sqrt(np.mean(y*y))),4),'peak',round(float(np.max(np.abs(y))),3))

bed=dec('starswarm-round17-A-electromagnetic-expansion.mp3')
astr=dec('starswarm-round20-A-astronomical-spotlight.mp3')
signal=dec('starswarm-round20-B-signals-in-the-dark.mp3')
chorus=dec('starswarm-round18-A-gathering-chorus.mp3')

# A: 63s. Play active context, start barely revealing the rise timbre before
# accompaniment ducks. The earlier Round 20A returns to bed at the end; allow
# music to continue. Smooth, long equal-power fade to avoid a hard timbre swap.
D=63;n=D*SR;t=np.arange(n)/SR
x=seg(bed,62,D)
# The Round20 audition is 48 s and comes from 17A's 72s excerpt.
# We place it at new second 11 (same original 72s) so the bed is phase/
# harmonically consistent with the source used to build it.
r=seg(astr,0,48)
i=11*SR
# Switch into feature slowly 11-25s. The rise isn't loud initially,
# but it is audible before the broad duck. Exit 43-55s.
lt=np.arange(r.shape[1])/SR+11
weight=sm((lt-11)/13)*sm((58-lt)/13)
x[:,i:i+r.shape[1]]=x[:,i:i+r.shape[1]]*(1-weight[None,:])+r*weight[None,:]
# Fade from seconds 59-63 to avoid arbitrary abruptly cutoff audition.
outfade=sm((D-t)/3.5);x*=outfade[None,:]
render('starswarm-round22-A-astronomical-entrance.mp3',x)

# B: 76s. Establish music, then gradual transfer from recognizably foreign
# electronic phrases into a full chorus. The signals begin as a prominent
# series and some of their ending material stays faintly as the choral mass
# comes forward. We do not tie this to any game event.
D=76;n=D*SR;t=np.arange(n)/SR
x=seg(bed,82,D)
# Signals inserted 7..55, choir 30..74; 17-second hand-off.
s=seg(signal,0,48);c=seg(chorus,0,44)
# First introduce the signals with a rising crossover instead of hard splice.
start=7;i=start*SR;lt=np.arange(48*SR)/SR+start
ws=sm((lt-7)/8)*sm((55-lt)/17)
x[:,i:i+len(ws)]=x[:,i:i+len(ws)]*(1-ws[None,:])+s*ws[None,:]
# Instead of an abrupt drop into a full choir, reveal the chorus over a longer
# blend while the signal language remains as quiet clues below it.
start=30;i=start*SR;lt=np.arange(44*SR)/SR+start
wc=sm((lt-30)/17)*sm((74-lt)/9)
x[:,i:i+len(wc)]=x[:,i:i+len(wc)]*(1-wc[None,:])+c*wc[None,:]
# Stitch a few unmistakable short remnants of the synthesized robotic voice
# into the onset of chorus so one develops into the other perceptually.
# These are source-derived from original generated clip, not the licensed BG4.
rem=seg(signal,23,12)
ri=42*SR;rt=np.arange(rem.shape[1])/SR
remenv=(0.12*sm(rt/2)*sm((12-rt)/3)).astype('float32')
x[:,ri:ri+len(remenv)]+=rem*remenv[None,:]
x*=sm((D-t)/3.3)[None,:]
render('starswarm-round22-B-signals-to-swarm.mp3',x)
