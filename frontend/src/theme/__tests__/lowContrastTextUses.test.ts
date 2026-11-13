/**
 * Guards #3754 / #3755 / #3819: green (`colors.bonus`), teal (`colors.accent`), purple
 * (`colors.secondary`), lime (`colors.tertiary`) and gold (`colors.celebration`, `#ffd700`) must not
 * colour TEXT, because in the light theme they read 1.2-4.4:1 on cream. Text uses `bonusText` /
 * `accentText` / `secondaryText` / `tertiaryText` / `goldText` (and `warnText` for the amber);
 * icons, borders, rings and fills keep the raw token (3:1 non-text rule).
 *
 * A TypeScript AST scan of every non-test source file under `src`. It flags a style property named
 * `color` (the text colour on a <Text>; `borderColor`, `backgroundColor`, `tintColor` and so on are
 * other names) whose value, over any number of lines, mentions:
 *   - `colors.accent` / `bonus` / `secondary` / `tertiary` / `celebration` (also `c.accent`,
 *     `palette.bonus`, `colors["bonus"]`);
 *   - a raw amber / gold constant (`BLACKJACK_CHIPS_LOW`, `MAHJONG_BORDER_SELECTED`);
 *   - a destructured `accent` / `bonus` / ... binding (`const { accent } = colors`);
 *   - a local alias of one of those (`const acc = colors.accent; ... color: acc`).
 * Comments are never looked at.
 *
 * Exempt: a GameActionBar action (an object with an `icon`) whose `color` resolves to
 * `colors.bonus` and whose `labelColor` resolves to `colors.bonusText` (the icon may be the 3:1
 * green, the label is AA), directly or through a local `const`. `accentAsText(colors, x)` is a
 * sanitizer: its arguments are not scanned. `color: colors.accent` with any `labelColor` fails.
 *
 * No allow-list: every text use of these colours was moved to a text token in #3819. Table
 * accents reach text through `accentAsText`. Do not add exemptions to get new low-contrast text
 * past this; text on a fixed dark surface would need a documented, commented entry here.
 *
 * Limits: it does not follow a raw colour through a function call, a prop or another file
 * (`accentColor` props, `colors[config.accentKey]`), and it ignores an icon's `color=` JSX prop,
 * which the 3:1 non-text rule allows. Aliases are matched by name across the whole file, not by
 * scope. Do not add exemptions to get new low-contrast text past this: use the Text token.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";

const SRC = join(__dirname, "../..");
const RAW = new Set(["accent", "bonus", "secondary", "tertiary", "celebration"]);
/** Raw gold / amber constants (theme.constants / theme.mahjong): not text colours in light. */
const RAW_CONSTS = new Set(["BLACKJACK_CHIPS_LOW", "MAHJONG_BORDER_SELECTED"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** `colors`, `c`, `palette` or `x.colors`: the objects a theme palette lives in. */
function isPalette(e: ts.Expression): boolean {
  if (ts.isIdentifier(e)) return ["colors", "c", "palette"].includes(e.text);
  return ts.isPropertyAccessExpression(e) && e.name.text === "colors";
}

/** `colors.accent` or `colors["bonus"]`. */
function isRawRef(n: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(n)) return RAW.has(n.name.text) && isPalette(n.expression);
  if (ts.isElementAccessExpression(n)) {
    const a = n.argumentExpression;
    return ts.isStringLiteralLike(a) && RAW.has(a.text) && isPalette(n.expression);
  }
  return false;
}

function anyNode(root: ts.Node, pred: (n: ts.Node) => boolean): boolean {
  let hit = false;
  const visit = (n: ts.Node) => {
    if (hit) return;
    if (pred(n)) hit = true;
    else ts.forEachChild(n, visit);
  };
  visit(root);
  return hit;
}

function propName(p: ts.ObjectLiteralElementLike): string | undefined {
  const n = p.name;
  if (n && (ts.isIdentifier(n) || ts.isStringLiteralLike(n))) return n.text;
  return undefined;
}

/** `file:line: text` of every low-contrast text colour in `source`. */
export function findOffenders(source: string, fileName = "x.tsx"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Pass 1: names bound to a raw colour (destructured or aliased), to a fixed point.
  const aliases = new Set<string>();
  const inits = new Map<string, ts.Expression>();
  // `accentAsText(colors, x)` turns the accent into accentText: its arguments are not text uses.
  const isSanitizer = (n: ts.Node) =>
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "accentAsText";
  const mentionsRaw = (root: ts.Node): boolean => {
    if (isSanitizer(root)) return false;
    if (isRawRef(root)) return true;
    if (ts.isIdentifier(root) && (aliases.has(root.text) || RAW_CONSTS.has(root.text))) return true;
    let hit = false;
    ts.forEachChild(root, (c) => {
      if (!hit && mentionsRaw(c)) hit = true;
    });
    return hit;
  };
  const isRef = (e: ts.Node, name: string): boolean =>
    ts.isPropertyAccessExpression(e) && isPalette(e.expression) && e.name.text === name;
  /** `e` is `colors.<name>`, or a local bound to an expression naming `colors.<name>` only. */
  const resolvesTo = (e: ts.Node, name: string, other: string): boolean => {
    const src = ts.isIdentifier(e) ? inits.get(e.text) : e;
    return (
      src !== undefined &&
      anyNode(src, (n) => isRef(n, name)) &&
      !anyNode(src, (n) => isRef(n, other))
    );
  };
  /** A GameActionBar action: icon `color` is the bonus green, label is `labelColor: ...bonusText`. */
  const isHintAction = (prop: ts.PropertyAssignment): boolean => {
    const obj = prop.parent;
    if (!ts.isObjectLiteralExpression(obj)) return false;
    if (!obj.properties.some((p) => propName(p) === "icon")) return false;
    const label = obj.properties.find((p) => propName(p) === "labelColor");
    if (!label || !ts.isPropertyAssignment(label)) return false;
    return (
      resolvesTo(prop.initializer, "bonus", "accent") &&
      resolvesTo(label.initializer, "bonusText", "bonus")
    );
  };
  const bind = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n)) {
      if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) {
          const source = (el.propertyName ?? el.name) as ts.Node;
          if (ts.isIdentifier(source) && RAW.has(source.text) && ts.isIdentifier(el.name)) {
            aliases.add(el.name.text);
          }
        }
      } else if (ts.isIdentifier(n.name) && n.initializer) {
        inits.set(n.name.text, n.initializer);
        if (mentionsRaw(n.initializer)) aliases.add(n.name.text);
      }
    }
    ts.forEachChild(n, bind);
  };
  for (let i = 0, before = -1; before !== aliases.size && i < 5; i++) {
    before = aliases.size;
    bind(sf);
  }

  // Pass 2: `color` properties whose value mentions one.
  const out: string[] = [];
  const report = (n: ts.Node) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    out.push(`${fileName}:${line}: ${n.getText(sf).replace(/\s+/g, " ")}`);
  };
  const scan = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && propName(n) === "color") {
      if (mentionsRaw(n.initializer) && !isHintAction(n)) report(n);
    } else if (ts.isShorthandPropertyAssignment(n) && n.name.text === "color") {
      if (aliases.has("color")) report(n);
    }
    ts.forEachChild(n, scan);
  };
  scan(sf);
  return out;
}

