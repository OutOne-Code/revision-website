/* --- CONFIGURATION SUPABASE --- */
const SUPABASE_URL = "https://lhbpsrtkffqutexfyhol.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_6RKfpvZs2FjupZ-4DZJapg_ckgjxnrC";

/* --- CONFIGURATION ASSISTANT IA ---
   L'IA est appelée via la fonction serverless Vercel  api/ai.js  (même domaine).
   Rien à changer si le fichier api/ai.js est bien à la racine du dépôt déployé sur Vercel. */
const AI_ENDPOINT = "/api/ai";


let supabaseClient = null;

if (window.supabase && typeof window.supabase.createClient === 'function') {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* --- ÉTAT GLOBAL DE L'APPLICATION --- */
let appData = {
  subjects: [],
  weeks: ["Semaine A", "Semaine B"],
  hours: ["8h00 - 9h00", "9h00 - 10h00", "10h15 - 11h15", "11h15 - 12h15", "14h00 - 15h00", "15h00 - 16h00"],
  timetable: {}, // structure : { weekIndex: { dayIndex: { hourIndex: { subjectId, room, teacher } } } }
  homeworks: [], // structure : [ { id, date: "YYYY-MM-DD", subjectId, description, done: false } ]
  grades: [],    // structure : [ { id, title, subjectId, value, coeff, date } ]
  customColors: { primary: "#4f46e5", accent: "#10b981" },
  appearance: { font: "system", background: { type: "none", value: "" } },
  aiAdvice: null, // dernière analyse IA des notes
  aiChat: [],     // historique du chat avec l'IA
  updatedAt: null,
  user: null
};

let currentSubjectId = null;
let currentChapterId = null;
let activeHighlightNode = null;
let currentCalendarDate = new Date();
let selectedSlotTarget = null; // { week, day, hour }
let gradesChartInstance = null;

/* --- INITIALISATION --- */
document.addEventListener('DOMContentLoaded', () => {
  loadLocalData();
  initTheme();
  applyCustomColors();
  applyAppearance();
  setupEventListeners();
  renderSidebar();
  renderHome();
  checkAuth();
});

/* --- STOCKAGE LOCAL & SYNCHRONISATION --- */
function loadLocalData() {
  const saved = localStorage.getItem('revision_app_data');
  if (saved) {
    try { 
      const parsed = JSON.parse(saved);
      appData = { ...appData, ...parsed };
      if (!appData.grades) appData.grades = [];
      if (!appData.aiChat) appData.aiChat = [];
      if (!appData.customColors) appData.customColors = { primary: "#4f46e5", accent: "#10b981" };
      if (!appData.appearance) appData.appearance = { font: "system", background: { type: "none", value: "" } };
      if (!appData.appearance.background) appData.appearance.background = { type: "none", value: "" };
    } catch(e) { 
      console.error("Erreur lecture localStorage", e); 
    }
  }
}

function saveData() {
  appData.updatedAt = new Date().toISOString();
  localStorage.setItem('revision_app_data', JSON.stringify(appData));
  showSaveIndicator();
  syncToCloud();
}


function showSaveIndicator() {
  const indicator = document.getElementById('save-indicator');
  if (indicator) {
    indicator.classList.remove('hidden');
    setTimeout(() => indicator.classList.add('hidden'), 2000);
  }
}

/* --- NAVIGATION ET VUES --- */
function switchView(viewName) {
  const views = {
    home: document.getElementById('view-home'),
    timetable: document.getElementById('view-timetable'),
    homework: document.getElementById('view-homework'),
    subject: document.getElementById('view-subject'),
    lesson: document.getElementById('view-lesson'),
    quiz: document.getElementById('view-quiz'),
    grades: document.getElementById('view-grades'),
    settings: document.getElementById('view-settings')
  };

  Object.keys(views).forEach(v => {
    if (views[v]) views[v].classList.add('hidden');
  });

  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

  if (views[viewName]) {
    views[viewName].classList.remove('hidden');
  }

  // Fermer la sidebar en mobile
  closeMobileSidebar();
}

function updateBreadcrumb(text) {
  const breadcrumb = document.getElementById('breadcrumb');
  if (breadcrumb) breadcrumb.textContent = text;
}

/* --- SIDEBAR & VUES PRINCIPALES --- */
function renderSidebar() {
  const subjectsListEl = document.getElementById('subjects-list');
  if (!subjectsListEl) return;

  subjectsListEl.innerHTML = '';
  appData.subjects.forEach(subject => {
    const el = document.createElement('div');
    el.className = `subject-item ${subject.id === currentSubjectId ? 'active' : ''}`;
    
    const badge = document.createElement('span');
    badge.className = 'color-badge';
    badge.style.backgroundColor = subject.color || '#4f46e5';

    const text = document.createElement('span');
    text.textContent = subject.name;

    el.appendChild(badge);
    el.appendChild(text);

    el.onclick = () => openSubject(subject.id);
    subjectsListEl.appendChild(el);
  });
}

function renderHome() {
  updateBreadcrumb("Accueil");
  const listEl = document.getElementById('upcoming-homework-list');
  if (!listEl) return;

  listEl.innerHTML = '';

  const todayStr = new Date().toISOString().split('T')[0];
  const upcoming = appData.homeworks
    .filter(h => h.date >= todayStr && !h.done)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  if (upcoming.length === 0) {
    listEl.innerHTML = '<p class="text-muted">Aucun devoir à venir. Bon travail !</p>';
    return;
  }

  upcoming.forEach(hw => {
    const subject = appData.subjects.find(s => s.id === hw.subjectId);
    const card = document.createElement('div');
    card.className = 'homework-card';
    if (subject) card.style.borderLeft = `5px solid ${subject.color || '#4f46e5'}`;

    card.innerHTML = `
      <div class="hw-card-header">
        <strong style="color: ${subject ? subject.color : 'inherit'}">${subject ? subject.name : 'Matière supprimée'}</strong>
        <span class="hw-card-date">${formatDateFR(hw.date)}</span>
      </div>
      <p class="hw-card-desc">${hw.description}</p>
    `;
    listEl.appendChild(card);
  });
}

/* --- EMPLOI DU TEMPS --- */
function openTimetable() {
  switchView('timetable');
  document.getElementById('nav-timetable').classList.add('active');
  updateBreadcrumb('Emploi du temps');

  const weekSelect = document.getElementById('select-week');
  weekSelect.innerHTML = '';
  appData.weeks.forEach((w, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = w;
    weekSelect.appendChild(opt);
  });

  weekSelect.onchange = () => renderTimetableGrid(parseInt(weekSelect.value));
  renderTimetableGrid(0);
}

function renderTimetableGrid(weekIdx) {
  const grid = document.getElementById('timetable-grid');
  if (!grid) return;

  const days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  
  let html = `<thead><tr><th>Horaire</th>`;
  days.forEach(d => html += `<th>${d}</th>`);
  html += `</tr></thead><tbody>`;

  appData.hours.forEach((hour, hIdx) => {
    html += `<tr><td class="time-col">${hour}</td>`;
    days.forEach((day, dIdx) => {
      const slotData = appData.timetable[weekIdx]?.[dIdx]?.[hIdx];
      let cellStyle = "";
      let cellContent = `<span class="empty-slot">+</span>`;

      if (slotData && slotData.subjectId) {
        const subject = appData.subjects.find(s => s.id === slotData.subjectId);
        if (subject) {
          cellStyle = `style="background-color: ${subject.color}22; border-left: 4px solid ${subject.color};"`;
          cellContent = `
            <div class="slot-subject-name" style="color:${subject.color}">${subject.name}</div>
            ${slotData.room ? `<div class="slot-info">📍 ${slotData.room}</div>` : ''}
            ${slotData.teacher ? `<div class="slot-info">👤 ${slotData.teacher}</div>` : ''}
          `;
        }
      }

      html += `<td ${cellStyle} onclick="openSlotModal(${weekIdx}, ${dIdx}, ${hIdx})">${cellContent}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody>`;
  grid.innerHTML = html;
}

function openSlotModal(week, day, hour) {
  selectedSlotTarget = { week, day, hour };
  const modal = document.getElementById('modal-slot');
  const subjectSelect = document.getElementById('slot-subject');
  
  subjectSelect.innerHTML = '<option value="">-- Aucune matière --</option>';
  appData.subjects.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    subjectSelect.appendChild(opt);
  });

  const slotData = appData.timetable[week]?.[day]?.[hour] || {};
  subjectSelect.value = slotData.subjectId || "";
  document.getElementById('slot-room').value = slotData.room || "";
  document.getElementById('slot-teacher').value = slotData.teacher || "";

  modal.classList.remove('hidden');
}

function saveSlot() {
  if (!selectedSlotTarget) return;
  const { week, day, hour } = selectedSlotTarget;

  const subjectId = document.getElementById('slot-subject').value;
  const room = document.getElementById('slot-room').value.trim();
  const teacher = document.getElementById('slot-teacher').value.trim();

  if (!appData.timetable[week]) appData.timetable[week] = {};
  if (!appData.timetable[week][day]) appData.timetable[week][day] = {};

  if (!subjectId) {
    delete appData.timetable[week][day][hour];
  } else {
    appData.timetable[week][day][hour] = { subjectId, room, teacher };
  }

  saveData();
  renderTimetableGrid(week);
  document.getElementById('modal-slot').classList.add('hidden');
}

/* --- DEVOIRS & CALENDRIER --- */
function openHomework() {
  switchView('homework');
  document.getElementById('nav-homework').classList.add('active');
  updateBreadcrumb('Devoirs');
  renderCalendar();
  renderHomeworkList();
}

function renderCalendar() {
  const monthYearEl = document.getElementById('cal-month-year');
  const daysGrid = document.getElementById('calendar-days');
  if (!monthYearEl || !daysGrid) return;

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();

  const monthNames = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
  monthYearEl.textContent = `${monthNames[month]} ${year}`;

  daysGrid.innerHTML = '';

  const firstDay = new Date(year, month, 1).getDay();
  const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1; // Ajuster pour Lundi = 0
  const totalDays = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < adjustedFirstDay; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day empty';
    daysGrid.appendChild(emptyCell);
  }

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    cell.textContent = day;

    // Vérifier les devoirs du jour
    const dayHws = appData.homeworks.filter(h => h.date === dateStr);
    if (dayHws.length > 0) {
      const dotsContainer = document.createElement('div');
      dotsContainer.className = 'cal-dots';
      dayHws.forEach(hw => {
        const subject = appData.subjects.find(s => s.id === hw.subjectId);
        const dot = document.createElement('span');
        dot.className = 'cal-dot';
        dot.style.backgroundColor = subject ? subject.color : '#888';
        dotsContainer.appendChild(dot);
      });
      cell.appendChild(dotsContainer);
    }

    cell.onclick = () => renderHomeworkList(dateStr);
    daysGrid.appendChild(cell);
  }
}

function renderHomeworkList(filterDate = null) {
  const container = document.getElementById('homework-items-list');
  const titleEl = document.getElementById('selected-date-title');
  if (!container) return;

  container.innerHTML = '';

  let list = appData.homeworks;
  if (filterDate) {
    titleEl.textContent = `Devoirs pour le ${formatDateFR(filterDate)}`;
    list = list.filter(h => h.date === filterDate);
  } else {
    titleEl.textContent = "Tous les devoirs à venir";
    const todayStr = new Date().toISOString().split('T')[0];
    list = list.filter(h => h.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date));
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="text-muted">Aucun devoir enregistré.</p>';
    return;
  }

  list.forEach(hw => {
    const subject = appData.subjects.find(s => s.id === hw.subjectId);
    const item = document.createElement('div');
    item.className = `hw-item ${hw.done ? 'done' : ''}`;

    item.innerHTML = `
      <div class="hw-item-left">
        <input type="checkbox" ${hw.done ? 'checked' : ''} onchange="toggleHomeworkDone('${hw.id}')">
        <span class="color-badge" style="background-color: ${subject ? subject.color : '#888'}"></span>
        <div>
          <strong>${subject ? subject.name : 'Matière inconnue'}</strong> - <small>${formatDateFR(hw.date)}</small>
          <p>${hw.description}</p>
        </div>
      </div>
      <button class="btn-icon" onclick="deleteHomework('${hw.id}')">🗑</button>
    `;
    container.appendChild(item);
  });
}

