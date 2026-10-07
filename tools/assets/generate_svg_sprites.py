#!/usr/bin/env python3
"""Generate kawaii SVG sprites for Cascade — all 21 remaining assets."""
import os
try:
    import cairosvg
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "cairosvg", "--break-system-packages"])
    import cairosvg

OUT = "/tmp/svg_sprites"
os.makedirs(OUT, exist_ok=True)

# ─── shared building blocks ───────────────────────────────────────────────────

def defs(c0, c1, c2, c3, extra=""):
    return f"""  <defs>
    <radialGradient id="body" cx="37%" cy="30%" r="68%" fx="37%" fy="30%">
      <stop offset="0%"   stop-color="{c0}"/>
      <stop offset="35%"  stop-color="{c1}"/>
      <stop offset="75%"  stop-color="{c2}"/>
      <stop offset="100%" stop-color="{c3}"/>
    </radialGradient>
    <radialGradient id="rim" cx="50%" cy="50%" r="50%">
      <stop offset="70%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.32)"/>
    </radialGradient>
    <radialGradient id="s1" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.90)"/>
      <stop offset="60%"  stop-color="rgba(255,255,255,0.30)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <radialGradient id="s2" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.70)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <clipPath id="clip"><circle cx="256" cy="256" r="210"/></clipPath>{extra}
  </defs>"""

BODY = """  <circle cx="256" cy="256" r="210" fill="url(#body)"/>
  <circle cx="256" cy="256" r="210" fill="url(#rim)"/>"""

SPEC = """  <ellipse cx="183" cy="168" rx="66" ry="46" transform="rotate(-28 183 168)" fill="url(#s1)"/>
  <ellipse cx="160" cy="192" rx="22" ry="14" transform="rotate(-28 160 192)" fill="url(#s2)" opacity="0.65"/>"""

def open_face(c="#2a0e00"):
    return f"""  <circle cx="210" cy="286" r="22" fill="{c}"/>
  <circle cx="217" cy="278" r="8" fill="white"/>
  <circle cx="302" cy="286" r="22" fill="{c}"/>
  <circle cx="309" cy="278" r="8" fill="white"/>
  <path d="M 220 322 Q 256 352 292 322" stroke="{c}" stroke-width="9" fill="none" stroke-linecap="round"/>"""

def closed_face(c="#1a0a00"):
    return f"""  <path d="M 194 282 Q 210 268 226 282" stroke="{c}" stroke-width="8" fill="none" stroke-linecap="round"/>
  <path d="M 286 282 Q 302 268 318 282" stroke="{c}" stroke-width="8" fill="none" stroke-linecap="round"/>
  <path d="M 220 318 Q 256 346 292 318" stroke="{c}" stroke-width="8" fill="none" stroke-linecap="round"/>
  <ellipse cx="185" cy="308" rx="24" ry="15" fill="rgba(255,130,130,0.38)"/>
  <ellipse cx="327" cy="308" rx="24" ry="15" fill="rgba(255,130,130,0.38)"/>"""

def write(name, c0, c1, c2, c3, details="", face="", extra_defs="", post_face=""):
    content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
{defs(c0, c1, c2, c3, extra_defs)}

{BODY}

{SPEC}