describe("no low-contrast bonus/accent/secondary/tertiary/gold text (#3754, #3755, #3819)", () => {
  it("uses the text tokens for text colour across src", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/");
      if (rel.startsWith("theme/")) continue;
      offenders.push(...findOffenders(readFileSync(file, "utf8"), rel));
    }
    expect(offenders).toEqual([]);
  });
});

describe("the scan itself", () => {
  const hits = (code: string) => findOffenders(code).length;

  describe("flags", () => {
    it.each([
      ["a plain accent", "const s = { color: colors.accent };"],
      ["a plain bonus", "const s = { color: colors.bonus };"],
      ["a plain secondary", "const s = { color: colors.secondary };"],
      ["a plain tertiary", "const s = { color: colors.tertiary };"],
      ["the celebration gold", "const s = { color: colors.celebration };"],
      [
        "the low-chips amber constant",
        "const s = { color: isLow ? BLACKJACK_CHIPS_LOW : c.text };",
      ],
      ["the Mahjong gold constant", "const s = { color: MAHJONG_BORDER_SELECTED };"],
      ["an alias of the amber", "const amber = BLACKJACK_CHIPS_LOW;\nconst s = { color: amber };"],
      [
        "a destructured secondary",
        "const { secondary } = colors;\nconst s = { color: secondary };",
      ],
      [
        "a secondary icon colour with a goldText label",
        "const a = { icon: 'x', color: colors.secondary, labelColor: colors.goldText };",
      ],
      ["a value split across lines", "const s = {\n  color:\n    colors.accent,\n};"],
      [
        "a ternary with the raw token on a later line",
        "const s = {\n  color: isActive\n    ? colors.accent\n    : colors.textMuted,\n};",
      ],
      ["the else branch", "const s = { color: ok ? colors.text : colors.bonus };"],
      ["an alias", "const acc = colors.accent;\nconst s = { color: acc };"],
      ["an alias of an alias", "const a = colors.bonus;\nconst b = a;\nconst s = { color: b };"],
      ["a destructured binding", "const { accent } = colors;\nconst s = { color: accent };"],
      [
        "a renamed destructured binding",
        "const { accent: teal } = colors;\nconst s = { color: teal };",
      ],
      ["another palette name", "const s = { color: c.accent };"],
      ["a nested palette", "const s = { color: theme.colors.bonus };"],
      ["an element access", 'const s = { color: colors["bonus"] };'],
      ["a quoted key", 'const s = { "color": colors.accent };'],
      ["a style array entry", "const s = [styles.a, { color: colors.accent }];"],
      [
        "a GameActionBar icon colour whose label is the wrong token",
        "const a = { key: 'k', icon: 'x', color: colors.accent, labelColor: colors.accentText };",
      ],
      [
        "an accent icon colour with a bonusText label",
        "const a = { key: 'k', icon: 'x', color: colors.accent, labelColor: colors.bonusText };",
      ],
      [
        "a bonus icon with an accentText label",
        "const a = { key: 'k', icon: 'x', color: colors.bonus, labelColor: colors.accentText };",
      ],
      [
        "a mixed accent/bonus icon colour",
        "const a = { icon: 'x', color: up ? colors.bonus : colors.accent, labelColor: colors.bonusText };",
      ],
      [
        "a bonus colour with no labelColor",
        "const a = { key: 'k', icon: 'x', color: colors.bonus };",
      ],
      [
        "a bonus colour with a raw labelColor",
        "const a = { key: 'k', icon: 'x', color: colors.bonus, labelColor: colors.bonus };",
      ],
      [
        "a bonus colour in a non-action object",
        "const a = { color: colors.bonus, labelColor: colors.bonusText };",
      ],
    ])("%s", (_n, code) => {
      expect(hits(code)).toBe(1);
    });
  });

  describe("ignores", () => {
    it.each([
      ["the text tokens", "const s = { color: colors.accentText, k: colors.bonusText };"],
      [
        "the new text tokens",
        "const s = [{ color: colors.secondaryText }, { color: colors.tertiaryText }, { color: colors.goldText }, { color: colors.warnText }];",
      ],
      [
        "the fill label tokens",
        "const s = { color: colors.textOnSecondary, k: colors.textOnBonus };",
      ],
      ["a secondary border", "const s = { borderColor: colors.secondary };"],
      ["a tertiary fill", "const s = { backgroundColor: colors.tertiary };"],
      ["the amber as a bar fill", "const s = { backgroundColor: BLACKJACK_CHIPS_LOW };"],
      ["a secondary icon prop", "const x = <Icon color={colors.secondary} />;"],
      [
        "a table accent through accentAsText",
        "const s = { color: accentAsText(colors, colors.secondary) };",
      ],
      ["a border", "const s = { borderColor: colors.accent };"],
      ["a fill", "const s = { backgroundColor: colors.bonus };"],
      ["an icon's JSX prop", "const x = <Icon color={colors.bonus} />;"],
      ["a line comment", "// const s = { color: colors.accent };\nconst t = 1;"],
      ["a block comment", "/* { color: colors.bonus } */\nconst t = 1;"],
      ["a trailing comment", "const s = { color: colors.text }; // was colors.accent, now text"],
      ["an alias used as a border", "const acc = colors.accent;\nconst s = { borderColor: acc };"],
      ["a property of another object", "const s = { color: card.accent };"],
      ["a string that names it", 'const s = { color: "colors.accent" };'],
      ["accentAsText, the sanitizer", "const s = { color: accentAsText(colors, colors.accent) };"],
      [
        "a Hint action through locals",
        "const i = dark ? BLUE : colors.bonus;\nconst l = dark ? BLUE : colors.bonusText;\nconst a = { icon: 'x', color: i, labelColor: l };",
      ],
      [
        "a Hint action: bonus icon, bonusText label",
        "const a = { key: 'k', icon: 'x', color: colors.bonus, labelColor: colors.bonusText };",
      ],
      [
        "the same over several lines",
        "const a = {\n  key: 'hint',\n  icon: 'lightbulb',\n  color: colors.bonus,\n  labelColor: colors.bonusText,\n};",
      ],
    ])("%s", (_n, code) => {
      expect(hits(code)).toBe(0);
    });
  });
});
