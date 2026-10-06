/* =========================================================
   QuizGen — логика приложения
   Разделы:
   0. Настройки и состояние   1. Утилиты        2. Тема
   3. Загрузка PDF / текста   4. Парсер         5. Сохранение
   6. Старт теста             7. Прохождение    8. Таймер
   9. Результаты              10. Инициализация
   ========================================================= */

/* ---------- 0. НАСТРОЙКИ И СОСТОЯНИЕ ---------- */

// Секунд на один вопрос в режиме «Экзамен» (меняйте при желании)
const SECONDS_PER_QUESTION = 60;

// Ключи localStorage
const LS = {
  theme: 'qg_theme',
  questions: 'qg_questions',   // последний загруженный тест
  meta: 'qg_meta',             // имя источника и дата
  best: 'qg_best',             // лучший результат
  settings: 'qg_settings'      // выбранные count / mode
};

// Подключаем воркер PDF.js (нужен для разбора PDF)
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Все вопросы, найденные в источнике: { id, question, options[], correctAnswerText }
let allQuestions = [];

// Текущая сессия теста
let session = {
  questions: [],     // вопросы с уже перемешанными вариантами + userAnswer
  index: 0,          // номер текущего вопроса
  mode: 'train',     // 'train' | 'exam'
  isRetry: false,    // true, если это «только ошибки»
  answered: false,   // выбран ли ответ на текущем вопросе
  selected: null     // индекс выбранного варианта
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

// Сообщение о статусе: type = 'ok' | 'error' | 'info'
function setStatus(text, type) {
  const el = $('status');
  if (!text) { el.hidden = true; return; }
  const icons = { ok: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-spinner fa-spin' };
  el.className = 'status ' + type;
  el.innerHTML = '<i class="fa-solid ' + icons[type] + '"></i><span></span>';
  el.querySelector('span').textContent = text;   // textContent — защита от XSS
  el.hidden = false;
}

// Безопасная работа с localStorage (в приватном режиме может падать)
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

// Формат времени мм:сс
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
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

// Извлекаем текст из PDF, сохраняя переносы строк (по координате Y)
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
  return lines.join('\n');
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
    const text = await extractTextFromPdf(file);
    applyParsed(parseQuestions(text), file.name);
  } catch (err) {
    console.error(err);
    setStatus('Ошибка чтения PDF: ' + (err.message || err), 'error');
  }
}

// Обработка вставленного текста
function handleText() {
  const text = $('text-input').value;
  if (!text.trim()) { setStatus('Поле пустое — вставьте текст с вопросами.', 'error'); return; }
  applyParsed(parseQuestions(text), 'Вставленный текст');
}

// Применяем результат парсинга: сохраняем и разблокируем кнопку «Начать»
function applyParsed(questions, sourceName) {
  if (!questions.length) {
    allQuestions = [];
    updateStartAvailability();
    setStatus('Вопросы не найдены. Проверьте формат: «1. Вопрос» и 4 варианта.', 'error');
    return;
  }
  allQuestions = questions;
  lsSet(LS.questions, questions);
  lsSet(LS.meta, { name: sourceName, date: new Date().toISOString(), count: questions.length });
  setStatus('Готово! Найдено вопросов: ' + questions.length, 'ok');
  updateStartAvailability();
  renderSavedBox();
}

/* ---------- 4. ПАРСЕР (версия с поддержкой переносов строк) ---------- */

// Начало вопроса: «12.» или «12)». Не срабатывает на «3.5 кг»
const START_RE = /^(["«“„]?)\s*(\d{1,4})\s*[.)](?!\d)\s*(.*)$/;

// Строки-мусор от PDF
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
function prepareLines(raw) {
  const out = [];
  raw
    .replace(/\r/g, '')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '')
    .split('\n')
    .forEach((l) => {
      const t = l.replace(/\s+/g, ' ').trim();
      if (PAGE_NOISE_RE.test(t)) return;
      if (!t) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        return;
      }
      out.push(t);
    });
  return out;
}

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
      const isNext = num === lastNum + 1;
      const isSkip = num > lastNum && filled >= 5;

      if (!cur || isNext || isSkip) {
        cur = { num, lines: [] };
        blocks.push(cur);
        lastNum = num;
        const rest = (m[1] + m[3]).trim();
        if (rest) cur.lines.push(rest);
        continue;
      }
    }
    if (cur) cur.lines.push(line);
  }
  return blocks;
}

