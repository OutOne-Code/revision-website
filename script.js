/* --- CONFIGURATION SUPABASE --- */
const SUPABASE_URL = "https://lhbpsrtkffqutexfyhol.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_6RKfpvZs2FjupZ-4DZJapg_ckgjxnrC";

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
      if (!appData.customColors) appData.customColors = { primary: "#4f46e5", accent: "#10b981" };
    } catch(e) { 
      console.error("Erreur lecture localStorage", e); 
    }
  }
}

function saveData() {
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
function openSettings() {
  switchView('settings');
  document.getElementById('nav-settings').classList.add('active');
  updateBreadcrumb('Personnalisation');

  document.getElementById('color-primary').value = appData.customColors.primary || '#4f46e5';
  document.getElementById('color-accent').value = appData.customColors.accent || '#10b981';
}

function applyCustomColors() {
  if (!appData.customColors) return;
  document.documentElement.style.setProperty('--primary', appData.customColors.primary);
  document.documentElement.style.setProperty('--accent', appData.customColors.accent);
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
      <small>${chap.annotations ? chap.annotations.length : 0} notion(s) surlignée(s)</small>
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

/* --- LISTENERS INTERFACE --- */
function setupEventListeners() {
  // Thème
  const btnToggleTheme = document.getElementById('btn-toggle-theme');
  const btnToggleThemeMobile = document.getElementById('btn-toggle-theme-mobile');
  if (btnToggleTheme) btnToggleTheme.onclick = toggleTheme;
  if (btnToggleThemeMobile) btnToggleThemeMobile.onclick = toggleTheme;

  // Sidebar Mobile
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (btnToggleSidebar) btnToggleSidebar.onclick = toggleMobileSidebar;
  if (overlay) overlay.onclick = closeMobileSidebar;

  // Navigation principale
  document.getElementById('nav-home').onclick = () => { switchView('home'); renderHome(); };
  document.getElementById('nav-timetable').onclick = openTimetable;
  document.getElementById('nav-homework').onclick = openHomework;
  document.getElementById('nav-grades').onclick = openGrades;
  document.getElementById('nav-settings').onclick = openSettings;

  // Modales d'annulation / fermeture
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.onclick = () => {
      btn.closest('.modal-backdrop').classList.add('hidden');
    };
  });

  // Emploi du Temps
  document.getElementById('btn-config-timetable').onclick = () => {
    document.getElementById('cfg-weeks').value = appData.weeks.join(', ');
    document.getElementById('cfg-hours').value = appData.hours.join('\n');
    document.getElementById('modal-timetable-config').classList.remove('hidden');
  };

  document.getElementById('btn-save-timetable-config').onclick = () => {
    const weeksInput = document.getElementById('cfg-weeks').value;
    const hoursInput = document.getElementById('cfg-hours').value;

    appData.weeks = weeksInput.split(',').map(w => w.trim()).filter(Boolean);
    appData.hours = hoursInput.split('\n').map(h => h.trim()).filter(Boolean);

    saveData();
    document.getElementById('modal-timetable-config').classList.add('hidden');
    openTimetable();
  };

  document.getElementById('btn-save-slot').onclick = saveSlot;
  document.getElementById('btn-delete-slot').onclick = () => {
    if (selectedSlotTarget) {
      const { week, day, hour } = selectedSlotTarget;
      if (appData.timetable[week]?.[day]?.[hour]) {
        delete appData.timetable[week][day][hour];
        saveData();
        renderTimetableGrid(week);
      }
    }
    document.getElementById('modal-slot').classList.add('hidden');
  };

  // Devoirs & Calendrier Navigation
  document.getElementById('cal-prev').onclick = () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar();
  };
  document.getElementById('cal-next').onclick = () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar();
  };
  document.getElementById('btn-add-homework').onclick = openAddHomeworkModal;
  document.getElementById('btn-save-homework').onclick = saveHomework;

  // Notes
  document.getElementById('btn-add-grade').onclick = openAddGradeModal;
  document.getElementById('btn-save-grade').onclick = saveGrade;

  // Personnalisation
  document.getElementById('color-primary').onchange = (e) => {
    appData.customColors.primary = e.target.value;
    applyCustomColors();
    saveData();
  };

  document.getElementById('color-accent').onchange = (e) => {
    appData.customColors.accent = e.target.value;
    applyCustomColors();
    saveData();
  };

  document.getElementById('btn-reset-theme-colors').onclick = () => {
    appData.customColors = { primary: "#4f46e5", accent: "#10b981" };
    applyCustomColors();
    saveData();
    openSettings();
  };

  // Matières
  const btnAddSubject = document.getElementById('btn-add-subject');
  if (btnAddSubject) {
    btnAddSubject.onclick = () => {
      const name = prompt("Nom de la matière :");
      if (!name || !name.trim()) return;
      const color = prompt("Code couleur HEX (ex: #4f46e5) :", "#4f46e5") || "#4f46e5";
      const newSubject = { id: Date.now().toString(), name: name.trim(), color, chapters: [] };
      appData.subjects.push(newSubject);
      saveData();
      renderSidebar();
      openSubject(newSubject.id);
    };
  }

  const btnEditSubjectColor = document.getElementById('btn-edit-subject-color');
  if (btnEditSubjectColor) {
    btnEditSubjectColor.onclick = () => {
      const subject = appData.subjects.find(s => s.id === currentSubjectId);
      if (!subject) return;
      const color = prompt("Nouvelle couleur HEX :", subject.color || "#4f46e5");
      if (color) {
        subject.color = color;
        saveData();
        renderSidebar();
        openSubject(subject.id);
      }
    };
  }

  const btnRenameSubject = document.getElementById('btn-rename-subject');
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

  const btnDeleteSubject = document.getElementById('btn-delete-subject');
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
  const btnAddChapter = document.getElementById('btn-add-chapter');
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

  const btnDeleteChapter = document.getElementById('btn-delete-chapter');
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

  const btnBackToSubject = document.getElementById('btn-back-to-subject');
  if (btnBackToSubject) btnBackToSubject.onclick = () => openSubject(currentSubjectId);

  const btnExitQuiz = document.getElementById('btn-exit-quiz');
  if (btnExitQuiz) btnExitQuiz.onclick = () => openChapter(currentChapterId);

  // Éditeur Formattage
  document.querySelectorAll('.editor-toolbar .tool-btn[data-cmd]').forEach(btn => {
    btn.onclick = () => {
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.val || null;
      document.execCommand(cmd, false, val);
    };
  });

  const editor = document.getElementById('editor');
  if (editor) editor.oninput = autoSaveCurrentLesson;

  const chapterTitle = document.getElementById('chapter-title');
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

  // Surlignage Magique
  const btnMagic = document.getElementById('btn-magic-highlight');
  if (btnMagic) btnMagic.onclick = applyMagicHighlight;

  const btnSaveAnn = document.getElementById('btn-save-annotation');
  if (btnSaveAnn) btnSaveAnn.onclick = saveAnnotation;

  const btnRemoveHighlight = document.getElementById('btn-remove-highlight');
  if (btnRemoveHighlight) btnRemoveHighlight.onclick = removeHighlight;

  // Quiz
  const btnStartQuiz = document.getElementById('btn-start-quiz');
  if (btnStartQuiz) btnStartQuiz.onclick = startQuiz;

  // Modale Authentification
  const btnAuthModal = document.getElementById('btn-auth-modal');
  if (btnAuthModal) btnAuthModal.onclick = () => document.getElementById('auth-modal').classList.remove('hidden');

  const btnCloseModal = document.getElementById('btn-close-modal');
  if (btnCloseModal) btnCloseModal.onclick = () => document.getElementById('auth-modal').classList.add('hidden');

  const btnLogin = document.getElementById('btn-login');
  if (btnLogin) btnLogin.onclick = handleLogin;

  const btnSignup = document.getElementById('btn-signup');
  if (btnSignup) btnSignup.onclick = handleSignup;

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.onclick = handleLogout;
}

