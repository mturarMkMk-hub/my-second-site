/* =========================================================
   QuizGen — логика приложения
   Разделы:
   0. Настройки и состояние   1. Утилиты        2. Тема
   3. Загрузка PDF / текста   4. Парсер         5. Проверка разбора
   6. Сохранение              7. Старт теста    8. Прохождение
   9. Таймер                  10. Результаты    11. Инициализация
   ========================================================= */

/* ---------- 0. НАСТРОЙКИ И СОСТОЯНИЕ ---------- */

// Секунд на один вопрос в режиме «Экзамен» (меняйте при желании)
const SECONDS_PER_QUESTION = 60;

// Если в PDF меньше такого числа символов на страницу — считаем его сканом (картинкой)
const MIN_CHARS_PER_PAGE = 20;

// Ключи localStorage
const LS = {
  theme: 'qg_theme',
  questions: 'qg_questions',   // последний загруженный тест
  meta: 'qg_meta',             // имя источника и дата
  best: 'qg_best',             // лучшие результаты (отдельно для каждого теста)
  settings: 'qg_settings'      // выбранные count / mode
};

// Подключаем воркер PDF.js (нужен для разбора PDF)
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Все вопросы теста: { id, num, question, options[], correctAnswerText }
// options[0] — ВСЕГДА правильный вариант (так в исходнике)
let allQuestions = [];

// Отчёт последнего разбора: { failed: [{num, text}], missing: [номера] }
let parseReport = null;

// Название источника (имя PDF или «Вставленный текст»)
let currentSource = '';

// Удалось ли сохранить тест в localStorage
let storageOk = true;

// «Ширина колонки» последнего разбора (нужна для ручного исправления)
let lastWrapWidth = 60;

// Текущая сессия теста
let session = {
  questions: [],     // вопросы с перемешанными вариантами + userIndex
  index: 0,          // номер текущего вопроса
  mode: 'train',     // 'train' | 'exam'
  isRetry: false,    // true, если это «только ошибки»
  answered: false,   // выбран ли ответ на текущем вопросе
  bestKey: null,     // ключ для сохранения лучшего результата
  deadline: 0        // момент окончания (мс) для режима «Экзамен»
};

let timerId = null;   // id интервала таймера
let timeLeft = 0;     // оставшиеся секунды

// Короткая функция для поиска элементов
const $ = (id) => document.getElementById(id);

/* ---------- 1. УТИЛИТЫ ---------- */

// Алгоритм Fisher-Yates — честное перемешивание массива (возвращает копию)
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Показ нужного экрана (start / quiz / result)
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Сообщение о статусе: type = 'ok' | 'error' | 'warn' | 'info'
function setStatus(text, type) {
  const el = $('status');
  if (!text) { el.hidden = true; return; }
  const icons = {
    ok: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    warn: 'fa-triangle-exclamation',
    info: 'fa-spinner fa-spin'
  };
  el.className = 'status ' + type;
  el.innerHTML = '<i class="fa-solid ' + icons[type] + '"></i><span></span>';
  el.querySelector('span').textContent = text;   // textContent — защита от XSS
  el.hidden = false;
}

// Безопасная работа с localStorage (в приватном режиме или при переполнении может падать)
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
// Возвращает true, если запись удалась
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
}

// Формат времени мм:сс
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// Короткий «отпечаток» теста — чтобы хранить лучший результат отдельно для каждого теста
function testIdOf(questions) {
  const s = questions.map((q) => q.question + '|' + q.options.join('|')).join('\n');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ---------- 2. ТЕМА ---------- */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('theme-toggle').innerHTML = theme === 'dark'
    ? '<i class="fa-solid fa-sun"></i>'
    : '<i class="fa-solid fa-moon"></i>';
  lsSet(LS.theme, theme);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ---------- 3. ЗАГРУЗКА PDF / ТЕКСТА ---------- */

// Извлекаем текст из PDF, сохраняя переносы строк (по координате Y).
// Возвращает { text, pages }
async function extractTextFromPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const lines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    let line = '';
    let lastY = null;
    let lastEnd = null;   // правый край предыдущего фрагмента

    for (const item of content.items) {
      if (!item.str) continue;
      const x = item.transform[4];
      const y = item.transform[5];

      // Если Y заметно изменился — это новая строка
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        // Большой зазор между строками = новый абзац → пустая строка-разделитель
        if (Math.abs(y - lastY) > (item.height || 10) * 1.7) lines.push('');
        line = '';
        lastEnd = null;
      }
      // Если между фрагментами есть зазор — добавляем пробел
      if (line && lastEnd !== null && x - lastEnd > 1 &&
          !line.endsWith(' ') && !item.str.startsWith(' ')) {
        line += ' ';
      }
      line += item.str;
      lastY = y;
      lastEnd = x + (item.width || 0);
    }
    if (line) lines.push(line);
    lines.push('');   // разделитель между страницами
  }
  return { text: lines.join('\n'), pages: pdf.numPages };
}