{details}
{face}
{post_face}
</svg>"""
    svg_path = f"{OUT}/{name}.svg"
    with open(svg_path, "w") as f:
        f.write(content)
    cairosvg.svg2png(url=svg_path, write_to=f"{OUT}/{name}.png", output_width=512, output_height=512)
    print(f"  ✓ {name}")


# ─── FRUITS ──────────────────────────────────────────────────────────────────

print("Fruits:")

write("blueberry",
    "#c4b5fd", "#7c3aed", "#4c1d95", "#2e1065",
    details="""  <!-- 5-petal calyx crown (characteristic blueberry top) -->
  <g transform="translate(256,47)">
    <ellipse cx="0" cy="-15" rx="10" ry="15" fill="#2e1065" transform="rotate(0)"/>
    <ellipse cx="0" cy="-15" rx="10" ry="15" fill="#2e1065" transform="rotate(72)"/>
    <ellipse cx="0" cy="-15" rx="10" ry="15" fill="#2e1065" transform="rotate(144)"/>
    <ellipse cx="0" cy="-15" rx="10" ry="15" fill="#2e1065" transform="rotate(216)"/>
    <ellipse cx="0" cy="-15" rx="10" ry="15" fill="#2e1065" transform="rotate(288)"/>
    <circle r="11" fill="#4c1d95"/>
  </g>""",
    face=open_face()
)

write("lemon",
    "#fef9c3", "#facc15", "#ca8a04", "#78350f",
    details="""  <!-- nubs at poles — characteristic lemon tips -->
  <ellipse cx="256" cy="48" rx="20" ry="14" fill="rgba(120,83,0,0.45)"/>
  <ellipse cx="256" cy="464" rx="20" ry="14" fill="rgba(120,83,0,0.45)"/>""",
    face=open_face()
)

write("grape",
    "#e9d5ff", "#9333ea", "#6b21a8", "#3b0764",
    details="""  <!-- stem -->
  <rect x="250" y="30" width="12" height="28" rx="5" fill="#5c3317"/>
  <!-- small leaf -->
  <ellipse cx="270" cy="40" rx="19" ry="9" transform="rotate(-32 270 40)" fill="#4d7c0f"/>
  <path d="M 264 46 Q 272 37 280 43" stroke="#15803d" stroke-width="2.5" fill="none"/>""",
    face=open_face()
)

write("orange",
    "#fed7aa", "#f97316", "#c2410c", "#7c2d12",
    details="""  <!-- navel at bottom -->
  <circle cx="256" cy="450" r="22" fill="rgba(124,45,18,0.40)"/>
  <circle cx="256" cy="450" r="12" fill="rgba(124,45,18,0.28)"/>""",
    face=open_face(),
    post_face="""  <!-- stem nub -->
  <rect x="251" y="33" width="10" height="20" rx="4" fill="#5c3317"/>"""
)

write("apple",
    "#fca5a5", "#ef4444", "#b91c1c", "#7f1d1d",
    details="",
    face=open_face(),
    post_face="""  <!-- stem + leaf -->
  <rect x="251" y="30" width="11" height="28" rx="5" fill="#5c3317"/>
  <ellipse cx="271" cy="42" rx="22" ry="10" transform="rotate(-35 271 42)" fill="#15803d"/>
  <path d="M 266 48 Q 274 38 282 44" stroke="#16a34a" stroke-width="2.5" fill="none"/>"""
)

write("peach",
    "#fed7aa", "#fb923c", "#ea580c", "#9a3412",
    details="""  <!-- vertical crease groove -->
  <path d="M 256 50 Q 245 256 256 462" stroke="rgba(154,52,18,0.22)" stroke-width="6" fill="none"/>
  <!-- warm blush circles -->
  <ellipse cx="188" cy="310" rx="30" ry="18" fill="rgba(253,186,116,0.48)"/>
  <ellipse cx="324" cy="310" rx="30" ry="18" fill="rgba(253,186,116,0.48)"/>""",
    face=open_face(),
    post_face="""  <!-- stem + leaf -->
  <rect x="251" y="32" width="10" height="22" rx="4" fill="#5c3317"/>
  <ellipse cx="269" cy="42" rx="20" ry="9" transform="rotate(-28 269 42)" fill="#15803d"/>"""
)

write("coconut",
    "#d6b896", "#a47551", "#6b3f1e", "#3d1f0a",
    details="""  <!-- fibrous grain lines -->
  <g clip-path="url(#clip)">
    <line x1="200" y1="46" x2="176" y2="466" stroke="rgba(61,31,10,0.13)" stroke-width="3.5"/>
    <line x1="228" y1="46" x2="210" y2="466" stroke="rgba(61,31,10,0.13)" stroke-width="3.5"/>
    <line x1="256" y1="46" x2="256" y2="466" stroke="rgba(61,31,10,0.13)" stroke-width="3.5"/>
    <line x1="284" y1="46" x2="302" y2="466" stroke="rgba(61,31,10,0.13)" stroke-width="3.5"/>
    <line x1="312" y1="46" x2="336" y2="466" stroke="rgba(61,31,10,0.13)" stroke-width="3.5"/>
  </g>
  <!-- three characteristic coconut eye-dimples -->
  <circle cx="229" cy="122" r="22" fill="#2a0a00"/>
  <circle cx="283" cy="122" r="22" fill="#2a0a00"/>
  <circle cx="256" cy="88" r="22" fill="#2a0a00"/>
  <circle cx="235" cy="116" r="7" fill="rgba(255,255,255,0.30)"/>
  <circle cx="289" cy="116" r="7" fill="rgba(255,255,255,0.30)"/>
  <circle cx="262" cy="82"  r="7" fill="rgba(255,255,255,0.30)"/>""",
    face=open_face()
)

# Dragonfruit: kawaii pitaya — pink oval body, green bracts, does not fit the
# standard write() template, so built as a raw SVG (same approach as sun below).
dragonfruit_svg = """<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="body" cx="38%" cy="28%" r="70%" fx="38%" fy="28%">
      <stop offset="0%"   stop-color="#fdb5d3"/>
      <stop offset="35%"  stop-color="#e91e8c"/>
      <stop offset="75%"  stop-color="#c2185b"/>
      <stop offset="100%" stop-color="#880e4f"/>
    </radialGradient>
    <radialGradient id="rim" cx="50%" cy="50%" r="50%">
      <stop offset="68%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.35)"/>
    </radialGradient>
    <radialGradient id="shine" cx="35%" cy="28%" r="40%" fx="35%" fy="28%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.90)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>

  <!-- Crown bracts — drawn BEHIND body -->
  <!-- L2 -->
  <path d="M 176.00,152.00 C 164.00,115.25 188.00,55.00 196.00,47.00 C 204.00,55.00 228.00,115.25 216.00,152.00 Z" fill="#2a6614" transform="rotate(-30, 196, 152)"/>
  <path d="M 185.00,152.00 C 178.40,115.25 191.60,55.00 196.00,47.00 C 200.40,55.00 213.60,115.25 207.00,152.00 Z" fill="#86c441" transform="rotate(-30, 196, 152)"/>
  <!-- L1 -->
  <path d="M 203.00,137.00 C 189.80,96.75 216.20,30.00 225.00,22.00 C 233.80,30.00 260.20,96.75 247.00,137.00 Z" fill="#2a6614" transform="rotate(-15, 225, 137)"/>
  <path d="M 212.90,137.00 C 205.64,96.75 220.16,30.00 225.00,22.00 C 229.84,30.00 244.36,96.75 237.10,137.00 Z" fill="#86c441" transform="rotate(-15, 225, 137)"/>
  <!-- Center (tallest) -->
  <path d="M 232.00,135.00 C 217.60,91.25 246.40,18.00 256.00,10.00 C 265.60,18.00 294.40,91.25 280.00,135.00 Z" fill="#2a6614"/>
  <path d="M 242.80,135.00 C 234.88,91.25 250.72,18.00 256.00,10.00 C 261.28,18.00 277.12,91.25 269.20,135.00 Z" fill="#86c441"/>
  <!-- R1 -->
  <path d="M 265.00,137.00 C 251.80,96.75 278.20,30.00 287.00,22.00 C 295.80,30.00 322.20,96.75 309.00,137.00 Z" fill="#2a6614" transform="rotate(15, 287, 137)"/>
  <path d="M 274.90,137.00 C 267.64,96.75 282.16,30.00 287.00,22.00 C 291.84,30.00 306.36,96.75 299.10,137.00 Z" fill="#86c441" transform="rotate(15, 287, 137)"/>
  <!-- R2 -->
  <path d="M 296.00,152.00 C 284.00,115.25 308.00,55.00 316.00,47.00 C 324.00,55.00 348.00,115.25 336.00,152.00 Z" fill="#2a6614" transform="rotate(30, 316, 152)"/>
  <path d="M 305.00,152.00 C 298.40,115.25 311.60,55.00 316.00,47.00 C 320.40,55.00 333.60,115.25 327.00,152.00 Z" fill="#86c441" transform="rotate(30, 316, 152)"/>

  <!-- Body -->
  <ellipse cx="256" cy="280" rx="118" ry="145" fill="url(#body)"/>
  <ellipse cx="256" cy="280" rx="118" ry="145" fill="url(#rim)"/>
  <ellipse cx="256" cy="280" rx="118" ry="145" fill="url(#shine)"/>

  <!-- Side bracts left — drawn IN FRONT of body -->
  <!-- L upper -->
  <path d="M 121.00,229.00 C 110.80,201.00 131.20,157.00 138.00,149.00 C 144.80,157.00 165.20,201.00 155.00,229.00 Z" fill="#2a6614" transform="rotate(-70, 138, 229)"/>
  <path d="M 128.65,229.00 C 123.04,201.00 134.26,157.00 138.00,149.00 C 141.74,157.00 152.96,201.00 147.35,229.00 Z" fill="#86c441" transform="rotate(-70, 138, 229)"/>
  <!-- L mid -->
  <path d="M 122.00,280.00 C 112.40,253.75 131.60,213.00 138.00,205.00 C 144.40,213.00 163.60,253.75 154.00,280.00 Z" fill="#2a6614" transform="rotate(-90, 138, 280)"/>
  <path d="M 129.20,280.00 C 123.92,253.75 134.48,213.00 138.00,205.00 C 141.52,213.00 152.08,253.75 146.80,280.00 Z" fill="#86c441" transform="rotate(-90, 138, 280)"/>
  <!-- L lower -->
  <path d="M 127.00,335.00 C 117.40,308.75 136.60,268.00 143.00,260.00 C 149.40,268.00 168.60,308.75 159.00,335.00 Z" fill="#2a6614" transform="rotate(-110, 143, 335)"/>
  <path d="M 134.20,335.00 C 128.92,308.75 139.48,268.00 143.00,260.00 C 146.52,268.00 157.08,308.75 151.80,335.00 Z" fill="#86c441" transform="rotate(-110, 143, 335)"/>

  <!-- Side bracts right — drawn IN FRONT of body -->
  <!-- R upper -->
  <path d="M 357.00,229.00 C 346.80,201.00 367.20,157.00 374.00,149.00 C 380.80,157.00 401.20,201.00 391.00,229.00 Z" fill="#2a6614" transform="rotate(70, 374, 229)"/>
  <path d="M 364.65,229.00 C 359.04,201.00 370.26,157.00 374.00,149.00 C 377.74,157.00 388.96,201.00 383.35,229.00 Z" fill="#86c441" transform="rotate(70, 374, 229)"/>
  <!-- R mid -->
  <path d="M 358.00,280.00 C 348.40,253.75 367.60,213.00 374.00,205.00 C 380.40,213.00 399.60,253.75 390.00,280.00 Z" fill="#2a6614" transform="rotate(90, 374, 280)"/>
  <path d="M 365.20,280.00 C 359.92,253.75 370.48,213.00 374.00,205.00 C 377.52,213.00 388.08,253.75 382.80,280.00 Z" fill="#86c441" transform="rotate(90, 374, 280)"/>
  <!-- R lower -->
  <path d="M 353.00,335.00 C 343.40,308.75 362.60,268.00 369.00,260.00 C 375.40,268.00 394.60,308.75 385.00,335.00 Z" fill="#2a6614" transform="rotate(110, 369, 335)"/>
  <path d="M 360.20,335.00 C 354.92,308.75 365.48,268.00 369.00,260.00 C 372.52,268.00 383.08,308.75 377.80,335.00 Z" fill="#86c441" transform="rotate(110, 369, 335)"/>

  <!-- Bottom bracts — drawn IN FRONT of body -->
  <!-- Bottom L -->
  <path d="M 182.00,415.00 C 173.60,394.00 190.40,363.00 196.00,355.00 C 201.60,363.00 218.40,394.00 210.00,415.00 Z" fill="#2a6614" transform="rotate(-150, 196, 415)"/>
  <path d="M 188.30,415.00 C 183.68,394.00 192.92,363.00 196.00,355.00 C 199.08,363.00 208.32,394.00 203.70,415.00 Z" fill="#86c441" transform="rotate(-150, 196, 415)"/>
  <!-- Bottom center -->
  <path d="M 242.00,425.00 C 233.60,405.75 250.40,378.00 256.00,370.00 C 261.60,378.00 278.40,405.75 270.00,425.00 Z" fill="#2a6614" transform="rotate(180, 256, 425)"/>
  <path d="M 248.30,425.00 C 243.68,405.75 252.92,378.00 256.00,370.00 C 259.08,378.00 268.32,405.75 263.70,425.00 Z" fill="#86c441" transform="rotate(180, 256, 425)"/>
  <!-- Bottom R -->
  <path d="M 302.00,415.00 C 293.60,394.00 310.40,363.00 316.00,355.00 C 321.60,363.00 338.40,394.00 330.00,415.00 Z" fill="#2a6614" transform="rotate(150, 316, 415)"/>
  <path d="M 308.30,415.00 C 303.68,394.00 312.92,363.00 316.00,355.00 C 319.08,363.00 328.32,394.00 323.70,415.00 Z" fill="#86c441" transform="rotate(150, 316, 415)"/>

  <!-- Face -->
  <circle cx="214" cy="268" r="24" fill="#1a0a0a"/>
  <circle cx="298" cy="268" r="24" fill="#1a0a0a"/>
  <circle cx="221" cy="260" r="9"  fill="white"/>
  <circle cx="305" cy="260" r="9"  fill="white"/>
  <path d="M 218,302 Q 256,328 294,302" stroke="#1a0a0a" stroke-width="9" fill="none" stroke-linecap="round"/>
