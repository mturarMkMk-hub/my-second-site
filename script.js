/* =========================================================
   QuizGen — Мультиязычная версия (Исправленная)
   ========================================================= */

const SECONDS_PER_QUESTION = 60;

const LS = {
  theme: 'qg_theme',
  lang: 'qg_lang',
  questions: 'qg_questions',
  meta: 'qg_meta',
  best: 'qg_best',
  settings: 'qg_settings'
};

const I18N = {
  ru: {
    mainTitle: 'Создайте тест из PDF или текста',
    mainSubtitle: 'Формат: «1. Вопрос» и 4 варианта. Верный вариант можно отметить звёздочкой (*).',
    tabPdf: 'PDF-файл',
    tabText: 'Вставить текст',
    dzTitle: 'Перетащите PDF сюда',
    dzSub: 'или нажмите, чтобы выбрать файл',
    btnParseText: 'Разобрать текст',
    btnEditQuestions: 'Просмотр / Редактировать',
    savedTitle: 'Последний тест сохранён',
    btnLoad: 'Загрузить',
    settingsTitle: 'Настройки теста',
    countLabel: 'Количество вопросов',
    countAll: 'Все',
    modeLabel: 'Режим',
    modeTrain: 'Тренировка',
    modeExam: 'Экзамен',
    modeTrainHint: 'Правильность ответа видна сразу после клика.',
    modeExamHint: 'Ответы «вслепую», идёт таймер, итоги — в конце.',
    btnStart: 'Начать тест',
    btnRetryErrors: 'Только ошибки',
    btnRestart: 'Заново',
    btnHome: 'В меню',
    reviewTitle: 'Разбор ошибок',
    modalTitle: 'Редактирование вопросов',
    btnSaveClose: 'Сохранить и закрыть',
    footer: 'QuizGen · работает полностью в вашем браузере, файлы никуда не отправляются',
    statusOk: 'Готово! Найдено вопросов: ',
    statusErr: 'Вопросы не найдены. Проверьте формат.',
    bestResult: 'Лучший результат: ',
    questionText: 'Вопрос ',
    fromText: ' из ',
    nextQuestion: 'Следующий вопрос',
    finishQuiz: 'Завершить',
    yourAns: 'Твой ответ',
    rightAns: 'Правильный ответ',
    noErrors: 'Ошибок нет — идеальный результат!'
  },
  kk: {
    mainTitle: 'PDF немесе мәтіннен тест жасаңыз',
    mainSubtitle: 'Форматы: «1. Сұрақ» және 4 нұсқа. Дұрыс жауапты жұлдызшамен (*) белгілеуге болады.',
    tabPdf: 'PDF файлы',
    tabText: 'Мәтінді қою',
    dzTitle: 'PDF файлын осы жерге сүйреңіз',
    dzSub: 'немесе файлды таңдау үшін басыңыз',
    btnParseText: 'Мәтінді талдау',
    btnEditQuestions: 'Көру / Өңдеу',
    savedTitle: 'Соңғы тест сақталды',
    btnLoad: 'Жүктеу',
    settingsTitle: 'Тест баптаулары',
    countLabel: 'Сұрақтар саны',
    countAll: 'Барлығы',
    modeLabel: 'Режим',
    modeTrain: 'Жаттығу',
    modeExam: 'Емтихан',
    modeTrainHint: 'Дұрыс жауап бірден көрсетіледі.',
    modeExamHint: 'Жауаптар жасырын, таймер жүреді, нәтиже соңында.',
    btnStart: 'Тестті бастау',
    btnRetryErrors: 'Тек қателер',
    btnRestart: 'Қайта бастау',
    btnHome: 'Мәзірге',
    reviewTitle: 'Қателермен жұмыс',
    modalTitle: 'Сұрақтарды өңдеу',
    btnSaveClose: 'Сақтау және жабу',
    footer: 'QuizGen · толықтай браузеріңізде жұмыс істейді',
    statusOk: 'Дайын! Табылған сұрақтар: ',
    statusErr: 'Сұрақтар табылмады. Форматты тексеріңіз.',
    bestResult: 'Үздік нәтиже: ',
    questionText: 'Сұрақ ',
    fromText: ' / ',
    nextQuestion: 'Келесі сұрақ',
    finishQuiz: 'Aяқтау',
    yourAns: 'Сіздің жауабыңыз',
    rightAns: 'Дұрыс жауап',
    noErrors: 'Қателер жоқ — тамаша нәтиже!'
  },
  en: {
    mainTitle: 'Create Quiz from PDF or Text',
    mainSubtitle: 'Format: "1. Question" followed by 4 options. Mark correct answer with an asterisk (*).',
    tabPdf: 'PDF File',
    tabText: 'Paste Text',
    dzTitle: 'Drag & drop PDF here',
    dzSub: 'or click to browse file',
    btnParseText: 'Parse Text',
    btnEditQuestions: 'Preview / Edit',
    savedTitle: 'Last test saved',
    btnLoad: 'Load',
    settingsTitle: 'Quiz Settings',
    countLabel: 'Number of questions',
    countAll: 'All',
    modeLabel: 'Mode',
    modeTrain: 'Practice',
    modeExam: 'Exam',
    modeTrainHint: 'Instant feedback after clicking.',
    modeExamHint: 'Timed mode, answers revealed at the end.',
    btnStart: 'Start Quiz',
    btnRetryErrors: 'Retry Mistakes',
    btnRestart: 'Restart',
    btnHome: 'Home',
    reviewTitle: 'Mistakes Review',
    modalTitle: 'Edit Questions',
    btnSaveClose: 'Save & Close',
    footer: 'QuizGen · runs entirely in your browser',
    statusOk: 'Done! Questions found: ',
    statusErr: 'No questions found. Check format.',
    bestResult: 'Best Result: ',
    questionText: 'Question ',
    fromText: ' of ',
    nextQuestion: 'Next Question',
    finishQuiz: 'Finish',
    yourAns: 'Your answer',
    rightAns: 'Correct answer',
    noErrors: 'No mistakes — perfect score!'
  }
};