// Обработка выбранного PDF-файла
async function handleFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    setStatus('Пожалуйста, выберите файл в формате PDF.', 'error');
    return;
  }
  if (!window.pdfjsLib) {
    setStatus('Не удалось загрузить PDF.js. Проверьте интернет-соединение.', 'error');
    return;
  }
  try {
    setStatus('Читаю PDF…', 'info');
    const { text, pages } = await extractTextFromPdf(file);

    // Скан: в файле почти нет текстового слоя, одни картинки
    const chars = text.replace(/\s/g, '').length;
    if (chars < MIN_CHARS_PER_PAGE * pages) {
      parseReport = null;
      renderPreview();
      setStatus(
        'В этом PDF почти нет текста — похоже, это скан (страницы-картинки). ' +
        'Распознайте его через OCR (например, Google Drive: «Открыть в Google Документах», ' +
        'или Adobe Acrobat) и загрузите снова либо вставьте текст вручную.',
        'error'
      );
      return;
    }
    applyParsed(parseQuestions(text), file.name);
  } catch (err) {
    console.error(err);
    if (err && err.name === 'PasswordException') {
      setStatus('PDF защищён паролем. Снимите защиту и загрузите файл снова.', 'error');
    } else {
      setStatus('Ошибка чтения PDF: ' + (err.message || err), 'error');
    }
  }
}

// Обработка вставленного текста
function handleText() {
  const text = $('text-input').value;
  if (!text.trim()) { setStatus('Поле пустое — вставьте текст с вопросами.', 'error'); return; }
  applyParsed(parseQuestions(text), 'Вставленный текст');
}

// Применяем результат парсинга
function applyParsed(report, sourceName) {
  currentSource = sourceName;
  allQuestions = report.questions;
  parseReport = { failed: report.failed, missing: report.missing };

  if (!allQuestions.length && !parseReport.failed.length) {
    parseReport = null;
    renderPreview();
    updateStartAvailability();
    renderBest();
    setStatus('Вопросы не найдены. Проверьте формат: «1. Вопрос» и 4 варианта.', 'error');
    return;
  }
  commitQuestions();
}

// Фиксируем текущий набор вопросов: нумерация, сохранение, обновление интерфейса
function commitQuestions() {
  allQuestions.sort((a, b) => (a.num || 0) - (b.num || 0));
  allQuestions.forEach((q, i) => { q.id = i + 1; });

  if (allQuestions.length) {
    storageOk = lsSet(LS.questions, allQuestions);
    lsSet(LS.meta, { name: currentSource, date: new Date().toISOString(), count: allQuestions.length });
  } else {
    storageOk = true;
  }

  updateStartAvailability();
  renderSavedBox();
  renderBest();
  renderPreview();
  refreshStatus();
}

// Итоговое сообщение под зоной загрузки
function refreshStatus() {
  const failed = parseReport ? parseReport.failed.length : 0;
  if (!allQuestions.length && !failed) {
    setStatus('Вопросов не осталось. Загрузите другой файл или текст.', 'error');
    return;
  }
  if (!allQuestions.length) {
    setStatus('Ни один вопрос не распознан автоматически — поправьте их ниже вручную.', 'warn');
    return;
  }
  let msg = 'Найдено вопросов: ' + allQuestions.length;
  let type = 'ok';
  if (failed) { msg += '. Не распознано: ' + failed + ' — см. «Проверку разбора» ниже.'; type = 'warn'; }
  if (!storageOk) {
    msg += ' Тест не поместился в память браузера и не будет сохранён — после закрытия вкладки его придётся загрузить заново.';
    type = 'warn';
  }
  setStatus(msg, type);
}

/* ---------- 4. ПАРСЕР (версия с поддержкой переносов строк) ---------- */