</svg>"""

with open(f"{OUT}/dragonfruit.svg", "w") as f:
    f.write(dragonfruit_svg + "\n")
cairosvg.svg2png(url=f"{OUT}/dragonfruit.svg", write_to=f"{OUT}/dragonfruit.png", output_width=512, output_height=512)
print("  ✓ dragonfruit (pitaya: pink body + green bracts)")

write("pineapple",
    "#fde68a", "#d97706", "#92400e", "#78350f",
    details="""  <!-- diamond crosshatch pattern (clipped to sphere) -->
  <g clip-path="url(#clip)" opacity="0.30">
    <line x1="46"  y1="46"  x2="466" y2="466" stroke="#78350f" stroke-width="10"/>
    <line x1="136" y1="46"  x2="512" y2="422" stroke="#78350f" stroke-width="10"/>
    <line x1="0"   y1="136" x2="422" y2="512" stroke="#78350f" stroke-width="10"/>
    <line x1="466" y1="46"  x2="46"  y2="466" stroke="#78350f" stroke-width="10"/>
    <line x1="376" y1="46"  x2="0"   y2="422" stroke="#78350f" stroke-width="10"/>
    <line x1="512" y1="136" x2="90"  y2="512" stroke="#78350f" stroke-width="10"/>
    <line x1="46"  y1="256" x2="466" y2="256" stroke="#78350f" stroke-width="8"/>
    <line x1="46"  y1="170" x2="466" y2="170" stroke="#78350f" stroke-width="8"/>
    <line x1="46"  y1="342" x2="466" y2="342" stroke="#78350f" stroke-width="8"/>
  </g>""",
    face=open_face(),
    post_face="""  <!-- crown spikes -->
  <g fill="#15803d">
    <polygon points="256,10 248,60 264,60"/>
    <polygon points="222,18 220,68 236,64"/>
    <polygon points="290,18 292,68 276,64"/>
    <polygon points="192,36 196,84 210,76"/>
    <polygon points="320,36 316,84 302,76"/>
  </g>"""
)

write("watermelon",
    "#86efac", "#22c55e", "#15803d", "#14532d",
    details="""  <!-- dark green curved stripes (clipped) -->
  <g clip-path="url(#clip)">
    <path d="M 256 46 Q 340 120 370 256 Q 340 392 256 466" fill="none" stroke="#14532d" stroke-width="28"/>
    <path d="M 256 46 Q 172 120 142 256 Q 172 392 256 466" fill="none" stroke="#14532d" stroke-width="28"/>
    <path d="M 256 46 Q 420 90 450 256 Q 420 422 256 466" fill="none" stroke="#14532d" stroke-width="14"/>
    <path d="M 256 46 Q 92  90 62  256 Q 92  422 256 466" fill="none" stroke="#14532d" stroke-width="14"/>
  </g>
  <!-- red slice peek at bottom -->
  <g clip-path="url(#clip)">
    <path d="M 188 430 Q 256 490 324 430 Q 290 400 256 396 Q 222 400 188 430" fill="#dc2626"/>
    <!-- seeds -->
    <ellipse cx="228" cy="446" rx="6" ry="9" transform="rotate(-10 228 446)" fill="#14532d"/>
    <ellipse cx="256" cy="452" rx="6" ry="9" fill="#14532d"/>
    <ellipse cx="284" cy="446" rx="6" ry="9" transform="rotate(10 284 446)" fill="#14532d"/>
  </g>""",
    face=open_face("#14532d")
)


# ─── COSMOS ──────────────────────────────────────────────────────────────────

print("Cosmos:")

write("moon",
    "#f3f4f6", "#d1d5db", "#9ca3af", "#4b5563",
    details="""  <!-- craters -->
  <g clip-path="url(#clip)">
    <circle cx="320" cy="160" r="40" fill="rgba(75,85,99,0.18)"/>
    <circle cx="320" cy="160" r="32" fill="rgba(75,85,99,0.10)"/>
    <circle cx="180" cy="340" r="28" fill="rgba(75,85,99,0.18)"/>
    <circle cx="180" cy="340" r="22" fill="rgba(75,85,99,0.10)"/>
    <circle cx="360" cy="340" r="18" fill="rgba(75,85,99,0.18)"/>
    <circle cx="360" cy="340" r="14" fill="rgba(75,85,99,0.10)"/>
    <circle cx="200" cy="180" r="14" fill="rgba(75,85,99,0.18)"/>
    <circle cx="200" cy="180" r="10" fill="rgba(75,85,99,0.10)"/>
  </g>""",
    face=closed_face("#374151")
)

write("pluto",
    "#e2d5c3", "#b8a08a", "#8b6b52", "#5c4033",
    details="""  <!-- Tombaugh Regio — heart-shaped lighter plain -->
  <g clip-path="url(#clip)">
    <path d="M 256 200 C 210 180 168 210 180 260 C 192 310 256 360 256 360
             C 256 360 320 310 332 260 C 344 210 302 180 256 200 Z"
          fill="rgba(242,226,204,0.60)"/>
  </g>""",
    face=closed_face("#4a2c1a")
)

write("mercury",
    "#d1d5db", "#9ca3af", "#6b7280", "#374151",
    details="""  <!-- heavy cratering -->
  <g clip-path="url(#clip)">
    <circle cx="300" cy="150" r="38" fill="rgba(55,65,81,0.20)"/>
    <circle cx="300" cy="150" r="28" fill="rgba(55,65,81,0.12)"/>
    <circle cx="170" cy="280" r="28" fill="rgba(55,65,81,0.20)"/>
    <circle cx="170" cy="280" r="20" fill="rgba(55,65,81,0.12)"/>
    <circle cx="350" cy="320" r="22" fill="rgba(55,65,81,0.20)"/>
    <circle cx="350" cy="320" r="16" fill="rgba(55,65,81,0.12)"/>
    <circle cx="190" cy="160" r="18" fill="rgba(55,65,81,0.20)"/>
    <circle cx="190" cy="160" r="13" fill="rgba(55,65,81,0.12)"/>
    <circle cx="330" cy="220" r="14" fill="rgba(55,65,81,0.18)"/>
    <circle cx="220" cy="380" r="14" fill="rgba(55,65,81,0.18)"/>
    <circle cx="150" cy="370" r="10" fill="rgba(55,65,81,0.18)"/>
  </g>""",
    face=closed_face("#374151")
)

write("mars",
    "#fecaca", "#f87171", "#dc2626", "#7f1d1d",
    details="""  <!-- polar ice cap -->
  <g clip-path="url(#clip)">
    <ellipse cx="256" cy="72" rx="66" ry="38" fill="rgba(255,255,255,0.75)"/>
    <ellipse cx="256" cy="72" rx="48" ry="26" fill="rgba(255,255,255,0.55)"/>
    <!-- dust storm band -->
    <path d="M 46 310 Q 256 295 466 310" stroke="rgba(253,186,116,0.30)" stroke-width="22" fill="none"/>
  </g>""",
    face=closed_face("#7f1d1d")
)

write("venus",
    "#fef9c3", "#fde047", "#ca8a04", "#78350f",
    details="""  <!-- thick cloud swirl bands -->
  <g clip-path="url(#clip)" opacity="0.38">
    <path d="M 46 180 Q 180 156 256 180 Q 332 204 466 180"
          stroke="#78350f" stroke-width="18" fill="none"/>
    <path d="M 46 240 Q 160 220 256 244 Q 352 268 466 240"
          stroke="#78350f" stroke-width="14" fill="none"/>
    <path d="M 46 310 Q 200 290 256 312 Q 312 334 466 310"
          stroke="#78350f" stroke-width="18" fill="none"/>
    <path d="M 46 370 Q 180 355 256 372 Q 332 389 466 370"
          stroke="#78350f" stroke-width="12" fill="none"/>
  </g>""",
    face=closed_face("#78350f")
)

write("earth",
    "#bfdbfe", "#60a5fa", "#2563eb", "#1e3a8a",
    details="""  <!-- continent blobs (clipped) -->
  <g clip-path="url(#clip)">
    <!-- Americas -->
    <path d="M 148 130 C 130 160 118 220 124 280 C 130 340 150 380 164 360
             C 178 340 190 300 186 260 C 182 220 170 170 148 130 Z"
          fill="rgba(34,197,94,0.60)"/>
    <!-- Eurasia/Africa -->
    <path d="M 260 120 C 300 110 360 120 380 160 C 400 200 390 250 370 280
             C 350 310 320 320 300 300 C 280 280 270 250 260 220
             C 250 190 240 150 260 120 Z"
          fill="rgba(34,197,94,0.55)"/>
    <path d="M 290 310 C 310 300 330 320 326 370 C 322 420 296 440 278 420
             C 260 400 266 360 290 310 Z"
          fill="rgba(34,197,94,0.55)"/>
    <!-- white cloud wisps -->
    <path d="M 46 220 Q 140 200 200 222 Q 260 244 300 220"
          stroke="rgba(255,255,255,0.50)" stroke-width="20" fill="none"/>
    <path d="M 200 350 Q 300 330 380 354"
          stroke="rgba(255,255,255,0.45)" stroke-width="16" fill="none"/>
  </g>""",
    face=closed_face("#1e3a8a")
)

write("neptune",
    "#a5b4fc", "#4f46e5", "#3730a3", "#1e1b4b",
    details="""  <!-- storm bands -->
  <g clip-path="url(#clip)">
    <path d="M 46 220 Q 256 205 466 220" stroke="rgba(165,180,252,0.40)" stroke-width="28" fill="none"/>
    <path d="M 46 300 Q 256 315 466 300" stroke="rgba(165,180,252,0.30)" stroke-width="18" fill="none"/>
    <!-- Great Dark Spot -->
    <ellipse cx="330" cy="250" rx="44" ry="28" transform="rotate(-15 330 250)" fill="rgba(30,27,75,0.55)"/>
    <ellipse cx="330" cy="250" rx="28" ry="18" transform="rotate(-15 330 250)" fill="rgba(30,27,75,0.35)"/>
  </g>""",
    face=closed_face("#1e1b4b")
)

write("uranus",
    "#cffafe", "#22d3ee", "#0891b2", "#164e63",
    details="""  <!-- subtle band -->
  <g clip-path="url(#clip)">
    <path d="M 46 256 Q 256 244 466 256" stroke="rgba(255,255,255,0.18)" stroke-width="30" fill="none"/>
  </g>""",
    face=closed_face("#164e63"),
    post_face="""  <!-- ring — Uranus is tilted so ring goes nearly vertical -->
  <ellipse cx="256" cy="256" rx="52" ry="270" fill="none"
           stroke="rgba(180,240,255,0.58)" stroke-width="14"/>
  <ellipse cx="256" cy="256" rx="52" ry="270" fill="none"
           stroke="rgba(255,255,255,0.22)" stroke-width="28"/>"""
)

# Saturn: rings must be drawn BEFORE body so face is never masked.
# Bypass write() helper and construct SVG manually.
saturn_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
{defs("#fde68a", "#f59e0b", "#d97706", "#92400e")}

  <!-- rings drawn first — sphere body covers centre portion -->
  <ellipse cx="256" cy="256" rx="318" ry="76" fill="none" stroke="rgba(253,230,138,0.35)" stroke-width="22"/>
  <ellipse cx="256" cy="256" rx="284" ry="68" fill="none" stroke="rgba(253,230,138,0.55)" stroke-width="18"/>
  <ellipse cx="256" cy="256" rx="248" ry="59" fill="none" stroke="rgba(253,230,138,0.70)" stroke-width="14"/>

{BODY}

  <!-- cloud bands -->
  <g clip-path="url(#clip)">
    <path d="M 46 210 Q 256 198 466 210" stroke="rgba(146,64,14,0.28)" stroke-width="22" fill="none"/>
    <path d="M 46 310 Q 256 322 466 310" stroke="rgba(146,64,14,0.22)" stroke-width="16" fill="none"/>
  </g>

{SPEC}

{closed_face("#78350f")}
</svg>"""
with open(f"{OUT}/saturn.svg", "w") as f:
    f.write(saturn_svg)
