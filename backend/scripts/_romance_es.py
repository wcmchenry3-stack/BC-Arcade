"""Spanish lemmas (wspanish) and rule-based Spanish inflections for gen_romance_words.py (#3239).

wspanish source: Debian ``wspanish`` 1.0.30, ``words.spanish.latin1`` ("Word list
license: Public Domain."). It is a lowercase list of mostly base forms (nouns, adjectives
in both genders, infinitives), so the plurals and conjugations players type are generated
here and kept only when Ngram attests them.

Every function here is pure.
"""

from __future__ import annotations

import unicodedata

from _wordfold import fold, is_key, words

_PLAIN = str.maketrans("áéíóú", "aeiou")


def parse_wspanish(data: bytes) -> list[str]:
    """Lowercase NFC words of the Latin-1 list whose fold is a Spanish 5-letter key."""
    out = set()
    for line in data.decode("latin-1").splitlines():
        w = unicodedata.normalize("NFC", line.strip().lower())
        if w.isalpha() and is_key(fold(w), "es"):
            out.add(w)
    return sorted(out)


def parse_wspanish_all(data: bytes) -> list[str]:
    """Every alphabetic word of the list (any length): verbs of any length inflect to 5."""
    out = set()
    for line in data.decode("latin-1").splitlines():
        w = unicodedata.normalize("NFC", line.strip().lower())
        if w.isalpha():
            out.add(w)
    return sorted(out)


def _vowel_groups(word: str) -> int:
    groups, prev = 0, False
    for ch in word:
        cur = ch in "aeiouáéíóúü"
        groups += cur and not prev
        prev = cur
    return groups


def plurals(word: str) -> set[str]:
    """Candidate plurals: ``casa``->``casas``, ``árbol``->``árboles``, ``luz``->``luces``,
    ``canción``->``canciones``, ``gas``->``gases``, ``inglés``->``ingleses``."""
    if word.endswith("x"):
        return set()
    if word.endswith("s"):
        # Only a stressed final syllable takes -es (gas, mes, inglés); lunes, crisis do not.
        if _vowel_groups(word) == 1 or word[-2:-1] in ("á", "é", "í", "ó", "ú"):
            return {word[:-2] + word[-2].translate(_PLAIN) + "ses"}
        return set()
    last = word[-1]
    if last in "aeiouáéó":
        return {word + "s"}
    if last in "íú":
        return {word + "s", word + "es"}
    if last == "z":
        return {word[:-1] + "ces"}
    stem = word
    if len(word) >= 2 and word[-2] in "áéíóú" and last in "ns":
        stem = word[:-2] + word[-2].translate(_PLAIN) + last
    return {stem + "es"}


_AR = words(
    "o as a amos áis an é aste ó asteis aron aba abas ábamos abais aban "
    "aré arás ará aremos aréis arán aría arías aríamos aríais arían "
    "e es emos éis en ara aras áramos arais aran ase ases ásemos aseis asen "
    "ado ada ados adas ando ad"
)
_ER = words(
    "o es e emos éis en í iste ió imos isteis ieron ía ías íamos íais ían "
    "eré erás erá eremos eréis erán ería erías eríamos eríais erían "
    "a as amos áis an iera ieras iéramos ierais ieran iese ieses iésemos ieseis iesen "
    "ido ida idos idas iendo ed"
)
_IR = words(
    "o es e imos ís en í iste ió isteis ieron ía ías íamos íais ían "
    "iré irás irá iremos iréis irán iría irías iríamos iríais irían "
    "a as amos áis an iera ieras iéramos ierais ieran iese ieses iésemos ieseis iesen "
    "ido ida idos idas iendo id"
)
# Endings whose stressed syllable is the stem's (stem changes apply: e->ie, o->ue, e->i).
_STRESSED_STEM = frozenset(words("o as a an es e en"))