let currentLang = 'ru';

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

let allQuestions = [];
let session = {
  questions: [],
  index: 0,
  mode: 'train',
  isRetry: false,
  answered: false,
  selected: null
};

let timerId = null;
let timeLeft = 0;

const $ = (id) => document.getElementById(id);

function setLanguage(lang) {
  if (!I18N[lang]) lang = 'ru';
  currentLang = lang;
  lsSet(LS.lang, lang);
  $('lang-select').value = lang;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (I18N[lang][key]) el.textContent = I18N[lang][key];
  });

  updateModeHint();
  renderBest();
  renderSavedBox();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setStatus(text, type) {
  const el = $('status');
  if (!text) { el.hidden = true; return; }
  const icons = { ok: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-spinner fa-spin' };
  el.className = 'status ' + type;
  el.innerHTML = '<i class="fa-solid ' + icons[type] + '"></i><span></span>';
  el.querySelector('span').textContent = text;
  el.hidden = false;
}

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

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

function speakQuestion() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  const q = session.questions[session.index];
  const langCode = currentLang === 'kk' ? 'kk-KZ' : currentLang === 'en' ? 'en-US' : 'ru-RU';

  const textToRead = q.question + '. ' + q.options.map((opt, idx) => (idx + 1) + ': ' + opt).join('. ');
  const utterance = new SpeechSynthesisUtterance(textToRead);
  utterance.lang = langCode;
  window.speechSynthesis.speak(utterance);
}

async function extractTextFromPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const lines = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    let line = '';
    let lastY = null;
    let lastEnd = null;

    for (const item of content.items) {
      if (!item.str) continue;
      const x = item.transform[4];
      const y = item.transform[5];

      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        if (Math.abs(y - lastY) > (item.height || 10) * 1.7) lines.push('');
        line = '';
        lastEnd = null;
      }
      if (line && lastEnd !== null && x - lastEnd > 1 && !line.endsWith(' ') && !item.str.startsWith(' ')) {
        line += ' ';
      }
      line += item.str;
      lastY = y;
      lastEnd = x + (item.width || 0);
    }
    if (line) lines.push(line);
    lines.push('');
  }
  return lines.join('\n');
}