/* --- ÉDITEUR & SURLIGNAGE MAGIQUE --- */
function autoSaveCurrentLesson() {
  if (!currentChapterId) return;
  const subject = appData.subjects.find(s => s.id === currentSubjectId);
  if (!subject) return;

  const chap = subject.chapters.find(c => c.id === currentChapterId);
  if (!chap) return;

  const editor = document.getElementById('editor');
  if (!editor) return;

  chap.content = editor.innerHTML;
  
  const highlights = editor.querySelectorAll('mark.magic-highlight');
  chap.annotations = Array.from(highlights).map(h => ({
    id: h.dataset.id,
    text: h.textContent,
    note: h.dataset.note || ""
  }));

  saveData();
}

function applyMagicHighlight() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return alert("Sélectionnez du texte dans la leçon pour utiliser le surlignage magique.");
  }

  const range = sel.getRangeAt(0);
  const mark = document.createElement('mark');
  mark.className = 'magic-highlight';
  mark.dataset.id = Date.now().toString();
  mark.dataset.note = "";

  try {
    range.surroundContents(mark);
    attachClickToMark(mark);
    autoSaveCurrentLesson();
    showAnnotationPopover(mark);
  } catch(e) {
    alert("Veuillez sélectionner uniquement du texte dans un même paragraphe.");
  }
}

function attachHighlightEvents() {
  const editor = document.getElementById('editor');
  if (editor) {
    editor.querySelectorAll('mark.magic-highlight').forEach(attachClickToMark);
  }
}

function attachClickToMark(mark) {
  mark.onclick = (e) => {
    e.stopPropagation();
    showAnnotationPopover(mark);
  };
}