/*
  Как это работает:
  1. Текст чистится (мусор PDF, номера страниц) и режется на БЛОКИ по нумерации: 1. / 2. / 3.
  2. Внутри блока ищем 5 частей: вопрос + 4 варианта. Два способа:
     А) по кавычкам: "вопрос" "вариант 1" ... — самый надёжный;
     Б) если кавычек нет — по раскладке строк (пустые строки, длина строки, знаки препинания).
  3. Строки внутри каждой части склеиваются обратно (с учётом переносов слов через дефис).
  Результат: { questions, failed, missing }
*/

// Начало вопроса: «12.» или «12)». Не срабатывает на «3.5 кг»
const START_RE = /^(["«“„]?)\s*(\d{1,4})\s*[.)](?!\d)\s*(.*)$/;

// Строки-мусор от PDF: «- 5 -», «Страница 5». Если есть другие колонтитулы — добавьте сюда
const PAGE_NOISE_RE = /^(?:[-–—]\s*\d+\s*[-–—]|(?:страница|стр\.?|page)\s*\d+(?:\s*(?:из|of)\s*\d+)?)$/i;

// Открывающая кавычка → допустимые закрывающие
const QUOTE_PAIRS = { '"': '"', '«': '»', '“': '”', '„': '“”' };

/* ----- Главная функция ----- */
function parseQuestions(raw) {
  const lines = prepareLines(raw);
  const wrapWidth = estimateWrapWidth(lines);
  lastWrapWidth = wrapWidth;
  const blocks = splitIntoBlocks(lines);

  const questions = [];
  const failed = [];

  for (const block of blocks) {
    const parsed = parseBlock(block, wrapWidth);
    if (!parsed) {
      console.warn('Вопрос №' + block.num + ' не распознан.');
      // Сохраняем исходный текст блока, чтобы пользователь мог поправить его вручную
      failed.push({ num: block.num, text: block.lines.join('\n').trim() });
      continue;
    }
    questions.push({
      id: questions.length + 1,
      num: block.num,
      question: parsed.question,
      options: parsed.options,
      correctAnswerText: parsed.options[0]   // первый вариант в исходнике — правильный
    });
  }

  return { questions, failed, missing: findMissingNumbers(blocks) };
}

// Какие номера из диапазона 1…N вообще не встретились в тексте
function findMissingNumbers(blocks) {
  if (!blocks.length) return [];
  const present = new Set(blocks.map((b) => b.num));
  const max = Math.min(Math.max(...present), 5000);
  const missing = [];
  for (let n = 1; n <= max; n++) if (!present.has(n)) missing.push(n);
  return missing;
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

/* ---------- 5. ПРОВЕРКА РАЗБОРА ---------- */

// Рисуем карточку «Проверка разбора»
function renderPreview() {
  const card = $('preview-card');
  if (!parseReport) { card.hidden = true; return; }
  card.hidden = false;

  // --- Сводка ---
  const sum = $('preview-summary');
  sum.innerHTML = '';
  const addChip = (cls, icon, text) => {
    const c = document.createElement('span');
    c.className = 'chip ' + cls;
    c.innerHTML = '<i class="fa-solid ' + icon + '"></i><span></span>';
    c.querySelector('span').textContent = text;
    sum.appendChild(c);
  };
  addChip('ok', 'fa-circle-check', 'Найдено: ' + allQuestions.length);
  if (parseReport.failed.length) addChip('bad', 'fa-circle-xmark', 'Не распознано: ' + parseReport.failed.length);
  if (parseReport.missing.length) {
    const shown = parseReport.missing.slice(0, 15).join(', ');
    const more = parseReport.missing.length > 15 ? ' и ещё ' + (parseReport.missing.length - 15) : '';
    addChip('warn', 'fa-magnifying-glass', 'Нет в тексте номеров: ' + shown + more);
  }

  // --- Не распознанные блоки: можно поправить вручную ---
  const fl = $('failed-list');
  fl.innerHTML = '';
  parseReport.failed.forEach((f) => fl.appendChild(buildFailedItem(f)));

  // --- Найденные вопросы (рисуем только если список раскрыт) ---
  $('found-details').hidden = allQuestions.length === 0;
  if ($('found-details').open) renderFoundList();
}

function buildFailedItem(f) {
  const item = document.createElement('div');
  item.className = 'failed-item';

  const head = document.createElement('div');
  head.className = 'failed-head';
  head.textContent = 'Вопрос №' + f.num + ' — не удалось разобрать';

  const hint = document.createElement('div');
  hint.className = 'failed-hint';
  hint.textContent = 'Оставьте ровно 5 частей: вопрос и 4 варианта (правильный — первый). ' +
    'Каждая часть с новой строки или в кавычках «…».';

  const ta = document.createElement('textarea');
  ta.className = 'textarea';
  ta.rows = 6;
  ta.value = f.text;

  const err = document.createElement('div');
  err.className = 'failed-error';
  err.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'failed-actions';

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-secondary btn-sm';
  ok.innerHTML = '<i class="fa-solid fa-check"></i> Разобрать';
  ok.addEventListener('click', () => {
    const parsed = parseManual(ta.value, f.num);
    if (!parsed) {
      err.textContent = 'Всё ещё не получается: нужно ровно 5 частей (вопрос + 4 варианта).';
      err.hidden = false;
      return;
    }
    allQuestions.push(parsed);
    parseReport.failed = parseReport.failed.filter((x) => x !== f);
    commitQuestions();
  });

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'btn btn-ghost btn-sm';
  skip.innerHTML = '<i class="fa-solid fa-forward"></i> Пропустить';
  skip.addEventListener('click', () => {
    parseReport.failed = parseReport.failed.filter((x) => x !== f);
    commitQuestions();
  });

  actions.append(ok, skip);
  item.append(head, hint, ta, actions, err);
  return item;
}

// Разбор вопроса, исправленного вручную
function parseManual(text, num) {
  const parsed = parseBlock({ num, lines: prepareLines(text) }, lastWrapWidth);
  if (!parsed) return null;
  return {
    id: 0, num,
    question: parsed.question,
    options: parsed.options,
    correctAnswerText: parsed.options[0]
  };
}

// Список найденных вопросов: правильный (первый) вариант подсвечен зелёным
function renderFoundList() {
  const list = $('found-list');
  list.innerHTML = '';
  allQuestions.forEach((q) => {
    const item = document.createElement('div');
    item.className = 'found-item';

    const num = document.createElement('div');
    num.className = 'found-num';
    num.textContent = '№' + (q.num || q.id);

    const body = document.createElement('div');
    body.className = 'found-body';
    const qEl = document.createElement('div');
    qEl.className = 'found-q';
    qEl.textContent = q.question;
    const ul = document.createElement('ul');
    ul.className = 'found-opts';
    q.options.forEach((o, i) => {
      const li = document.createElement('li');
      if (i === 0) li.className = 'right';
      li.textContent = o;
      ul.appendChild(li);
    });
    body.append(qEl, ul);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn small';
    del.title = 'Удалить вопрос';
    del.setAttribute('aria-label', 'Удалить вопрос');
    del.innerHTML = '<i class="fa-solid fa-trash"></i>';
    del.addEventListener('click', () => {
      allQuestions = allQuestions.filter((x) => x !== q);
      commitQuestions();
    });

    item.append(num, body, del);
    list.appendChild(item);
  });
}

/* ---------- 6. СОХРАНЕНИЕ / ЗАГРУЗКА ---------- */

// Блок «Последний тест сохранён»
function renderSavedBox() {
  const saved = lsGet(LS.questions);
  const meta = lsGet(LS.meta);
  const box = $('saved-box');
  if (saved && saved.length) {
    const d = meta && meta.date ? new Date(meta.date).toLocaleString('ru-RU') : '';
    $('saved-meta').textContent =
      (meta && meta.name ? meta.name + ' · ' : '') + saved.length + ' вопр.' + (d ? ' · ' + d : '');
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

function loadSaved() {
  const saved = lsGet(LS.questions);
  if (!saved || !saved.length) return;
  const meta = lsGet(LS.meta);
  allQuestions = saved;
  currentSource = meta && meta.name ? meta.name : '';
  parseReport = null;         // для загруженного теста отчёт разбора не показываем
  renderPreview();
  updateStartAvailability();
  renderBest();
  setStatus('Загружен сохранённый тест: ' + saved.length + ' вопросов', 'ok');
}

// Сколько вопросов реально будет в тесте при текущем выборе
function effectiveCount() {
  const v = $('count-select').value;
  return v === 'all' ? allQuestions.length : Math.min(parseInt(v, 10), allQuestions.length);
}

// Ключ лучшего результата: «отпечаток теста | число вопросов»
function bestKeyNow() {
  return testIdOf(allQuestions) + '|' + effectiveCount();
}

// Лучший результат для текущего теста и числа вопросов
function renderBest() {
  const el = $('best-line');
  if (!allQuestions.length) { el.hidden = true; return; }
  const map = lsGet(LS.best) || {};
  const best = map[bestKeyNow()];
  if (best && typeof best.percent === 'number') {
    el.innerHTML = '<i class="fa-solid fa-trophy"></i> Лучший результат для этого теста: <b>' +
      best.percent + '%</b> (' + best.score + ' из ' + best.total + ')';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function saveBest(key, percent, score, total) {
  const map = lsGet(LS.best) || {};
  if (!map[key] || percent > map[key].percent) {
    map[key] = { percent, score, total, date: new Date().toISOString() };
    lsSet(LS.best, map);
  }
}

// Сохранение выбранных настроек
function saveSettings() {
  lsSet(LS.settings, { count: $('count-select').value, mode: getMode() });
}
function restoreSettings() {
  const s = lsGet(LS.settings);
  if (!s) return;
  if (s.count) $('count-select').value = s.count;
  if (s.mode) { const r = document.querySelector('input[name="mode"][value="' + s.mode + '"]'); if (r) r.checked = true; }
}

function getMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function updateModeHint() {
  $('mode-hint').textContent = getMode() === 'train'
    ? 'Правильность ответа видна сразу после клика.'
    : 'Ответы «вслепую», идёт таймер (' + SECONDS_PER_QUESTION + ' сек. на вопрос), итоги — в конце.';
}

// Кнопка «Начать тест» активна только когда есть вопросы
function updateStartAvailability() {
  $('start-btn').disabled = allQuestions.length === 0;
}

/* ---------- 7. СТАРТ ТЕСТА ---------- */

// Собираем сессию: перемешиваем вопросы И варианты ответов.
// В каждом вопросе запоминаем correctIndex — позицию правильного ответа ПОСЛЕ перемешивания.
// orig — ссылка на исходный вопрос (нужна для «Начать заново» и «Перепройти ошибки»).
function buildSession(sourceQuestions, mode, isRetry, bestKey) {
  const prepared = shuffle(sourceQuestions).map((q) => {
    const order = shuffle(q.options.map((_, i) => i));   // Fisher-Yates по индексам
    return {
      id: q.id,
      orig: q,
      question: q.question,
      options: order.map((i) => q.options[i]),
      correctIndex: order.indexOf(0),                    // исходный индекс 0 — правильный
      correctAnswerText: q.options[0],
      userIndex: null                                    // выбранный вариант (номер позиции)
    };
  });
  return { questions: prepared, index: 0, mode, isRetry, answered: false, bestKey, deadline: 0 };
}

function startTest() {
  if (!allQuestions.length) return;
  saveSettings();

  const pool = shuffle(allQuestions).slice(0, effectiveCount());
  launch(buildSession(pool, getMode(), false, bestKeyNow()));
}

// Запуск подготовленной сессии
function launch(newSession) {
  session = newSession;
  showScreen('quiz');

  // Таймер — только в режиме «Экзамен»
  stopTimer();
  if (session.mode === 'exam') {
    session.deadline = Date.now() + session.questions.length * SECONDS_PER_QUESTION * 1000;
    $('timer').hidden = false;
    tick();
    timerId = setInterval(tick, 500);
  } else {
    $('timer').hidden = true;
  }
  renderQuestion();
}

/* ---------- 8. ПРОХОЖДЕНИЕ ТЕСТА ---------- */

function renderQuestion() {
  const q = session.questions[session.index];
  const total = session.questions.length;

  session.answered = false;

  // Прогресс
  $('progress-text').textContent = 'Вопрос ' + (session.index + 1) + ' из ' + total;
  $('progress-fill').style.width = (session.index / total * 100) + '%';
  $('q-number').textContent = 'Вопрос ' + (session.index + 1);
  $('q-text').textContent = q.question;

  // Варианты ответов
  const box = $('options');
  box.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option';
    btn.innerHTML =
      '<span class="num">' + (i + 1) + '</span>' +
      '<span class="label"></span>' +
      '<i class="fa-solid mark"></i>';
    btn.querySelector('.label').textContent = opt;
    btn.addEventListener('click', () => selectAnswer(i));
    box.appendChild(btn);
  });

  // Кнопка «Далее» заблокирована, пока не выбран ответ
  $('next-btn').disabled = true;
  $('next-label').textContent = session.index === total - 1 ? 'Завершить' : 'Следующий вопрос';

  // Анимация появления вопроса
  const wrap = $('question-wrap');
  wrap.classList.remove('enter');
  void wrap.offsetWidth;            // перезапуск CSS-анимации
  wrap.classList.add('enter');
}

function selectAnswer(i) {
  const q = session.questions[session.index];
  const buttons = $('options').querySelectorAll('.option');
  if (i < 0 || i >= buttons.length) return;

  if (session.mode === 'train') {
    // ТРЕНИРОВКА: ответ фиксируется сразу, показываем верно/неверно
    if (session.answered) return;
    session.answered = true;
    q.userIndex = i;

    buttons.forEach((b, idx) => {
      b.classList.add('locked');
      const mark = b.querySelector('.mark');
      if (idx === q.correctIndex) {
        b.classList.add('correct');
        mark.classList.add('fa-circle-check');
      } else if (idx === i) {
        b.classList.add('wrong');
        mark.classList.add('fa-circle-xmark');
      }
    });
  } else {
    // ЭКЗАМЕН: можно менять выбор до нажатия «Далее», верность не показывается
    session.answered = true;
    q.userIndex = i;
    buttons.forEach((b, idx) => b.classList.toggle('selected', idx === i));
  }
  $('next-btn').disabled = false;

  // Снимаем фокус с кнопки, чтобы Enter/Пробел не срабатывали дважды (клик + наш обработчик)
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

function nextQuestion() {
  if (!session.answered) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (session.index < session.questions.length - 1) {
    session.index++;
    renderQuestion();
  } else {
    finishTest();
  }
}

// Горячие клавиши: 1–4 — выбор, Enter/Space — далее
document.addEventListener('keydown', (e) => {
  if (!$('screen-quiz').classList.contains('active')) return;
  if (e.repeat) return;                       // игнорируем удержание клавиши
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'input' || tag === 'select') return;

  if (e.key >= '1' && e.key <= '4') {
    e.preventDefault();
    selectAnswer(parseInt(e.key, 10) - 1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    nextQuestion();
  }
});

/* ---------- 9. ТАЙМЕР ---------- */
// Считаем от реального времени (Date.now), поэтому в фоновой вкладке таймер не отстаёт

function tick() {
  timeLeft = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
  updateTimerView();
  if (timeLeft <= 0) finishTest(true);        // время вышло
}
function updateTimerView() {
  $('timer-value').textContent = fmtTime(timeLeft);
  $('timer').classList.toggle('warn', timeLeft <= 30);
}
function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}

// Когда вкладка снова стала видимой — сразу пересчитываем время
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && timerId) tick();
});

/* ---------- 10. РЕЗУЛЬТАТЫ ---------- */

function isWrong(q) { return q.userIndex !== q.correctIndex; }

function finishTest(timeout) {
  stopTimer();
  $('progress-fill').style.width = '100%';

  const total = session.questions.length;
  const wrongList = session.questions.filter(isWrong);
  const score = total - wrongList.length;
  const percent = Math.round(score / total * 100);

  // Статусный бейдж
  let text, cls;
  if (percent >= 90)      { text = 'Отлично!';          cls = 'great'; }
  else if (percent >= 75) { text = 'Очень хорошо';      cls = 'good';  }
  else if (percent >= 50) { text = 'Хорошая попытка';   cls = 'mid';   }
  else                    { text = 'Нужно повторить';   cls = 'bad';   }

  const ringColors = { great: 'var(--success)', good: 'var(--primary)', mid: 'var(--warning)', bad: 'var(--danger)' };
  const ring = $('ring');
  ring.style.setProperty('--ring-color', ringColors[cls]);
  ring.style.setProperty('--p', 0);                       // стартуем с нуля...

  $('res-percent').textContent = percent + '%';
  const badge = $('res-badge');
  badge.textContent = text;
  badge.className = 'badge ' + cls;
  $('res-score').textContent = 'Верно: ' + score + ' из ' + total;
  $('res-extra').textContent = timeout ? 'Время вышло — неотвеченные вопросы засчитаны как ошибки.' : '';

  // Лучший результат запоминаем только для обычных тестов (не «только ошибки»)
  if (!session.isRetry && session.bestKey) saveBest(session.bestKey, percent, score, total);

  renderReview(wrongList);
  $('retry-errors-btn').hidden = wrongList.length === 0;
  showScreen('result');

  // ...и плавно доводим кольцо до нужного процента
  requestAnimationFrame(() => requestAnimationFrame(() => ring.style.setProperty('--p', percent)));
}

// Разбор ошибок
function renderReview(wrongList) {
  const list = $('review-list');
  list.innerHTML = '';

  if (!wrongList.length) {
    list.innerHTML = '<div class="review-empty"><i class="fa-solid fa-champagne-glasses"></i> Ошибок нет — идеальный результат!</div>';
    return;
  }

  wrongList.forEach((q, n) => {
    const item = document.createElement('div');
    item.className = 'review-item';
    item.style.animationDelay = Math.min(n * 0.04, 0.4) + 's';

    const qEl = document.createElement('div');
    qEl.className = 'review-q';
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = (n + 1) + '.';
    qEl.appendChild(idx);
    qEl.appendChild(document.createTextNode(q.question));

    const mine = document.createElement('div');
    mine.className = 'review-ans mine';
    mine.innerHTML = '<small>Твой ответ</small><span></span>';
    mine.querySelector('span').textContent =
      q.userIndex === null ? '— нет ответа —' : q.options[q.userIndex];

    const right = document.createElement('div');
    right.className = 'review-ans right';
    right.innerHTML = '<small>Правильный ответ</small><span></span>';
    right.querySelector('span').textContent = q.correctAnswerText;

    item.append(qEl, mine, right);
    list.appendChild(item);
  });
}

// «Перепройти только ошибки» — мини-тест из ошибочных вопросов (варианты снова перемешиваются)
function retryErrors() {
  const wrong = session.questions.filter(isWrong);
  if (!wrong.length) return;
  launch(buildSession(wrong.map((q) => q.orig), session.mode, true, session.bestKey));
}

// «Начать заново» — тот же набор вопросов, новый случайный порядок и варианты
function restartTest() {
  launch(buildSession(session.questions.map((q) => q.orig), session.mode, session.isRetry, session.bestKey));
}

function goHome() {
  stopTimer();
  renderBest();
  showScreen('start');
}

/* ---------- 11. ИНИЦИАЛИЗАЦИЯ ---------- */

function init() {
  // Тема
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  $('theme-toggle').addEventListener('click', toggleTheme);

  // Вкладки PDF / Текст
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // Выбор файла и Drag-and-Drop
  const dz = $('dropzone');
  $('file-input').addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
    e.target.value = '';   // позволяет выбрать тот же файл повторно
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
  // Чтобы браузер не открывал PDF, если уронили мимо зоны
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Текст
  $('parse-text-btn').addEventListener('click', handleText);

  // Сохранённый тест
  $('load-saved-btn').addEventListener('click', loadSaved);

  // Список найденных вопросов рисуем лениво — при первом раскрытии
  $('found-details').addEventListener('toggle', () => {
    if ($('found-details').open) renderFoundList();
  });

  // Настройки
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => { updateModeHint(); saveSettings(); }));
  $('count-select').addEventListener('change', () => { saveSettings(); renderBest(); });

  // Кнопки теста
  $('start-btn').addEventListener('click', startTest);
  $('next-btn').addEventListener('click', nextQuestion);
  $('quit-btn').addEventListener('click', () => {
    if (confirm('Выйти из теста? Прогресс будет потерян.')) goHome();
  });

  // Кнопки результатов
  $('retry-errors-btn').addEventListener('click', retryErrors);
  $('restart-btn').addEventListener('click', restartTest);
  $('home-btn').addEventListener('click', goHome);

  // Восстановление данных из localStorage
  restoreSettings();
  updateModeHint();

  // Если есть сохранённый тест — подгружаем сразу, можно начинать без повторной загрузки
  const saved = lsGet(LS.questions);
  if (saved && saved.length) {
    const meta = lsGet(LS.meta);
    allQuestions = saved;
    currentSource = meta && meta.name ? meta.name : '';
    updateStartAvailability();
  }
  renderSavedBox();
  renderBest();
}

document.addEventListener('DOMContentLoaded', init);