function toggleHomeworkDone(id) {
  const hw = appData.homeworks.find(h => h.id === id);
  if (hw) {
    hw.done = !hw.done;
    saveData();
    renderHomeworkList();
    renderHome();
  }
}

function deleteHomework(id) {
  appData.homeworks = appData.homeworks.filter(h => h.id !== id);
  saveData();
  renderCalendar();
  renderHomeworkList();
  renderHome();
}

function openAddHomeworkModal() {
  const modal = document.getElementById('modal-homework');
  const subjectSelect = document.getElementById('hw-subject');
  
  subjectSelect.innerHTML = '';
  appData.subjects.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    subjectSelect.appendChild(opt);
  });

  document.getElementById('hw-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('hw-description').value = '';
  modal.classList.remove('hidden');
}

function saveHomework() {
  const date = document.getElementById('hw-date').value;
  const subjectId = document.getElementById('hw-subject').value;
  const description = document.getElementById('hw-description').value.trim();

  if (!date || !subjectId || !description) return alert("Veuillez remplir tous les champs.");

  appData.homeworks.push({
    id: Date.now().toString(),
    date,
    subjectId,
    description,
    done: false
  });

  saveData();
  document.getElementById('modal-homework').classList.add('hidden');
  renderCalendar();
  renderHomeworkList();
  renderHome();
}

/* --- GESTION DES NOTES ET SUIVI --- */
function openGrades() {
  switchView('grades');
  document.getElementById('nav-grades').classList.add('active');
  updateBreadcrumb('Notes & Suivi');
  renderGradesDashboard();
}

function renderGradesDashboard() {
  calculateOverallAverage();
  renderGradesChart();
  renderGradesList();
  renderAIAdvice();
  renderAIChat();
}

/* --- ASSISTANT IA --- */
/* En production (Vercel) : appel de /api/ai (clé cachée côté serveur).
   En local (python -m http.server) : /api/ai n'existe pas, on bascule
   automatiquement sur un appel direct à Gemini avec une clé stockée
   dans le navigateur (localStorage : gemini_api_key). */

const AI_QUIZ_SYSTEM = `Tu es un professeur français qui crée des quiz de révision.
À partir du cours fourni, génère un quiz au format JSON STRICT :
{"questions":[{"question":"...","options":["a","b","c","d"],"answer":0,"explanation":"..."}]}
Règles : uniquement des notions présentes dans le cours, 4 options plausibles par question,
"answer" est l'index (0-3) de la bonne réponse, explication courte et pédagogique, en français.`;

const AI_ADVICE_SYSTEM = `Tu es un coach scolaire français bienveillant et concret.
À partir des notes, matières, chapitres et devoirs de l'élève, réponds en JSON STRICT :
{"summary":"bilan en 2-3 phrases",
 "priorities":[{"subject":"nom","level":"urgent|à consolider|solide","why":"...","topics":["point 1","point 2"],"actions":["conseil 1","conseil 2"]}],
 "tips":["conseil de méthode 1","conseil 2","conseil 3"]}
Classe les matières de la plus urgente à la plus solide. Sois précis, en français, sans blabla.`;

