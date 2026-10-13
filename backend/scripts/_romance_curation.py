"""Hand-curated answer exclusions for gen_romance_words.py (#3239).

Folded keys of words that pass every automatic answer rule but make poor daily answers.
They stay valid guesses. Offensive and proper-noun-like words go in
``answers_blocklist_{fr,es}.txt`` instead; this list is for quality, not safety.
Reviewed by hand on 2026-10-13; the native-speaker review in #3201 may add to it.
"""

from __future__ import annotations


def _keys(text: str) -> frozenset[str]:
    return frozenset(text.split())


ANSWER_EXCLUDE: dict[str, frozenset[str]] = {
    "fr": _keys(
        # Obscure, technical or learned (anatomy, botany, chemistry, heraldry, law).
        "alleu ambon amide azyme betel bolus caude cilie cippe cirre ciste copal culee "
        "darse debet decan dotal douar dyade empan esser ester fasce fenil gambe gnose "
        "grume ictus ileon labre lacis lemme liage macle manse marli noeme oblat psoas "
        "raphe rumen scion sicle sinue stipe suint lazzi nodal manes mufti "
        # Archaic or 19th-century words and spellings Littré does not label.
        "affin aspre celer coste coite diton duire duite estoc farde haste ladre levis "
        "roide seing sieur dinee recru relai "
        # Latin, English and other foreign words.
        "cella comma fanum manus oculi testa velum break brick brief drift drill lunch "
        "stick sloop tweed whist paddy quote mezzo ethos "
        # Inflected forms and fragments the rules let through.
        "amers argue boute broie cabre etres fines fonts futee hoche liais mande monte "
        "mules nages racle rayee juree tapee rotie velue serve vires runes cense usite "
        "strie lisme liure lette tende recta ordon plano prote raire ramas surle sique "
        "naire panis baile basal autan garou appli velle loess razon stupa reaux ceste grenu "
        "puine tafia ceans palpe ovine vesce nitre",
    ),
    "es": _keys(
        # Obscure, technical or learned.
        "alfoz almud anata bacia braco calce calda camal carpo cateo corno cuado gluma "
        "gneis gules herma lisis litis meato numen labil urico etimo sesil ileon plica "
        "proba retor segur copra guaca guaje jacal ocote machi chala pucho tomin dupla "
        "batey bateo estro ester "
        # Archaic forms wspanish keeps.
        "dotor dubda dubio efeto fabla facer fecho ferir logar maese mesma mesmo micer "
        "mosen oidor yedra dalgo della dello desto deque desus cuita "
        # Foreign words, fragments and Latin.
        "acion apres archi basis cello conta cerno cerra certa corps corso cuemo festa "
        "ficar forte grand hiper inter index lecha lizar litar longa merca muito multi "
        "proto quier retro satis statu sulla totum trans umero verbi zuela ingre redor "
        "porta prest choro asnal bable amate millo tilla tillo pecha peche sueno "
        # Inflected forms (participles, feminine and plural forms, verb forms).
        "afino amado atado izado usado fiado roido ovado arada mucha misma tanta ambas "
        "bella chata chula zurda hueca manca corva trina dimes rever seudo testa labra parla "
        "pingo cuasi",
    ),
}