cairosvg.svg2png(url=f"{OUT}/saturn.svg", write_to=f"{OUT}/saturn.png", output_width=512, output_height=512)
print("  ✓ saturn")

write("jupiter",
    "#fde8c8", "#f97316", "#c2410c", "#7c2d12",
    details="""  <!-- horizontal band stripes (clipped) -->
  <g clip-path="url(#clip)">
    <rect x="0" y="190" width="512" height="38" fill="rgba(124,45,18,0.28)"/>
    <rect x="0" y="270" width="512" height="28" fill="rgba(124,45,18,0.22)"/>
    <rect x="0" y="320" width="512" height="20" fill="rgba(124,45,18,0.18)"/>
    <rect x="0" y="150" width="512" height="18" fill="rgba(124,45,18,0.15)"/>
    <!-- Great Red Spot -->
    <ellipse cx="340" cy="300" rx="50" ry="32" transform="rotate(-8 340 300)" fill="rgba(185,28,28,0.65)"/>
    <ellipse cx="340" cy="300" rx="34" ry="22" transform="rotate(-8 340 300)" fill="rgba(220,38,38,0.45)"/>
  </g>""",
    face=closed_face("#7c2d12")
)

write("sun",
    "#fef9c3", "#fbbf24", "#d97706", "#78350f",
    details="""  <!-- corona flame spikes (behind body) drawn before body — use post_face instead -->""",
    face=open_face("#78350f"),
    post_face="""  <!-- corona spikes radiating outward (drawn after face so they appear behind) -->"""
)