const AI_CHAT_SYSTEM = `Tu es l'assistant de révision de l'élève, en français.
Tu connais ses matières, ses chapitres, ses notes et ses devoirs (fournis en contexte).
Donne des conseils concrets, courts et encourageants.`;

function isLocalDev() {
  return ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname);
}

function getGeminiKey() {
  let key = localStorage.getItem('gemini_api_key');
  if (!key) {
    key = prompt("Clé API Google AI Studio (mode local uniquement)\nhttps://aistudio.google.com/apikey");
    if (key) localStorage.setItem('gemini_api_key', key.trim());
  }
  return key ? key.trim() : null;
}

async function callAI(payload) {
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const raw = await res.text();
    let body = {};
    try { body = JSON.parse(raw); } catch (e) { body = null; }

    // Pas de fonction serverless disponible (serveur local, 404/405, HTML renvoyé)
    if (body === null || res.status === 404 || res.status === 405) {
      return await callGeminiDirect(payload);
    }
    if (!res.ok || body.error) {
      throw new Error(body.error || `Erreur ${res.status} de l'assistant IA.`);
    }
    return body;
  } catch (err) {
    if (err instanceof TypeError) return await callGeminiDirect(payload); // fetch impossible
    throw err;
  }
}

async function callGeminiDirect(payload) {
  const key = getGeminiKey();
  if (!key) {
    throw new Error("Aucune clé IA. En local, renseigne une clé Google AI Studio ; en ligne, la clé vient de Vercel.");
  }

  let system = AI_CHAT_SYSTEM;
  let jsonMode = false;
  let turns = [];

  if (payload.mode === 'quiz') {
    system = AI_QUIZ_SYSTEM;
    jsonMode = true;
    turns = [{ role: 'user', content: `Chapitre : ${payload.title || 'Sans titre'}\nNombre de questions : ${payload.count || 8}\n\nCours :\n${payload.lesson || ''}` }];
  } else if (payload.mode === 'advice') {
    system = AI_ADVICE_SYSTEM;
    jsonMode = true;
    turns = [{ role: 'user', content: String(payload.context || '') }];
  } else {
    system = `${AI_CHAT_SYSTEM}\n\nContexte élève :\n${String(payload.context || '')}`;
    turns = (payload.messages || []).slice(-20);
    if (!turns.length) turns = [{ role: 'user', content: 'Bonjour' }];
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map(t => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(t.content || '') }]
      })),
      generationConfig: jsonMode ? { responseMimeType: 'application/json' } : {}
    })
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 403) localStorage.removeItem('gemini_api_key');
    throw new Error(res.status === 429
      ? "Trop de demandes à l'IA, réessaie dans quelques instants."
      : `Erreur IA (${res.status}). Vérifie ta clé Google AI Studio.`);
  }

  const data = await res.json();
  const content = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');

  if (!jsonMode) return { content };
  try {
    const cleaned = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
    return { data: JSON.parse(cleaned) };
  } catch (e) {
    throw new Error("Réponse IA illisible.");
  }
}


function buildStudentContext() {
  const lines = [];

  lines.push("MATIÈRES ET CHAPITRES :");
  if (!appData.subjects.length) lines.push("- aucune matière enregistrée");
  appData.subjects.forEach(s => {
    const chapters = (s.chapters || []).map(c => c.title).join(', ') || 'aucun chapitre';
    lines.push(`- ${s.name} : ${chapters}`);
  });

  lines.push("\nNOTES (sur 20) :");
  if (!appData.grades || !appData.grades.length) lines.push("- aucune note enregistrée");
  (appData.grades || []).forEach(g => {
    const subject = appData.subjects.find(s => s.id === g.subjectId);
    lines.push(`- ${formatDateFR(g.date)} | ${subject ? subject.name : 'Matière inconnue'} | ${g.title} : ${g.value}/20 (coeff ${g.coeff})`);
  });

  const todayStr = new Date().toISOString().split('T')[0];
  lines.push("\nDEVOIRS À VENIR :");
  const upcoming = (appData.homeworks || []).filter(h => h.date >= todayStr && !h.done);
  if (!upcoming.length) lines.push("- aucun devoir à venir");
  upcoming.forEach(h => {
    const subject = appData.subjects.find(s => s.id === h.subjectId);
    lines.push(`- ${formatDateFR(h.date)} | ${subject ? subject.name : '?'} : ${h.description}`);
  });

  lines.push(`\nDate du jour : ${formatDateFR(todayStr)}`);
  return lines.join('\n');
}