function showAnnotationPopover(mark) {
  const popover = document.getElementById('annotation-popover');
  const popoverInput = document.getElementById('annotation-input');
  if (!popover || !popoverInput) return;

  activeHighlightNode = mark;
  const rect = mark.getBoundingClientRect();
  popover.style.top = `${rect.bottom + window.scrollY + 5}px`;
  popover.style.left = `${rect.left + window.scrollX}px`;
  popoverInput.value = mark.dataset.note || "";
  popover.classList.remove('hidden');
}

function saveAnnotation() {
  const popover = document.getElementById('annotation-popover');
  const popoverInput = document.getElementById('annotation-input');
  if (activeHighlightNode && popoverInput) {
    activeHighlightNode.dataset.note = popoverInput.value;
    autoSaveCurrentLesson();
  }
  if (popover) popover.classList.add('hidden');
}

function removeHighlight() {
  const popover = document.getElementById('annotation-popover');
  if (activeHighlightNode) {
    const text = activeHighlightNode.textContent;
    activeHighlightNode.replaceWith(text);
    autoSaveCurrentLesson();
  }
  if (popover) popover.classList.add('hidden');
}

/* --- QUIZ --- */
function startQuiz() {
  const subject = appData.subjects.find(s => s.id === currentSubjectId);
  if (!subject) return;

  const chap = subject.chapters.find(c => c.id === currentChapterId);
  if (!chap) return;

  if (!chap.annotations || chap.annotations.length === 0) {
    return alert("Surlignez au moins une notion importante pour créer un quiz !");
  }

  generateQuiz(chap.annotations);
  switchView('quiz');
}

function generateQuiz(annotations) {
  const container = document.getElementById('quiz-container');
  if (!container) return;

  let currentStep = 0;
  let score = 0;

  function showQuestion() {
    if (currentStep >= annotations.length) {
      const finalGrade = Math.round((score / annotations.length) * 20);
      container.innerHTML = `
        <div class="quiz-card">
          <h2>Quiz Terminé !</h2>
          <p style="font-size: 1.5rem; margin: 20px 0;">Note : <strong>${finalGrade} / 20</strong></p>
          <p>${score} réponse(s) correcte(s) sur ${annotations.length}</p>
          <button onclick="openChapter('${currentChapterId}')" class="btn btn-primary" style="margin-top:20px;">Retour à la leçon</button>
        </div>
      `;
      return;
    }

    const item = annotations[currentStep];
    container.innerHTML = `
      <div class="quiz-card">
        <h3>Question ${currentStep + 1}/${annotations.length}</h3>
        <p style="margin: 15px 0;">Que désigne ou explicite la notion : <strong>« ${item.text} »</strong> ?</p>
        <div class="quiz-options">
          <button class="btn btn-secondary" id="btn-reveal">Afficher la réponse / Explication</button>
        </div>
        <div id="quiz-answer" class="hidden" style="margin-top: 15px; padding: 15px; background: var(--bg-sidebar); border-radius: 8px;">
          <p><strong>Explication :</strong> ${item.note || "Aucune note enregistrée."}</p>
          <p style="margin-top: 15px;">Avez-vous eu juste ?</p>
          <div style="display:flex; gap:10px; margin-top:10px; justify-content:center;">
            <button id="btn-correct" class="btn btn-primary">Oui (+1)</button>
            <button id="btn-wrong" class="btn btn-danger">Non</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-reveal').onclick = () => {
      document.getElementById('quiz-answer').classList.remove('hidden');
      document.getElementById('btn-reveal').style.display = 'none';
    };

    document.getElementById('btn-correct').onclick = () => { score++; currentStep++; showQuestion(); };
    document.getElementById('btn-wrong').onclick = () => { currentStep++; showQuestion(); };
  }

  showQuestion();
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
async function syncToCloud() {
  if (!supabaseClient || !appData.user) return;
  
  try {
    await supabaseClient.from('user_revisions').upsert({
      user_id: appData.user.id,
      content: appData,
      updated_at: new Date()
    });
  } catch(e) {
    console.error("Erreur de synchronisation cloud :", e);
  }
}

async function checkAuth() {
  if (!supabaseClient) return;
  
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      appData.user = session.user;
      updateAuthUI(true);
      loadCloudData();
    }
  } catch(e) {
    console.error("Erreur d'authentification :", e);
  }
}

async function loadCloudData() {
  if (!supabaseClient || !appData.user) return;
  
  const { data, error } = await supabaseClient.from('user_revisions').select('content').eq('user_id', appData.user.id).single();
  if (data && data.content) {
    appData = { ...appData, ...data.content };
    localStorage.setItem('revision_app_data', JSON.stringify(appData));
    applyCustomColors();
    renderSidebar();
    renderHome();
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
    loadCloudData();
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
