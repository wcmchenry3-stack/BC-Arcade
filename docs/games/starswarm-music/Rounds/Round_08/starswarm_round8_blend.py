"""Round 8 controlled combinations of Star Swarm Round 7, using original approved sound foundation.
Only original procedural recordings; nothing from the licensed reference tracks is sampled.
"""
from pathlib import Path
import subprocess
import numpy as np
from scipy.signal import butter, sosfilt
ROOT=Path('/mnt/data'); SR=24000; D=75.; N=round(SR*D)
def decode(filename):
 p=subprocess.run(['ffmpeg','-v','error','-i',str(ROOT/filename),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
 return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()[:,:N].astype(np.float64)
base=decode('starswarm-round6-B-living-space-extended.mp3')
a=decode('starswarm-round7-A-cinematic-development.mp3')-base
b=decode('starswarm-round7-B-haunting-character.mp3')-base
# More atmospheric musical movement plus restrained, identifiable organ-like material.
version_a=base+.83*a+.55*b
# Move the organ-like voice away from the listener. Reduce its distinctive high harmonics,
# blend with band-limited reflected trails, and retain only a trace of its recognizable dry attack.
sos=butter(3,[145,1600],btype='bandpass',fs=SR,output='sos')
filtered=sosfilt(sos,b,axis=1)
# Soft, diffuse multiecho. Same notes as version A; the difference is presentation/distance.
wet=np.zeros_like(filtered)
for ch in range(2):
 for delay,gain in [(0.21+ch*.09,.24),(0.59+ch*.14,.23),(1.16+ch*.17,.20),(2.11+ch*.07,.14),(3.47+ch*.19,.09)]:
  k=round(delay*SR)
  wet[ch,k:]+=gain*filtered[1-ch,:-k]
t=np.arange(N)/SR
breath=.95+.05*np.sin(2*np.pi*.047*t+.7)
distant=(.24*b+.70*filtered+.66*wet)*breath[None,:]
version_b=base+.83*a+.55*distant
# Use common gain to preserve the comparison; do not squash dynamic motion.
peak=max(np.max(np.abs(version_a)),np.max(np.abs(version_b)))
scale=min(1.,.94/peak)
for name,y in [('starswarm-round8-A-cinematic-haunting.mp3',version_a),('starswarm-round8-B-distant-haunting.mp3',version_b)]:
 y=(y*scale).astype('<f4')
 fn=ROOT/name
 p=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i','-','-codec:a','libmp3lame','-b:a','128k',str(fn)],stdin=subprocess.PIPE)
 p.communicate(y.T.tobytes())
 if p.returncode:raise RuntimeError('encode failed')
 print(fn.name,fn.stat().st_size,'RMS',round(float(np.sqrt(np.mean(y*y))),5),'Peak',round(float(np.max(np.abs(y))),4))