async function requestAIAdvice() {
  const container = document.getElementById('ai-advice-content');
  const btn = document.getElementById('btn-ai-advice');
  if (!container) return;

  if (!appData.grades || !appData.grades.length) {
    return alert("Ajoutez au moins une note pour que l'IA puisse analyser votre progression.");
  }

  if (btn) { btn.disabled = true; btn.textContent = "Analyse en cours…"; }
  container.innerHTML = `<div class="ai-loader"></div>`;

  try {
    const result = await callAI({ mode: 'advice', context: buildStudentContext() });
    appData.aiAdvice = { ...result.data, date: new Date().toISOString() };
    saveData();
    renderAIAdvice();
  } catch (e) {
    container.innerHTML = `<p class="ai-error">${escapeHtml(e.message)}</p>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Analyser mes notes"; }
  }
}

function renderAIAdvice() {
  const container = document.getElementById('ai-advice-content');
  if (!container) return;

  const advice = appData.aiAdvice;
  if (!advice || !advice.summary) {
    container.innerHTML = '<p class="text-muted">Aucune analyse pour le moment.</p>';
    return;
  }

  const priorities = (advice.priorities || []).map(p => `
    <div class="ai-priority level-${(p.level || '').replace(/\s/g, '-')}">
      <div class="ai-priority-head">
        <strong>${escapeHtml(p.subject)}</strong>
        <span class="ai-badge">${escapeHtml(p.level || '')}</span>
      </div>
      <p>${escapeHtml(p.why || '')}</p>
      ${(p.topics && p.topics.length) ? `<p><em>Points de leçon à revoir :</em></p><ul>${p.topics.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
      ${(p.actions && p.actions.length) ? `<p><em>Conseils :</em></p><ul>${p.actions.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : ''}
    </div>`).join('');

  const tips = (advice.tips || []).map(t => `<li>${escapeHtml(t)}</li>`).join('');

  container.innerHTML = `
    <p class="ai-summary">${escapeHtml(advice.summary)}</p>
    ${priorities}
    ${tips ? `<div class="ai-tips"><strong>Méthode de travail</strong><ul>${tips}</ul></div>` : ''}
    <p class="text-muted" style="margin-top:10px;font-size:0.8rem;">Analyse du ${advice.date ? formatDateFR(advice.date.split('T')[0]) : ''}</p>`;
}

function renderAIChat() {
  const box = document.getElementById('ai-chat-messages');
  if (!box) return;

  const messages = appData.aiChat || [];
  if (!messages.length) {
    box.innerHTML = '<p class="text-muted">Posez une question à l\'assistant : organisation, méthode, explication d\'une notion…</p>';
    return;
  }

  box.innerHTML = messages.map(m => `
    <div class="ai-msg ${m.role === 'user' ? 'user' : 'bot'}">
      ${escapeHtml(m.content).replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}
    </div>`).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendAIChatMessage() {
  const input = document.getElementById('ai-chat-input');
  const btn = document.getElementById('btn-ai-chat-send');
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  if (!appData.aiChat) appData.aiChat = [];
  appData.aiChat.push({ role: 'user', content: text });
  input.value = '';
  renderAIChat();

  const box = document.getElementById('ai-chat-messages');
  if (box) box.insertAdjacentHTML('beforeend', '<div class="ai-msg bot" id="ai-typing"><div class="ai-loader"></div></div>');
  if (btn) btn.disabled = true;

  try {
    const result = await callAI({
      mode: 'chat',
      context: buildStudentContext(),
      messages: appData.aiChat.slice(-20)
    });
    appData.aiChat.push({ role: 'assistant', content: result.content || "…" });
  } catch (e) {
    appData.aiChat.push({ role: 'assistant', content: `⚠️ ${e.message}` });
  } finally {
    if (btn) btn.disabled = false;
    saveData();
    renderAIChat();
  }
}


function calculateOverallAverage() {
  const overallEl = document.getElementById('overall-average');
  if (!overallEl) return;

  if (!appData.grades || appData.grades.length === 0) {
    overallEl.textContent = "-- / 20";
    return;
  }

  let totalScore = 0;
  let totalCoeff = 0;

  appData.grades.forEach(g => {
    const val = parseFloat(g.value);
    const coeff = parseFloat(g.coeff) || 1;
    if (!isNaN(val)) {
      totalScore += val * coeff;
      totalCoeff += coeff;
    }
  });

  if (totalCoeff === 0) {
    overallEl.textContent = "-- / 20";
  } else {
    const avg = (totalScore / totalCoeff).toFixed(2);
    overallEl.textContent = `${avg} / 20`;
  }
}

function renderGradesChart() {
  const ctx = document.getElementById('grades-chart');
  if (!ctx) return;

  if (gradesChartInstance) {
    gradesChartInstance.destroy();
  }

  const sortedGrades = [...appData.grades].sort((a, b) => a.date.localeCompare(b.date));

  let runningScore = 0;
  let runningCoeff = 0;
  const labels = [];
  const data = [];

  sortedGrades.forEach(g => {
    const val = parseFloat(g.value);
    const coeff = parseFloat(g.coeff) || 1;
    runningScore += val * coeff;
    runningCoeff += coeff;

    labels.push(formatDateFR(g.date));
    data.push((runningScore / runningCoeff).toFixed(2));
  });

  gradesChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Moyenne générale',
        data: data,
        borderColor: appData.customColors.primary || '#4f46e5',
        backgroundColor: 'rgba(79, 70, 229, 0.1)',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          min: 0,
          max: 20
        }
      }
    }
  });
}

function renderGradesList() {
  const container = document.getElementById('grades-items-list');
  if (!container) return;

  container.innerHTML = '';

  if (!appData.grades || appData.grades.length === 0) {
    container.innerHTML = '<p class="text-muted">Aucune note enregistrée pour le moment.</p>';
    return;
  }

  const sorted = [...appData.grades].sort((a, b) => b.date.localeCompare(a.date));

  sorted.forEach(g => {
    const subject = appData.subjects.find(s => s.id === g.subjectId);
    const item = document.createElement('div');
    item.className = 'hw-item';

    item.innerHTML = `
      <div class="hw-item-left">
        <span class="color-badge" style="background-color: ${subject ? subject.color : '#888'}"></span>
        <div>
          <strong>${g.title}</strong> (${subject ? subject.name : 'Matière inconnue'}) - <small>${formatDateFR(g.date)}</small>
          <p>Note : <strong>${g.value} / 20</strong> (Coeff. ${g.coeff})</p>
        </div>
      </div>
      <button class="btn-icon" onclick="deleteGrade('${g.id}')">🗑</button>
    `;
    container.appendChild(item);
  });
}

function openAddGradeModal() {
  const modal = document.getElementById('modal-grade');
  const subjectSelect = document.getElementById('grade-subject');

  subjectSelect.innerHTML = '';
  appData.subjects.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    subjectSelect.appendChild(opt);
  });

  document.getElementById('grade-title').value = '';
  document.getElementById('grade-value').value = '';
  document.getElementById('grade-coeff').value = '1';
  document.getElementById('grade-date').value = new Date().toISOString().split('T')[0];

  modal.classList.remove('hidden');
}

function saveGrade() {
  const subjectId = document.getElementById('grade-subject').value;
  const title = document.getElementById('grade-title').value.trim();
  const value = parseFloat(document.getElementById('grade-value').value);
  const coeff = parseFloat(document.getElementById('grade-coeff').value) || 1;
  const date = document.getElementById('grade-date').value;

  if (!subjectId || !title || isNaN(value) || !date) {
    return alert("Veuillez remplir correctement tous les champs.");
  }

  appData.grades.push({
    id: Date.now().toString(),
    subjectId,
    title,
    value,
    coeff,
    date
  });

  saveData();
  document.getElementById('modal-grade').classList.add('hidden');
  renderGradesDashboard();
}

function deleteGrade(id) {
  appData.grades = appData.grades.filter(g => g.id !== id);
  saveData();
  renderGradesDashboard();
}

/* --- PERSONNALISATION --- */
const FONT_CHOICES = [
  { id: "system",    name: "Système",     stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: "inter",     name: "Moderne",     stack: '"Inter", "Segoe UI", Helvetica, Arial, sans-serif' },
  { id: "georgia",   name: "Élégante",    stack: 'Georgia, "Times New Roman", serif' },
  { id: "trebuchet", name: "Arrondie",    stack: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { id: "verdana",   name: "Lisible",     stack: 'Verdana, Geneva, sans-serif' },
  { id: "mono",      name: "Monospace",   stack: '"JetBrains Mono", "Courier New", monospace' },
  { id: "comic",     name: "Manuscrite",  stack: '"Comic Sans MS", "Segoe Print", cursive' }
];

const BG_PRESETS = [
  { id: "none",     name: "Aucun",      css: "none" },
  { id: "sunset",   name: "Coucher",    css: "linear-gradient(135deg, #ff9a9e 0%, #fad0c4 50%, #fbc2eb 100%)" },
  { id: "ocean",    name: "Océan",      css: "linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)" },
  { id: "forest",   name: "Forêt",      css: "linear-gradient(135deg, #134e5e 0%, #71b280 100%)" },
  { id: "night",    name: "Nuit",       css: "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)" },
  { id: "pastel",   name: "Pastel",     css: "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)" },
  { id: "peach",    name: "Pêche",      css: "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)" },
  { id: "mesh",     name: "Quadrillé",  css: "repeating-linear-gradient(0deg, rgba(125,125,125,0.12) 0 1px, transparent 1px 40px), repeating-linear-gradient(90deg, rgba(125,125,125,0.12) 0 1px, transparent 1px 40px)" }
];

function getFontStack(id) {
  const f = FONT_CHOICES.find(f => f.id === id);
  return f ? f.stack : FONT_CHOICES[0].stack;
}

function applyAppearance() {
  if (!appData.appearance) appData.appearance = { font: "system", background: { type: "none", value: "" } };
  const root = document.documentElement;

  // Police globale
  root.style.setProperty('--app-font', getFontStack(appData.appearance.font));

  // Fond d'écran
  const bg = appData.appearance.background || { type: "none", value: "" };
  let image = 'none';
  let solid = null;

  if (bg.type === 'preset') {
    const preset = BG_PRESETS.find(b => b.id === bg.value);
    image = preset ? preset.css : 'none';
  } else if (bg.type === 'image') {
    image = `linear-gradient(rgba(0,0,0,0.05), rgba(0,0,0,0.05)), url("${bg.value}")`;
  } else if (bg.type === 'color') {
    solid = bg.value;
  }

  root.style.setProperty('--app-bg-image', image);
  if (solid) {
    document.body.style.backgroundColor = solid;
  } else {
    document.body.style.backgroundColor = '';
  }
  document.body.classList.toggle('has-bg-image', image !== 'none');
}

function renderFontOptions() {
  const container = document.getElementById('font-options');
  if (!container) return;
  container.innerHTML = '';
  FONT_CHOICES.forEach(f => {
    const btn = document.createElement('button');
    btn.className = 'font-option' + (appData.appearance.font === f.id ? ' active' : '');
    btn.style.fontFamily = f.stack;
    btn.innerHTML = `Aa <small>${f.name}</small>`;
    btn.onclick = () => {
      appData.appearance.font = f.id;
      applyAppearance();
      saveData();
      renderFontOptions();
    };
    container.appendChild(btn);
  });
}

function renderBgOptions() {
  const container = document.getElementById('bg-options');
  if (!container) return;
  container.innerHTML = '';
  const bg = appData.appearance.background || { type: 'none', value: '' };
  BG_PRESETS.forEach(preset => {
    const btn = document.createElement('button');
    const isActive = (preset.id === 'none' && bg.type === 'none') || (bg.type === 'preset' && bg.value === preset.id);
    btn.className = 'bg-option' + (isActive ? ' active' : '');
    btn.style.background = preset.css === 'none' ? 'var(--bg-main)' : preset.css;
    btn.innerHTML = `<span>${preset.name}</span>`;
    btn.onclick = () => {
      appData.appearance.background = preset.id === 'none'
        ? { type: 'none', value: '' }
        : { type: 'preset', value: preset.id };
      applyAppearance();
      saveData();
      renderBgOptions();
    };
    container.appendChild(btn);
  });
}

function openSettings() {
  switchView('settings');
  document.getElementById('nav-settings').classList.add('active');
  updateBreadcrumb('Personnalisation');

  document.getElementById('color-primary').value = appData.customColors.primary || '#4f46e5';
  document.getElementById('color-accent').value = appData.customColors.accent || '#10b981';

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const defaults = isDark
    ? { text: '#f3f4f6', heading: '#f3f4f6', muted: '#9ca3af' }
    : { text: '#1f2937', heading: '#1f2937', muted: '#6b7280' };
  ['text', 'heading', 'muted'].forEach(key => {
    const input = document.getElementById('color-' + key);
    if (input) input.value = appData.customColors[key] || defaults[key];
  });

  const bg = appData.appearance.background || { type: 'none', value: '' };
  const solidInput = document.getElementById('bg-solid-color');
  if (solidInput && bg.type === 'color') solidInput.value = bg.value;
  const urlInput = document.getElementById('bg-image-url');
  if (urlInput) urlInput.value = bg.type === 'image' && !bg.value.startsWith('data:') ? bg.value : '';

  renderFontOptions();
  renderBgOptions();
}

function applyCustomColors() {
  if (!appData.customColors) return;
  const root = document.documentElement;
  root.style.setProperty('--primary', appData.customColors.primary);
  root.style.setProperty('--accent', appData.customColors.accent);

  // Couleur de police personnalisée (vide = valeur du thème)
  const c = appData.customColors;
  if (c.text) root.style.setProperty('--text-main', c.text);
  else root.style.removeProperty('--text-main');

  if (c.muted) root.style.setProperty('--text-muted', c.muted);
  else root.style.removeProperty('--text-muted');

  if (c.heading) root.style.setProperty('--heading-color', c.heading);
  else root.style.removeProperty('--heading-color');
}


/* --- SÉLECTEUR VISUEL DE COULEURS (MATIÈRES) --- */
const SUBJECT_COLORS = [
  { hex: "#ef4444", name: "Rouge" },      { hex: "#f97316", name: "Orange" },
  { hex: "#f59e0b", name: "Ambre" },      { hex: "#eab308", name: "Jaune" },
  { hex: "#84cc16", name: "Citron" },     { hex: "#22c55e", name: "Vert" },
  { hex: "#10b981", name: "Émeraude" },   { hex: "#14b8a6", name: "Turquoise" },
  { hex: "#06b6d4", name: "Cyan" },       { hex: "#0ea5e9", name: "Bleu ciel" },
  { hex: "#3b82f6", name: "Bleu" },       { hex: "#4f46e5", name: "Indigo" },
  { hex: "#8b5cf6", name: "Violet" },     { hex: "#a855f7", name: "Pourpre" },
  { hex: "#d946ef", name: "Fuchsia" },    { hex: "#ec4899", name: "Rose" },
  { hex: "#f43f5e", name: "Framboise" },  { hex: "#78716c", name: "Pierre" },
  { hex: "#64748b", name: "Ardoise" },    { hex: "#0f172a", name: "Nuit" }
];

let colorPickerCallback = null;
let colorPickerValue = "#4f46e5";

function openColorPicker(initialColor, onConfirm, title) {
  colorPickerCallback = onConfirm;
  colorPickerValue = initialColor || "#4f46e5";

  const modal = document.getElementById('modal-color');
  if (!modal) { if (onConfirm) onConfirm(colorPickerValue); return; }

  const titleEl = document.getElementById('modal-color-title');
  if (titleEl) titleEl.textContent = title || "Choisir une couleur";

  renderColorPalette();
  modal.classList.remove('hidden');
}

function renderColorPalette() {
  const palette = document.getElementById('color-palette');
  if (!palette) return;

  palette.innerHTML = '';
  SUBJECT_COLORS.forEach(c => {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch' + (c.hex.toLowerCase() === colorPickerValue.toLowerCase() ? ' active' : '');
    swatch.style.backgroundColor = c.hex;
    swatch.title = c.name;
    swatch.setAttribute('aria-label', c.name);
    swatch.onclick = () => { colorPickerValue = c.hex; renderColorPalette(); };
    palette.appendChild(swatch);
  });

  const custom = document.getElementById('color-custom');
  if (custom) custom.value = colorPickerValue;

  const dot = document.getElementById('color-preview-dot');
  if (dot) dot.style.backgroundColor = colorPickerValue;

  const nameEl = document.getElementById('color-preview-name');
  if (nameEl) {
    const known = SUBJECT_COLORS.find(c => c.hex.toLowerCase() === colorPickerValue.toLowerCase());
    nameEl.textContent = known ? known.name : "Couleur personnalisée";
  }
}

function setupColorPicker() {
  const custom = document.getElementById('color-custom');
  if (custom) {
    custom.oninput = (e) => { colorPickerValue = e.target.value; renderColorPalette(); };
  }

  const confirmBtn = document.getElementById('btn-confirm-color');
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      document.getElementById('modal-color').classList.add('hidden');
      if (colorPickerCallback) colorPickerCallback(colorPickerValue);
      colorPickerCallback = null;
    };
  }
}

/* --- GESTION MATIÈRES & CHAPITRES --- */
function openSubject(subjectId) {
  currentSubjectId = subjectId;
  currentChapterId = null;
  renderSidebar();

  const subject = appData.subjects.find(s => s.id === subjectId);
  if (!subject) return;

  const subjectTitle = document.getElementById('subject-title');
  const badge = document.getElementById('subject-color-badge');

  if (subjectTitle) subjectTitle.textContent = subject.name;
  if (badge) badge.style.backgroundColor = subject.color || '#4f46e5';

  updateBreadcrumb(`Matière > ${subject.name}`);
  renderChapters();
  switchView('subject');
}

function renderChapters() {
  const grid = document.getElementById('chapters-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const subject = appData.subjects.find(s => s.id === currentSubjectId);
  if (!subject) return;

  subject.chapters.forEach(chap => {
    const card = document.createElement('div');
    card.className = 'chapter-card';
    card.innerHTML = `
      <h3>${chap.title}</h3>
      <small>${chap.content ? 'Cours enregistré' : 'Chapitre vide'}</small>
    `;
    card.onclick = () => openChapter(chap.id);
    grid.appendChild(card);
  });
}

function openChapter(chapterId) {
  currentChapterId = chapterId;
  const subject = appData.subjects.find(s => s.id === currentSubjectId);
  if (!subject) return;

  const chap = subject.chapters.find(c => c.id === chapterId);
  if (!chap) return;

  const chapterTitle = document.getElementById('chapter-title');
  const editor = document.getElementById('editor');

  if (chapterTitle) chapterTitle.textContent = chap.title;
  if (editor) editor.innerHTML = chap.content || "";
  
  updateBreadcrumb(`${subject.name} > ${chap.title}`);
  attachHighlightEvents();
  switchView('lesson');
}

/* el() : comme getElementById, mais renvoie un objet factice si l'élément
   n'existe pas — un id manquant ne casse plus tous les autres boutons. */
function el(id) {
  const node = document.getElementById(id);
  if (node) return node;
  console.warn('Élément introuvable :', id);
  return new Proxy({}, {
    get: (t, p) => (p === 'classList' ? { add() {}, remove() {}, toggle() {} } : p === 'value' ? '' : () => {}),
    set: () => true
  });
}

/* --- LISTENERS INTERFACE --- */
function setupEventListeners() {
  setupColorPicker();
  // Thème
  const btnToggleTheme = el('btn-toggle-theme');
  const btnToggleThemeMobile = el('btn-toggle-theme-mobile');
  if (btnToggleTheme) btnToggleTheme.onclick = toggleTheme;
  if (btnToggleThemeMobile) btnToggleThemeMobile.onclick = toggleTheme;

  // Sidebar Mobile
  const btnToggleSidebar = el('btn-toggle-sidebar');
  const overlay = el('sidebar-overlay');
  if (btnToggleSidebar) btnToggleSidebar.onclick = toggleMobileSidebar;
  if (overlay) overlay.onclick = closeMobileSidebar;

  // Navigation principale
  el('nav-home').onclick = () => { switchView('home'); renderHome(); };
  el('nav-timetable').onclick = openTimetable;
  el('nav-homework').onclick = openHomework;
  el('nav-grades').onclick = openGrades;
  el('nav-settings').onclick = openSettings;

  // Modales d'annulation / fermeture
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.onclick = () => {
      btn.closest('.modal-backdrop').classList.add('hidden');
    };
  });

  // Emploi du Temps
  el('btn-config-timetable').onclick = () => {
    el('cfg-weeks').value = appData.weeks.join(', ');
    el('cfg-hours').value = appData.hours.join('\n');
    el('modal-timetable-config').classList.remove('hidden');
  };

  el('btn-save-timetable-config').onclick = () => {
    const weeksInput = el('cfg-weeks').value;
    const hoursInput = el('cfg-hours').value;

    appData.weeks = weeksInput.split(',').map(w => w.trim()).filter(Boolean);
    appData.hours = hoursInput.split('\n').map(h => h.trim()).filter(Boolean);

    saveData();
    el('modal-timetable-config').classList.add('hidden');
    openTimetable();
  };

  el('btn-save-slot').onclick = saveSlot;
  el('btn-delete-slot').onclick = () => {
    if (selectedSlotTarget) {
      const { week, day, hour } = selectedSlotTarget;
      if (appData.timetable[week]?.[day]?.[hour]) {
        delete appData.timetable[week][day][hour];
        saveData();
        renderTimetableGrid(week);
      }
    }
    el('modal-slot').classList.add('hidden');
  };

  // Devoirs & Calendrier Navigation
  el('cal-prev').onclick = () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar();
  };
  el('cal-next').onclick = () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar();
  };
  el('btn-add-homework').onclick = openAddHomeworkModal;
  el('btn-save-homework').onclick = saveHomework;

  // Notes
  el('btn-add-grade').onclick = openAddGradeModal;
  el('btn-save-grade').onclick = saveGrade;

  // Personnalisation
  el('color-primary').onchange = (e) => {
    appData.customColors.primary = e.target.value;
    applyCustomColors();
    saveData();
  };

  el('color-accent').onchange = (e) => {
    appData.customColors.accent = e.target.value;
    applyCustomColors();
    saveData();
  };

  const bgSolid = el('bg-solid-color');
  if (bgSolid) {
    bgSolid.oninput = (e) => {
      appData.appearance.background = { type: 'color', value: e.target.value };
      applyAppearance();
      saveData();
      renderBgOptions();
    };
  }

  const btnApplyBgUrl = el('btn-apply-bg-url');
  if (btnApplyBgUrl) {
    btnApplyBgUrl.onclick = () => {
      const url = el('bg-image-url').value.trim();
      if (!url) return;
      appData.appearance.background = { type: 'image', value: url };
      applyAppearance();
      saveData();
      renderBgOptions();
    };
  }

  const bgFile = el('bg-image-file');
  if (bgFile) {
    bgFile.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 2.5 * 1024 * 1024) {
        alert("Image trop lourde (2,5 Mo max). Utilisez plutôt un lien d'image.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        appData.appearance.background = { type: 'image', value: reader.result };
        applyAppearance();
        saveData();
        renderBgOptions();
      };
      reader.readAsDataURL(file);
    };
  }

  const btnResetBg = el('btn-reset-bg');
  if (btnResetBg) {
    btnResetBg.onclick = () => {
      appData.appearance.background = { type: 'none', value: '' };
      applyAppearance();
      saveData();
      renderBgOptions();
    };
  }

  el('btn-reset-theme-colors').onclick = () => {
    appData.customColors = {
      ...appData.customColors,
      primary: "#4f46e5",
      accent: "#10b981"
    };
    applyCustomColors();
    saveData();
    openSettings();
  };

  // Couleur du texte
  ['text', 'heading', 'muted'].forEach(key => {
    const input = el('color-' + key);
    if (input) {
      input.oninput = (e) => {
        appData.customColors[key] = e.target.value;
        applyCustomColors();
        saveData();
      };
    }
  });

  const btnResetText = el('btn-reset-text-colors');
  if (btnResetText) {
    btnResetText.onclick = () => {
      delete appData.customColors.text;
      delete appData.customColors.heading;
      delete appData.customColors.muted;
      applyCustomColors();
      saveData();
      openSettings();
    };
  }


  // Matières
  const btnAddSubject = el('btn-add-subject');
  if (btnAddSubject) {
    btnAddSubject.onclick = () => {
      const name = prompt("Nom de la matière :");
      if (!name || !name.trim()) return;
      openColorPicker("#4f46e5", (color) => {
        const newSubject = { id: Date.now().toString(), name: name.trim(), color, chapters: [] };
        appData.subjects.push(newSubject);
        saveData();
        renderSidebar();
        openSubject(newSubject.id);
      }, `Couleur de « ${name.trim()} »`);
    };
  }

  const btnEditSubjectColor = el('btn-edit-subject-color');
  if (btnEditSubjectColor) {
    btnEditSubjectColor.onclick = () => {
      const subject = appData.subjects.find(s => s.id === currentSubjectId);
      if (!subject) return;
      openColorPicker(subject.color || "#4f46e5", (color) => {
        subject.color = color;
        saveData();
        renderSidebar();
        openSubject(subject.id);
      }, `Couleur de « ${subject.name} »`);
    };
  }

  const btnRenameSubject = el('btn-rename-subject');
  if (btnRenameSubject) {
    btnRenameSubject.onclick = () => {
      const subject = appData.subjects.find(s => s.id === currentSubjectId);
      if (!subject) return;
      const newName = prompt("Nouveau nom de la matière :", subject.name);
      if (newName && newName.trim()) {
        subject.name = newName.trim();
        saveData();
        renderSidebar();
        openSubject(subject.id);
      }
    };
  }

  const btnDeleteSubject = el('btn-delete-subject');
  if (btnDeleteSubject) {
    btnDeleteSubject.onclick = () => {
      if (confirm("Voulez-vous vraiment supprimer cette matière et tous ses chapitres ?")) {
        appData.subjects = appData.subjects.filter(s => s.id !== currentSubjectId);
        currentSubjectId = null;
        saveData();
        renderSidebar();
        switchView('home');
        renderHome();
      }
    };
  }

  // Chapitres
  const btnAddChapter = el('btn-add-chapter');
  if (btnAddChapter) {
    btnAddChapter.onclick = () => {
      const subject = appData.subjects.find(s => s.id === currentSubjectId);
      if (!subject) return;
      const title = prompt("Titre du chapitre :");
      if (!title || !title.trim()) return;

      const newChap = { id: Date.now().toString(), title: title.trim(), content: "", annotations: [] };
      subject.chapters.push(newChap);
      saveData();
      renderChapters();
    };
  }

  const btnDeleteChapter = el('btn-delete-chapter');
  if (btnDeleteChapter) {
    btnDeleteChapter.onclick = () => {
      if (confirm("Supprimer ce chapitre ?")) {
        const subject = appData.subjects.find(s => s.id === currentSubjectId);
        if (!subject) return;
        subject.chapters = subject.chapters.filter(c => c.id !== currentChapterId);
        saveData();
        openSubject(currentSubjectId);
      }
    };
  }

  const btnBackToSubject = el('btn-back-to-subject');
  if (btnBackToSubject) btnBackToSubject.onclick = () => openSubject(currentSubjectId);

  const btnExitQuiz = el('btn-exit-quiz');
  if (btnExitQuiz) btnExitQuiz.onclick = () => openChapter(currentChapterId);

  // Éditeur Formattage
  document.querySelectorAll('.editor-toolbar .tool-btn[data-cmd]').forEach(btn => {
    btn.onclick = () => {
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val || null;
      document.execCommand(cmd, false, val);
    };
  });

  const editor = el('editor');
  if (editor) editor.oninput = autoSaveCurrentLesson;

  const chapterTitle = el('chapter-title');
  if (chapterTitle) {
    chapterTitle.onblur = () => {
      const subject = appData.subjects.find(s => s.id === currentSubjectId);
      if (!subject) return;
      const chap = subject.chapters.find(c => c.id === currentChapterId);
      if (chap) {
        chap.title = chapterTitle.textContent;
        saveData();
      }
    };
  }

  // Quiz généré par l'IA
  const btnStartQuiz = el('btn-start-quiz');
  if (btnStartQuiz) btnStartQuiz.onclick = startQuiz;

  // Assistant IA (onglet Notes & Suivi)
  const btnAdvice = el('btn-ai-advice');
  if (btnAdvice) btnAdvice.onclick = requestAIAdvice;

  const btnChatSend = el('btn-ai-chat-send');
  if (btnChatSend) btnChatSend.onclick = sendAIChatMessage;

  const chatInput = el('ai-chat-input');
  if (chatInput) {
    chatInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIChatMessage(); }
    };
  }

  const btnChatClear = el('btn-ai-chat-clear');
  if (btnChatClear) {
    btnChatClear.onclick = () => {
      appData.aiChat = [];
      saveData();
      renderAIChat();
    };
  }


  // Modale Authentification
  const btnAuthModal = el('btn-auth-modal');
  if (btnAuthModal) btnAuthModal.onclick = () => el('auth-modal').classList.remove('hidden');

  const btnCloseModal = el('btn-close-modal');
  if (btnCloseModal) btnCloseModal.onclick = () => el('auth-modal').classList.add('hidden');

  const btnLogin = el('btn-login');
  if (btnLogin) btnLogin.onclick = handleLogin;

  const btnSignup = el('btn-signup');
  if (btnSignup) btnSignup.onclick = handleSignup;

  const btnLogout = el('btn-logout');
  if (btnLogout) btnLogout.onclick = handleLogout;
}

/* --- ÉDITEUR --- */
function autoSaveCurrentLesson() {
  if (!currentChapterId) return;
  const subject = appData.subjects.find(s => s.id === currentSubjectId);
  if (!subject) return;

  const chap = subject.chapters.find(c => c.id === currentChapterId);
  if (!chap) return;

  const editor = document.getElementById('editor');
  if (!editor) return;

  chap.content = editor.innerHTML;
  saveData();
}

function attachHighlightEvents() {
  // Le surlignage magique a été remplacé par la génération de quiz par l'IA.
}

/* --- QUIZ GÉNÉRÉ PAR L'IA --- */
let currentQuiz = null;

async function startQuiz() {
  const subject = appData.subjects.find(s => s.id === currentSubjectId);
  if (!subject) return;

  const chap = subject.chapters.find(c => c.id === currentChapterId);
  if (!chap) return;

  const editor = document.getElementById('editor');
  const lessonText = (editor ? editor.innerText : '').trim();

  if (lessonText.length < 40) {
    return alert("Écrivez ou collez d'abord votre cours : l'IA a besoin de contenu pour créer le quiz.");
  }

  switchView('quiz');
  const container = document.getElementById('quiz-container');
  container.innerHTML = `<div class="quiz-card"><h2>✨ L'IA prépare votre quiz…</h2><p class="text-muted">Quelques secondes de patience.</p><div class="ai-loader"></div></div>`;

  try {
    const result = await callAI({
      mode: 'quiz',
      title: chap.title,
      lesson: lessonText,
      count: 8
    });

    const questions = (result.data && result.data.questions) || [];
    if (!questions.length) throw new Error("Aucune question générée.");

    currentQuiz = questions;
    runQuiz(questions);
  } catch (e) {
    container.innerHTML = `
      <div class="quiz-card">
        <h2>Impossible de générer le quiz</h2>
        <p class="text-muted">${e.message}</p>
        <button onclick="startQuiz()" class="btn btn-primary" style="margin-top:20px;">Réessayer</button>
      </div>`;
  }
}

function runQuiz(questions) {
  const container = document.getElementById('quiz-container');
  if (!container) return;

  let currentStep = 0;
  let score = 0;

  function showQuestion() {
    if (currentStep >= questions.length) {
      const finalGrade = Math.round((score / questions.length) * 20);
      container.innerHTML = `
        <div class="quiz-card">
          <h2>Quiz terminé !</h2>
          <p style="font-size: 1.5rem; margin: 20px 0;">Note : <strong>${finalGrade} / 20</strong></p>
          <p>${score} bonne(s) réponse(s) sur ${questions.length}</p>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;">
            <button onclick="startQuiz()" class="btn btn-magic">Nouveau quiz</button>
            <button onclick="openChapter('${currentChapterId}')" class="btn btn-primary">Retour à la leçon</button>
          </div>
        </div>`;
      return;
    }

    const q = questions[currentStep];
    const options = Array.isArray(q.options) ? q.options : [];

    container.innerHTML = `
      <div class="quiz-card">
        <h3>Question ${currentStep + 1}/${questions.length}</h3>
        <p style="margin: 15px 0; font-size:1.1rem;"><strong>${escapeHtml(q.question || '')}</strong></p>
        <div class="quiz-options" id="quiz-options">
          ${options.map((opt, i) => `<button class="btn btn-secondary quiz-option" data-i="${i}">${escapeHtml(opt)}</button>`).join('')}
        </div>
        <div id="quiz-answer" class="hidden quiz-answer"></div>
      </div>`;

    container.querySelectorAll('.quiz-option').forEach(btn => {
      btn.onclick = () => {
        const chosen = parseInt(btn.dataset.i);
        const correct = chosen === Number(q.answer);
        if (correct) score++;

        container.querySelectorAll('.quiz-option').forEach(b => {
          b.disabled = true;
          const i = parseInt(b.dataset.i);
          if (i === Number(q.answer)) b.classList.add('correct');
          else if (i === chosen) b.classList.add('wrong');
        });

        const answerEl = document.getElementById('quiz-answer');
        answerEl.classList.remove('hidden');
        answerEl.innerHTML = `
          <p><strong>${correct ? '✅ Bonne réponse !' : '❌ Réponse incorrecte.'}</strong></p>
          <p style="margin-top:8px;">${escapeHtml(q.explanation || '')}</p>
          <button id="btn-next-q" class="btn btn-primary" style="margin-top:15px;">Question suivante</button>`;
        document.getElementById('btn-next-q').onclick = () => { currentStep++; showQuestion(); };
      };
    });
  }

  showQuestion();
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


/* --- THÈME & MOBILE --- */
function initTheme() {
  const theme = localStorage.getItem('theme') || 'light';
  applyTheme(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const target = current === 'light' ? 'dark' : 'light';
  applyTheme(target);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  const btnTheme = document.getElementById('btn-toggle-theme');
  const btnThemeMobile = document.getElementById('btn-toggle-theme-mobile');

  const icon = theme === 'light' ? '🌙' : '☀️';
  if (btnTheme) btnTheme.textContent = icon;
  if (btnThemeMobile) btnThemeMobile.textContent = icon;
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('mobile-open');
  overlay.classList.toggle('active');
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('active');
}

/* --- UTILITAIRES --- */
function formatDateFR(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

/* --- SUPABASE & AUTHENTIFICATION --- */
let syncTimer = null;
let realtimeChannel = null;
let isApplyingCloudData = false;

function syncToCloud() {
  if (!supabaseClient || !appData.user || isApplyingCloudData) return;
  // Anti-spam : on regroupe les sauvegardes rapprochées
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushToCloud, 600);
}

async function pushToCloud() {
  if (!supabaseClient || !appData.user) return;

  const payload = { ...appData };
  delete payload.user; // on ne stocke pas la session dans le contenu
  appData.updatedAt = new Date().toISOString();
  payload.updatedAt = appData.updatedAt;

  try {
    const { error } = await supabaseClient
      .from('user_revisions')
      .upsert(
        {
          user_id: appData.user.id,
          content: payload,
          updated_at: appData.updatedAt
        },
        { onConflict: 'user_id' }
      );
    if (error) {
      console.error("Erreur de synchronisation cloud :", error);
      setSyncState('error');
    } else {
      setSyncState('online');
    }
  } catch (e) {
    console.error("Erreur de synchronisation cloud :", e);
    setSyncState('error');
  }
}

function setSyncState(state) {
  const statusEl = document.getElementById('sync-status');
  if (!statusEl) return;
  if (state === 'online') {
    statusEl.textContent = "Synchronisé (Cloud)";
    statusEl.className = "sync-status online";
  } else if (state === 'error') {
    statusEl.textContent = "Erreur de synchro";
    statusEl.className = "sync-status offline";
  } else {
    statusEl.textContent = "Hors-ligne (Local)";
    statusEl.className = "sync-status offline";
  }
}

async function checkAuth() {
  if (!supabaseClient) return;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      appData.user = session.user;
      updateAuthUI(true);
      await loadCloudData();
      startRealtimeSync();
    }
  } catch(e) {
    console.error("Erreur d'authentification :", e);
  }

  // Re-synchronise dès que l'appareil revient au premier plan
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadCloudData();
  });
  window.addEventListener('focus', () => loadCloudData());
}