/* ----- Шаг 3. Разбор одного блока ----- */
function parseBlock(block, wrapWidth) {
  const byQuotes = splitByQuotes(block.lines.join('\n'));
  const parts = byQuotes || splitByLayout(block.lines, wrapWidth);
  if (!parts || parts.length !== 5) return null;

  const tidy = (s) => s.replace(/\s+/g, ' ').trim();
  const fix = (s) => (byQuotes ? tidy(s) : unwrapQuotes(tidy(s)));

  const question = fix(parts[0]);
  const options = parts.slice(1).map((o) => stripOptionMarker(fix(o)));

  if (!question || options.some((o) => !o)) return null;
  return { question, options };
}

/* --- Способ А: разделение по кавычкам --- */
function splitByQuotes(text) {
  const segs = [];
  let outside = '';
  let opener = null, closers = null, depth = 0, buf = '';

  for (const ch of text) {
    if (!closers) {
      if (QUOTE_PAIRS[ch]) { opener = ch; closers = QUOTE_PAIRS[ch]; depth = 1; buf = ''; }
      else outside += ch;
    } else if (ch === opener && opener !== closers) {
      depth++; buf += ch;
    } else if (closers.includes(ch)) {
      depth--;
      if (depth === 0) { segs.push(buf); closers = null; opener = null; }
      else buf += ch;
    } else {
      buf += ch;
    }
  }

  if (closers) return null;
  if (segs.length !== 5) return null;
  if (outside.replace(/[\s\d.,;:()\-–—]/g, '').length > 10) return null;

  return segs.map((s) => joinWrapped(s.split('\n')));
}

/* --- Способ Б: разделение по раскладке строк (если кавычек нет) --- */
function splitByLayout(lines, wrapWidth) {
  const rows = [];
  let blank = false;
  for (const l of lines) {
    if (!l) { blank = true; continue; }
    rows.push({ text: l, blankBefore: blank && rows.length > 0 });
    blank = false;
  }
  if (rows.length < 5) return null;

  const groups = [];
  rows.forEach((r) => {
    if (r.blankBefore || !groups.length) groups.push([r.text]);
    else groups[groups.length - 1].push(r.text);
  });
  if (groups.length === 5) return groups.map((g) => joinWrapped(g));

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

function gapScore(prev, next, blankBefore, wrapWidth) {
  let s = 0;
  if (blankBefore) s += 2;

  const ratio = prev.length / wrapWidth;
  if (ratio < 0.6) s += 3;
  else if (ratio < 0.8) s += 2;
  else if (ratio >= 0.92) s -= 3;

  if (/\?$/.test(prev)) s += 2;
  if (/:$/.test(prev)) s += 1;
  if (/[.!;…)»”"]$/.test(prev)) s += 1;

  if (/[,\-–—(]$/.test(prev) ||
      /(?:^|\s)(?:и|в|во|на|с|со|к|ко|по|от|до|из|за|для|что|как|или|а|но|не|о|об|у|the|of|and|to|in|a)$/i.test(prev)) {
    s -= 3;
  }

  if (/^[a-zа-яё]/.test(next)) s -= 1;
  else s += 1;
  return s;
}

/* ----- Вспомогательные функции ----- */
function joinWrapped(parts) {
  let res = '';
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (!res) res = p;
    else if (/[A-Za-zА-Яа-яЁё]-$/.test(res) && /^[a-zа-яё]/.test(p)) res = res.slice(0, -1) + p;
    else res += ' ' + p;
  }
  return res;
}

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

function stripOptionMarker(s) {
  return s.replace(/^(?:[1-4][.)]|[A-Da-dА-Гa-г]\))\s+/, '').trim();
}

/* ---------- 5. СОХРАНЕНИЕ / ЗАГРУЗКА ---------- */

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
  allQuestions = saved;
  setStatus('Загружен сохранённый тест: ' + saved.length + ' вопросов', 'ok');
  updateStartAvailability();
}

