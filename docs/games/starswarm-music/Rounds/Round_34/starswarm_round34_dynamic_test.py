"""Round 34: original Round 31 melody, test directed musical dynamics vs unchanged control.
No third-party/reference recording is imported. Requires Round_31 generator and numpy/scipy/ffmpeg.
"""
from pathlib import Path
import subprocess, importlib.util
import numpy as np
from scipy.signal import butter, sosfiltfilt

ROOT=Path(__file__).resolve().parent
source=ROOT.parent/'Round_31'/'starswarm_round31_expressive_lead.py'
if not source.exists():
    source=ROOT/'starswarm_round31_expressive_lead.py'
spec=importlib.util.spec_from_file_location('round31',source)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
sr=mod.SR
x=mod.render('D').copy()
N=int(sr*22)
a=x[:,:N].copy()
t=np.arange(N)/sr
low=sosfiltfilt(butter(3,140,fs=sr,output='sos'),a,axis=1)
mid=a-low
b=low*.78+mid*1.13
points=[(0,.58),(.5,.68),(1.6,.96),(3.3,1.14),(4.45,1.11),(5.0,.82),
        (5.8,1.00),(7.2,1.17),(8.85,1.10),(9.75,.82),
        (10.4,.92),(12.2,1.19),(14.2,1.06),(15.25,.78),
        (16.1,.93),(17.9,1.16),(19.0,1.08),(20.25,.76),(21.4,1.12),(22,.98)]
xt=np.array([q[0] for q in points]);yt=np.array([q[1] for q in points])
raw=np.interp(t,xt,yt)
k=int(.15*sr);k+=1-k%2
ker=np.hanning(k);ker/=ker.sum()
env=np.convolve(np.pad(raw,(k//2,k//2),mode='edge'),ker,mode='valid')[:N]
b*=env[None,:]
energy=lambda sig:float(np.sqrt(np.mean(sig.astype('float64')**2)))
g=.11/max(energy(a),energy(b))
b*=energy(a)/energy(b)
peak=max(float(np.max(abs(a))),float(np.max(abs(b))))
g=min(g,.90/peak)
for name,sig in [('starswarm-round34-A-original-score-control.mp3',a),('starswarm-round34-B-directed-musical-force.mp3',b)]:
    cmd=['ffmpeg','-y','-loglevel','error','-f','f32le','-ac','2','-ar',str(sr),'-i','pipe:0','-c:a','libmp3lame','-b:a','128k',str(ROOT/name)]
    subprocess.run(cmd,input=np.ascontiguousarray((sig*g).T,dtype='<f4').tobytes(),check=True)
    print(name,(ROOT/name).stat().st_size)