function applyCloudContent(content) {
  if (!content) return;
  isApplyingCloudData = true;

  const localDate = appData.updatedAt ? new Date(appData.updatedAt).getTime() : 0;
  const cloudDate = content.updatedAt ? new Date(content.updatedAt).getTime() : 1;

  // Le cloud gagne sauf si les données locales sont plus récentes
  if (cloudDate >= localDate) {
    const user = appData.user;
    appData = { ...appData, ...content, user };
    localStorage.setItem('revision_app_data', JSON.stringify(appData));
    applyCustomColors();
    applyAppearance();
    renderSidebar();
    refreshCurrentView();
  }

  isApplyingCloudData = false;
}

function refreshCurrentView() {
  const visible = document.querySelector('.view:not(.hidden)');
  const id = visible ? visible.id : 'view-home';
  if (id === 'view-timetable') {
    const weekSelect = document.getElementById('select-week');
    renderTimetableGrid(weekSelect ? parseInt(weekSelect.value) || 0 : 0);
  } else if (id === 'view-homework') {
    renderCalendar();
    renderHomeworkList();
  } else if (id === 'view-grades') {
    renderGradesDashboard();
  } else if (id === 'view-subject') {
    renderChapters();
  } else if (id === 'view-home') {
    renderHome();
  }
}

