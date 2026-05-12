from __future__ import annotations

import json
import math
import os
from typing import Any

def _rank(card: dict) -> int:
    r = card["rank"]
    return 14 if r == 1 else r


def _is_heart(card: dict) -> bool:
    return card["suit"] == "hearts"


def _is_qs(card: dict) -> bool:
    return card["suit"] == "spades" and card["rank"] == 12


def _card_points(card: dict) -> int:
    if _is_heart(card):
        return 1
    if _is_qs(card):
        return 13
    return 0


def _hand_points(tricks: list[dict], player: int) -> int:
    total = 0
    for trick in tricks:
        if trick["winner"] == player:
            total += sum(_card_points(p["card"]) for p in trick["plays"])
    return total


def load_games(data_dir: str) -> list:
    games = []
    for fname in sorted(os.listdir(data_dir)):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(data_dir, fname)
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    games.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return games


def _std_dev(values: list[float], avg: float) -> float:
    if not values:
        return 0.0
    variance = sum((v - avg) ** 2 for v in values) / len(values)
    return math.sqrt(variance)


def summary_stats(games: list[dict]) -> dict:
    if not games:
        return {}

    n_players = 4
    wins = [0] * n_players
    final_scores: list[list[int]] = [[] for _ in range(n_players)]
    pts_per_hand: list[list[float]] = [[] for _ in range(n_players)]
    tricks_per_hand: list[list[int]] = [[] for _ in range(n_players)]
    qs_taken = [0] * n_players
    moon_shots = [0] * n_players
    zero_pt_hands = [0] * n_players
    high_damage_hands = [0] * n_players
    total_hands = [0] * n_players

    for game in games:
        winner = game.get("winner", -1)
        if 0 <= winner < n_players:
            wins[winner] += 1

        for p in range(n_players):
            final_scores[p].append(game["finalScores"][p])

        for hand in game.get("hands", []):
            tricks = hand.get("tricks", [])
            hand_pts = [_hand_points(tricks, p) for p in range(n_players)]
            hand_tricks = [
                sum(1 for t in tricks if t["winner"] == p) for p in range(n_players)
            ]

            all_pts = sum(hand_pts)
            moon_player = None
            if all_pts == 26:
                moon_player = next(
                    (p for p in range(n_players) if hand_pts[p] == 26), None
                )

            for p in range(n_players):
                pts = hand_pts[p]
                pts_per_hand[p].append(float(pts))
                tricks_per_hand[p].append(hand_tricks[p])
                total_hands[p] += 1

                for trick in tricks:
                    if trick["winner"] == p:
                        for play in trick["plays"]:
                            if _is_qs(play["card"]):
                                qs_taken[p] += 1

                if moon_player == p:
                    moon_shots[p] += 1

                if pts == 0:
                    zero_pt_hands[p] += 1
                if pts >= 10:
                    high_damage_hands[p] += 1

    result = {}
    for p in range(n_players):
        scores = final_scores[p]
        avg_score = sum(scores) / len(scores) if scores else 0.0
        pph = pts_per_hand[p]
        avg_pts = sum(pph) / len(pph) if pph else 0.0
        tph = tricks_per_hand[p]
        avg_tricks = sum(tph) / len(tph) if tph else 0.0
        n_hands = total_hands[p]
        result[str(p)] = {
            "games_won": wins[p],
            "avg_final_score": round(avg_score, 2),
            "min_final_score": min(scores) if scores else 0,
            "max_final_score": max(scores) if scores else 0,
            "std_dev_final_score": round(_std_dev(scores, avg_score), 2),
            "avg_pts_per_hand": round(avg_pts, 2),
            "avg_tricks_per_hand": round(avg_tricks, 2),
            "total_qs_taken": qs_taken[p],
            "moon_shots": moon_shots[p],
            "zero_pt_hand_rate": round(zero_pt_hands[p] / n_hands, 4) if n_hands else 0,
            "high_damage_hand_rate": round(high_damage_hands[p] / n_hands, 4) if n_hands else 0,
        }
    return result