def _spell(stem: str, ending: str, inf_end: str) -> str:
    """Orthographic changes before e / a / o (buscar -> busqué, coger -> cojo...)."""
    front = ending[:1] in ("e", "é")
    if inf_end == "ar" and front:
        if stem.endswith("c"):
            return stem[:-1] + "qu" + ending
        if stem.endswith("g"):
            return stem + "u" + ending
        if stem.endswith("z"):
            return stem[:-1] + "c" + ending
        if stem.endswith("gu"):
            return stem[:-1] + "ü" + ending
    if inf_end in ("er", "ir") and ending[:1] in ("a", "o", "á"):
        if stem.endswith("g"):
            return stem[:-1] + "j" + ending
        if stem.endswith("gu"):
            return stem[:-1] + ending
        if stem.endswith("c") and len(stem) > 1 and stem[-2] in "aeiou":
            return stem[:-1] + "zc" + ending  # conocer -> conozco
        if stem.endswith("c"):
            return stem[:-1] + "z" + ending  # vencer -> venzo
    return stem + ending


def _changed_stems(stem: str) -> set[str]:
    """Stem-change variants on the last stem vowel: e->ie, e->i, o->ue, o->u, u->ue."""
    out = set()
    for i in range(len(stem) - 1, -1, -1):
        v = stem[i]
        if v in "aeiou":
            if v == "e":
                out |= {stem[:i] + "ie" + stem[i + 1 :], stem[:i] + "i" + stem[i + 1 :]}
            elif v == "o":
                out |= {stem[:i] + "ue" + stem[i + 1 :], stem[:i] + "u" + stem[i + 1 :]}
            elif v == "u":
                out.add(stem[:i] + "ue" + stem[i + 1 :])
            break
    return out


def verb_forms(inf: str) -> set[str]:
    """Regular conjugations (plus stem-change variants) of a Spanish infinitive."""
    end = inf[-2:]
    if end not in ("ar", "er", "ir") or len(inf) < 3:
        return set()
    stem = inf[:-2]
    endings = {"ar": _AR, "er": _ER, "ir": _IR}[end]
    out = set()
    for e in endings:
        out.add(_spell(stem, e, end))
        if e in _STRESSED_STEM:
            out.update(_spell(s, e, end) for s in _changed_stems(stem))
    if end == "ir":  # pedir -> pidió, pidamos; dormir -> durmió
        for s in _changed_stems(stem):
            out.update(_spell(s, e, end) for e in ("ió", "ieron", "amos", "iendo", "iera"))
    if end == "ir" and stem.endswith("u") and not stem.endswith(("gu", "qu")):
        # huir -> huyo, huye, huyen, huyó, huyendo
        out.update(stem + "y" + e for e in ("o", "es", "e", "en", "a", "as", "an", "ó", "endo"))
    if end in ("er", "ir") and stem[-1:] in ("a", "e", "o"):
        # leer -> leyó, leyeron, leyendo, leído; caer -> cayó, caído
        out.update(stem + e for e in ("yó", "yeron", "yendo", "yera", "yese"))
        out.update(stem + e for e in ("ído", "ída", "ídos", "ídas", "íste", "ímos"))
    out.discard(inf)
    return out


CLITICS = ("me", "te", "se", "lo", "la", "le", "nos", "os", "los", "las", "les")


def enclitics(inf: str) -> set[str]:
    """An infinitive with an attached pronoun: ``dar`` -> ``darle``, ``darse``..."""
    if not inf.endswith(("ar", "er", "ir", "ír")):
        return set()
    return {inf + c for c in CLITICS}


