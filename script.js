/* ---------- 4. ПАРСЕР (версия с поддержкой переносов строк) ---------- */

/*
  Как это работает:
  1. Текст чистится (мусор PDF, номера страниц) и режется на БЛОКИ по нумерации: 1. / 2. / 3.
  2. Внутри блока ищем 5 частей: вопрос + 4 варианта. Два способа:
     А) по кавычкам: "вопрос" "вариант 1" ... — самый надёжный, переносы внутри кавычек не мешают;
     Б) если кавычек нет — по раскладке строк (пустые строки, длина строки, знаки препинания).
  3. Строки внутри каждой части склеиваются обратно (с учётом переносов слов через дефис).
*/

// Начало вопроса: «12.» или «12)». Не срабатывает на «3.5 кг» (после точки не должно идти число)
const START_RE = /^(["«“„]?)\s*(\d{1,4})\s*[.)](?!\d)\s*(.*)$/;

// Строки-мусор от PDF: «- 5 -», «Страница 5», «Стр. 5 из 20». Если в PDF есть другие колонтитулы — добавьте сюда
const PAGE_NOISE_RE = /^(?:[-–—]\s*\d+\s*[-–—]|(?:страница|стр\.?|page)\s*\d+(?:\s*(?:из|of)\s*\d+)?)$/i;

// Открывающая кавычка → допустимые закрывающие
const QUOTE_PAIRS = { '"': '"', '«': '»', '“': '”', '„': '“”' };

/* ----- Главная функция ----- */
function parseQuestions(raw) {
  const lines = prepareLines(raw);
  const wrapWidth = estimateWrapWidth(lines);
  const blocks = splitIntoBlocks(lines);

  const result = [];
  for (const block of blocks) {
    const parsed = parseBlock(block, wrapWidth);
    if (!parsed) {
      console.warn('Вопрос №' + block.num + ' пропущен: не удалось выделить вопрос и 4 варианта.');
      continue;
    }
    result.push({
      id: result.length + 1,
      question: parsed.question,
      options: parsed.options,
      correctAnswerText: parsed.options[0]   // первый вариант в исходнике — правильный
    });
  }
  return result;
}

/* ----- Шаг 1. Подготовка строк ----- */
// Пустые строки сохраняем (одной), они помогают определять границы абзацев
function prepareLines(raw) {
  const out = [];
  raw
    .replace(/\r/g, '')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')              // неразрывные пробелы
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '')        // мягкие переносы, невидимые символы
    .split('\n')
    .forEach((l) => {
      const t = l.replace(/\s+/g, ' ').trim();
      if (PAGE_NOISE_RE.test(t)) return;                // номера страниц выбрасываем
      if (!t) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        return;
      }
      out.push(t);
    });
  return out;
}

// Примерная «ширина колонки» в символах: по ней отличаем строки-переносы (они почти полные)
function estimateWrapWidth(lines) {
  const lens = lines.filter(Boolean).map((l) => l.length).sort((a, b) => a - b);
  if (!lens.length) return 60;
  return Math.max(lens[Math.floor(lens.length * 0.95)] || 0, 20);
}

/* ----- Шаг 2. Разбиение на блоки по нумерации ----- */
function splitIntoBlocks(lines) {
  const blocks = [];
  let cur = null;
  let lastNum = 0;

  for (const line of lines) {
    const m = line.match(START_RE);
    if (m) {
      const num = parseInt(m[2], 10);
      const filled = cur ? cur.lines.filter(Boolean).length : 0;
      const isNext = num === lastNum + 1;                 // номер идёт по порядку
      const isSkip = num > lastNum && filled >= 5;        // пропущен номер, но предыдущий блок уже полный

      if (!cur || isNext || isSkip) {
        cur = { num, lines: [] };
        blocks.push(cur);
        lastNum = num;
        // m[1] — кавычка перед номером (если была), возвращаем её в текст
        const rest = (m[1] + m[3]).trim();
        if (rest) cur.lines.push(rest);
        continue;
      }
    }
    if (cur) cur.lines.push(line);   // всё остальное — продолжение текущего блока
  }
  return blocks;
}

/* ----- Шаг 3. Разбор одного блока ----- */
function parseBlock(block, wrapWidth) {
  const byQuotes = splitByQuotes(block.lines.join('\n'));
  const parts = byQuotes || splitByLayout(block.lines, wrapWidth);
  if (!parts || parts.length !== 5) return null;

  const tidy = (s) => s.replace(/\s+/g, ' ').trim();
  // Если делили по кавычкам, они уже сняты; иначе снимаем обрамляющие
  const fix = (s) => (byQuotes ? tidy(s) : unwrapQuotes(tidy(s)));

  const question = fix(parts[0]);
  const options = parts.slice(1).map((o) => stripOptionMarker(fix(o)));

  if (!question || options.some((o) => !o)) return null;
  return { question, options };
}