def safe_discard_rate(games: list[dict]) -> dict:
    if not games:
        return {}

    counts: list[dict[str, Any]] = [
        {
            "void_opportunities": 0,
            "hearts_dumped": 0,
            "qs_dumped": 0,
            "wasted": 0,
            "wasted_suits": {"clubs": 0, "diamonds": 0, "spades": 0},
        }
        for _ in range(4)
    ]

    for game in games:
        for hand in game.get("hands", []):
            tricks = hand.get("tricks", [])
            for trick in tricks:
                plays = trick["plays"]
                if not plays:
                    continue
                led_suit = plays[0]["card"]["suit"]
                trick_number = trick["trickNumber"]

                for play in plays[1:]:
                    p = play["player"]
                    card = play["card"]
                    if card["suit"] == led_suit:
                        continue
                    # void opportunity
                    counts[p]["void_opportunities"] += 1

                    if _is_heart(card) and trick_number != 1:
                        counts[p]["hearts_dumped"] += 1
                    elif _is_qs(card) and trick_number != 1:
                        counts[p]["qs_dumped"] += 1
                    else:
                        counts[p]["wasted"] += 1
                        suit = card["suit"]
                        if suit in counts[p]["wasted_suits"]:
                            counts[p]["wasted_suits"][suit] += 1

    result = {}
    for p in range(4):
        c = counts[p]
        total = c["void_opportunities"]
        penalty_dumps = c["hearts_dumped"] + c["qs_dumped"]
        rate = round(penalty_dumps / total, 4) if total else 0.0
        result[str(p)] = {
            "void_opportunities": total,
            "hearts_dumped": c["hearts_dumped"],
            "qs_dumped": c["qs_dumped"],
            "wasted": c["wasted"],
            "penalty_dump_rate": rate,
            "wasted_suits": c["wasted_suits"],
        }
    return result


def qs_dump_timing(games: list[dict]) -> dict:
    if not games:
        return {}

    trick_nums: list[list[int]] = [[] for _ in range(4)]
    distributions: list[list[int]] = [[0] * 14 for _ in range(4)]  # index 1–13

    for game in games:
        for hand in game.get("hands", []):
            received = hand.get("received", [[], [], [], []])

            # Rebuild who holds Q♠ after passing
            qs_holders = set()
            for p in range(4):
                initial = hand.get("initialDeal", [[], [], [], []])[p]
                passed_out = hand.get("passed", [[], [], [], []])[p]
                received_cards = hand.get("received", [[], [], [], []])[p]
                passed_out_set = {(c["suit"], c["rank"]) for c in passed_out}
                has_qs = any(_is_qs(c) for c in initial if (c["suit"], c["rank"]) not in passed_out_set)
                has_qs = has_qs or any(_is_qs(c) for c in received_cards)
                if has_qs:
                    qs_holders.add(p)

            tricks = hand.get("tricks", [])
            for trick in tricks:
                for play in trick["plays"]:
                    if play["player"] in qs_holders and _is_qs(play["card"]):
                        tn = trick["trickNumber"]
                        trick_nums[play["player"]].append(tn)
                        if 1 <= tn <= 13:
                            distributions[play["player"]][tn] += 1
                        qs_holders.discard(play["player"])

    result = {}
    for p in range(4):
        nums = trick_nums[p]
        avg = round(sum(nums) / len(nums), 2) if nums else 0.0
        result[str(p)] = {
            "avg_trick": avg,
            "min_trick": min(nums) if nums else 0,
            "max_trick": max(nums) if nums else 0,
            "count": len(nums),
            "distribution": {str(t): distributions[p][t] for t in range(1, 14)},
        }
    return result


