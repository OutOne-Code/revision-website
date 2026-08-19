/* --- CONFIGURATION SUPABASE --- */
const SUPABASE_URL = "https://lhbpsrtkffqutexfyhol.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_6RKfpvZs2FjupZ-4DZJapg_ckgjxnrC"; // Votre clé anon complète

let supabaseClient = null;

// Initialisation sécurisée du client Supabase
if (window.supabase && typeof window.supabase.createClient === 'function') {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* --- ÉTAT GLOBAL DE L'APPLICATION --- */
let appData = {
  subjects: [],
  user: null
};

let currentSubjectId = null;
let currentChapterId = null;
let activeHighlightNode = null;

/* --- INITIALISATION --- */
document.addEventListener('DOMContentLoaded', () => {
  loadLocalData();
  initTheme();
  setupEventListeners();
  renderSidebar();
  checkAuth();
});

/* --- STOCKAGE LOCAL & SYNCHRONISATION --- */
function loadLocalData() {
  const saved = localStorage.getItem('revision_app_data');
  if (saved) {
    try { 
      appData = JSON.parse(saved); 
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
    subject: document.getElementById('view-subject'),
    lesson: document.getElementById('view-lesson'),
    quiz: document.getElementById('view-quiz')
  };

  Object.keys(views).forEach(v => {
    if (views[v]) views[v].classList.add('hidden');
  });

  if (views[viewName]) {
    views[viewName].classList.remove('hidden');
  }
}

function updateBreadcrumb(text) {
  const breadcrumb = document.getElementById('breadcrumb');
  if (breadcrumb) breadcrumb.textContent = text;
}

/* --- GESTION MATIÈRES & CHAPITRES --- */
function renderSidebar() {
  const subjectsListEl = document.getElementById('subjects-list');
  if (!subjectsListEl) return;

  subjectsListEl.innerHTML = '';
  appData.subjects.forEach(subject => {
    const el = document.createElement('div');
    el.className = `subject-item ${subject.id === currentSubjectId ? 'active' : ''}`;
    el.textContent = subject.name;
    el.onclick = () => openSubject(subject.id);
    subjectsListEl.appendChild(el);
  });
}

function openSubject(subjectId) {
  currentSubjectId = subjectId;
  currentChapterId = null;
  renderSidebar();

  const subject = appData.subjects.find(s => s.id === subjectId);
  if (!subject) return;

  const subjectTitle = document.getElementById('subject-title');
  if (subjectTitle) subjectTitle.textContent = subject.name;

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
  if (btnToggleTheme) btnToggleTheme.onclick = toggleTheme;

  // Matières
  const btnAddSubject = document.getElementById('btn-add-subject');
  if (btnAddSubject) {
    btnAddSubject.onclick = () => {
      const name = prompt("Nom de la matière :");
      if (!name || !name.trim()) return;
      const newSubject = { id: Date.now().toString(), name: name.trim(), chapters: [] };
      appData.subjects.push(newSubject);
      saveData();
      renderSidebar();
      openSubject(newSubject.id);
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
        updateBreadcrumb('Accueil');
        switchView('home');
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

  // Surlignage Magique & Popover
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

/* --- GENERATION DE QUIZ --- */
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
        <div id="quiz-answer" class="hidden" style="margin-top: 15px; padding: 15px; background: var(--bg-sidebar); border-radius: 6px;">
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

/* --- THÈME --- */
function initTheme() {
  const theme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const target = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem('theme', target);
}

/* --- SUPABASE & AUTHENTIFICATION --- */
async function syncToCloud() {
  if (!supabaseClient || !appData.user) return;
  
  try {
    await supabaseClient.from('user_revisions').upsert({
      user_id: appData.user.id,
      content: appData.subjects,
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
    appData.subjects = data.content;
    localStorage.setItem('revision_app_data', JSON.stringify(appData));
    renderSidebar();
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
      msgEl.style.color = "red";
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
      msgEl.style.color = "red";
      msgEl.textContent = error.message;
    }
  } else {
    if (msgEl) {
      msgEl.style.color = "green";
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