/* --- Способ А: разделение по кавычкам --- */
function splitByQuotes(text) {
  const segs = [];
  let outside = '';          // текст вне кавычек (должен быть почти пустым)
  let opener = null, closers = null, depth = 0, buf = '';

  for (const ch of text) {
    if (!closers) {
      if (QUOTE_PAIRS[ch]) { opener = ch; closers = QUOTE_PAIRS[ch]; depth = 1; buf = ''; }
      else outside += ch;
    } else if (ch === opener && opener !== closers) {
      depth++; buf += ch;                                   // вложенная кавычка «внутри «так»»
    } else if (closers.includes(ch)) {
      depth--;
      if (depth === 0) { segs.push(buf); closers = null; opener = null; }
      else buf += ch;
    } else {
      buf += ch;
    }
  }

  if (closers) return null;                                  // незакрытая кавычка
  if (segs.length !== 5) return null;                        // нужно ровно 5 частей
  if (outside.replace(/[\s\d.,;:()\-–—]/g, '').length > 10) return null; // слишком много текста вне кавычек

  return segs.map((s) => joinWrapped(s.split('\n')));
}

/* --- Способ Б: разделение по раскладке строк (если кавычек нет) --- */
function splitByLayout(lines, wrapWidth) {
  // Непустые строки + пометка «перед ней была пустая строка»
  const rows = [];
  let blank = false;
  for (const l of lines) {
    if (!l) { blank = true; continue; }
    rows.push({ text: l, blankBefore: blank && rows.length > 0 });
    blank = false;
  }
  if (rows.length < 5) return null;

  // Б1. Если пустые строки делят блок ровно на 5 абзацев — это и есть вопрос + 4 варианта
  const groups = [];
  rows.forEach((r) => {
    if (r.blankBefore || !groups.length) groups.push([r.text]);
    else groups[groups.length - 1].push(r.text);
  });
  if (groups.length === 5) return groups.map((g) => joinWrapped(g));

  // Б2. Иначе выбираем 4 самых «похожих на границу» места между строками
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    gaps.push({ i, score: gapScore(rows[i - 1].text, rows[i].text, rows[i].blankBefore, wrapWidth) });
  }
  const cuts = gaps
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 4)
    .map((g) => g.i)
    .sort((a, b) => a - b);

  const segs = [];
  let start = 0;
  [...cuts, rows.length].forEach((end) => {
    segs.push(rows.slice(start, end).map((r) => r.text));
    start = end;
  });
  return segs.map((s) => joinWrapped(s));
}

// Оценка: «здесь заканчивается часть (вопрос/вариант)». Чем выше балл — тем вероятнее граница
function gapScore(prev, next, blankBefore, wrapWidth) {
  let s = 0;
  if (blankBefore) s += 2;                                   // пустая строка между строками

  const ratio = prev.length / wrapWidth;
  if (ratio < 0.6) s += 3;                                   // короткая строка — вероятно, конец части
  else if (ratio < 0.8) s += 2;
  else if (ratio >= 0.92) s -= 3;                            // строка «до упора» — вероятно, перенос

  if (/\?$/.test(prev)) s += 2;                              // конец вопроса
  if (/:$/.test(prev)) s += 1;
  if (/[.!;…)»”"]$/.test(prev)) s += 1;                      // законченное предложение

  // Строка оборвалась на запятой, дефисе или предлоге/союзе — явный перенос
  if (/[,\-–—(]$/.test(prev) ||
      /(?:^|\s)(?:и|в|во|на|с|со|к|ко|по|от|до|из|за|для|что|как|или|а|но|не|о|об|у|the|of|and|to|in|a)$/i.test(prev)) {
    s -= 3;
  }

  if (/^[a-zа-яё]/.test(next)) s -= 1;                       // следующая строка с маленькой буквы
  else s += 1;                                               // с большой буквы / цифры
  return s;
}

/* ----- Вспомогательные функции ----- */

// Склейка строк в одну: слова, перенесённые через дефис, собираются обратно
function joinWrapped(parts) {
  let res = '';
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (!res) res = p;
    else if (/[A-Za-zА-Яа-яЁё]-$/.test(res) && /^[a-zа-яё]/.test(p)) res = res.slice(0, -1) + p;
    else res += ' ' + p;
  }
  return res;
}

// Снимаем кавычки, только если ВЕСЬ текст обёрнут в пару («ТСО» и «ЕСО» останется как есть)
function unwrapQuotes(s) {
  s = s.trim();
  const first = s[0], last = s[s.length - 1];
  const closers = QUOTE_PAIRS[first];
  if (closers && s.length > 1 && closers.includes(last)) {
    const inner = s.slice(1, -1);
    if (!inner.includes(first) && !closers.includes(inner.slice(-1))) return inner.trim();
  }
  return s;
}

// Убираем маркеры вариантов «1)», «2.», «A)», «б)». Инициалы вроде «А. С. Пушкин» не трогаем
function stripOptionMarker(s) {
  return s.replace(/^(?:[1-4][.)]|[A-Da-dА-Гa-г]\))\s+/, '').trim();
}