async function handleFile(file) {
  if (!file) return;
  if (!window.pdfjsLib) { setStatus('PDF.js Error', 'error'); return; }
  try {
    setStatus('...', 'info');
    const text = await extractTextFromPdf(file);
    applyParsed(parseQuestions(text), file.name);
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

function handleText() {
  const text = $('text-input').value;
  if (!text.trim()) return;
  applyParsed(parseQuestions(text), 'Text input');
}

function applyParsed(questions, sourceName) {
  if (!questions.length) {
    allQuestions = [];
    updateStartAvailability();
    setStatus(I18N[currentLang].statusErr, 'error');
    $('preview-bar').hidden = true;
    return;
  }
  allQuestions = questions;
  lsSet(LS.questions, questions);
  lsSet(LS.meta, { name: sourceName, date: new Date().toISOString(), count: questions.length });
  
  setStatus(I18N[currentLang].statusOk + questions.length, 'ok');
  $('parsed-count-text').textContent = I18N[currentLang].statusOk + questions.length;
  $('preview-bar').hidden = false;

  updateStartAvailability();
  renderSavedBox();
}

const START_RE = /^(?:["«“„]?)\s*(?:сұрақ|question|вопрос)?\s*(\d{1,4})\s*[-.)]\s*(.*)$/i;
const PAGE_NOISE_RE = /^(?:[-–—]\s*\d+\s*[-–—]|(?:страница|бет|стр\.?|page)\s*\d+)/i;

function parseQuestions(raw) {
  const lines = prepareLines(raw);
  const blocks = splitIntoBlocks(lines);
  const result = [];

  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (parsed) {
      result.push({
        id: result.length + 1,
        question: parsed.question,
        options: parsed.options,
        correctAnswerText: parsed.correctAnswerText
      });
    }
  }
  return result;
}

function prepareLines(raw) {
  const out = [];
  raw.replace(/\r/g, '').split('\n').forEach((l) => {
    const t = l.replace(/\s+/g, ' ').trim();
    if (PAGE_NOISE_RE.test(t)) return;
    if (!t) { if (out.length && out[out.length - 1] !== '') out.push(''); return; }
    out.push(t);
  });
  return out;
}

function splitIntoBlocks(lines) {
  const blocks = [];
  let cur = null;
  let lastNum = 0;

  for (const line of lines) {
    const m = line.match(START_RE);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!cur || num === lastNum + 1 || num > lastNum) {
        cur = { num, lines: [] };
        blocks.push(cur);
        lastNum = num;
        if (m[2].trim()) cur.lines.push(m[2].trim());
        continue;
      }
    }
    if (cur) cur.lines.push(line);
  }
  return blocks;
}

function parseBlock(block) {
  const rawLines = block.lines.filter(Boolean);
  if (rawLines.length < 2) return null;

  const question = rawLines[0];
  let options = rawLines.slice(1).map(s => stripOptionMarker(s));

  if (options.length < 2) return null;

  let correctIndex = 0;
  options = options.map((opt, idx) => {
    if (opt.startsWith('*')) {
      correctIndex = idx;
      return opt.replace(/^\*\s*/, '');
    }
    return opt;
  });

  return {
    question,
    options,
    correctAnswerText: options[correctIndex]
  };
}

function stripOptionMarker(s) {
  return s.replace(/^(?:\*?\s*)(?:[1-9][0-9]?[.)]|[A-Da-dА-Гa-г])[.)]\s+/, '').trim();
}