# Irregular verbs: forms the rules cannot make. A paradigm applies to its own verb and,
# for bases of 5+ letters, to compounds (oponer -> opuso, obtener -> obtuvo).
# Only Ngram-attested 5-letter forms survive.
PARADIGMS: dict[str, str] = {
    "ser": "soy eres somos sois son era eras éramos erais eran fui fuiste fue fuimos "
    "fueron seré serás será seremos serán sería serías serían sea seas seamos sean "
    "fuera fueras fueran fuese fueses fuesen fuere sido siendo",
    "estar": "estoy estás está estamos están estaba estuve estuvo estuvimos estuvieron "
    "esté estés estemos estén estuviera estuviese",
    "ir": "voy vas vamos vais van iba ibas íbamos iban iré irás irá iremos irán iría "
    "irías irían vaya vayas vayamos vayan yendo ido idos",
    "haber": "he has ha hemos habéis han había habías habían hube hubo hubimos hubieron "
    "habré habrás habrá habrán habría habrían haya hayas hayamos hayan hubiera hubiese",
    "tener": "tengo tienes tiene tenemos tienen tuve tuviste tuvo tuvimos tuvieron tendré "
    "tendrás tendrá tendrán tendría tenga tengas tengan tuviera tuviese",
    "hacer": "hago hice hiciste hizo hicimos hicieron haré harás hará haremos harán haría "
    "harías harían haga hagas hagamos hagan hiciera hiciese hecho hecha hechos hechas",
    "decir": "digo dices dice dicen dije dijiste dijo dijimos dijeron diré dirás dirá "
    "diremos dirán diría dirías dirían diga digas digamos digan dijera dijese dicho "
    "dicha dichos dichas diciendo",
    "poder": "puedo puedes puede pueden pude pudiste pudo pudimos pudieron podré podrás "
    "podrá podrán podría pueda puedas puedan pudiera pudiese pudiendo",
    "querer": "quiero quieres quiere quieren quise quisiste quiso quisieron querré querrá "
    "querría quiera quieras quieran quisiera quisiese",
    "saber": "sé supe supiste supo supieron sabré sabrás sabrá sabría sepa sepas sepamos "
    "sepan supiera supiese",
    "poner": "pongo puse pusiste puso pusieron pondré pondrás pondrá pondría ponga pongas "
    "pongan pusiera pusiese puesto puesta puestos puestas",
    "venir": "vengo vienes viene vienen vine viniste vino vinimos vinieron vendré vendrás "
    "vendrá vendría venga vengas vengan viniera viniese viniendo",
    "ver": "veo ves vemos veis ven vi viste vio vimos vieron veré verás verá vería vea "
    "veas veamos vean viera viese visto vista vistos vistas viendo veía veías veían",
    "dar": "doy das da damos dan di diste dio dimos dieron daré darás dará daría dé des "
    "demos den diera dieras dieran diese diesen dado dada dando",
    "salir": "salgo saldré saldrás saldrá saldría salga salgas salgan",
    "traer": "traigo traje trajiste trajo trajimos trajeron traiga traigas traigan trajera "
    "trajese",
    "caer": "caigo caiga caigas caigan",
    "oír": "oigo oyes oye oímos oyen oí oíste oyó oyeron oiga oigas oigan oyera oyese oído "
    "oyendo",
    "valer": "valgo valga valgas valgan valdré valdrá valdría",
    "caber": "quepo quepa quepas quepan cupe cupo cupiera cabrá cabría",
    "andar": "anduve anduvo anduvieron anduviera",
    "ducir": "duzco dujo dujeron duzca duzcas duzcan dujera dujese dujimos dujiste",
    "morir": "muerto muerta muertos muertas",
    "reír": "río ríes ríe reímos ríen reí rió rieron ría rías rían riera riendo reído",
    "oler": "huelo hueles huele huelen huela",
}


def irregular_forms(inf: str) -> set[str]:
    """Paradigm forms for ``inf`` and for a compound of a 5+ letter base."""
    out: set[str] = set()
    for base, forms in PARADIGMS.items():
        if inf == base or (len(base) >= 5 and inf.endswith(base)):
            prefix = inf[: len(inf) - len(base)]
            out.update(prefix + f for f in forms.split())
    return out


def lemma_forms(word: str) -> set[str]:
    """Inflected candidates for one wspanish word: plurals, verb forms, enclitics."""
    out = plurals(word) | verb_forms(word) | irregular_forms(word) | enclitics(word)
    out.discard(word)
    return out


def feminine_of(word: str, lemmas: frozenset[str]) -> bool:
    """``buena`` is the feminine of ``bueno`` when both are lemmas."""
    return word.endswith("a") and word[:-1] + "o" in lemmas