function startRealtimeSync() {
  if (!supabaseClient || !appData.user) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

  realtimeChannel = supabaseClient
    .channel('revisions-sync')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'user_revisions',
        filter: `user_id=eq.${appData.user.id}`
      },
      (payload) => {
        if (payload.new && payload.new.content) {
          applyCloudContent(payload.new.content);
        }
      }
    )
    .subscribe();
}

async function loadCloudData() {
  if (!supabaseClient || !appData.user) return;

  const { data, error } = await supabaseClient
    .from('user_revisions')
    .select('content')
    .eq('user_id', appData.user.id)
    .maybeSingle();

  if (error) {
    console.error("Erreur de lecture cloud :", error);
    setSyncState('error');
    return;
  }

  if (data && data.content) {
    applyCloudContent(data.content);
    setSyncState('online');
  } else {
    // Première synchro de ce compte : on envoie les données locales
    pushToCloud();
  }
}


async function handleLogin() {
  const emailInput = document.getElementById('auth-email');
  const passInput = document.getElementById('auth-password');
  const msgEl = document.getElementById('auth-message');

  if (!emailInput || !passInput) return;
  if (!supabaseClient) return alert("Le client Supabase n'est pas initialisé.");

  const { data, error } = await supabaseClient.auth.signInWithPassword({ 
    email: emailInput.value, 
    password: passInput.value 
  });

  if (error) {
    if (msgEl) {
      msgEl.style.color = "var(--danger)";
      msgEl.textContent = error.message;
    }
  } else {
    appData.user = data.user;
    updateAuthUI(true);
    await loadCloudData();
    startRealtimeSync();
    document.getElementById('auth-modal').classList.add('hidden');
  }
}