function renderBest() {
  const best = lsGet(LS.best);
  const el = $('best-line');
  if (best) {
    el.innerHTML = '<i class="fa-solid fa-trophy"></i> Лучший результат: <b>' +
      best.percent + '%</b> (' + best.score + ' из ' + best.total + ')';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function saveBest(percent, score, total) {
  const best = lsGet(LS.best);
  if (!best || percent > best.percent) {
    lsSet(LS.best, { percent, score, total, date: new Date().toISOString() });
  }
}

function saveSettings() {
  lsSet(LS.settings, { count: $('count-select').value, mode: getMode() });
}

function restoreSettings() {
  const s = lsGet(LS.settings);
  if (!s) return;
  if (s.count) $('count-select').value = s.count;
  if (s.mode) { const r = document.querySelector('input[name="mode"][value="' + s.mode + '"]'); if (r) r.checked = true; }
  updateModeHint();
}

function getMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function updateModeHint() {
  $('mode-hint').textContent = getMode() === 'train'
    ? 'Правильность ответа видна сразу после клика.'
    : 'Ответы «вслепую», идёт таймер (' + SECONDS_PER_QUESTION + ' сек. на вопрос), итоги — в конце.';
}

function updateStartAvailability() {
  $('start-btn').disabled = allQuestions.length === 0;
}

/* ---------- 6. СТАРТ ТЕСТА ---------- */

function buildSession(sourceQuestions, mode, isRetry) {
  const prepared = shuffle(sourceQuestions).map((q) => ({
    id: q.id,
    question: q.question,
    correctAnswerText: q.correctAnswerText,
    options: shuffle(q.options),
    userAnswer: null
  }));
  return { questions: prepared, index: 0, mode, isRetry, answered: false, selected: null };
}

function startTest() {
  if (!allQuestions.length) return;
  saveSettings();

  const countVal = $('count-select').value;
  let pool = shuffle(allQuestions);
  if (countVal !== 'all') pool = pool.slice(0, Math.min(parseInt(countVal, 10), pool.length));

  launch(buildSession(pool, getMode(), false));
}

function launch(newSession) {
  session = newSession;
  showScreen('quiz');

  stopTimer();
  if (session.mode === 'exam') {
    timeLeft = session.questions.length * SECONDS_PER_QUESTION;
    $('timer').hidden = false;
    updateTimerView();
    timerId = setInterval(tick, 1000);
  } else {
    $('timer').hidden = true;
  }
  renderQuestion();
}

/* ---------- 7. ПРОХОЖДЕНИЕ ТЕСТА ---------- */

function renderQuestion() {
  const q = session.questions[session.index];
  const total = session.questions.length;

  session.answered = false;
  session.selected = null;

  $('progress-text').textContent = 'Вопрос ' + (session.index + 1) + ' из ' + total;
  $('progress-fill').style.width = (session.index / total * 100) + '%';
  $('q-number').textContent = 'Вопрос ' + (session.index + 1);
  $('q-text').textContent = q.question;

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

  $('next-btn').disabled = true;
  $('next-label').textContent = session.index === total - 1 ? 'Завершить' : 'Следующий вопрос';

  const wrap = $('question-wrap');
  wrap.classList.remove('enter');
  void wrap.offsetWidth;
  wrap.classList.add('enter');
}

function selectAnswer(i) {
  const q = session.questions[session.index];
  const buttons = $('options').querySelectorAll('.option');
  if (i < 0 || i >= buttons.length) return;

  if (session.mode === 'train') {
    if (session.answered) return;
    session.answered = true;
    q.userAnswer = q.options[i];

    buttons.forEach((b, idx) => {
      b.classList.add('locked');
      const mark = b.querySelector('.mark');
      if (q.options[idx] === q.correctAnswerText) {
        b.classList.add('correct');
        mark.classList.add('fa-circle-check');
      } else if (idx === i) {
        b.classList.add('wrong');
        mark.classList.add('fa-circle-xmark');
      }
    });
  } else {
    session.answered = true;
    session.selected = i;
    q.userAnswer = q.options[i];
    buttons.forEach((b, idx) => b.classList.toggle('selected', idx === i));
  }
  $('next-btn').disabled = false;
}

function nextQuestion() {
  if (!session.answered) return;
  if (session.index < session.questions.length - 1) {
    session.index++;
    renderQuestion();
  } else {
    finishTest();
  }
}

document.addEventListener('keydown', (e) => {
  if (!$('screen-quiz').classList.contains('active')) return;
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

/* ---------- 8. ТАЙМЕР ---------- */

function tick() {
  timeLeft--;
  updateTimerView();
  if (timeLeft <= 0) {
    finishTest(true);
  }
}
function updateTimerView() {
  $('timer-value').textContent = fmtTime(Math.max(timeLeft, 0));
  $('timer').classList.toggle('warn', timeLeft <= 30);
}
function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}

/* ---------- 9. РЕЗУЛЬТАТЫ ---------- */

function finishTest(timeout) {
  stopTimer();
  $('progress-fill').style.width = '100%';

  const total = session.questions.length;
  const wrongList = session.questions.filter((q) => q.userAnswer !== q.correctAnswerText);
  const score = total - wrongList.length;
  const percent = Math.round(score / total * 100);

  let text, cls;
  if (percent >= 90)      { text = 'Отлично!';          cls = 'great'; }
  else if (percent >= 75) { text = 'Очень хорошо';      cls = 'good';  }
  else if (percent >= 50) { text = 'Хорошая попытка';   cls = 'mid';   }
  else                    { text = 'Нужно повторить';   cls = 'bad';   }

  const ringColors = { great: 'var(--success)', good: 'var(--primary)', mid: 'var(--warning)', bad: 'var(--danger)' };
  const ring = $('ring');
  ring.style.setProperty('--ring-color', ringColors[cls]);
  ring.style.setProperty('--p', percent);

  $('res-percent').textContent = percent + '%';
  const badge = $('res-badge');
  badge.textContent = text;
  badge.className = 'badge ' + cls;
  $('res-score').textContent = 'Верно: ' + score + ' из ' + total;
  $('res-extra').textContent = timeout ? 'Время вышло — неотвеченные вопросы засчитаны как ошибки.' : '';

  if (!session.isRetry) saveBest(percent, score, total);

  renderReview(wrongList);
  $('retry-errors-btn').hidden = wrongList.length === 0;
  showScreen('result');
}

function renderReview(wrongList) {
  const list = $('review-list');
  list.innerHTML = '';

  if (!wrongList.length) {
    list.innerHTML = '<div class="review-empty"><i class="fa-solid fa-party-horn"></i> Ошибок нет — идеальный результат!</div>';
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
    mine.querySelector('span').textContent = q.userAnswer === null ? '— нет ответа —' : q.userAnswer;

    const right = document.createElement('div');
    right.className = 'review-ans right';
    right.innerHTML = '<small>Правильный ответ</small><span></span>';
    right.querySelector('span').textContent = q.correctAnswerText;

    item.append(qEl, mine, right);
    list.appendChild(item);
  });
}

function retryErrors() {
  const wrong = session.questions.filter((q) => q.userAnswer !== q.correctAnswerText);
  if (!wrong.length) return;
  const source = wrong.map((q) => ({
    id: q.id,
    question: q.question,
    correctAnswerText: q.correctAnswerText,
    options: [q.correctAnswerText].concat(q.options.filter((o) => o !== q.correctAnswerText))
  }));
  launch(buildSession(source, session.mode, true));
}

function restartTest() {
  const source = session.questions.map((q) => ({
    id: q.id,
    question: q.question,
    correctAnswerText: q.correctAnswerText,
    options: q.options
  }));
  launch(buildSession(source, session.mode, session.isRetry));
}

function goHome() {
  stopTimer();
  renderBest();
  showScreen('start');
}

/* ---------- 10. ИНИЦИАЛИЗАЦИЯ ---------- */

function init() {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  $('theme-toggle').addEventListener('click', toggleTheme);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  const dz = $('dropzone');
  $('file-input').addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('parse-text-btn').addEventListener('click', handleText);
  $('load-saved-btn').addEventListener('click', loadSaved);

  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => { updateModeHint(); saveSettings(); }));
  $('count-select').addEventListener('change', saveSettings);

  $('start-btn').addEventListener('click', startTest);
  $('next-btn').addEventListener('click', nextQuestion);
  $('quit-btn').addEventListener('click', () => {
    if (confirm('Выйти из теста? Прогресс будет потерян.')) goHome();
  });

  $('retry-errors-btn').addEventListener('click', retryErrors);
  $('restart-btn').addEventListener('click', restartTest);
  $('home-btn').addEventListener('click', goHome);

  restoreSettings();
  renderSavedBox();
  renderBest();
  updateModeHint();

  const saved = lsGet(LS.questions);
  if (saved && saved.length) {
    allQuestions = saved;
    updateStartAvailability();
  }
}

document.addEventListener('DOMContentLoaded', init);