def moon_eligibility(games: list[dict]) -> dict:
    if not games:
        return {}

    eligible_counts = [0] * 4
    shots_made = [0] * 4
    outcome_buckets: list[dict[str, int]] = [
        {"0": 0, "1-5": 0, "6-12": 0, "13-19": 0, "20-26": 0}
        for _ in range(4)
    ]
    near_misses = [0] * 4

    for game in games:
        for hand in game.get("hands", []):
            received = hand.get("received", [[], [], [], []])
            initial = hand.get("initialDeal", [[], [], [], []])
            passed_out = hand.get("passed", [[], [], [], []])

            tricks = hand.get("tricks", [])
            hand_pts = [_hand_points(tricks, p) for p in range(4)]
            all_pts = sum(hand_pts)

            for p in range(4):
                passed_set = {(c["suit"], c["rank"]) for c in passed_out[p]}
                post_pass = [c for c in initial[p] if (c["suit"], c["rank"]) not in passed_set]
                post_pass += received[p]

                high_hearts = sum(
                    1 for c in post_pass if _is_heart(c) and _rank(c) >= 10
                )
                if high_hearts < 3:
                    continue

                eligible_counts[p] += 1
                pts = hand_pts[p]

                if all_pts == 26 and pts == 26:
                    shots_made[p] += 1

                if pts == 0:
                    outcome_buckets[p]["0"] += 1
                elif pts <= 5:
                    outcome_buckets[p]["1-5"] += 1
                elif pts <= 12:
                    outcome_buckets[p]["6-12"] += 1
                elif pts <= 19:
                    outcome_buckets[p]["13-19"] += 1
                else:
                    outcome_buckets[p]["20-26"] += 1

                if pts >= 15:
                    near_misses[p] += 1

    result = {}
    for p in range(4):
        result[str(p)] = {
            "eligible_hands": eligible_counts[p],
            "shots_made": shots_made[p],
            "near_misses": near_misses[p],
            "outcome_buckets": outcome_buckets[p],
        }
    return result


def pass_direction_breakdown(games: list[dict]) -> dict:
    if not games:
        return {}

    directions = ["left", "right", "across", "none"]
    data: list[dict[str, list[float]]] = [
        {d: [] for d in directions} for _ in range(4)
    ]

    for game in games:
        for hand in game.get("hands", []):
            direction = hand.get("passDirection", "none")
            if direction not in directions:
                direction = "none"
            tricks = hand.get("tricks", [])
            for p in range(4):
                pts = float(_hand_points(tricks, p))
                data[p][direction].append(pts)

    result = {}
    for p in range(4):
        result[str(p)] = {}
        for d in directions:
            vals = data[p][d]
            avg = round(sum(vals) / len(vals), 2) if vals else 0.0
            result[str(p)][d] = {
                "avg_pts": avg,
                "std_dev": round(_std_dev(vals, avg), 2),
                "sample_count": len(vals),
            }
    return result


def missed_qs_dumps(games: list[dict]) -> list:
    incidents = []

    for g_idx, game in enumerate(games):
        for hand in game.get("hands", []):
            hand_num = hand.get("handNumber", 0)
            tricks = hand.get("tricks", [])
            hand_pts = [_hand_points(tricks, p) for p in range(4)]

            initial = hand.get("initialDeal", [[], [], [], []])
            passed_out = hand.get("passed", [[], [], [], []])
            received = hand.get("received", [[], [], [], []])
            qs_holders = set()
            for p in range(4):
                passed_set = {(c["suit"], c["rank"]) for c in passed_out[p]}
                post_pass = [c for c in initial[p] if (c["suit"], c["rank"]) not in passed_set]
                post_pass += received[p]
                if any(_is_qs(c) for c in post_pass):
                    qs_holders.add(p)

            for trick in tricks:
                plays = trick["plays"]
                if not plays:
                    continue
                led_suit = plays[0]["card"]["suit"]
                if led_suit != "spades":
                    continue

                trick_num = trick["trickNumber"]
                covering_card = None
                covering_eff_rank = 12  # Q♠ effective rank

                for play in plays:
                    p = play["player"]
                    card = play["card"]

                    # Check BEFORE updating covering_card so we use the state
                    # prior to this player's play (cards played by others before them)
                    if (
                        p in qs_holders
                        and covering_card is not None
                        and card["suit"] == "spades"
                        and not _is_qs(card)
                    ):
                        plays_str = ", ".join(
                            f"P{pl['player']}:{pl['card']['suit'][0].upper()}{pl['card']['rank']}"
                            for pl in plays
                        )
                        incidents.append({
                            "game": g_idx,
                            "hand": hand_num,
                            "trick": trick_num,
                            "qs_holder": p,
                            "covering_card": covering_card,
                            "played_instead": card,
                            "trick_plays": plays_str,
                            "hand_pts_taken": hand_pts[p],
                        })

                    # Update covering card after the check — use effective rank so Ace (rank 1) → 14
                    eff = _rank(card)
                    if card["suit"] == "spades" and eff > covering_eff_rank:
                        covering_eff_rank = eff
                        covering_card = card

                    if _is_qs(card):
                        qs_holders.discard(p)

    return incidents
