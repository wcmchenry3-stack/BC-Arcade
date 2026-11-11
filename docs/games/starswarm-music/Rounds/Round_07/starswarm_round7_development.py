"""Star Swarm Round 7: owner-approved Living Space foundation, two controlled musical variations.
Uses the project-owned Round 6 prototype as a fixed background, with purely synthesized original additions.
No recordings from the four reference tracks, no borrowed melody. Exploratory clips, not release assets.
"""
from pathlib import Path
import subprocess
import numpy as np
import soundfile as sf
ROOT=Path('/mnt/data'); SR=24000; D=75.; N=int(D*SR); t=np.arange(N)/SR
source=(ROOT/'starswarm_round5_foundations.py').read_text().split("for kind in ['A','B']:")[0]
ns={'__name__':'starswarm_round7_generic','__file__':str(ROOT/'starswarm_round5_foundations.py')}
exec(compile(source,str(ROOT/'starswarm_round5_foundations.py'),'exec'),ns)
ns.update(D=D,N=N,t=t)
osc=ns['osc']; texture=ns['texture']

def decode(path):
    p=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ar',str(SR),'-ac','2','-f','f32le','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).T.copy()

base=decode(ROOT/'starswarm-round6-B-living-space-extended.mp3')
# contextual excerpt: 0..75 sec preserves the complete approved Round 5B and part of extension
base=base[:,:N]

def layer(preset):
    x=np.zeros_like(base)
    if preset=='A':
        # Cinematic evolution: several overlapping, suspended harmonic turns rather than chord blocks.
        # Mostly starts AFTER 0:20, to preserve early approved character and expose a controlled difference.
        parts=[
          (62,17,39,.010,.20,.22,4,9),  # D4 shared unresolved upper fifth
          (63,26,48,.015,.14,.20,5,8),  # Eb4 gives new emotional color
          (68,34,58,.012,.18,.22,5,9),  # Ab4
          (65,43,66,.014,.15,.23,4,9),  # F4
          (61,53,75,.015,.20,.19,4,9),  # Db4 unresolved reach
          (70,61,75,.010,.11,.16,5,9),  # Bb4 brighter above
          (55,29,63,.011,.20,.16,6,8),  # G3 maintained anchor
          (48,47,75,.017,.16,.13,6,9),  # C3 lower tension
        ]
        glides=[(74,22,34,.0050),(72,32,44,.006),(75,44,58,.006),(73,57,71,.005)]
    else:
        # Haunting organ color, not a foreground keyboard: soft, octave-related organ stops
        # emerge from existing tonal bed, imperfect slightly modulated pipe timbres and long envelopes.
        parts=[
          (55,22,49,.011,.04,.25,8,11),
          (62,26,51,.012,.05,.27,7,11),
          (67,35,58,.012,.05,.28,8,9),
          (63,44,66,.014,.06,.23,7,10),
          (70,49,74,.010,.05,.22,8,10),
          (61,58,75,.012,.07,.23,7,9),
          (50,28,62,.014,.03,.12,8,10),
        ]
        glides=[(74,25,41,.0035),(73,42,56,.004),(75,56,73,.0035)]
    for i,(m,a,b,v,inh,bright,att,rel) in enumerate(parts):
        x+=osc(m,a,b,v,7200+i+(0 if preset=='A' else 200),inharm=inh,brightness=bright,attack=att,release=rel,motion=.7)
    for i,(m,a,b,v) in enumerate(glides):
        x+=osc(m,a,b,v,7600+i+(0 if preset=='A' else 200),inharm=.13 if preset=='A' else .07,brightness=.15,attack=2.5,release=4)
    # Each contribution has quiet, wide reflected tails; these are small additions to the unchanged bed.
    for ch in range(2):
        dry=x[ch].copy()
        for delay,gain in [(0.37+ch*.07,.17),(1.23+ch*.18,.12),(2.91+ch*.17,.075)]:
            k=int(delay*SR)
            x[ch,k:]+=gain*dry[:-k]
    # Keep the first 12 sec exact, and bring the new voices in gradually.
    gate=np.sin(np.pi/2*np.clip((t-13)/14,0,1))**2
    x*=gate[None,:]
    return x

files=[]
for preset,tag in [('A','cinematic-development'),('B','haunting-character')]:
    addition=layer(preset)
    y=base+addition
    # Common fixed scaling, not per-section levelling or normalization.
    y=np.clip(y,-.96,.96)
    fn=ROOT/f'starswarm-round7-{preset}-{tag}.mp3'
    proc=subprocess.Popen(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i','-','-codec:a','libmp3lame','-b:a','128k',str(fn)],stdin=subprocess.PIPE)
    proc.communicate(np.asarray(y.T,dtype='<f4').tobytes())
    if proc.returncode:raise RuntimeError('ffmpeg error')
    files.append(fn)
    print(fn.name,fn.stat().st_size,'rms',np.sqrt(np.mean(y*y)),'peak',np.max(np.abs(y)))
print('outputs',len(files))