async function handleSignup() {
  const emailInput = document.getElementById('auth-email');
  const passInput = document.getElementById('auth-password');
  const msgEl = document.getElementById('auth-message');

  if (!emailInput || !passInput) return;
  if (!supabaseClient) return alert("Le client Supabase n'est pas initialisé.");

  const { data, error } = await supabaseClient.auth.signUp({ 
    email: emailInput.value, 
    password: passInput.value 
  });

  if (error) {
    if (msgEl) {
      msgEl.style.color = "var(--danger)";
      msgEl.textContent = error.message;
    }
  } else {
    if (msgEl) {
      msgEl.style.color = "var(--accent)";
      msgEl.textContent = "Compte créé ! Vérifiez votre boîte mail pour valider l'inscription.";
    }
  }
}

async function handleLogout() {
  if (supabaseClient && realtimeChannel) { supabaseClient.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (supabaseClient) await supabaseClient.auth.signOut();
  appData.user = null;
  updateAuthUI(false);
  document.getElementById('auth-modal').classList.add('hidden');
}

function updateAuthUI(isLoggedIn) {
  const statusEl = document.getElementById('sync-status');
  const logoutBtn = document.getElementById('btn-logout');

  if (statusEl) {
    if (isLoggedIn) {
      statusEl.textContent = "Connecté (Cloud)";
      statusEl.className = "sync-status online";
    } else {
      statusEl.textContent = "Hors-ligne (Local)";
      statusEl.className = "sync-status offline";
    }
  }

  if (logoutBtn) {
    if (isLoggedIn) {
      logoutBtn.classList.remove('hidden');
    } else {
      logoutBtn.classList.add('hidden');
    }
  }
}