# Sun needs special treatment: corona behind body, so rebuild it
sun_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
{defs("#fef9c3", "#fbbf24", "#d97706", "#78350f")}

  <!-- corona spikes behind sphere -->
  <g fill="#fbbf24">
    <polygon points="256,10 244,64 268,64"/>
    <polygon points="381,31 348,76 368,90"/>
    <polygon points="481,131 437,148 443,170"/>
    <polygon points="502,256 448,244 448,268"/>
    <polygon points="481,381 443,342 437,364"/>
    <polygon points="381,481 368,422 348,436"/>
    <polygon points="256,502 268,448 244,448"/>
    <polygon points="131,481 164,436 144,422"/>
    <polygon points="31,381 75,364 69,342"/>
    <polygon points="10,256 64,268 64,244"/>
    <polygon points="31,131 69,170 75,148"/>
    <polygon points="131,31 144,90 164,76"/>
  </g>
  <!-- outer glow ring -->
  <circle cx="256" cy="256" r="225" fill="rgba(251,191,36,0.22)"/>

{BODY}

{SPEC}

{open_face("#78350f")}
</svg>"""

with open(f"{OUT}/sun.svg", "w") as f:
    f.write(sun_svg)
cairosvg.svg2png(url=f"{OUT}/sun.svg", write_to=f"{OUT}/sun.png", output_width=512, output_height=512)
print("  ✓ sun (rebuilt with corona-behind-body)")

print("\nDone! All sprites in", OUT)
