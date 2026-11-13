## Cascade sim (full)

| metric | heuristic@60 | heuristic@120 | random@60 | random@120 | spam@60 | spam@120 | capstone:skilled@60 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| games | 100 | 100 | 100 | 100 | 100 | 100 | 50 |
| game length s (mean) | 180.0 | 180.0 | 157.0 | 150.0 | 67.6 | 65.4 | 458.0 |
| score (mean) | 5968 | 6006 | 4221 | 3887 | 4368 | 4213 | 21950 |
| score (min..max) | 4618..7920 | 4490..8250 | 940..8340 | 1628..8116 | 1220..9036 | 1314..10200 | 14682..29096 |
| ended by overflow | 0.00 | 0.00 | 0.69 | 0.84 | 1.00 | 1.00 | 0.42 |
| ended by hard stop | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| hit time cap | 1.00 | 1.00 | 0.31 | 0.16 | 0.00 | 0.00 | 0.02 |
| top tier reached rate | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.56 |
| top tier (mean) | 9.0 | 9.0 | 8.2 | 8.1 | 8.0 | 7.9 | 10.6 |
| win rate / time (s) | 0.00 / n/a | 0.00 / n/a | 0.00 / n/a | 0.00 / n/a | 0.00 / n/a | 0.00 / n/a | 0.56 / 414.1 |
| packing density | 0.656 | 0.658 | 0.695 | 0.691 | 0.715 | 0.716 | 0.692 |
| visible gap mean px | -0.17 | -0.17 | -0.17 | -0.16 | -0.18 | -0.17 | -0.18 |
| visible gap max px | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 |
| deepest overlap px (mean of games) | 4.34 | 4.75 | 3.22 | 3.06 | 0.84 | 0.89 | 4.99 |
| settle after drop ms | 938 | 915 | 637 | 631 | 548 | 590 | 819 |
| settle after 3+ chain ms | 501 | 500 | 262 | 260 | 500 | 939 | 483 |
| settle episodes cut off by the next drop (read settle with this) | 0.52 | 0.49 | 0.74 | 0.75 | 1.00 | 1.00 | 0.37 |
| jitter px/s | 1.32 | 1.32 | 1.48 | 1.46 | 3.43 | 3.41 | 1.20 |
| guard rail events / game | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| guard rail events / min | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| deepest wall penetration px | 0.31 | 0.31 | 0.31 | 0.31 | 0.31 | 0.31 | 0.31 |
| wall penetration > 1 px / min | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| chain latency ms, median / p90 | 17 / 17 | 17 / 17 | 17 / 17 | 17 / 17 | 17 / 17 | 17 / 17 | 17 / 17 |
| chain merges under 150 ms | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| time to capstone s, p25 / median / p75 (winners) | n/a / n/a / n/a | n/a / n/a / n/a | n/a / n/a / n/a | n/a / n/a / n/a | n/a / n/a / n/a | n/a / n/a / n/a | 373 / 410 / 460 |
| time to tier 10 s, median | 170 | 162 | 138 | 168 | n/a | 67 | 265 |
| step ms (20+ pieces, wall clock) | 0.077 | 0.037 | 0.139 | 0.072 | 0.178 | 0.085 | 0.098 |
| step ms, worst game p95 (wall clock) | 0.165 | 0.114 | 0.362 | 0.295 | 0.446 | 0.346 | 0.184 |
| drop share t0 | 0.128 | 0.128 | 0.135 | 0.134 | 0.199 | 0.197 | 0.136 |
| drop share t1 | 0.183 | 0.182 | 0.194 | 0.195 | 0.291 | 0.288 | 0.191 |
| drop share t2 | 0.187 | 0.187 | 0.199 | 0.197 | 0.297 | 0.293 | 0.189 |
| drop share t3 | 0.182 | 0.182 | 0.171 | 0.171 | 0.072 | 0.075 | 0.173 |
| drop share t4 | 0.182 | 0.182 | 0.170 | 0.170 | 0.071 | 0.074 | 0.176 |
| drop share t5 | 0.138 | 0.139 | 0.131 | 0.133 | 0.070 | 0.073 | 0.134 |
| drop share t6 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| drop share t7 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| drop share t8 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| drop share t9 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| drop share t10 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| drop share t11 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| score from t0 merges | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| score from t1 merges | 17 | 17 | 14 | 13 | 41 | 39 | 54 |
| score from t2 merges | 68 | 69 | 62 | 57 | 173 | 162 | 211 |
| score from t3 merges | 176 | 176 | 164 | 151 | 447 | 420 | 523 |
| score from t4 merges | 387 | 386 | 337 | 312 | 533 | 506 | 1087 |
| score from t5 merges | 810 | 813 | 691 | 648 | 715 | 688 | 2255 |
| score from t6 merges | 1444 | 1455 | 1238 | 1171 | 1108 | 1092 | 4032 |
| score from t7 merges | 1302 | 1313 | 973 | 901 | 817 | 794 | 3866 |
| score from t8 merges | 1052 | 1060 | 573 | 484 | 433 | 394 | 3553 |
| score from t9 merges | 609 | 635 | 159 | 138 | 102 | 108 | 3072 |
| score from t10 merges | 102 | 82 | 10 | 10 | 0 | 10 | 2150 |
| score from t11 merges | 0 | 0 | 0 | 0 | 0 | 0 | 1147 |
| longest drought t0 (drops) | 30 | 30 | 30 | 30 | 22 | 23 | 32 |
| longest drought t1 (drops) | 27 | 27 | 27 | 27 | 22 | 18 | 27 |
| longest drought t2 (drops) | 34 | 34 | 34 | 34 | 18 | 18 | 31 |
| longest drought t3 (drops) | 24 | 24 | 40 | 50 | 111 | 118 | 57 |
| longest drought t4 (drops) | 27 | 27 | 33 | 50 | 91 | 91 | 41 |
| longest drought t5 (drops) | 33 | 33 | 55 | 33 | 76 | 76 | 54 |

| queue sample | calm | danger |
| --- | ---: | ---: |
| share t0 | 0.134 | 0.209 |
| longest drought t0 | 40 | 22 |
| share t1 | 0.182 | 0.297 |
| longest drought t1 | 29 | 19 |
| share t2 | 0.183 | 0.299 |
| longest drought t2 | 34 | 20 |
| share t3 | 0.182 | 0.064 |
| longest drought t3 | 43 | 148 |
| share t4 | 0.182 | 0.066 |
| longest drought t4 | 30 | 105 |
| share t5 | 0.136 | 0.065 |
| longest drought t5 | 42 | 133 |