function openPreviewModal() {
  const container = $('preview-list');
  container.innerHTML = '';

  allQuestions.forEach((q, idx) => {
    const item = document.createElement('div');
    item.className = 'modal-q-item';
    item.innerHTML = `
      <div class="q-edit-header">
        <b>№ ${idx + 1}</b>
        <button class="btn btn-ghost small text-danger" onclick="deleteQuestion(${idx})"><i class="fa-solid fa-trash"></i></button>
      </div>
      <input type="text" class="textarea q-input" value="${escapeHtml(q.question)}" onchange="updateQText(${idx}, this.value)">
      <div class="opts-edit">
        ${q.options.map((opt, oIdx) => `
          <div class="opt-edit-row">
            <input type="radio" name="correct_${idx}" ${opt === q.correctAnswerText ? 'checked' : ''} onchange="setCorrectOpt(${idx},${oIdx})">
            <input type="text" class="textarea opt-input" value="${escapeHtml(opt)}" onchange="updateOptText(${idx},${oIdx}, this.value)">
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(item);
  });

  $('modal-preview').hidden = false;
}

function escapeHtml(str) {
  return str.replace(/"/g, '&quot;');
}

function closePreviewModal() {
  $('modal-preview').hidden = true;
  lsSet(LS.questions, allQuestions);
  updateStartAvailability();
}

function deleteQuestion(idx) {
  allQuestions.splice(idx, 1);
  openPreviewModal();
}

function updateQText(idx, val) { allQuestions[idx].question = val; }
function updateOptText(idx, oIdx, val) {
  const isCorrect = allQuestions[idx].options[oIdx] === allQuestions[idx].correctAnswerText;
  allQuestions[idx].options[oIdx] = val;
  if (isCorrect) allQuestions[idx].correctAnswerText = val;
}
function setCorrectOpt(idx, oIdx) {
  allQuestions[idx].correctAnswerText = allQuestions[idx].options[oIdx];
}

function renderSavedBox() {
  const saved = lsGet(LS.questions);
  const meta = lsGet(LS.meta);
  const box = $('saved-box');
  if (saved && saved.length) {
    const d = meta && meta.date ? new Date(meta.date).toLocaleDateString() : '';
    $('saved-meta').textContent = (meta && meta.name ? meta.name + ' · ' : '') + saved.length + ' вопр. ' + d;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

function loadSaved() {
  const saved = lsGet(LS.questions);
  if (!saved || !saved.length) return;
  allQuestions = saved;
  setStatus(I18N[currentLang].statusOk + saved.length, 'ok');
  $('preview-bar').hidden = false;
  $('parsed-count-text').textContent = I18N[currentLang].statusOk + saved.length;
  updateStartAvailability();
}

function renderBest() {
  const best = lsGet(LS.best);
  const el = $('best-line');
  if (best) {
    el.innerHTML = '<i class="fa-solid fa-trophy"></i> ' + I18N[currentLang].bestResult + '<b>' + best.percent + '%</b>';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function saveBest(percent, score, total) {
  const best = lsGet(LS.best);
  if (!best || percent > best.percent) {
    lsSet(LS.best, { percent, score, total });
  }
}

function updateModeHint() {
  const mode = getMode();
  $('mode-hint').textContent = mode === 'train' ? I18N[currentLang].modeTrainHint : I18N[currentLang].modeExamHint;
}

function getMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function updateStartAvailability() {
  $('start-btn').disabled = allQuestions.length === 0;
}

function startTest() {
  if (!allQuestions.length) return;
  const countVal = $('count-select').value;
  let pool = shuffle(allQuestions);
  if (countVal !== 'all') pool = pool.slice(0, Math.min(parseInt(countVal, 10), pool.length));

  launch({
    questions: pool.map(q => ({
      id: q.id,
      question: q.question,
      correctAnswerText: q.correctAnswerText,
      options: shuffle(q.options),
      userAnswer: null
    })),
    index: 0,
    mode: getMode(),
    isRetry: false,
    answered: false,
    selected: null
  });
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

function renderQuestion() {
  const q = session.questions[session.index];
  const total = session.questions.length;

  session.answered = false;
  session.selected = null;

  $('progress-text').textContent = I18N[currentLang].questionText + (session.index + 1) + I18N[currentLang].fromText + total;
  $('progress-fill').style.width = (session.index / total * 100) + '%';
  $('q-number').textContent = I18N[currentLang].questionText + (session.index + 1);$('q-text').textContent = q.question;

  const box = $('options');
  box.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option';
    btn.innerHTML = `<span class="num">${i + 1}</span><span class="label"></span><i class="fa-solid mark"></i>`;
    btn.querySelector('.label').textContent = opt;
    btn.addEventListener('click', () => selectAnswer(i));
    box.appendChild(btn);
  });

  $('next-btn').disabled = true;
  $('next-label').textContent = session.index === total - 1 ? I18N[currentLang].finishQuiz : I18N[currentLang].nextQuestion;
}

function selectAnswer(i) {
  const q = session.questions[session.index];
  const buttons = $('options').querySelectorAll('.option');

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

function tick() {
  timeLeft--;
  updateTimerView();
  if (timeLeft <= 0) finishTest(true);
}
function updateTimerView() {
  $('timer-value').textContent = fmtTime(Math.max(timeLeft, 0));$('timer').classList.toggle('warn', timeLeft <= 30);
}
function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}

function finishTest(timeout) {
  stopTimer();
  $('progress-fill').style.width = '100%';

  const total = session.questions.length;
  const wrongList = session.questions.filter((q) => q.userAnswer !== q.correctAnswerText);
  const score = total - wrongList.length;
  const percent = Math.round(score / total * 100);

  const ring = $('ring');
  ring.style.setProperty('--p', percent);

  $('res-percent').textContent = percent + '\%';$('res-score').textContent = score + ' / ' + total;

  if (!session.isRetry) saveBest(percent, score, total);

  renderReview(wrongList);
  $('retry-errors-btn').hidden = wrongList.length === 0;
  showScreen('result');
}

function renderReview(wrongList) {
  const list = $('review-list');
  list.innerHTML = '';

  if (!wrongList.length) {
    list.innerHTML = `<div class="review-empty"><i class="fa-solid fa-party-horn"></i> ${I18N[currentLang].noErrors}</div>`;
    return;
  }

  wrongList.forEach((q, n) => {
    const item = document.createElement('div');
    item.className = 'review-item';
    item.innerHTML = `
      <div class="review-q"><b>${n + 1}.</b> ${escapeHtml(q.question)}</div>
      <div class="review-ans mine"><small>${I18N[currentLang].yourAns}</small>${escapeHtml(q.userAnswer || '—')}</div>
      <div class="review-ans right"><small>${I18N[currentLang].rightAns}</small>${escapeHtml(q.correctAnswerText)}</div>
    `;
    list.appendChild(item);
  });
}

function goHome() {
  stopTimer();
  renderBest();
  showScreen('start');
}

function init() {
  applyTheme(lsGet(LS.theme) || 'light');
  $('theme-toggle').addEventListener('click', toggleTheme);

  const savedLang = lsGet(LS.lang) || 'ru';
  setLanguage(savedLang);
  $('lang-select').addEventListener('change', (e) => setLanguage(e.target.value));

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  const dz = $('dropzone');$('file-input').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  $('parse-text-btn').addEventListener('click', handleText);
  $('load-saved-btn').addEventListener('click', loadSaved);$('open-preview-btn').addEventListener('click', openPreviewModal);
  $('close-modal-btn').addEventListener('click', closePreviewModal);$('save-preview-btn').addEventListener('click', closePreviewModal);

  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', updateModeHint));

  $('start-btn').addEventListener('click', startTest);$('next-btn').addEventListener('click', nextQuestion);
  $('tts-btn').addEventListener('click', speakQuestion);$('quit-btn').addEventListener('click', () => { if (confirm('Exit?')) goHome(); });

  $('retry-errors-btn').addEventListener('click', () => {
    const wrong = session.questions.filter((q) => q.userAnswer !== q.correctAnswerText);
    launch({
      questions: wrong.map(q => ({ ...q, options: shuffle(q.options), userAnswer: null })),
      index: 0, mode: session.mode, isRetry: true, answered: false, selected: null
    });
  });

  $('restart-btn').addEventListener('click', startTest);$('home-btn').addEventListener('click', goHome);

  renderSavedBox();
  renderBest();

  const saved = lsGet(LS.questions);
  if (saved && saved.length) {
    allQuestions = saved;
    updateStartAvailability();
  }
}

document.addEventListener('DOMContentLoaded', init);