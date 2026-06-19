/* ============================================================
   IdeaForge Pro v2.0 — Firebase Edition
   Auth: Google Sign-In | DB: Firestore (no localStorage for data)
   ============================================================ */

// ===================== STATE =====================
let ideas          = [];
let currentIdeaId  = null;
let currentPhase   = 0;
let editingId      = null;
let activeFilter   = 'all';
let activeTagFilter= null;
let formData       = {};
let charts         = {};
let currentUser    = null;   // Firebase user object
let _unsubIdeas    = null;   // Firestore real-time listener unsubscribe fn

// ===================== FIREBASE HELPERS =====================
function fb() { return window._firebase; }

function userIdeasCol() {
  // Collection path: users/{uid}/ideas
  const { db, collection } = fb();
  return collection(db, 'users', currentUser.uid, 'ideas');
}

function userIdeaDoc(ideaId) {
  const { db, doc } = fb();
  return doc(db, 'users', currentUser.uid, 'ideas', ideaId);
}

function userSettingsDoc() {
  const { db, doc } = fb();
  return doc(db, 'users', currentUser.uid, 'settings', 'prefs');
}

// Sync status UI
function setSyncStatus(status, label) {
  const ind = document.getElementById('syncIndicator');
  const lbl = document.getElementById('syncLabel');
  if (!ind) return;
  ind.className = `sync-indicator ${status}`;
  if (lbl) lbl.textContent = label;
}

// ===================== AUTH STATE HANDLER =====================
window.onFirebaseAuthChange = async function(user) {
  if (user) {
    currentUser = user;
    hideAuthScreen();
    updateSidebarUser(user);
    await initApp();
  } else {
    currentUser = null;
    ideas = [];
    if (_unsubIdeas) { _unsubIdeas(); _unsubIdeas = null; }
    showAuthScreen();
  }
};

function showAuthScreen() {
  const el = document.getElementById('authOverlay');
  if (el) { el.classList.remove('hidden'); }
}
function hideAuthScreen() {
  const el = document.getElementById('authOverlay');
  if (el) { el.classList.add('hidden'); }
}

function updateSidebarUser(user) {
  const avatar = document.getElementById('sidebarAvatar');
  const name   = document.getElementById('sidebarUserName');
  const email  = document.getElementById('sidebarUserEmail');
  if (avatar) avatar.src = user.photoURL || '';
  if (name)   name.textContent  = user.displayName || 'User';
  if (email)  email.textContent = user.email || '';
}

// ===================== FIRESTORE — READ / WRITE =====================
async function loadIdeasFromDB() {
  setSyncStatus('syncing', 'Loading…');
  try {
    const { getDocs, query, orderBy } = fb();
    const col   = userIdeasCol();
    const snap  = await getDocs(query(col, orderBy('date', 'desc')));
    ideas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setSyncStatus('synced', 'Synced');
  } catch(e) {
    console.error('loadIdeas error:', e);
    setSyncStatus('error', 'Error');
    showToast('Could not load ideas from database.', 'error');
  }
}

async function saveIdeaToDB(idea) {
  setSyncStatus('syncing', 'Saving…');
  try {
    const { setDoc } = fb();
    await setDoc(userIdeaDoc(idea.id), idea);
    setSyncStatus('synced', 'Saved ✓');
  } catch(e) {
    console.error('saveIdea error:', e);
    setSyncStatus('error', 'Save failed');
    showToast('Could not save idea to database.', 'error');
  }
}

async function deleteIdeaFromDB(ideaId) {
  setSyncStatus('syncing', 'Deleting…');
  try {
    const { deleteDoc } = fb();
    await deleteDoc(userIdeaDoc(ideaId));
    setSyncStatus('synced', 'Synced');
  } catch(e) {
    console.error('deleteIdea error:', e);
    setSyncStatus('error', 'Delete failed');
    showToast('Could not delete idea from database.', 'error');
  }
}

// Save Gemini key to Firestore (per user)
async function saveGeminiKeyToDB(key) {
  if (!currentUser) return;
  try {
    const { setDoc } = fb();
    await setDoc(userSettingsDoc(), { geminiKey: key }, { merge: true });
  } catch(e) { /* fallback to localStorage */ }
  localStorage.setItem('if_gemini_key_' + currentUser.uid, key);
}

async function loadGeminiKeyFromDB() {
  if (!currentUser) return '';
  // Try Firestore first, fallback to localStorage
  try {
    const { getDoc } = fb();
    const snap = await getDoc(userSettingsDoc());
    if (snap.exists() && snap.data().geminiKey) {
      return snap.data().geminiKey;
    }
  } catch(e) {}
  return localStorage.getItem('if_gemini_key_' + currentUser.uid) || '';
}

// Save OpenRouter key to Firestore (per user)
async function saveOpenRouterKeyToDB(key) {
  if (!currentUser) return;
  try {
    const { setDoc } = fb();
    await setDoc(userSettingsDoc(), { openrouterKey: key }, { merge: true });
  } catch(e) { /* fallback to localStorage */ }
  localStorage.setItem('if_or_key_' + currentUser.uid, key);
}

async function loadOpenRouterKeyFromDB() {
  if (!currentUser) return '';
  // Try Firestore first, fallback to localStorage
  try {
    const { getDoc } = fb();
    const snap = await getDoc(userSettingsDoc());
    if (snap.exists() && snap.data().openrouterKey) {
      return snap.data().openrouterKey;
    }
  } catch(e) {}
  return localStorage.getItem('if_or_key_' + currentUser.uid) || '';
}

// Save chat provider preference to Firestore (per user)
async function saveChatProviderToDB(provider) {
  if (!currentUser) return;
  try {
    const { setDoc } = fb();
    await setDoc(userSettingsDoc(), { chatProvider: provider }, { merge: true });
  } catch(e) { /* fallback to localStorage */ }
  localStorage.setItem('if_chat_provider_' + currentUser.uid, provider);
}

async function loadChatProviderFromDB() {
  if (!currentUser) return 'gemini';
  // Try Firestore first, fallback to localStorage
  try {
    const { getDoc } = fb();
    const snap = await getDoc(userSettingsDoc());
    if (snap.exists() && snap.data().chatProvider) {
      return snap.data().chatProvider;
    }
  } catch(e) {}
  return localStorage.getItem('if_chat_provider_' + currentUser.uid) || 'gemini';
}

// Save OpenRouter model to Firestore (per user)
async function saveOpenRouterModelToDB(model) {
  if (!currentUser) return;
  try {
    const { setDoc } = fb();
    await setDoc(userSettingsDoc(), { openrouterModel: model }, { merge: true });
  } catch(e) { /* fallback to localStorage */ }
  localStorage.setItem('if_or_model_' + currentUser.uid, model);
}

async function loadOpenRouterModelFromDB() {
  if (!currentUser) return 'google/gemini-2.0-flash-exp:free';
  // Try Firestore first, fallback to localStorage
  try {
    const { getDoc } = fb();
    const snap = await getDoc(userSettingsDoc());
    if (snap.exists() && snap.data().openrouterModel) {
      return snap.data().openrouterModel;
    }
  } catch(e) {}
  return localStorage.getItem('if_or_model_' + currentUser.uid) || 'google/gemini-2.0-flash-exp:free';
}

// ===================== PERSIST (replaces old localStorage persist) =====================
async function persist() {
  // ideas array is already up-to-date — caller does DB write directly
  // This just refreshes the UI
  renderAll();
}

// ===================== GETTERS / SETTERS for Gemini key =====================
function getGeminiKey() {
  if (!currentUser) return localStorage.getItem('if_gemini_key') || '';
  return localStorage.getItem('if_gemini_key_' + currentUser.uid) || '';
}
function saveGeminiKey(key) {
  const storageKey = currentUser
    ? 'if_gemini_key_' + currentUser.uid
    : 'if_gemini_key';
  localStorage.setItem(storageKey, key.trim());
  // Also save to Firestore in background
  if (currentUser) saveGeminiKeyToDB(key.trim());
}

// ===================== GETTERS / SETTERS for OpenRouter key =====================
function getORKey() {
  if (!currentUser) return localStorage.getItem('if_or_key') || '';
  return localStorage.getItem('if_or_key_' + currentUser.uid) || '';
}
function setORKey(k) {
  const storageKey = currentUser
    ? 'if_or_key_' + currentUser.uid
    : 'if_or_key';
  localStorage.setItem(storageKey, k.trim());
  // Also save to Firestore in background
  if (currentUser) saveOpenRouterKeyToDB(k.trim());
}

// ===================== GETTERS / SETTERS for OpenRouter model =====================
function getORModel() {
  if (!currentUser) return localStorage.getItem('if_or_model') || 'google/gemini-2.0-flash-exp:free';
  return localStorage.getItem('if_or_model_' + currentUser.uid) || 'google/gemini-2.0-flash-exp:free';
}
function setORModel(m) {
  const storageKey = currentUser
    ? 'if_or_model_' + currentUser.uid
    : 'if_or_model';
  localStorage.setItem(storageKey, m);
  // Also save to Firestore in background
  if (currentUser) saveOpenRouterModelToDB(m);
}

// ===================== GETTERS / SETTERS for chat provider =====================
function getChatProvider() {
  if (!currentUser) return localStorage.getItem('if_chat_provider') || 'gemini';
  return localStorage.getItem('if_chat_provider_' + currentUser.uid) || 'gemini';
}
function setChatProvider(p) {
  const storageKey = currentUser
    ? 'if_chat_provider_' + currentUser.uid
    : 'if_chat_provider';
  localStorage.setItem(storageKey, p);
  // Also save to Firestore in background
  if (currentUser) saveChatProviderToDB(p);
  updateProviderUI();
}

// ===================== INIT (called after sign-in) =====================
async function initApp() {
  await loadIdeasFromDB();
  await loadPreset();      // adds sample only if user has zero ideas
  buildForm();
  renderAll();
  setupEventListeners();
  updateHeroDate();
  applyTheme();
  initChatbot();
  
  // Pre-load all user settings from DB into localStorage cache
  if (currentUser) {
    const savedGeminiKey = await loadGeminiKeyFromDB();
    if (savedGeminiKey) localStorage.setItem('if_gemini_key_' + currentUser.uid, savedGeminiKey);
    
    const savedORKey = await loadOpenRouterKeyFromDB();
    if (savedORKey) localStorage.setItem('if_or_key_' + currentUser.uid, savedORKey);
    
    const savedORModel = await loadOpenRouterModelFromDB();
    if (savedORModel) localStorage.setItem('if_or_model_' + currentUser.uid, savedORModel);
    
    const savedProvider = await loadChatProviderFromDB();
    if (savedProvider) localStorage.setItem('if_chat_provider_' + currentUser.uid, savedProvider);
    
    // Update UI with the restored provider
    updateProviderUI();
  }
}

// ===================== PHASES CONFIG =====================
const PHASES = [
  { n:1, title:'Reality Mapping',    goal:'Map the system. Find friction.' },
  { n:2, title:'Insight Discovery',  goal:'Find a non-obvious truth.' },
  { n:3, title:'Problem Selection',  goal:'Choose a painful, valuable problem.' },
  { n:4, title:'Solution Design',    goal:'Define a 10x transformative solution.' },
  { n:5, title:'Market & Business',  goal:'Ensure it can become a real company.' },
  { n:6, title:'7-Question Filter',  goal:'Answer the key startup filters.' },
  { n:7, title:'Moat & Risk',        goal:'Assess defensibility and risks.' },
  { n:8, title:'Commitment',         goal:'Make your final thesis & decision.' },
];

const DOMAINS = ['Healthcare','Education','Energy','Finance','Logistics','Agriculture',
  'Software/Data','Climate','Consumer','Government','Media','Manufacturing','Other'];

function blank() {
  return {
    id: Date.now().toString(), date: today(),
    name:'', domains:[], valueChain:'',
    frictions:['','','',''],
    commonBelief:'', contrarian:'', contrarian2:'', evidence:'', insight:'',
    problemUser:'', problemBecause:'', problemDef:'',
    scores:{ pain:3, urgency:3, budget:3, alternatives:3, awareness:3 },
    targetRole:'', targetContext:'',
    dimensions:[], solution:'',
    solutionHelp:'', solutionAchieve:'', solutionBy:'', solutionUnlike:'',
    technologies:'', mvp:'',
    beachheadWho:'', beachheadUseCase:'', beachheadWin:'',
    marketPath:['','',''],
    bizWho:'', bizWhat:'', bizPricing:'', recurring:'',
    bizPrice:'', bizCosts:'', grossMargin:'', ltv:'',
    channels:[], channelExplain:'',
    q1:'',q2:'',q3:'',q4:'',q5:'',q6:'',q7:'', overallFilter:'',
    moats:[], moatExplain:'',
    risks:['','','','',''], risksControl:'',
    asymmetricWork:'', asymmetricFail:'', asymmetricExplain:'',
    assumptions:[], assumptionList:['','',''],
    experiments:[], experimentDesc:'', evidence2:'',
    summaryInsight:'', summaryProblem:'', summarySolution:'',
    summaryUser:'', summaryMarket:'', summaryBiz:'',
    summaryDist:'', summaryMoat:'', summaryWhy:'', summaryVision:'',
    conviction:7, finalDecision:'', finalNotes:'',
    tags:[], aiAnalysis:null
  };
}
function today() { return new Date().toISOString().split('T')[0]; }
function totalScore(idea) {
  if (!idea?.scores) return 0;
  return Object.values(idea.scores).reduce((a,b)=>a+b,0);
}
function tierClass(s) { return s>=20?'score-high':s>=13?'score-mid':'score-low'; }
function decCls(d) {
  return d==='Commit fully'?'dec-commit':d==='Keep exploring'?'dec-explore':d==='Discard'?'dec-discard':'dec-none';
}

// ===================== INIT =====================
window.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initAuthParticles();
  initCursor();
  applyTheme();

  // Auth screen sign-in button
  document.getElementById('googleSignInBtn')?.addEventListener('click', signInWithGoogle);

  // Sign-out button
  document.getElementById('signOutBtn')?.addEventListener('click', signOutUser);

  // App will fully init via onFirebaseAuthChange → initApp()
  // Show auth screen immediately (will hide once auth state resolves)
  // Don't show it here — onAuthStateChanged fires quickly and decides
});

async function signInWithGoogle() {
  const { auth, provider, signInWithPopup } = fb();
  const errEl  = document.getElementById('authError');
  const loadEl = document.getElementById('authLoading');
  const btnEl  = document.getElementById('googleSignInBtn');

  errEl.style.display  = 'none';
  loadEl.style.display = 'flex';
  btnEl.style.display  = 'none';

  try {
    await signInWithPopup(auth, provider);
    // onAuthStateChanged fires automatically → hideAuthScreen + initApp
  } catch(e) {
    loadEl.style.display = 'none';
    btnEl.style.display  = 'flex';
    const msg = e.code === 'auth/popup-closed-by-user'
      ? 'Sign-in cancelled. Please try again.'
      : e.code === 'auth/popup-blocked'
      ? 'Popup was blocked. Please allow popups for this site.'
      : `Sign-in failed: ${e.message}`;
    errEl.textContent   = msg;
    errEl.style.display = 'block';
  }
}

async function signOutUser() {
  const { auth, signOut } = fb();
  if (!confirm('Sign out of IdeaForge?')) return;
  try {
    if (_unsubIdeas) { _unsubIdeas(); _unsubIdeas = null; }
    ideas = [];
    currentUser = null;
    await signOut(auth);
    // onAuthStateChanged → showAuthScreen
    showToast('Signed out successfully.', 'success');
  } catch(e) {
    showToast('Sign-out failed. Please try again.', 'error');
  }
}

function renderAll() {
  renderSidebar();
  renderDashboard();
  renderLeaderboard();
  renderAnalytics();
  updateCompareSelects();
  document.getElementById('navBadgeTotal').textContent = ideas.length;
}

// ===================== EVENT LISTENERS =====================
function setupEventListeners() {
  // Nav items
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.view));
  });
  // Top new btn + sidebar
  document.getElementById('topNewBtn').addEventListener('click', newIdeaAction);
  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
  // Theme
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  // Sidebar search
  document.getElementById('sidebarSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.idea-nav-li').forEach(li => {
      li.style.display = li.dataset.name?.toLowerCase().includes(q) ? '' : 'none';
    });
  });
  // Compare selects
  document.getElementById('compareA').addEventListener('change', renderCompare);
  document.getElementById('compareB').addEventListener('change', renderCompare);
  // Filter bar
  document.getElementById('filterBar').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderDashboard();
  });
  // Search trigger
  document.getElementById('globalSearchTrigger').addEventListener('click', openSearch);
  document.getElementById('sidebarSearch').addEventListener('focus', openSearch);
  document.getElementById('globalSearch').addEventListener('input', runSearch);
  // Detail buttons
  document.getElementById('detailAIBtn').addEventListener('click', runAIAnalysis);
  document.getElementById('detailEditBtn').addEventListener('click', () => editIdea(currentIdeaId));
  document.getElementById('detailDeleteBtn').addEventListener('click', () => confirmDelete(currentIdeaId));
  document.getElementById('detailExportBtn').addEventListener('click', exportPDF);
  // Export button handled by onclick in HTML (openExportModal)
  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if ((e.metaKey||e.ctrlKey) && e.key==='k') { e.preventDefault(); openSearch(); }
    if (e.key==='Escape') { closeSearch(); closeAIPanel(); closeChat(); }
  });
  // Sidebar overlay
  document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
  });
}

// ===================== SIDEBAR / THEME =====================
function createSidebarOverlay() {
  if (document.getElementById('sidebarOverlay')) return;
  const el = document.createElement('div');
  el.className = 'sidebar-overlay'; el.id = 'sidebarOverlay';
  document.body.appendChild(el);
  el.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    el.classList.remove('open');
  });
}
function toggleSidebar() {
  createSidebarOverlay();
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('open');
}
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  localStorage.setItem('if_theme', t);
  document.getElementById('themeIcon').textContent = t === 'dark' ? '◑' : '☀';
  reinitCharts();
}
function applyTheme() {
  const t = localStorage.getItem('if_theme') || 'dark';
  document.documentElement.dataset.theme = t;
  document.getElementById('themeIcon').textContent = t === 'dark' ? '◑' : '☀';
}
function updateHeroDate() {
  document.getElementById('heroDate').textContent =
    new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
}

// ===================== SWITCH VIEW =====================
function switchView(view, id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view===view));
  document.querySelectorAll('.idea-nav-li').forEach(n => n.classList.toggle('active', id && n.dataset.id===id));
  const el = document.getElementById('view-'+view);
  if (el) el.classList.add('active');
  const titles = { dashboard:'Dashboard','new-idea':'New Idea',leaderboard:'Leaderboard',compare:'Compare',analytics:'Analytics',detail:'Idea Detail' };
  document.getElementById('bcCurrent').textContent = titles[view] || view;
  closeSidebar();
  if (view === 'analytics') setTimeout(renderAnalyticsCharts, 80);
}

// ===================== MOBILE BOTTOM NAV SYNC =====================
function mbnSwitch(btn, view) {
  document.querySelectorAll('.mbn-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  switchView(view);
}

// Keep mobile bottom nav in sync when desktop nav is used
const _origSwitchView = switchView;
function syncMobileNav(view) {
  document.querySelectorAll('.mbn-item[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
}
// Patch switchView to also sync bottom nav
const __sv = switchView;
window.switchView = function(view, id) {
  __sv(view, id);
  syncMobileNav(view);
};

// ===================== NEW IDEA =====================
function newIdeaAction() {
  editingId = null; formData = blank();
  document.getElementById('formTitle').textContent = 'Evaluate New Idea';
  buildForm(); goToPhase(0); switchView('new-idea');
}

// ===================== AUTH SCREEN PARTICLES =====================
function initAuthParticles() {
  const c = document.getElementById('authCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  let W, H, pts = [];
  function resize() { W = c.width = innerWidth; H = c.height = innerHeight; }
  resize(); window.addEventListener('resize', resize);
  for (let i = 0; i < 40; i++) {
    pts.push({ x:Math.random()*1920, y:Math.random()*1080, vx:(Math.random()-.5)*.3, vy:(Math.random()-.5)*.3, r:Math.random()*1.5+.5 });
  }
  function draw() {
    ctx.clearRect(0,0,W,H);
    const pc = '0,245,200';
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if(p.x<0)p.x=W; if(p.x>W)p.x=0; if(p.y<0)p.y=H; if(p.y>H)p.y=0;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(${pc},0.5)`; ctx.fill();
    });
    pts.forEach((a,i) => pts.slice(i+1).forEach(b => {
      const d = Math.hypot(a.x-b.x, a.y-b.y);
      if(d < 100){ ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
        ctx.strokeStyle=`rgba(${pc},${(1-d/100)*0.1})`; ctx.lineWidth=0.5; ctx.stroke(); }
    }));
    requestAnimationFrame(draw);
  }
  draw();
}
function initParticles() {
  const isMobile = window.matchMedia('(max-width:900px)').matches;
  const c = document.getElementById('bgCanvas');
  const ctx = c.getContext('2d');
  let W, H, pts = [];
  function resize() { W=c.width=innerWidth; H=c.height=innerHeight; }
  resize(); window.addEventListener('resize', resize);
  const count = isMobile ? 20 : 60;   // fewer particles on mobile
  for (let i=0; i<count; i++) pts.push({ x:Math.random()*1920, y:Math.random()*1080, vx:(Math.random()-.5)*.2, vy:(Math.random()-.5)*.2, r:Math.random()*1.5+.5 });
  function draw() {
    ctx.clearRect(0,0,W,H);
    const isDark = document.documentElement.dataset.theme !== 'light';
    const pc = isDark ? '0,245,200' : '124,107,255';
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x<0)p.x=W; if(p.x>W)p.x=0; if(p.y<0)p.y=H; if(p.y>H)p.y=0;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(${pc},0.4)`; ctx.fill();
    });
    pts.forEach((a,i) => pts.slice(i+1).forEach(b => {
      const d=Math.hypot(a.x-b.x,a.y-b.y);
      if(d<120){ ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
        ctx.strokeStyle=`rgba(${pc},${(1-d/120)*0.08})`; ctx.lineWidth=0.5; ctx.stroke(); }
    }));
    requestAnimationFrame(draw);
  }
  draw();
}

// ===================== CURSOR =====================
function initCursor() {
  // Skip on touch devices
  if (window.matchMedia('(hover:none) and (pointer:coarse)').matches) {
    document.getElementById('cursorGlow').style.display = 'none';
    return;
  }
  const glow = document.getElementById('cursorGlow');
  let mx=0,my=0,cx=0,cy=0;
  document.addEventListener('mousemove', e => { mx=e.clientX; my=e.clientY; });
  function update() {
    cx += (mx-cx)*.12; cy += (my-cy)*.12;
    glow.style.left = cx+'px'; glow.style.top = cy+'px';
    requestAnimationFrame(update);
  }
  update();
}

// ===================== RENDER SIDEBAR =====================
function renderSidebar() {
  const ul = document.getElementById('sidebarIdeas');
  if (!ideas.length) { ul.innerHTML = '<div style="padding:8px 14px;font-size:11px;color:var(--text3)">No ideas yet</div>'; return; }
  const sorted = [...ideas].sort((a,b) => totalScore(b)-totalScore(a));
  ul.innerHTML = sorted.map(idea => {
    const s = totalScore(idea); const t = tierClass(s);
    const dotCls = s>=20?'green':s>=13?'amber':'red';
    return `<li class="idea-nav-li" data-id="${idea.id}" data-name="${esc(idea.name)}" onclick="viewIdea('${idea.id}')">
      <span class="inl-dot ${dotCls}"></span>
      <span class="inl-name">${idea.name || 'Untitled'}</span>
      <span class="inl-score">${s}</span>
    </li>`;
  }).join('');
  document.getElementById('navBadgeTotal').textContent = ideas.length;
}

// ===================== RENDER DASHBOARD =====================
function renderDashboard() {
  // KPIs
  document.getElementById('kpiTotal').textContent = ideas.length;
  const strong = ideas.filter(i=>i.overallFilter==='Strong').length;
  document.getElementById('kpiStrong').textContent = strong;
  const avg = ideas.length ? Math.round(ideas.reduce((a,b)=>a+totalScore(b),0)/ideas.length) : '—';
  document.getElementById('kpiAvg').textContent = avg;
  const committed = ideas.filter(i=>i.finalDecision==='Commit fully').length;
  document.getElementById('kpiCommit').textContent = committed;
  const avgConv = ideas.length ? (ideas.reduce((a,b)=>a+(b.conviction||0),0)/ideas.length).toFixed(1) : '—';
  document.getElementById('kpiConviction').textContent = avgConv;

  // Tag filter row
  const allTags = [...new Set(ideas.flatMap(i=>i.tags||[]))];
  const tfr = document.getElementById('tagFilterRow');
  tfr.innerHTML = allTags.map(t =>
    `<button class="tag-filter-chip${activeTagFilter===t?' active':''}" onclick="filterByTag('${t}')">#${t}</button>`
  ).join('');

  // Filter ideas
  let filtered = [...ideas];
  if (activeFilter !== 'all') {
    filtered = filtered.filter(i => i.finalDecision===activeFilter || i.overallFilter===activeFilter);
  }
  if (activeTagFilter) {
    filtered = filtered.filter(i => (i.tags||[]).includes(activeTagFilter));
  }

  const grid = document.getElementById('ideasGrid');
  const empty = document.getElementById('emptyState');
  if (!ideas.length) { grid.innerHTML=''; grid.appendChild(empty); return; }
  if (!filtered.length) { grid.innerHTML='<div style="grid-column:1/-1;color:var(--text3);padding:40px;text-align:center;font-size:13px">No ideas match this filter.</div>'; return; }

  grid.innerHTML = filtered.map((idea, i) => {
    const s = totalScore(idea); const tc = tierClass(s);
    const d = idea.finalDecision||'';
    const glowColor = d==='Commit fully'?'var(--success)':d==='Keep exploring'?'var(--warn)':d==='Discard'?'var(--danger)':'var(--accent2)';
    const dom = (idea.domains||[]).slice(0,2).map(d=>`<span class="card-domain-chip">${d}</span>`).join('');
    const tagHtml = (idea.tags||[]).slice(0,3).map(t=>`<span class="card-tag">#${t}</span>`).join('');
    const convPct = ((idea.conviction||0)/10*100);
    return `<div class="idea-card" style="animation-delay:${i*0.05}s" onclick="viewIdea('${idea.id}')">
      <div class="idea-card-glow" style="background:${glowColor}"></div>
      <div class="card-top">
        <div class="card-domains">${dom || '<span class="card-domain-chip">General</span>'}</div>
        <div class="card-score ${tc}">${s}<small>/25</small></div>
      </div>
      <div class="card-name">${idea.name||'Untitled Idea'}</div>
      <div class="card-insight">${idea.insight||idea.summaryInsight||'No insight recorded yet.'}</div>
      ${tagHtml ? `<div class="card-tags">${tagHtml}</div>` : ''}
      <div class="card-bottom">
        <div class="card-meta">${idea.date||''}</div>
        <div class="card-conviction">
          <span>💡 ${idea.conviction||'?'}</span>
          <div class="conv-bar"><div class="conv-fill" style="width:${convPct}%"></div></div>
        </div>
        <span class="card-decision ${decCls(d)}">${d||'Undecided'}</span>
      </div>
    </div>`;
  }).join('');
}

function filterByTag(tag) {
  activeTagFilter = activeTagFilter===tag ? null : tag;
  renderDashboard();
}

// ===================== FORM BUILD =====================
function buildForm() {
  const form = document.getElementById('ideaForm');
  form.innerHTML = '';
  const navList = document.getElementById('phaseNavList');
  navList.innerHTML = PHASES.map((p,i) => `
    <li class="fsn-item${i===0?' active':''}" data-idx="${i}" onclick="goToPhase(${i})">
      <span class="fsn-num">${p.n}</span> ${p.title}
    </li>`).join('');
  const dotsRow = document.getElementById('phaseDotsRow');
  dotsRow.innerHTML = PHASES.map((_,i)=>`<div class="pdot${i===0?' active':''}" data-i="${i}" onclick="goToPhase(${i})"></div>`).join('');

  form.appendChild(makePhase(0, `
    ${fg('Idea Name / Working Title','<input class="form-input" id="f-name" placeholder="e.g. SmartFleet — AI Logistics">')}
    ${fg('Date','<input type="date" class="form-input" id="f-date">')}
    ${fg('Domain(s)', mkDomains())}
    ${fg('Tags (comma separated)','<input class="form-input" id="f-tags" placeholder="e.g. saas, b2b, ai">','Add tags to organize and filter ideas')}
    ${fg('System / Value Chain','<textarea class="form-textarea" id="f-valueChain" placeholder="Describe how the current system works — steps, actors, flow..."></textarea>')}
    ${fg('Observed Frictions',mkFrictions())}
  `));
  form.appendChild(makePhase(1, `
    ${fg('Common Belief','<textarea class="form-textarea" id="f-commonBelief" placeholder="Most people assume..."></textarea>')}
    ${fg('Contrarian Insight','<div class="form-row"><input class="form-input" id="f-contrarian" placeholder="It turns out that..."><input class="form-input" id="f-contrarian2" placeholder="because..."></div>')}
    ${fg('Evidence / Signals','<textarea class="form-textarea" id="f-evidence" placeholder="Observations, data, signals that support this..."></textarea>')}
    ${fg('Insight Statement','<textarea class="form-textarea" id="f-insight" placeholder="Your core contrarian insight in one sentence..."></textarea>')}
  `));
  form.appendChild(makePhase(2, `
    ${fg('Problem Statement','<div class="form-row-3"><input class="form-input" id="f-problemUser" placeholder="[User type]"><input class="form-input" id="f-problemBecause" placeholder="struggles with..."><input class="form-input" id="f-problemDef" placeholder="because..."></div>')}
    ${fg('Problem Score (1=Low, 5=High)', mkScoreSliders())}
    <div class="form-row">
      ${fg('Target Role','<input class="form-input" id="f-targetRole" placeholder="e.g. Fleet operators">')}
      ${fg('Context','<input class="form-input" id="f-targetContext" placeholder="e.g. Daily dispatch">')}
    </div>
  `));
  form.appendChild(makePhase(3, `
    ${fg('10x Dimension', mkPills('dim',['Cost','Speed','Quality','Convenience','Access','Reliability','Personalization','Other']))}
    ${fg('First-Principles Solution','<textarea class="form-textarea" id="f-solution" placeholder="Ignore existing solutions. What is the ideal approach?"></textarea>')}
    ${fg('Solution Statement','<div class="form-row" style="margin-bottom:10px"><input class="form-input" id="f-solutionHelp" placeholder="We help..."><input class="form-input" id="f-solutionAchieve" placeholder="achieve..."></div><div class="form-row"><input class="form-input" id="f-solutionBy" placeholder="by..."><input class="form-input" id="f-solutionUnlike" placeholder="unlike..."></div>')}
    <div class="form-row">
      ${fg('Technologies / Enablers','<input class="form-input" id="f-technologies" placeholder="AI, IoT, cloud...">')}
      ${fg('MVP Feasible?',`<select class="form-select" id="f-mvp"><option value="">Select</option><option>Yes</option><option>No</option><option>Unsure</option></select>`)}
    </div>
  `));
  form.appendChild(makePhase(4, `
    <div class="form-row">
      ${fg('Beachhead — Who','<input class="form-input" id="f-beachheadWho" placeholder="Smallest group you can dominate">')}
      ${fg('Beachhead — Use Case','<input class="form-input" id="f-beachheadUseCase" placeholder="Specific scenario">')}
    </div>
    ${fg('Why You Can Win Here','<input class="form-input" id="f-beachheadWin" placeholder="Your unfair advantage in this niche">')}
    ${fg('Market Expansion Path','<div class="form-row-3"><input class="form-input" id="f-mpath1" placeholder="1. Initial niche"><input class="form-input" id="f-mpath2" placeholder="2. Next market"><input class="form-input" id="f-mpath3" placeholder="3. Long term"></div>')}
    <div class="form-row">
      ${fg('Who Pays?','<input class="form-input" id="f-bizWho" placeholder="e.g. Logistics companies">')}
      ${fg('What Do They Pay For?','<input class="form-input" id="f-bizWhat" placeholder="e.g. Platform subscription">')}
    </div>
    <div class="form-row">
      ${fg('Pricing Logic','<input class="form-input" id="f-bizPricing" placeholder="Per seat / usage / flat">')}
      ${fg('Recurring?',`<select class="form-select" id="f-recurring"><option value="">Select</option><option>Yes</option><option>No</option></select>`)}
    </div>
    <div class="form-row">
      ${fg('Price per Customer','<input class="form-input" id="f-bizPrice" placeholder="e.g. $500/mo">')}
      ${fg('Gross Margin',`<select class="form-select" id="f-grossMargin"><option value="">Select</option><option>High</option><option>Medium</option><option>Low</option></select>`)}
    </div>
    <div class="form-row">
      ${fg('Main Costs','<input class="form-input" id="f-bizCosts" placeholder="Cloud, dev, support...">')}
      ${fg('LTV vs CAC','<input class="form-input" id="f-ltv" placeholder="e.g. LTV $50k vs CAC $5k">')}
    </div>
    ${fg('Distribution Channels', mkPills('ch',['Viral','Direct sales','Partnerships','SEO/Content','Marketplaces','Paid ads','Embedded','Other']))}
    ${fg('Distribution Plan','<textarea class="form-textarea" id="f-channelExplain" placeholder="How will you reach your first 1000 customers?"></textarea>')}
  `));
  form.appendChild(makePhase(5, `
    ${fg('1. Engineering — 10x better?','<textarea class="form-textarea" id="f-q1" placeholder="How are you 10x better than alternatives?"></textarea>')}
    ${fg('2. Timing — Why now?','<textarea class="form-textarea" id="f-q2" placeholder="What recent changes make this the right moment?"></textarea>')}
    ${fg('3. Monopoly — Can you own a niche?','<textarea class="form-textarea" id="f-q3" placeholder="Which specific niche can you dominate first?"></textarea>')}
    ${fg('4. People — Right team?','<textarea class="form-textarea" id="f-q4" placeholder="Why are you the right team to build this?"></textarea>')}
    ${fg('5. Distribution — Clear path?','<textarea class="form-textarea" id="f-q5" placeholder="How will you acquire customers at scale?"></textarea>')}
    ${fg('6. Durability — 10-20 year horizon?','<textarea class="form-textarea" id="f-q6" placeholder="What makes this valuable long-term?"></textarea>')}
    ${fg('7. Secret — Unique insight?','<textarea class="form-textarea" id="f-q7" placeholder="What do you know that most people don\'t?"></textarea>')}
    ${fg('Overall 7-Filter Rating',`<div class="rating-row">
      <button type="button" class="rating-btn rb-strong" onclick="selectRating(this,'Strong')">✓ Strong</button>
      <button type="button" class="rating-btn rb-medium" onclick="selectRating(this,'Medium')">~ Medium</button>
      <button type="button" class="rating-btn rb-weak" onclick="selectRating(this,'Weak')">✕ Weak</button>
    </div>`)}
  `));
  form.appendChild(makePhase(6, `
    ${fg('Moats — Check all that apply', mkPills('moat',['Proprietary tech','Data advantage','Network effects','Switching costs','Brand','Scale economies','Regulatory position'],'purple'))}
    ${fg('Strongest Moat Explained','<textarea class="form-textarea" id="f-moatExplain" placeholder="Describe your most durable competitive advantage..."></textarea>')}
    ${fg('Top 5 Failure Risks', mkRisks())}
    ${fg('Risks Controllable?',`<select class="form-select" id="f-risksControl"><option value="">Select</option><option>Mostly</option><option>Some</option><option>Hardly</option></select>`)}
    <div class="form-row">
      ${fg('Massive if it works?',`<select class="form-select" id="f-asymmetricWork"><option value="">Select</option><option>Yes</option><option>No</option></select>`)}
      ${fg('Limited downside if fails?',`<select class="form-select" id="f-asymmetricFail"><option value="">Select</option><option>Yes</option><option>No</option></select>`)}
    </div>
    ${fg('Asymmetric Explanation','<textarea class="form-textarea" id="f-asymmetricExplain" placeholder="Why is this an asymmetric bet?"></textarea>')}
  `));
  form.appendChild(makePhase(7, `
    ${fg('Key Assumptions', mkPills('asmp',['Problem is real','Users care enough','Willingness to pay','Solution gets used','Channel works']))}
    ${fg('Top 3 Assumptions to Test', mkAsmpList())}
    ${fg('Validation Methods', mkPills('exp',['Customer interviews','Landing page','Demo/prototype','Concierge MVP','A/B test']))}
    ${fg('Experiment Plan','<textarea class="form-textarea" id="f-experimentDesc" placeholder="What experiments will you run in the next 30 days?"></textarea>')}
    ${fg('Evidence Collected','<textarea class="form-textarea" id="f-evidence2" placeholder="Learnings from validation so far..."></textarea>')}
    <hr style="border:none;border-top:1px solid var(--border);margin:22px 0">
    <div style="font-family:var(--font-d);font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px">📄 One-Page Thesis</div>
    <div class="thesis-grid">
      ${['summaryInsight:Insight','summaryProblem:Problem','summarySolution:Solution (10x)','summaryUser:Target User',
        'summaryMarket:Market Path','summaryBiz:Business Model','summaryDist:Distribution','summaryMoat:Moat',
        'summaryWhy:Why Now','summaryVision:10-Year Vision']
        .map(s => { const [id,lbl]=s.split(':');
          return `<div class="thesis-cell"><div class="thesis-cell-lbl">${lbl}</div><input class="form-input" id="f-${id}" placeholder="${lbl}..." style="background:transparent;border:none;padding:4px 0;font-size:12px;"></div>`;
        }).join('')}
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:22px 0">
    <div style="font-family:var(--font-d);font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px">🎯 Final Commitment</div>
    ${fg('Conviction Score (1–10)', `<div class="conviction-wrap">
      <div class="conviction-big-num" id="convDisplay">7</div>
      <div class="conviction-right">
        <input type="range" class="score-slider" id="f-conviction" min="1" max="10" value="7"
          oninput="document.getElementById('convDisplay').textContent=this.value">
        <div class="conviction-desc">How confident are you this is worth pursuing?</div>
      </div>
    </div>`)}
    ${fg('Final Decision',`<div class="decision-row">
      <button type="button" class="dec-btn db-commit" onclick="selectDecision(this,'Commit fully')">✓ Commit Fully</button>
      <button type="button" class="dec-btn db-explore" onclick="selectDecision(this,'Keep exploring')">~ Keep Exploring</button>
      <button type="button" class="dec-btn db-discard" onclick="selectDecision(this,'Discard')">✕ Discard</button>
    </div>`)}
    ${fg('Final Notes','<textarea class="form-textarea" id="f-finalNotes" placeholder="Any final thoughts or commitments..."></textarea>')}
    <button type="button" class="btn-save" onclick="saveIdea()">💾 Save Idea to Portfolio</button>
  `));

  attachFormListeners();
  updatePhaseUI();
}

function makePhase(idx, html) {
  const p = PHASES[idx];
  const div = document.createElement('div');
  div.className = 'form-phase' + (idx===0?' active':'');
  div.dataset.phase = idx;
  div.innerHTML = `<div class="phase-block">
    <div class="phase-block-hd">
      <div class="phase-num-badge">${p.n}</div>
      <div>
        <div class="phase-block-title">Phase ${p.n} — ${p.title}</div>
        <div class="phase-block-goal">${p.goal}</div>
      </div>
    </div>${html}</div>`;
  return div;
}
function fg(label, input, hint='') {
  return `<div class="form-group"><label class="form-label">${label}</label>${input}${hint?`<div class="form-hint">${hint}</div>`:''}</div>`;
}
function mkDomains() {
  return `<div class="pill-group">${DOMAINS.map(d=>`<label><input type="checkbox" class="pill-cb" name="domain" value="${d}"><span class="pill-label">${d}</span></label>`).join('')}</div>`;
}
function mkFrictions() {
  return [1,2,3,4].map(n=>`<input class="form-input" id="f-friction${n}" placeholder="Friction #${n}" style="margin-bottom:8px">`).join('');
}
function mkScoreSliders() {
  const items = [{k:'pain',l:'Pain (severity & frequency)'},{k:'urgency',l:'Urgency (need it now)'},{k:'budget',l:'Budget (ability to pay)'},{k:'alternatives',l:'Poor current alternatives'},{k:'awareness',l:'User awareness of problem'}];
  return `<div class="score-grid">${items.map(({k,l})=>`
    <div class="score-row">
      <span class="srl">${l}</span>
      <input type="range" class="score-slider" id="f-score-${k}" min="1" max="5" value="3"
        oninput="updateScoreVal('${k}',this.value)">
      <span class="sv" id="sv-${k}">3</span>
    </div>`).join('')}
    <div class="score-total-bar">
      <span class="stl">TOTAL SCORE (out of 25)</span>
      <span class="stv" id="scoreTotalDisp">15</span>
    </div>
  </div>`;
}
function updateScoreVal(k, v) {
  document.getElementById('sv-'+k).textContent = v;
  let t=0; ['pain','urgency','budget','alternatives','awareness'].forEach(x=>{ t+=parseInt(document.getElementById('f-score-'+x)?.value||3); });
  document.getElementById('scoreTotalDisp').textContent = t;
  document.getElementById('fsnScoreVal').textContent = t+'/25';
}
function mkPills(name, opts, variant='') {
  return `<div class="pill-group">${opts.map(o=>`<label><input type="checkbox" class="pill-cb ${variant}" name="${name}" value="${o}"><span class="pill-label">${o}</span></label>`).join('')}</div>`;
}
function mkRisks() { return [1,2,3,4,5].map(n=>`<input class="form-input" id="f-risk${n}" placeholder="Risk #${n}" style="margin-bottom:8px">`).join(''); }
function mkAsmpList() { return [1,2,3].map(n=>`<input class="form-input" id="f-asmp${n}" placeholder="Assumption #${n}" style="margin-bottom:8px">`).join(''); }

// ===================== PHASE NAV =====================
function changePhase(dir) {
  captureFormData();
  const np = currentPhase + dir;
  if (np<0||np>=PHASES.length) return;
  goToPhase(np);
}
function goToPhase(idx) {
  captureFormData();
  currentPhase = idx;
  document.querySelectorAll('.form-phase').forEach(p=>p.classList.remove('active'));
  document.querySelector(`.form-phase[data-phase="${idx}"]`)?.classList.add('active');
  updatePhaseUI();
  document.querySelector('.form-main')?.scrollTo({top:0,behavior:'smooth'});
}
function updatePhaseUI() {
  const total = PHASES.length;
  document.getElementById('formProgressFill').style.width = ((currentPhase+1)/total*100)+'%';
  document.getElementById('formPhaseLabel').textContent = `Phase ${currentPhase+1} of ${total}`;
  document.getElementById('btnPrev').style.visibility = currentPhase===0?'hidden':'visible';
  const nextBtn = document.getElementById('btnNext');
  nextBtn.textContent = currentPhase===total-1 ? 'Save ✓' : 'Next →';
  nextBtn.onclick = currentPhase===total-1 ? ()=>{captureFormData();saveIdea();} : ()=>changePhase(1);
  document.querySelectorAll('.fsn-item').forEach((el,i) => {
    el.classList.toggle('active',i===currentPhase);
    el.classList.toggle('done',i<currentPhase);
  });
  document.querySelectorAll('.pdot').forEach((d,i) => {
    d.classList.toggle('active',i===currentPhase);
    d.classList.toggle('done',i<currentPhase);
  });
}
function attachFormListeners() {
  document.querySelectorAll('#ideaForm .form-input, #ideaForm .form-textarea, #ideaForm .form-select').forEach(el => {
    el.addEventListener('input', captureFormData);
    el.addEventListener('change', captureFormData);
  });
  document.querySelectorAll('#ideaForm input[type=checkbox]').forEach(el => el.addEventListener('change', captureFormData));
}
function selectRating(btn, val) {
  document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  formData.overallFilter = val;
}
function selectDecision(btn, val) {
  document.querySelectorAll('.dec-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  formData.finalDecision = val;
}

// ===================== CAPTURE FORM DATA =====================
function captureFormData() {
  const g = id => document.getElementById(id)?.value||'';
  const cb = name => [...document.querySelectorAll(`#ideaForm input[name="${name}"]:checked`)].map(e=>e.value);
  formData.name = g('f-name'); formData.date = g('f-date');
  formData.domains = cb('domain');
  formData.tags = g('f-tags').split(',').map(t=>t.trim()).filter(Boolean);
  formData.valueChain = g('f-valueChain');
  formData.frictions = [1,2,3,4].map(n=>g('f-friction'+n));
  formData.commonBelief = g('f-commonBelief'); formData.contrarian = g('f-contrarian');
  formData.contrarian2 = g('f-contrarian2'); formData.evidence = g('f-evidence');
  formData.insight = g('f-insight');
  formData.problemUser = g('f-problemUser'); formData.problemBecause = g('f-problemBecause');
  formData.problemDef = g('f-problemDef');
  formData.scores = { pain:+g('f-score-pain')||3, urgency:+g('f-score-urgency')||3, budget:+g('f-score-budget')||3, alternatives:+g('f-score-alternatives')||3, awareness:+g('f-score-awareness')||3 };
  formData.targetRole = g('f-targetRole'); formData.targetContext = g('f-targetContext');
  formData.dimensions = cb('dim'); formData.solution = g('f-solution');
  formData.solutionHelp = g('f-solutionHelp'); formData.solutionAchieve = g('f-solutionAchieve');
  formData.solutionBy = g('f-solutionBy'); formData.solutionUnlike = g('f-solutionUnlike');
  formData.technologies = g('f-technologies'); formData.mvp = g('f-mvp');
  formData.beachheadWho = g('f-beachheadWho'); formData.beachheadUseCase = g('f-beachheadUseCase');
  formData.beachheadWin = g('f-beachheadWin');
  formData.marketPath = [g('f-mpath1'),g('f-mpath2'),g('f-mpath3')];
  formData.bizWho = g('f-bizWho'); formData.bizWhat = g('f-bizWhat');
  formData.bizPricing = g('f-bizPricing'); formData.recurring = g('f-recurring');
  formData.bizPrice = g('f-bizPrice'); formData.bizCosts = g('f-bizCosts');
  formData.grossMargin = g('f-grossMargin'); formData.ltv = g('f-ltv');
  formData.channels = cb('ch'); formData.channelExplain = g('f-channelExplain');
  ['q1','q2','q3','q4','q5','q6','q7'].forEach(q => formData[q] = g('f-'+q));
  formData.moats = cb('moat'); formData.moatExplain = g('f-moatExplain');
  formData.risks = [1,2,3,4,5].map(n=>g('f-risk'+n));
  formData.risksControl = g('f-risksControl'); formData.asymmetricWork = g('f-asymmetricWork');
  formData.asymmetricFail = g('f-asymmetricFail'); formData.asymmetricExplain = g('f-asymmetricExplain');
  formData.assumptions = cb('asmp');
  formData.assumptionList = [1,2,3].map(n=>g('f-asmp'+n));
  formData.experiments = cb('exp'); formData.experimentDesc = g('f-experimentDesc');
  formData.evidence2 = g('f-evidence2');
  ['summaryInsight','summaryProblem','summarySolution','summaryUser','summaryMarket',
   'summaryBiz','summaryDist','summaryMoat','summaryWhy','summaryVision'].forEach(k => formData[k]=g('f-'+k));
  formData.conviction = +g('f-conviction')||7;
  formData.finalNotes = g('f-finalNotes');
}
function populateForm(d) {
  const s = (id, v) => { const el=document.getElementById(id); if(el) el.value=v||''; };
  const sc = (name, vals) => document.querySelectorAll(`#ideaForm input[name="${name}"]`).forEach(cb => cb.checked=(vals||[]).includes(cb.value));
  s('f-name',d.name); s('f-date',d.date);
  sc('domain',d.domains);
  s('f-tags',(d.tags||[]).join(', '));
  s('f-valueChain',d.valueChain);
  (d.frictions||[]).forEach((f,i)=>s('f-friction'+(i+1),f));
  s('f-commonBelief',d.commonBelief); s('f-contrarian',d.contrarian);
  s('f-contrarian2',d.contrarian2); s('f-evidence',d.evidence); s('f-insight',d.insight);
  s('f-problemUser',d.problemUser); s('f-problemBecause',d.problemBecause); s('f-problemDef',d.problemDef);
  if(d.scores) Object.entries(d.scores).forEach(([k,v])=>{ s('f-score-'+k,v); const el=document.getElementById('sv-'+k); if(el)el.textContent=v; });
  const t=Object.values(d.scores||{}).reduce((a,b)=>a+b,0);
  const el=document.getElementById('scoreTotalDisp'); if(el)el.textContent=t;
  const fsn=document.getElementById('fsnScoreVal'); if(fsn)fsn.textContent=t+'/25';
  s('f-targetRole',d.targetRole); s('f-targetContext',d.targetContext);
  sc('dim',d.dimensions); s('f-solution',d.solution);
  s('f-solutionHelp',d.solutionHelp); s('f-solutionAchieve',d.solutionAchieve);
  s('f-solutionBy',d.solutionBy); s('f-solutionUnlike',d.solutionUnlike);
  s('f-technologies',d.technologies); s('f-mvp',d.mvp);
  s('f-beachheadWho',d.beachheadWho); s('f-beachheadUseCase',d.beachheadUseCase);
  s('f-beachheadWin',d.beachheadWin);
  (d.marketPath||[]).forEach((p,i)=>s('f-mpath'+(i+1),p));
  ['bizWho','bizWhat','bizPricing','recurring','bizPrice','bizCosts','grossMargin','ltv'].forEach(k=>s('f-'+k,d[k]));
  sc('ch',d.channels); s('f-channelExplain',d.channelExplain);
  ['q1','q2','q3','q4','q5','q6','q7'].forEach(q=>s('f-'+q,d[q]));
  if(d.overallFilter){ const btn=document.querySelector(`.rb-${d.overallFilter.toLowerCase()}`); if(btn)btn.classList.add('active'); }
  sc('moat',d.moats); s('f-moatExplain',d.moatExplain);
  (d.risks||[]).forEach((r,i)=>s('f-risk'+(i+1),r));
  s('f-risksControl',d.risksControl); s('f-asymmetricWork',d.asymmetricWork);
  s('f-asymmetricFail',d.asymmetricFail); s('f-asymmetricExplain',d.asymmetricExplain);
  sc('asmp',d.assumptions);
  (d.assumptionList||[]).forEach((a,i)=>s('f-asmp'+(i+1),a));
  sc('exp',d.experiments); s('f-experimentDesc',d.experimentDesc); s('f-evidence2',d.evidence2);
  ['summaryInsight','summaryProblem','summarySolution','summaryUser','summaryMarket',
   'summaryBiz','summaryDist','summaryMoat','summaryWhy','summaryVision'].forEach(k=>s('f-'+k,d[k]));
  s('f-conviction',d.conviction||7);
  const cd=document.getElementById('convDisplay'); if(cd)cd.textContent=d.conviction||7;
  s('f-finalNotes',d.finalNotes);
  if(d.finalDecision){ const btn=document.querySelector(`.db-${d.finalDecision==='Commit fully'?'commit':d.finalDecision==='Keep exploring'?'explore':'discard'}`); if(btn)btn.classList.add('active'); }
}

// ===================== SAVE =====================
async function saveIdea() {
  captureFormData();
  if (!formData.name.trim()) { showToast('Please enter an idea name.', 'error'); return; }

  const ideaToSave = editingId ? { ...formData, id: editingId } : { ...formData };
  const savedId    = editingId || formData.id;

  if (editingId) {
    const idx = ideas.findIndex(i => i.id === editingId);
    if (idx !== -1) ideas[idx] = ideaToSave;
    else ideas.push(ideaToSave);
  } else {
    ideas.push(ideaToSave);
  }

  editingId = null;
  renderAll();
  showToast('Idea saved! ✓', 'success');
  viewIdea(savedId);

  // Write to Firestore in background
  await saveIdeaToDB(ideaToSave);
}

// ===================== VIEW IDEA (DETAIL) =====================
function viewIdea(id) {
  const idea = ideas.find(i=>i.id===id);
  if (!idea) return;
  currentIdeaId = id;
  document.getElementById('detailContent').innerHTML = buildDetailHTML(idea);
  switchView('detail', id);
  destroyCharts();
  setTimeout(() => {
    animateScoreBars();
    buildRadarChart(idea);
    buildScoreChart(idea);
    buildLBBars();
  }, 120);
}
function editIdea(id) {
  const idea = ideas.find(i=>i.id===id);
  if (!idea) return;
  editingId = id; formData = {...idea};
  document.getElementById('formTitle').textContent = 'Edit: '+(idea.name||'Untitled');
  buildForm(); goToPhase(0); populateForm(idea); switchView('new-idea');
}
function confirmDelete(id) {
  const idea = ideas.find(i => i.id === id);
  if (!idea) return;
  document.getElementById('confirmTitle').textContent = 'Delete Idea';
  document.getElementById('confirmBody').textContent  = `Are you sure you want to delete "${idea.name || 'this idea'}"? This cannot be undone.`;
  document.getElementById('confirmOverlay').style.display = 'flex';
  document.getElementById('confirmCancel').onclick = () => document.getElementById('confirmOverlay').style.display = 'none';
  document.getElementById('confirmOk').onclick = async () => {
    ideas = ideas.filter(i => i.id !== id);
    renderAll();
    document.getElementById('confirmOverlay').style.display = 'none';
    showToast('Idea deleted.', 'error');
    switchView('dashboard');
    await deleteIdeaFromDB(id);  // delete from Firestore
  };
}

// ===================== DETAIL HTML =====================
function buildDetailHTML(idea) {
  const s = totalScore(idea); const tc = tierClass(s);
  const decChip = idea.finalDecision ? `<span class="detail-decision-chip ${decCls(idea.finalDecision)}">${idea.finalDecision}</span>` : '';
  const filterBadge = idea.overallFilter ? `<span class="detail-domain-chip" style="color:${idea.overallFilter==='Strong'?'var(--success)':idea.overallFilter==='Medium'?'var(--warn)':'var(--danger)'}">Filter: ${idea.overallFilter}</span>` : '';
  const domChips = (idea.domains||[]).map(d=>`<span class="detail-domain-chip">${d}</span>`).join('');
  const tagChips = (idea.tags||[]).map(t=>`<span class="detail-domain-chip" style="color:var(--accent2)">#${t}</span>`).join('');

  return `
  <div class="detail-hero">
    <div class="detail-hero-top">
      <div>
        <div class="detail-idea-name">${idea.name||'Untitled Idea'}</div>
        <div class="detail-idea-date">Evaluated ${idea.date||'—'}</div>
      </div>
      <div class="detail-big-score">
        <div class="dbs-num ${tc}">${s}<span class="dbs-denom">/25</span></div>
        <div class="dbs-label">PROBLEM SCORE</div>
      </div>
    </div>
    <div class="detail-chips-row">${domChips}${tagChips}${filterBadge}${decChip}
      <span class="detail-domain-chip" style="color:var(--accent)">💡 Conviction: ${idea.conviction||'?'}/10</span>
    </div>
    <div class="thesis-summary-grid">
      ${[['Insight',idea.summaryInsight],['Problem',idea.summaryProblem],['Solution',idea.summarySolution],['Market Path',idea.summaryMarket],['Vision',idea.summaryVision]]
        .map(([l,v])=>`<div class="ts-cell"><div class="ts-label">${l}</div><div class="ts-val">${v||'—'}</div></div>`).join('')}
    </div>
  </div>

  <div class="detail-grid">
    <!-- Score bars -->
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">PHASE 3</span><span class="dc-title">Problem Score Analysis</span></div>
      ${Object.entries(idea.scores||{}).map(([k,v])=>`
        <div class="sb-row">
          <span class="sb-label">${{pain:'Pain',urgency:'Urgency',budget:'Budget',alternatives:'Poor Alternatives',awareness:'Awareness'}[k]||k}</span>
          <div class="sb-track"><div class="sb-fill" data-pct="${v/5*100}"></div></div>
          <span class="sb-num">${v}</span>
        </div>`).join('')}
      <div class="score-total-bar"><span class="stl">TOTAL</span><span class="stv ${tc}">${s} / 25</span></div>
    </div>
    <!-- Radar chart -->
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">RADAR</span><span class="dc-title">Strength Profile</span></div>
      <div class="chart-wrap"><canvas id="radarChart"></canvas></div>
    </div>
  </div>

  <div class="detail-grid">
    <!-- Phase 1 -->
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">PHASE 1</span><span class="dc-title">Reality Mapping</span></div>
      <div class="df"><div class="df-label">Value Chain / System</div><div class="df-val">${idea.valueChain||'—'}</div></div>
      <div class="df"><div class="df-label">Observed Frictions</div><div class="df-val">
        ${(idea.frictions||[]).filter(Boolean).map((f,i)=>`<div>• ${f}</div>`).join('')||'—'}
      </div></div>
    </div>
    <!-- Phase 2 -->
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">PHASE 2</span><span class="dc-title">Insight Discovery</span></div>
      <div class="df"><div class="df-label">Common Belief</div><div class="df-val">${idea.commonBelief||'—'}</div></div>
      <div class="df"><div class="df-label">Contrarian Insight</div>
        <div class="df-val" style="color:var(--accent2)">"It turns out that <em>${idea.contrarian||'...'}</em> because ${idea.contrarian2||'...'}"</div>
      </div>
      <div class="df"><div class="df-label">Core Insight</div><div class="df-val" style="font-style:italic">${idea.insight||'—'}</div></div>
    </div>
  </div>

  <div class="detail-grid">
    <!-- Phase 3 -->
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">PHASE 3</span><span class="dc-title">Problem Selection</span></div>
      <div class="df"><div class="df-label">Problem Statement</div>
        <div class="df-val"><strong>${idea.problemUser||'[User]'}</strong> struggles with <strong>${idea.problemBecause||'...'}</strong> because ${idea.problemDef||'...'}</div>
      </div>
      <div class="df"><div class="df-label">Target</div><div class="df-val"><strong>${idea.targetRole||'—'}</strong> — ${idea.targetContext||''}</div></div>
    </div>
    <!-- Phase 4 -->
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">PHASE 4</span><span class="dc-title">Solution Design</span></div>
      <div class="df"><div class="df-label">10x Dimensions</div>
        <div class="df-val">${(idea.dimensions||[]).map(d=>`<span style="background:var(--accent2-dim);color:var(--accent2);border:1px solid rgba(124,107,255,0.2);padding:2px 9px;border-radius:99px;font-size:10px;margin-right:4px">${d}</span>`).join('')||'—'}</div>
      </div>
      <div class="df"><div class="df-label">Solution</div><div class="df-val">${idea.solution||'—'}</div></div>
      <div class="df"><div class="df-label">Statement</div>
        <div class="df-val">"We help <strong>${idea.solutionHelp||'...'}</strong> achieve <strong>${idea.solutionAchieve||'...'}</strong> by <em>${idea.solutionBy||'...'}</em>, unlike ${idea.solutionUnlike||'...'}"</div>
      </div>
      <div class="df"><div class="df-label">Tech / MVP</div><div class="df-val">${idea.technologies||'—'} — MVP: ${idea.mvp||'?'}</div></div>
    </div>
  </div>

  <!-- Phase 5 Full -->
  <div class="detail-card full" style="margin-bottom:16px">
    <div class="dc-header"><span class="dc-badge">PHASE 5</span><span class="dc-title">Market & Business Validation</span></div>
    <div class="biz-3col">
      <div>
        <div class="df"><div class="df-label">Beachhead</div>
          <div class="df-val"><strong>${idea.beachheadWho||'—'}</strong><br>${idea.beachheadUseCase||''}<br><span style="color:var(--accent);font-size:11px">${idea.beachheadWin||''}</span></div>
        </div>
        <div class="df"><div class="df-label">Market Path</div>
          <div class="df-val">${(idea.marketPath||[]).filter(Boolean).map((p,i)=>`${i+1}. ${p}`).join('<br>')||'—'}</div>
        </div>
      </div>
      <div>
        <div class="df"><div class="df-label">Business Model</div>
          <div class="df-val"><strong>Who:</strong> ${idea.bizWho||'—'}<br><strong>What:</strong> ${idea.bizWhat||'—'}<br><strong>Pricing:</strong> ${idea.bizPricing||'—'}<br><strong>Recurring:</strong> ${idea.recurring||'?'}</div>
        </div>
      </div>
      <div>
        <div class="df"><div class="df-label">Unit Economics</div>
          <div class="df-val"><strong>Price:</strong> ${idea.bizPrice||'—'}<br><strong>Costs:</strong> ${idea.bizCosts||'—'}<br><strong>Margin:</strong> <span style="color:var(--accent)">${idea.grossMargin||'?'}</span><br><strong>LTV/CAC:</strong> ${idea.ltv||'—'}</div>
        </div>
        <div class="df"><div class="df-label">Channels</div>
          <div class="df-val">${(idea.channels||[]).map(c=>`<span style="font-size:10px;padding:2px 8px;background:var(--bg3);border-radius:99px;margin-right:4px">${c}</span>`).join('')||'—'}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Phase 6 & 7 -->
  <div class="detail-grid">
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">PHASE 6</span>
        <span class="dc-title">7-Question Filter
          ${idea.overallFilter?`<span style="margin-left:10px;font-size:12px;color:${idea.overallFilter==='Strong'?'var(--success)':idea.overallFilter==='Medium'?'var(--warn)':'var(--danger)'}">${idea.overallFilter}</span>`:''}
        </span>
      </div>
      <div class="q7-grid">
        ${[['Engineering',idea.q1],['Timing',idea.q2],['Monopoly',idea.q3],['People',idea.q4],['Distribution',idea.q5],['Durability',idea.q6],['Secret',idea.q7]]
          .map(([l,v])=>`<div class="q7-item"><div class="q7-label">${l}</div><div class="q7-val">${v||'—'}</div></div>`).join('')}
      </div>
    </div>
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">PHASE 7</span><span class="dc-title">Moat & Risk</span></div>
      <div class="df"><div class="df-label">Moats</div>
        <div class="df-val">${(idea.moats||[]).map(m=>`<span style="background:var(--accent-dim);color:var(--accent);border:1px solid rgba(0,245,200,0.2);padding:2px 9px;border-radius:99px;font-size:10px;margin-right:4px">${m}</span>`).join('')||'—'}</div>
      </div>
      <div class="df"><div class="df-label">Moat Explanation</div><div class="df-val">${idea.moatExplain||'—'}</div></div>
      <div class="df"><div class="df-label">Top Risks</div>
        <div class="df-val">${(idea.risks||[]).filter(Boolean).map((r,i)=>`<div>${i+1}. ${r}</div>`).join('')||'—'}</div>
      </div>
      <div class="df"><div class="df-label">Asymmetric</div>
        <div class="df-val">Massive upside: <strong>${idea.asymmetricWork||'?'}</strong> · Limited downside: <strong>${idea.asymmetricFail||'?'}</strong></div>
      </div>
      <!-- Score trend mini chart -->
      <div style="margin-top:16px">
        <div class="df-label">Score Distribution</div>
        <div class="chart-wrap" style="height:120px"><canvas id="scoreBarChart"></canvas></div>
      </div>
    </div>
  </div>

  <!-- Phase 8 -->
  <div class="detail-card full" style="margin-bottom:16px;background:linear-gradient(135deg,rgba(0,245,200,0.04),rgba(124,107,255,0.04));border-color:rgba(0,245,200,0.12)">
    <div class="dc-header"><span class="dc-badge">FINAL</span><span class="dc-title">Commitment & Thesis</span></div>
    <div class="commitment-2col">
      <div>
        <div style="text-align:center;padding:20px 0">
          <div class="conviction-hero-num ${tc}">
            ${idea.conviction||'?'}<span class="conviction-hero-denom">/10</span>
          </div>
          <div style="font-size:11px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin-top:6px">CONVICTION</div>
          <div style="margin-top:20px">${buildDecisionBadge(idea.finalDecision)}</div>
          ${idea.finalNotes?`<div style="margin-top:16px;font-size:12px;color:var(--text2);font-style:italic;line-height:1.7">"${idea.finalNotes}"</div>`:''}
        </div>
      </div>
      <div>
        <div style="font-size:10px;letter-spacing:1px;color:var(--text3);margin-bottom:12px;text-transform:uppercase">One-Page Thesis</div>
        <div class="thesis-grid">
          ${[['Insight',idea.summaryInsight],['Problem',idea.summaryProblem],['Solution',idea.summarySolution],['User',idea.summaryUser],
            ['Market',idea.summaryMarket],['Biz Model',idea.summaryBiz],['Distribution',idea.summaryDist],['Moat',idea.summaryMoat],
            ['Why Now',idea.summaryWhy],['Vision',idea.summaryVision]]
            .map(([l,v])=>`<div class="thesis-cell"><div class="thesis-cell-lbl">${l}</div><div class="thesis-cell-val">${v||'—'}</div></div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}
function buildDecisionBadge(d) {
  if(!d) return '<span style="color:var(--text3);font-size:12px">No decision yet</span>';
  const s = {
    'Commit fully':'background:var(--success-dim);color:var(--success);border-color:rgba(61,255,160,0.3)',
    'Keep exploring':'background:var(--warn-dim);color:var(--warn);border-color:rgba(255,185,64,0.3)',
    'Discard':'background:var(--danger-dim);color:var(--danger);border-color:rgba(255,77,106,0.3)'
  }[d]||'background:var(--bg3);color:var(--text2)';
  return `<span style="display:inline-block;padding:8px 24px;border-radius:99px;border:1px solid;font-size:14px;font-weight:600;font-family:var(--font-d);${s}">${d}</span>`;
}

// ===================== CHARTS =====================
function destroyCharts() {
  Object.values(charts).forEach(c => { try{c.destroy()}catch(e){} });
  charts = {};
}
function getChartColors() {
  const isDark = document.documentElement.dataset.theme !== 'light';
  return { grid: isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.08)', text: isDark?'#9896aa':'#6a6880', accent:'#00f5c8', accent2:'#7c6bff' };
}
function animateScoreBars() {
  document.querySelectorAll('.sb-fill[data-pct]').forEach(el => { el.style.width = el.dataset.pct+'%'; });
}
function buildRadarChart(idea) {
  const el = document.getElementById('radarChart'); if(!el) return;
  const c = getChartColors();
  charts.radar = new Chart(el, {
    type:'radar',
    data:{
      labels:['Pain','Urgency','Budget','Alternatives','Awareness'],
      datasets:[{
        data:Object.values(idea.scores||{pain:3,urgency:3,budget:3,alternatives:3,awareness:3}),
        backgroundColor:'rgba(0,245,200,0.12)',
        borderColor:'rgba(0,245,200,0.8)',borderWidth:2,
        pointBackgroundColor:'#00f5c8',pointRadius:4,
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,animation:{duration:1000},
      scales:{r:{min:0,max:5,ticks:{stepSize:1,display:false},grid:{color:c.grid},angleLines:{color:c.grid},pointLabels:{color:c.text,font:{size:10,family:'DM Mono'}}}},
      plugins:{legend:{display:false}}
    }
  });
}
function buildScoreChart(idea) {
  const el = document.getElementById('scoreBarChart'); if(!el) return;
  const c = getChartColors();
  const s = idea.scores||{};
  charts.scoreBar = new Chart(el, {
    type:'bar',
    data:{
      labels:['Pain','Urgency','Budget','Alt.','Aware.'],
      datasets:[{
        data:Object.values(s),
        backgroundColor:['rgba(0,245,200,0.6)','rgba(124,107,255,0.6)','rgba(255,107,157,0.6)','rgba(255,185,64,0.6)','rgba(61,255,160,0.6)'],
        borderRadius:4,borderWidth:0,
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,animation:{duration:900},
      scales:{
        y:{min:0,max:5,grid:{color:c.grid},ticks:{color:c.text,font:{size:9}}},
        x:{grid:{display:false},ticks:{color:c.text,font:{size:9}}}
      },
      plugins:{legend:{display:false}}
    }
  });
}
function reinitCharts() {
  if(currentIdeaId) viewIdea(currentIdeaId);
  if(document.getElementById('view-analytics').classList.contains('active')) renderAnalyticsCharts();
}

// ===================== LEADERBOARD =====================
function renderLeaderboard() {
  const sorted = [...ideas].sort((a,b)=>totalScore(b)-totalScore(a)||(b.conviction||0)-(a.conviction||0));
  const medals = ['🥇','🥈','🥉'];
  const content = document.getElementById('leaderboardContent');
  if(!ideas.length){content.innerHTML='<div style="color:var(--text3);padding:40px;text-align:center">No ideas to rank yet.</div>';return;}
  const max = totalScore(sorted[0])||1;
  content.innerHTML = `<div class="lb-table-wrap"><table class="lb-table">
    <thead><tr><th>#</th><th>Idea</th><th class="lb-col-hide">Domain</th><th class="lb-col-hide">Problem Score</th><th>Conviction</th><th>Decision</th></tr></thead>
    <tbody>${sorted.map((idea,i)=>{
      const s=totalScore(idea); const tc=tierClass(s);
      const pct=s/max*100;
      return `<tr>
        <td><div class="lb-rank rank-${i+1}">${medals[i]||i+1}</div></td>
        <td><div class="lb-name" onclick="viewIdea('${idea.id}')">${idea.name||'Untitled'}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:3px">${idea.date||''}</div></td>
        <td class="lb-col-hide">${(idea.domains||[]).join(', ')||'—'}</td>
        <td class="lb-col-hide">
          <div style="display:flex;align-items:center;gap:8px">
            <div class="lb-bar-wrap" style="flex:1;min-width:60px"><div class="lb-bar" data-pct="${pct}"></div></div>
            <span class="lb-score-big ${tc}">${s}</span>
          </div>
        </td>
        <td><span style="font-family:var(--font-d);font-size:18px;font-weight:800;color:var(--accent)">${idea.conviction||'—'}</span><span style="color:var(--text3);font-size:11px">/10</span></td>
        <td>${buildDecisionBadge(idea.finalDecision)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
  setTimeout(() => {
    document.querySelectorAll('.lb-bar[data-pct]').forEach(el=>{el.style.width=el.dataset.pct+'%';});
  }, 100);
}
function buildLBBars() {
  document.querySelectorAll('.lb-bar[data-pct]').forEach(el=>{el.style.width=el.dataset.pct+'%';});
}

// ===================== COMPARE =====================
function updateCompareSelects() {
  ['compareA','compareB'].forEach(id => {
    const sel = document.getElementById(id); if(!sel)return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Select —</option>' + ideas.map(i=>`<option value="${i.id}">${i.name||'Untitled'}</option>`).join('');
    if(prev) sel.value = prev;
  });
}
function renderCompare() {
  const aId = document.getElementById('compareA').value;
  const bId = document.getElementById('compareB').value;
  const box = document.getElementById('compareContent');
  if(!aId||!bId){box.innerHTML='';return;}
  if(aId===bId){box.innerHTML='<div style="color:var(--text3);font-size:13px;padding:20px 0">Please select two different ideas.</div>';return;}
  const a=ideas.find(i=>i.id===aId), b=ideas.find(i=>i.id===bId);
  if(!a||!b)return;
  const sa=totalScore(a), sb=totalScore(b);
  const winner = sa>sb?a:sb>sa?b:null;

  const rows = [
    ['Problem Score', sa+'/25', sb+'/25', true, sa, sb],
    ['Conviction', (a.conviction||'?')+'/10', (b.conviction||'?')+'/10', true, a.conviction, b.conviction],
    ['Domain', (a.domains||[]).join(', ')||'—', (b.domains||[]).join(', ')||'—'],
    ['Filter Rating', a.overallFilter||'—', b.overallFilter||'—'],
    ['Final Decision', a.finalDecision||'—', b.finalDecision||'—'],
    ['Target User', a.targetRole||'—', b.targetRole||'—'],
    ['Beachhead', a.beachheadWho||'—', b.beachheadWho||'—'],
    ['Business Model', a.bizPricing||'—', b.bizPricing||'—'],
    ['Gross Margin', a.grossMargin||'—', b.grossMargin||'—'],
    ['Moats', (a.moats||[]).join(', ')||'—', (b.moats||[]).join(', ')||'—'],
    ['MVP Feasible', a.mvp||'—', b.mvp||'—'],
    ['Tags', (a.tags||[]).join(', ')||'—', (b.tags||[]).join(', ')||'—'],
  ];

  box.innerHTML = `
  ${winner?`<div class="compare-winner-banner">
    <div><div class="cwb-label">Overall Winner</div><div class="cwb-winner">${winner.name} ✓</div></div>
    <div class="cwb-margin">Leads by ${Math.abs(sa-sb)} problem score points</div>
  </div>`:`<div class="compare-winner-banner"><div class="cwb-winner" style="color:var(--text2)">🤝 It's a tie!</div></div>`}
  <div class="compare-grid">
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">IDEA A</span><span class="dc-title">${a.name||'Idea A'}</span></div>
      ${buildScoreBarsHTML(a)}
    </div>
    <div class="detail-card">
      <div class="dc-header"><span class="dc-badge">IDEA B</span><span class="dc-title">${b.name||'Idea B'}</span></div>
      ${buildScoreBarsHTML(b)}
    </div>
  </div>
  <div class="compare-table-wrap">
    <table class="compare-table">
      <thead><tr><th>Criteria</th><th>${a.name||'Idea A'}</th><th>${b.name||'Idea B'}</th></tr></thead>
      <tbody>${rows.map(row=>{
        const [lbl,av,bv,hasScore,ra,rb]=row;
        let ac='',bc='';
        if(hasScore){ const na=parseFloat(ra||0),nb=parseFloat(rb||0); if(na>nb)ac='c-winner'; else if(nb>na)bc='c-winner'; }
        return `<tr><td>${lbl}</td><td class="${ac}">${av}</td><td class="${bc}">${bv}</td></tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
  setTimeout(animateScoreBars, 100);
}
function buildScoreBarsHTML(idea) {
  const s = totalScore(idea); const tc = tierClass(s);
  return Object.entries(idea.scores||{}).map(([k,v])=>`
    <div class="sb-row">
      <span class="sb-label">${{pain:'Pain',urgency:'Urgency',budget:'Budget',alternatives:'Alternatives',awareness:'Awareness'}[k]||k}</span>
      <div class="sb-track"><div class="sb-fill" data-pct="${v/5*100}"></div></div>
      <span class="sb-num">${v}</span>
    </div>`).join('')+`<div class="score-total-bar"><span class="stl">TOTAL</span><span class="stv ${tc}">${s}/25</span></div>`;
}

// ===================== ANALYTICS =====================
function renderAnalytics() {
  const grid = document.getElementById('analyticsGrid');
  if(!ideas.length){grid.innerHTML='<div style="color:var(--text3);padding:40px;text-align:center;grid-column:1/-1">Add some ideas to see analytics.</div>';return;}
  const decisions = {'Commit fully':0,'Keep exploring':0,'Discard':0,'Undecided':0};
  ideas.forEach(i=>{ decisions[i.finalDecision||'Undecided']=(decisions[i.finalDecision||'Undecided']||0)+1; });
  const domains = {};
  ideas.forEach(i=>(i.domains||[]).forEach(d=>{ domains[d]=(domains[d]||0)+1; }));
  grid.innerHTML = `
    <div class="analytics-card"><div class="ac-title">Score Distribution</div><div class="ac-sub">Ideas by problem score</div><div class="chart-wrap"><canvas id="chartScoreDist"></canvas></div></div>
    <div class="analytics-card"><div class="ac-title">Decision Breakdown</div><div class="ac-sub">Portfolio commitment status</div><div class="chart-wrap"><canvas id="chartDecisions"></canvas></div></div>
    <div class="analytics-card"><div class="ac-title">Top Domains</div><div class="ac-sub">Ideas per domain</div><div class="chart-wrap"><canvas id="chartDomains"></canvas></div></div>
    <div class="analytics-card"><div class="ac-title">Conviction Distribution</div><div class="ac-sub">Founder confidence levels</div><div class="chart-wrap"><canvas id="chartConviction"></canvas></div></div>
    <div class="analytics-card full"><div class="ac-title">Idea Portfolio Overview</div><div class="ac-sub">Score vs Conviction bubble map</div><div class="chart-wrap" style="height:280px"><canvas id="chartBubble"></canvas></div></div>
  `;
}
function renderAnalyticsCharts() {
  if(!ideas.length) return;
  const c = getChartColors();
  destroyAnalyticsCharts();

  // Score dist
  const bins = [0,0,0,0,0]; // 1-5, 6-10, 11-15, 16-20, 21-25
  ideas.forEach(i=>{ const s=totalScore(i); const b=Math.min(4,Math.floor(s/5)); bins[b]++; });
  if(document.getElementById('chartScoreDist')) charts.scoreDist = new Chart(document.getElementById('chartScoreDist'),{
    type:'bar',
    data:{labels:['1-5','6-10','11-15','16-20','21-25'],datasets:[{data:bins,backgroundColor:['rgba(255,77,106,0.7)','rgba(255,185,64,0.7)','rgba(255,185,64,0.7)','rgba(0,245,200,0.7)','rgba(61,255,160,0.7)'],borderRadius:6,borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:c.grid},ticks:{color:c.text,font:{size:9}}},x:{grid:{display:false},ticks:{color:c.text,font:{size:9}}}}}
  });
  // Decision donut
  if(document.getElementById('chartDecisions')) charts.decisions = new Chart(document.getElementById('chartDecisions'),{
    type:'doughnut',
    data:{labels:['Commit','Explore','Discard','Undecided'],datasets:[{data:[
      ideas.filter(i=>i.finalDecision==='Commit fully').length,
      ideas.filter(i=>i.finalDecision==='Keep exploring').length,
      ideas.filter(i=>i.finalDecision==='Discard').length,
      ideas.filter(i=>!i.finalDecision).length,
    ],backgroundColor:['rgba(61,255,160,0.8)','rgba(255,185,64,0.8)','rgba(255,77,106,0.8)','rgba(100,100,120,0.8)'],borderWidth:0,hoverOffset:8}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{position:'bottom',labels:{color:c.text,font:{size:10},padding:10}}}}
  });
  // Domains
  const doms = {}; ideas.forEach(i=>(i.domains||[]).forEach(d=>{doms[d]=(doms[d]||0)+1;}));
  const domKeys=Object.keys(doms).sort((a,b)=>doms[b]-doms[a]).slice(0,8);
  if(document.getElementById('chartDomains')) charts.domains = new Chart(document.getElementById('chartDomains'),{
    type:'bar',
    data:{labels:domKeys,datasets:[{data:domKeys.map(k=>doms[k]),backgroundColor:'rgba(124,107,255,0.7)',borderRadius:6,borderWidth:0}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:c.grid},ticks:{color:c.text,font:{size:9}}},y:{grid:{display:false},ticks:{color:c.text,font:{size:9}}}}}
  });
  // Conviction
  const convBins = Array(10).fill(0);
  ideas.forEach(i=>{ if(i.conviction) convBins[i.conviction-1]++; });
  if(document.getElementById('chartConviction')) charts.conviction = new Chart(document.getElementById('chartConviction'),{
    type:'line',
    data:{labels:['1','2','3','4','5','6','7','8','9','10'],datasets:[{data:convBins,borderColor:'rgba(255,107,157,0.9)',backgroundColor:'rgba(255,107,157,0.1)',tension:0.4,fill:true,pointBackgroundColor:'rgba(255,107,157,1)',pointRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:c.grid},ticks:{color:c.text,font:{size:9}}},x:{grid:{display:false},ticks:{color:c.text,font:{size:9}}}}}
  });
  // Bubble
  const colours = ['rgba(0,245,200,0.7)','rgba(124,107,255,0.7)','rgba(255,107,157,0.7)','rgba(255,185,64,0.7)','rgba(61,255,160,0.7)'];
  if(document.getElementById('chartBubble')) charts.bubble = new Chart(document.getElementById('chartBubble'),{
    type:'bubble',
    data:{datasets:ideas.map((idea,i)=>({
      label:idea.name||'Untitled',
      data:[{x:totalScore(idea),y:idea.conviction||5,r:Math.max(6,(idea.conviction||5)*2)}],
      backgroundColor:colours[i%colours.length],
    }))},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'bottom',labels:{color:c.text,font:{size:10},padding:10}}},
      scales:{
        x:{title:{display:true,text:'Problem Score',color:c.text,font:{size:10}},min:0,max:25,grid:{color:c.grid},ticks:{color:c.text,font:{size:9}}},
        y:{title:{display:true,text:'Conviction',color:c.text,font:{size:10}},min:0,max:10,grid:{color:c.grid},ticks:{color:c.text,font:{size:9}}}
      }
    }
  });
}
function destroyAnalyticsCharts() {
  ['scoreDist','decisions','domains','conviction','bubble'].forEach(k=>{ try{charts[k]?.destroy();delete charts[k];}catch(e){} });
}

// ===================== AI ANALYSIS =====================
// Gemini 2.0 Flash Lite — highest free quota, fast, capable
const GEMINI_MODEL  = 'gemini-2.0-flash-lite';
const GEMINI_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models';

// Prevent duplicate simultaneous requests
let _geminiInFlight = false;

function geminiURL(apiKey) {
  return `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

// ===================== AI ANALYSIS (Google Gemini — FREE) =====================
async function runAIAnalysis() {
  const idea = ideas.find(i => i.id === currentIdeaId);
  if (!idea) return;

  const panel = document.getElementById('aiPanel');
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';

  // If no key saved → show one-time setup screen
  const savedKey = getGeminiKey();
  if (!savedKey) {
    showGeminiKeySetup();
    return;
  }

  // Show cached result instantly if available
  if (idea.aiAnalysis) {
    renderAIPanel(idea.aiAnalysis, idea);
    const body = document.getElementById('aiBody');
    const bar = document.createElement('div');
    bar.style.cssText = 'margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center';
    bar.innerHTML = `
      <span style="font-size:11px;color:var(--text3)">✓ Cached result</span>
      <button onclick="clearCacheAndReanalyse()" style="font-size:11px;padding:4px 12px;border-radius:99px;background:var(--accent-dim);border:1px solid rgba(0,245,200,0.2);color:var(--accent);cursor:pointer;font-family:var(--font-b)">↺ Re-analyse</button>
    `;
    body.prepend(bar);
    return;
  }

  await callGeminiAPI(idea, savedKey);
}

async function clearCacheAndReanalyse() {
  const idx = ideas.findIndex(i => i.id === currentIdeaId);
  if (idx !== -1) {
    ideas[idx].aiAnalysis = null;
    saveIdeaToDB(ideas[idx]);  // persist cleared cache to DB
  }
  const savedKey = getGeminiKey();
  if (!savedKey) { showGeminiKeySetup(); return; }
  const idea = ideas.find(i => i.id === currentIdeaId);
  if (idea) await callGeminiAPI(idea, savedKey);
}

async function callGeminiAPI(idea, apiKey) {
  if (_geminiInFlight) { showToast('Analysis already running…', 'info'); return; }
  _geminiInFlight = true;
  document.getElementById('aiBody').innerHTML = `
    <div class="ai-loading">
      <div class="ai-spinner"></div>
      <div>
        <div style="color:var(--text);font-size:12.5px;font-weight:500">Gemini is analysing your idea…</div>
        <div style="color:var(--text3);font-size:11px;margin-top:3px">Usually takes 5–10 seconds</div>
      </div>
    </div>`;

  const prompt = `You are a world-class venture capital analyst and startup mentor. Analyse the following startup idea and return ONLY a raw JSON object — no markdown, no code fences, no explanation.

IDEA: ${idea.name}
DOMAIN: ${(idea.domains||[]).join(', ')||'Not specified'}
INSIGHT: ${idea.insight||'Not specified'}
PROBLEM: ${idea.problemUser} struggles with ${idea.problemBecause} because ${idea.problemDef}
SOLUTION: We help ${idea.solutionHelp} achieve ${idea.solutionAchieve} by ${idea.solutionBy}, unlike ${idea.solutionUnlike}
MARKET PATH: ${(idea.marketPath||[]).join(' → ')}
BUSINESS MODEL: ${idea.bizWho} pays ${idea.bizPrice} for ${idea.bizWhat}. Pricing: ${idea.bizPricing}. Gross Margin: ${idea.grossMargin}
MOATS: ${(idea.moats||[]).join(', ')||'None identified'}
PROBLEM SCORE: ${totalScore(idea)}/25
CONVICTION: ${idea.conviction}/10
7-FILTER RATING: ${idea.overallFilter||'Not rated'}
FINAL DECISION: ${idea.finalDecision||'Not decided'}

Return exactly this JSON structure and nothing else:
{"overallRating":"Strong Bet","aiScore":85,"oneLiner":"one punchy sentence","strengths":["s1","s2","s3"],"weaknesses":["w1","w2","w3"],"opportunities":["o1","o2"],"threats":["t1","t2"],"vcPerspective":"2-3 sentence VC gut-check","nextSteps":["step1","step2","step3"],"keyQuestion":"the single most important question this founder must answer"}
overallRating must be exactly one of: Strong Bet, Promising, Needs Work, Risky, Pass
aiScore must be a number 0-100.`;

  try {
    const res = await fetch(geminiURL(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1500
          // Note: responseMimeType NOT used — causes model-not-found on some regions
        }
      })
    });

    if (!res.ok) {
      _geminiInFlight = false;
      const errData = await res.json().catch(() => ({}));
      const errMsg  = errData?.error?.message || `HTTP ${res.status}`;
      const status  = res.status;

      if (status === 429 || errMsg.toLowerCase().includes('quota')) {
        showAIError(`
          <strong>Daily quota exceeded</strong><br><br>
          Your free Gemini key has hit its daily limit. This resets every 24 hours.<br><br>
          <strong>Quick fix:</strong> Go to
          <a href="https://aistudio.google.com/app/apikey" target="_blank"
            style="color:var(--accent)">aistudio.google.com/app/apikey</a>
          and create a <strong>new API key</strong> — each key gets a fresh daily quota.
          Then click <em>Change Key</em> below and paste the new one.
        `);
      } else if (status === 400 && (errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('api_key'))) {
        showGeminiKeyError('API key not recognised by Google. Please generate a fresh key at aistudio.google.com/app/apikey');
      } else if (status === 403) {
        showGeminiKeyError('Permission denied. Make sure the "Generative Language API" is enabled for this key in Google Cloud Console.');
      } else if (errMsg.includes('not found') || errMsg.includes('not supported')) {
        showAIError(`Model unavailable in your region.<br><small style="color:var(--text3)">${errMsg}</small>`);
      } else {
        showAIError(`Gemini error (${status}): ${errMsg}`);
      }
      return;
    }

    const data = await res.json();
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!raw) {
      const finishReason = data?.candidates?.[0]?.finishReason || 'UNKNOWN';
      showAIError(`Gemini returned no content (finishReason: ${finishReason}). Please try again.`);
      return;
    }

    // Strip any accidental markdown fences and parse
    const clean = raw.replace(/```json|```/gi, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (_) {
      // Fallback: try to pull first {...} block from response
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch (_2) { showAIError('Could not parse Gemini response. Please try again.'); return; }
      } else {
        showAIError('Gemini response was not valid JSON. Please try again.');
        return;
      }
    }

    renderAIPanel(parsed, idea);
    showToast('AI analysis complete! ✓', 'success');
    _geminiInFlight = false;

    // Cache to memory + Firestore
    const idx = ideas.findIndex(i => i.id === currentIdeaId);
    if (idx !== -1) {
      ideas[idx].aiAnalysis = parsed;
      saveIdeaToDB(ideas[idx]);   // persist to DB
    }

  } catch (e) {
    _geminiInFlight = false;
    if (e.message?.includes('Failed to fetch') || e.name === 'TypeError') {
      showAIError('Network error — check your internet connection and try again.');
    } else {
      showAIError(`Unexpected error: ${e.message}`);
    }
  }
}

// ---- Gemini Key Setup Screen (shown only once until user explicitly changes key) ----
function showGeminiKeySetup(errorMsg = '') {
  document.getElementById('aiBody').innerHTML = `
    ${errorMsg ? `<div style="padding:10px 14px;background:var(--danger-dim);border:1px solid rgba(255,77,106,0.25);border-radius:var(--r-sm);margin-bottom:16px;font-size:12px;color:var(--danger)">${errorMsg}</div>` : ''}
    <div class="gemini-setup">
      <div class="gemini-setup-logo">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="url(#g1)"/>
          <defs><linearGradient id="g1" x1="4" y1="2" x2="20" y2="18" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#00f5c8"/><stop offset="100%" stop-color="#7c6bff"/>
          </linearGradient></defs>
        </svg>
      </div>
      <div class="gemini-setup-title">Connect Gemini AI</div>
      <div class="gemini-setup-sub">Get a <strong>free</strong> API key — no credit card needed. Key is saved in your browser.</div>

      <div class="gemini-steps">
        <div class="gemini-step">
          <span class="gs-num">1</span>
          <span>Open <a href="https://aistudio.google.com/app/apikey" target="_blank" class="gs-link">aistudio.google.com/app/apikey</a></span>
        </div>
        <div class="gemini-step">
          <span class="gs-num">2</span>
          <span>Sign in with Google → click <strong>"Create API Key"</strong></span>
        </div>
        <div class="gemini-step">
          <span class="gs-num">3</span>
          <span>Copy &amp; paste the key below, then click Connect</span>
        </div>
      </div>

      <div class="gemini-key-input-wrap">
        <input
          type="password"
          id="geminiKeyInput"
          class="gemini-key-input"
          placeholder="Paste your key here (AIza...)"
          autocomplete="off"
          spellcheck="false"
          onkeydown="if(event.key==='Enter') connectGeminiKey()"
        >
        <button class="gemini-eye-btn" onclick="toggleKeyVisibility()" title="Show/hide">👁</button>
      </div>
      <div class="gemini-key-hint">🔒 Stored only in your browser's localStorage — never sent anywhere except Google.</div>

      <button class="gemini-connect-btn" id="geminiConnectBtn" onclick="connectGeminiKey()">
        <span class="btn-shimmer"></span>
        ✦ Save Key &amp; Analyse
      </button>
      <div class="gemini-free-badge">🎉 Free · 15 req/min · 1M tokens/day · No card needed</div>
    </div>`;

  // Auto-focus the input
  setTimeout(() => document.getElementById('geminiKeyInput')?.focus(), 100);
}

function toggleKeyVisibility() {
  const el = document.getElementById('geminiKeyInput');
  if (el) el.type = el.type === 'password' ? 'text' : 'password';
}

async function connectGeminiKey() {
  const input = document.getElementById('geminiKeyInput');
  if (!input) return;
  const key = input.value.trim();

  if (!key) { showToast('Please paste your API key first.', 'error'); input.focus(); return; }
  if (!key.startsWith('AIza')) {
    showToast('Gemini API keys start with "AIza…" — check your key.', 'error');
    input.focus(); return;
  }
  if (key.length < 30) {
    showToast('Key looks too short — please paste the full key.', 'error');
    input.focus(); return;
  }

  // Save immediately — NO validation test call (wastes quota)
  saveGeminiKey(key);
  showToast('Key saved! ✓ Running analysis…', 'success');

  const idea = ideas.find(i => i.id === currentIdeaId);
  if (idea) await callGeminiAPI(idea, key);
}

function showAIError(htmlMsg) {
  document.getElementById('aiBody').innerHTML = `
    <div style="padding:16px;background:var(--danger-dim);border:1px solid rgba(255,77,106,0.2);border-radius:var(--r-sm)">
      <div style="font-family:var(--font-d);font-size:13px;font-weight:700;color:var(--danger);margin-bottom:8px">Analysis Failed</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.75">${htmlMsg}</div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button onclick="clearCacheAndReanalyse()" style="padding:7px 16px;border-radius:var(--r-sm);background:var(--bg3);border:1px solid var(--border);color:var(--text2);font-family:var(--font-b);font-size:11.5px;cursor:pointer">↺ Try Again</button>
        <button onclick="changeGeminiKey()" style="padding:7px 16px;border-radius:var(--r-sm);background:var(--bg3);border:1px solid var(--border);color:var(--text3);font-family:var(--font-b);font-size:11.5px;cursor:pointer">⚙ Change Key</button>
      </div>
    </div>`;
}

function showGeminiKeyError(msg) {
  const k = currentUser ? 'if_gemini_key_' + currentUser.uid : 'if_gemini_key';
  localStorage.removeItem(k);
  showGeminiKeySetup(msg);
}

function renderAIPanel(data, idea) {
  const ratingColor = {
    'Strong Bet': 'var(--success)',
    'Promising':  'var(--accent)',
    'Needs Work': 'var(--warn)',
    'Risky':      'var(--danger)',
    'Pass':       'var(--danger)'
  }[data.overallRating] || 'var(--text2)';

  document.getElementById('aiBody').innerHTML = `
    <div class="ai-result-header">
      <div class="ai-score-badge" style="color:${ratingColor};border-color:${ratingColor}40">${data.aiScore}/100</div>
      <div class="ai-rating" style="color:${ratingColor}">${data.overallRating}</div>
      <div class="ai-one-liner">"${data.oneLiner}"</div>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">✓ Strengths</div>
      <div class="ai-tags">${(data.strengths||[]).map(s=>`<span class="ai-tag">${s}</span>`).join('')}</div>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">⚠ Weaknesses</div>
      <div class="ai-tags">${(data.weaknesses||[]).map(s=>`<span class="ai-tag warn">${s}</span>`).join('')}</div>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">→ Opportunities</div>
      <div class="ai-tags">${(data.opportunities||[]).map(s=>`<span class="ai-tag">${s}</span>`).join('')}</div>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">✕ Threats</div>
      <div class="ai-tags">${(data.threats||[]).map(s=>`<span class="ai-tag danger">${s}</span>`).join('')}</div>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">🏦 VC Perspective</div>
      <p style="font-size:12px;color:var(--text2);line-height:1.75">${data.vcPerspective||'—'}</p>
    </div>
    <div class="ai-section">
      <div class="ai-section-title">▶ Next Steps</div>
      ${(data.nextSteps||[]).map((s,i)=>`
        <div style="display:flex;gap:8px;margin-bottom:7px;font-size:12px;color:var(--text2)">
          <strong style="color:var(--accent);flex-shrink:0">${i+1}.</strong>${s}
        </div>`).join('')}
    </div>
    <div class="ai-key-q">
      <div class="ai-key-q-label">KEY QUESTION TO ANSWER</div>
      <div class="ai-key-q-text">"${data.keyQuestion}"</div>
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="clearCacheAndReanalyse()" style="flex:1;padding:8px;border-radius:var(--r-sm);background:var(--bg3);border:1px solid var(--border);color:var(--text3);cursor:pointer;font-family:var(--font-b);font-size:11px">↺ Re-analyse</button>
      <button onclick="changeGeminiKey()" style="flex:1;padding:8px;border-radius:var(--r-sm);background:var(--bg3);border:1px solid var(--border);color:var(--text3);cursor:pointer;font-family:var(--font-b);font-size:11px">⚙ Change Key</button>
    </div>`;
}

function closeAIPanel() {
  document.getElementById('aiPanel').style.display = 'none';
}

// ===================== PDF EXPORT =====================
function exportPDF() {
  const idea = ideas.find(i=>i.id===currentIdeaId);
  if(!idea){showToast('No idea selected.','error');return;}
  const w = window.open('','_blank');
  const s = totalScore(idea);
  w.document.write(`<!DOCTYPE html><html><head><title>${idea.name||'Idea'} — IdeaForge Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Mono:wght@300;400&display=swap');
    *{box-sizing:border-box;margin:0;padding:0} body{font-family:'DM Mono',monospace;background:#fff;color:#1a1927;padding:40px;line-height:1.6}
    h1{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;margin-bottom:4px}
    h2{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:12px;color:#3a3850;border-bottom:2px solid #f0eff6;padding-bottom:6px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;padding-bottom:20px;border-bottom:3px solid #7c6bff}
    .score-big{font-family:'Syne',sans-serif;font-size:52px;font-weight:800;color:${s>=20?'#22c55e':s>=13?'#f59e0b':'#ef4444'};line-height:1}
    .section{background:#f8f7fc;border-radius:10px;padding:20px;margin-bottom:16px;border:1px solid #e8e7f0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .field-label{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#9897a8;margin-bottom:3px}
    .field-val{font-size:12.5px;color:#3a3850;line-height:1.6}
    .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
    .chip{font-size:10px;padding:3px 10px;background:#ede9fe;color:#7c6bff;border-radius:99px}
    .chip.green{background:#dcfce7;color:#16a34a} .chip.red{background:#fee2e2;color:#dc2626}
    .meta{font-size:11px;color:#9897a8} .conv{font-family:'Syne',sans-serif;font-size:36px;font-weight:800;color:#7c6bff}
    table{width:100%;border-collapse:collapse} th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e8e7f0;font-size:12px}
    th{background:#f0eff6;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#9897a8}
    .footer{margin-top:30px;text-align:center;font-size:10px;color:#c8c7d4;padding-top:16px;border-top:1px solid #e8e7f0}
    @media print{body{padding:20px}}
  </style></head><body>
  <div class="header">
    <div>
      <div style="font-size:12px;font-family:'DM Mono';color:#9897a8;margin-bottom:6px">IDEAFORGE PRO — STARTUP EVALUATION REPORT</div>
      <h1>${idea.name||'Untitled Idea'}</h1>
      <div class="meta">Evaluated: ${idea.date||'—'} · Domains: ${(idea.domains||[]).join(', ')||'—'}</div>
      <div class="chips" style="margin-top:10px">
        ${(idea.tags||[]).map(t=>`<span class="chip">#${t}</span>`).join('')}
      </div>
    </div>
    <div style="text-align:right">
      <div class="score-big">${s}<span style="font-size:18px;font-weight:400;color:#9897a8">/25</span></div>
      <div class="meta">Problem Score</div>
      <div style="margin-top:10px"><span class="conv">${idea.conviction||'?'}</span><span class="meta">/10 conviction</span></div>
    </div>
  </div>
  <div class="section">
    <h2>Thesis Summary</h2>
    <div class="grid">
      ${[['Insight',idea.summaryInsight],['Problem',idea.summaryProblem],['Solution (10x)',idea.summarySolution],['Target User',idea.summaryUser],['Market Path',idea.summaryMarket],['Business Model',idea.summaryBiz],['Distribution',idea.summaryDist],['Moat',idea.summaryMoat],['Why Now',idea.summaryWhy],['10-Year Vision',idea.summaryVision]]
        .map(([l,v])=>`<div><div class="field-label">${l}</div><div class="field-val">${v||'—'}</div></div>`).join('')}
    </div>
  </div>
  <div class="grid">
    <div class="section">
      <h2>Problem Score</h2>
      ${Object.entries(idea.scores||{}).map(([k,v])=>`<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span class="field-val">${k}</span><strong>${v}/5</strong></div>`).join('')}
      <div style="border-top:2px solid #e8e7f0;margin-top:8px;padding-top:8px;display:flex;justify-content:space-between"><strong>Total</strong><strong style="color:${s>=20?'#16a34a':s>=13?'#d97706':'#dc2626'}">${s}/25</strong></div>
    </div>
    <div class="section">
      <h2>7-Filter Assessment</h2>
      ${[['Engineering',idea.q1],['Timing',idea.q2],['Monopoly',idea.q3],['People',idea.q4],['Distribution',idea.q5],['Durability',idea.q6],['Secret',idea.q7]]
        .map(([l,v])=>`<div style="margin-bottom:8px"><div class="field-label">${l}</div><div class="field-val">${(v||'—').substring(0,80)}${(v||'').length>80?'...':''}</div></div>`).join('')}
    </div>
  </div>
  <div class="section">
    <h2>Business Model</h2>
    <div class="grid">
      <div><div class="field-label">Who Pays</div><div class="field-val">${idea.bizWho||'—'}</div></div>
      <div><div class="field-label">What For</div><div class="field-val">${idea.bizWhat||'—'}</div></div>
      <div><div class="field-label">Pricing</div><div class="field-val">${idea.bizPricing||'—'}</div></div>
      <div><div class="field-label">Gross Margin</div><div class="field-val">${idea.grossMargin||'—'}</div></div>
      <div><div class="field-label">LTV / CAC</div><div class="field-val">${idea.ltv||'—'}</div></div>
      <div><div class="field-label">Channels</div><div class="field-val">${(idea.channels||[]).join(', ')||'—'}</div></div>
    </div>
  </div>
  <div class="section">
    <h2>Moat & Risk</h2>
    <div><div class="field-label">Moats</div><div class="chips">${(idea.moats||[]).map(m=>`<span class="chip">${m}</span>`).join('')||'—'}</div></div>
    <div style="margin-top:12px"><div class="field-label">Top Risks</div>${(idea.risks||[]).filter(Boolean).map((r,i)=>`<div class="field-val">${i+1}. ${r}</div>`).join('')||'—'}</div>
  </div>
  <div class="section" style="background:${idea.finalDecision==='Commit fully'?'#f0fdf4':idea.finalDecision==='Discard'?'#fef2f2':'#fffbeb'}">
    <h2>Final Decision</h2>
    <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:${idea.finalDecision==='Commit fully'?'#16a34a':idea.finalDecision==='Discard'?'#dc2626':'#d97706'}">${idea.finalDecision||'Not decided'}</div>
    ${idea.finalNotes?`<div class="field-val" style="margin-top:8px;font-style:italic">"${idea.finalNotes}"</div>`:''}
  </div>
  <div class="footer">Generated by IdeaForge Pro · ${new Date().toLocaleDateString('en-IN',{year:'numeric',month:'long',day:'numeric'})}</div>
  <script>window.print();<\/script>
  </body></html>`);
  w.document.close();
  showToast('PDF export opened in new tab.','success');
}

// ===================== GLOBAL SEARCH =====================
function openSearch() {
  document.getElementById('searchOverlay').classList.add('open');
  document.getElementById('searchModal').classList.add('open');
  setTimeout(()=>document.getElementById('globalSearch').focus(),100);
  runSearch();
}
function closeSearch() {
  document.getElementById('searchOverlay').classList.remove('open');
  document.getElementById('searchModal').classList.remove('open');
}
function runSearch() {
  const q = document.getElementById('globalSearch').value.toLowerCase();
  const box = document.getElementById('searchResults');
  if(!ideas.length){box.innerHTML='<div class="sr-empty">No ideas yet.</div>';return;}
  const filtered = q ? ideas.filter(i =>
    (i.name||'').toLowerCase().includes(q) ||
    (i.insight||'').toLowerCase().includes(q) ||
    (i.domains||[]).some(d=>d.toLowerCase().includes(q)) ||
    (i.tags||[]).some(t=>t.toLowerCase().includes(q))
  ) : ideas;
  if(!filtered.length){box.innerHTML='<div class="sr-empty">No results found.</div>';return;}
  const s = totalScore;
  box.innerHTML = filtered.map(idea => {
    const sc=s(idea); const tc=tierClass(sc);
    return `<div class="sr-item" onclick="closeSearch();viewIdea('${idea.id}')">
      <div class="sr-score ${tc}">${sc}</div>
      <div class="sr-info">
        <div class="sr-name">${idea.name||'Untitled'}</div>
        <div class="sr-sub">${(idea.domains||[]).join(', ')||'—'} · ${idea.date||''}</div>
      </div>
      <span style="font-size:11px;color:var(--text3)">${idea.finalDecision||'—'}</span>
    </div>`;
  }).join('');
}

// ===================== TOAST =====================
function showToast(msg, type='') {
  const stack = document.getElementById('toastStack');
  const t = document.createElement('div');
  t.className = 'toast '+(type||'');
  t.textContent = msg;
  stack.appendChild(t);
  setTimeout(()=>t.remove(),3500);
}

// ===================== UTILS =====================
function esc(s) { return (s||'').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ===================== EXPORT MODAL & FUNCTIONS =====================
let exportFormat = 'excel';

function openExportModal() {
  // Populate idea checkboxes
  const box = document.getElementById('exportIdeaChecks');
  if (box) {
    box.innerHTML = ideas.map(i => `
      <label class="export-check-row">
        <input type="checkbox" class="export-idea-cb" value="${i.id}" checked>
        <span>${i.name||'Untitled'} <span style="color:var(--text3);font-size:10px">(Score: ${totalScore(i)})</span></span>
      </label>`).join('');
  }
  document.getElementById('exportModalOverlay').style.display = 'flex';
}
function closeExportModal() {
  document.getElementById('exportModalOverlay').style.display = 'none';
}
function selectExportFmt(fmt, btn) {
  exportFormat = fmt;
  document.querySelectorAll('.export-fmt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
function toggleExportAll(cb) {
  document.querySelectorAll('.export-idea-cb').forEach(c => c.checked = cb.checked);
}

function getSortedIdeasForExport() {
  const sort  = document.getElementById('exportSortBy')?.value || 'score';
  const cbIds = [...document.querySelectorAll('.export-idea-cb:checked')].map(c => c.value);
  let list    = ideas.filter(i => cbIds.includes(i.id));
  if (sort === 'score')      list.sort((a,b) => totalScore(b) - totalScore(a));
  else if (sort === 'conviction') list.sort((a,b) => (b.conviction||0) - (a.conviction||0));
  else if (sort === 'date_desc')  list.sort((a,b) => (b.date||'').localeCompare(a.date||''));
  else if (sort === 'date_asc')   list.sort((a,b) => (a.date||'').localeCompare(b.date||''));
  else if (sort === 'name')       list.sort((a,b) => (a.name||'').localeCompare(b.name||''));
  return list;
}

function runExport() {
  const list = getSortedIdeasForExport();
  if (!list.length) { showToast('No ideas selected.', 'error'); return; }
  closeExportModal();
  if (exportFormat === 'excel') exportToExcel(list);
  else exportAllPDF(list);
}

// ── Excel Export ──
function exportToExcel(list) {
  showToast('Preparing Excel…', 'info');
  // Build CSV with all fields (no external library needed — Excel opens CSV)
  const FIELDS = [
    ['Name','name'], ['Date','date'], ['Domains','domains'], ['Tags','tags'],
    ['Problem Score','_score'], ['Conviction',  'conviction'], ['Decision','finalDecision'],
    ['Filter Rating','overallFilter'], ['Insight','insight'],
    ['Problem User','problemUser'], ['Problem Because','problemBecause'], ['Problem Definition','problemDef'],
    ['Score Pain','scores.pain'], ['Score Urgency','scores.urgency'], ['Score Budget','scores.budget'],
    ['Score Alternatives','scores.alternatives'], ['Score Awareness','scores.awareness'],
    ['Target Role','targetRole'], ['Target Context','targetContext'],
    ['10x Dimensions','dimensions'], ['Solution','solution'],
    ['Solution Statement','_solutionStatement'],
    ['Technologies','technologies'], ['MVP','mvp'],
    ['Beachhead Who','beachheadWho'], ['Beachhead Use Case','beachheadUseCase'],
    ['Beachhead Win','beachheadWin'], ['Market Path','_marketPath'],
    ['Biz Who Pays','bizWho'], ['Biz What For','bizWhat'],
    ['Pricing','bizPricing'], ['Recurring','recurring'], ['Price','bizPrice'],
    ['Costs','bizCosts'], ['Gross Margin','grossMargin'], ['LTV/CAC','ltv'],
    ['Channels','channels'], ['Channel Plan','channelExplain'],
    ['Q1 Engineering','q1'], ['Q2 Timing','q2'], ['Q3 Monopoly','q3'],
    ['Q4 People','q4'], ['Q5 Distribution','q5'], ['Q6 Durability','q6'], ['Q7 Secret','q7'],
    ['Moats','moats'], ['Moat Explanation','moatExplain'],
    ['Risks','_risks'], ['Risks Controllable','risksControl'],
    ['Asymmetric Work','asymmetricWork'], ['Asymmetric Fail','asymmetricFail'],
    ['Summary Insight','summaryInsight'], ['Summary Problem','summaryProblem'],
    ['Summary Solution','summarySolution'], ['Summary User','summaryUser'],
    ['Summary Market','summaryMarket'], ['Summary Biz','summaryBiz'],
    ['Summary Distribution','summaryDist'], ['Summary Moat','summaryMoat'],
    ['Why Now','summaryWhy'], ['10-Year Vision','summaryVision'],
    ['Final Notes','finalNotes']
  ];

  const csvRows = [];
  // Header
  csvRows.push(FIELDS.map(([h]) => `"${h}"`).join(','));

  // Rows
  list.forEach((idea, rank) => {
    const row = FIELDS.map(([, key]) => {
      let val = '';
      if (key === '_score')           val = totalScore(idea);
      else if (key === '_solutionStatement') val = `We help ${idea.solutionHelp||''} achieve ${idea.solutionAchieve||''} by ${idea.solutionBy||''}, unlike ${idea.solutionUnlike||''}`;
      else if (key === '_marketPath') val = (idea.marketPath||[]).join(' → ');
      else if (key === '_risks')      val = (idea.risks||[]).filter(Boolean).join('; ');
      else if (key.includes('.')) {
        const [obj, prop] = key.split('.');
        val = idea[obj]?.[prop] ?? '';
      } else if (Array.isArray(idea[key])) {
        val = (idea[key]||[]).join('; ');
      } else {
        val = idea[key] ?? '';
      }
      // Escape for CSV
      return `"${String(val).replace(/"/g,'""')}"`;
    });
    csvRows.push(row.join(','));
  });

  const csv  = '\uFEFF' + csvRows.join('\r\n'); // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `IdeaForge-Export-${today()}.csv`;
  a.click();
  showToast(`Excel exported — ${list.length} ideas ✓`, 'success');
}

// ── Multi-PDF Export ──
function exportAllPDF(list) {
  showToast('Generating PDF…', 'info');
  const w = window.open('', '_blank');
  const ideaHTMLs = list.map((idea, i) => {
    const s = totalScore(idea);
    return `
    <div class="idea-section${i > 0 ? ' page-break' : ''}">
      <div class="idea-header">
        <div>
          <div class="idea-num">Idea #${i+1}</div>
          <div class="idea-name">${idea.name||'Untitled'}</div>
          <div class="idea-meta">${idea.date||''} · ${(idea.domains||[]).join(', ')||'—'} · ${(idea.tags||[]).map(t=>'#'+t).join(' ')}</div>
        </div>
        <div style="text-align:right">
          <div class="score-big" style="color:${s>=20?'#16a34a':s>=13?'#d97706':'#dc2626'}">${s}<span style="font-size:14px;color:#9897a8">/25</span></div>
          <div class="meta">Problem Score</div>
          <div class="score-big" style="font-size:28px;color:#7c6bff;margin-top:4px">${idea.conviction||'?'}<span style="font-size:12px;color:#9897a8">/10</span></div>
          <div class="meta">Conviction</div>
        </div>
      </div>
      <div class="decision-badge" style="background:${idea.finalDecision==='Commit fully'?'#f0fdf4':idea.finalDecision==='Discard'?'#fef2f2':'#fffbeb'};color:${idea.finalDecision==='Commit fully'?'#16a34a':idea.finalDecision==='Discard'?'#dc2626':'#d97706'}">
        ${idea.finalDecision||'No decision yet'}
      </div>

      <div class="section"><h2>Thesis Summary</h2>
        <div class="grid">
          ${[['Insight',idea.summaryInsight],['Problem',idea.summaryProblem],['Solution',idea.summarySolution],['User',idea.summaryUser],['Market',idea.summaryMarket],['Biz Model',idea.summaryBiz],['Distribution',idea.summaryDist],['Moat',idea.summaryMoat],['Why Now',idea.summaryWhy],['Vision',idea.summaryVision]].map(([l,v])=>`<div><div class="fl">${l}</div><div class="fv">${v||'—'}</div></div>`).join('')}
        </div>
      </div>

      <div class="grid2">
        <div class="section"><h2>Problem Score</h2>
          ${Object.entries(idea.scores||{}).map(([k,v])=>`<div style="display:flex;justify-content:space-between;margin-bottom:5px"><span class="fv">${k}</span><strong>${v}/5</strong></div>`).join('')}
          <div style="border-top:2px solid #e8e7f0;margin-top:8px;padding-top:6px;display:flex;justify-content:space-between"><strong>Total</strong><strong style="color:${s>=20?'#16a34a':s>=13?'#d97706':'#dc2626'}">${s}/25</strong></div>
        </div>
        <div class="section"><h2>Business Model</h2>
          <div><div class="fl">Who Pays</div><div class="fv">${idea.bizWho||'—'}</div></div>
          <div><div class="fl">Pricing</div><div class="fv">${idea.bizPricing||'—'}</div></div>
          <div><div class="fl">Margin</div><div class="fv">${idea.grossMargin||'—'}</div></div>
          <div><div class="fl">LTV/CAC</div><div class="fv">${idea.ltv||'—'}</div></div>
          <div><div class="fl">Channels</div><div class="fv">${(idea.channels||[]).join(', ')||'—'}</div></div>
        </div>
      </div>

      <div class="section"><h2>7-Question Filter <span style="font-size:12px;font-weight:400;color:${idea.overallFilter==='Strong'?'#16a34a':idea.overallFilter==='Medium'?'#d97706':'#dc2626'}">${idea.overallFilter||''}</span></h2>
        <div class="grid">
          ${[['Engineering',idea.q1],['Timing',idea.q2],['Monopoly',idea.q3],['People',idea.q4],['Distribution',idea.q5],['Durability',idea.q6],['Secret',idea.q7]].map(([l,v])=>`<div><div class="fl">${l}</div><div class="fv">${(v||'—').substring(0,100)}${(v||'').length>100?'…':''}</div></div>`).join('')}
        </div>
      </div>

      <div class="grid2">
        <div class="section"><h2>Moats</h2>
          <div class="chips">${(idea.moats||[]).map(m=>`<span class="chip">${m}</span>`).join('')||'—'}</div>
          <div style="margin-top:8px"><div class="fv">${idea.moatExplain||''}</div></div>
        </div>
        <div class="section"><h2>Top Risks</h2>
          ${(idea.risks||[]).filter(Boolean).map((r,i)=>`<div class="fv">${i+1}. ${r}</div>`).join('')||'—'}
        </div>
      </div>
      ${idea.finalNotes?`<div class="section"><h2>Final Notes</h2><div class="fv" style="font-style:italic">"${idea.finalNotes}"</div></div>`:''}
    </div>`;
  }).join('');

  w.document.write(`<!DOCTYPE html><html><head>
  <title>IdeaForge Portfolio — ${list.length} Ideas</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Mono:wght@300;400&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Mono',monospace;background:#fff;color:#1a1927;padding:30px;line-height:1.6}
    .page-break{page-break-before:always;padding-top:30px}
    .idea-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:14px;border-bottom:3px solid #7c6bff}
    .idea-num{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9897a8;margin-bottom:4px}
    .idea-name{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;margin-bottom:4px}
    .idea-meta{font-size:11px;color:#9897a8}
    .score-big{font-family:'Syne',sans-serif;font-size:40px;font-weight:800;line-height:1}
    .meta{font-size:10px;color:#9897a8;margin-top:2px}
    .decision-badge{display:inline-block;padding:5px 16px;border-radius:99px;font-size:13px;font-weight:700;font-family:'Syne',sans-serif;margin-bottom:14px}
    .section{background:#f8f7fc;border-radius:10px;padding:16px;margin-bottom:12px;border:1px solid #e8e7f0}
    h2{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#3a3850;margin-bottom:10px;border-bottom:1px solid #e8e7f0;padding-bottom:6px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
    .fl{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#9897a8;margin-bottom:2px}
    .fv{font-size:12px;color:#3a3850;line-height:1.5}
    .chips{display:flex;flex-wrap:wrap;gap:5px}
    .chip{font-size:10px;padding:2px 9px;background:#ede9fe;color:#7c6bff;border-radius:99px}
    .toc-item{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e8e7f0;font-size:12px}
    .toc-rank{color:#9897a8;font-size:11px}
    @media print{.page-break{page-break-before:always}body{padding:15px}}
  </style></head><body>
  <div style="text-align:center;padding:30px 0 20px;border-bottom:3px solid #7c6bff;margin-bottom:24px">
    <div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;margin-bottom:6px">IdeaForge Pro — Portfolio Report</div>
    <div style="font-size:12px;color:#9897a8">Generated ${new Date().toLocaleDateString('en-IN',{year:'numeric',month:'long',day:'numeric'})} · ${list.length} ideas</div>
  </div>
  <!-- Table of Contents -->
  <div style="margin-bottom:24px">
    <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;margin-bottom:10px">Contents</div>
    ${list.map((idea,i)=>`
      <div class="toc-item">
        <span><strong>#${i+1}</strong> ${idea.name||'Untitled'}</span>
        <span class="toc-rank">Score: ${totalScore(idea)}/25 · ${idea.finalDecision||'Undecided'}</span>
      </div>`).join('')}
  </div>
  ${ideaHTMLs}
  <script>window.print();<\/script>
  </body></html>`);
  w.document.close();
  showToast(`PDF opened — ${list.length} ideas ✓`, 'success');
}

// ===================== FLOATING AI CHATBOT =====================
let chatHistory   = [];
let chatInFlight  = false;
let chatIsOpen    = false;

// ── AI Provider State ──
// provider: 'gemini' | 'openrouter'
// stored per-user in localStorage
function getChatProvider()  { return localStorage.getItem('if_chat_provider') || 'gemini'; }
function setChatProvider(p) { localStorage.setItem('if_chat_provider', p); updateProviderUI(); }
function getORKey()   { return localStorage.getItem(currentUser?'if_or_key_'+currentUser.uid:'if_or_key') || ''; }
function setORKey(k)  { localStorage.setItem(currentUser?'if_or_key_'+currentUser.uid:'if_or_key', k.trim()); }
function getORModel() { return localStorage.getItem('if_or_model') || 'google/gemini-2.0-flash-exp:free'; }
function setORModel(m){ localStorage.setItem('if_or_model', m); }

function updateProviderUI() {
  const p = getChatProvider();
  const lbl = document.getElementById('chatProviderLabel');
  const ml  = document.getElementById('chatModelLabel');
  if (p === 'gemini') {
    if (lbl) lbl.textContent = 'Gemini Free';
    if (ml)  ml.textContent  = 'Gemini 2.0 Flash Lite';
  } else {
    const model = getORModel().split('/').pop().split(':')[0];
    if (lbl) lbl.textContent = 'OpenRouter';
    if (ml)  ml.textContent  = model;
  }
}

function initChatbot() {
  updateChatIdeaSelector();
  updateProviderUI();
}

function updateChatIdeaSelector() {
  const sel = document.getElementById('chatIdeaContext');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">All ideas</option>' +
    ideas.map(i => `<option value="${i.id}">${i.name||'Untitled'}</option>`).join('');
  if (prev) sel.value = prev;
}

/* ── open / close / toggle ── */
function toggleChat() { chatIsOpen ? closeChat() : openChat(); }
function openChat() {
  chatIsOpen = true;
  document.getElementById('chatWindow').classList.add('open');
  document.getElementById('chatFab').classList.add('open');
  document.getElementById('chatFabBadge').style.display = 'none';
  document.getElementById('chatFabIcon').innerHTML =
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  updateChatIdeaSelector();
  updateProviderUI();
  // Check if API key is set for active provider
  const provider = getChatProvider();
  const hasKey   = provider === 'gemini' ? !!getGeminiKey() : !!getORKey();
  if (!hasKey) showChatKeySetup();
  setTimeout(() => document.getElementById('chatInput')?.focus(), 300);
}
function closeChat() {
  chatIsOpen = false;
  document.getElementById('chatWindow').classList.remove('open');
  document.getElementById('chatFab').classList.remove('open');
  document.getElementById('chatFabIcon').innerHTML =
    `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* ── API Settings Modal ── */
function openChatSettings() {
  const provider = getChatProvider();
  // Restore current values into settings form
  document.querySelectorAll('.provider-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.provider === provider);
  });
  document.getElementById('geminiSettings').style.display      = provider==='gemini'      ? '' : 'none';
  document.getElementById('openrouterSettings').style.display  = provider==='openrouter'  ? '' : 'none';

  const gKey = getGeminiKey();
  const oKey = getORKey();
  if (gKey) document.getElementById('settingsGeminiKey').value = gKey;
  if (oKey) document.getElementById('settingsORKey').value     = oKey;
  const orModel = getORModel();
  const orSel   = document.getElementById('settingsORModel');
  if (orSel) {
    // Set the input value (works for both custom and predefined models)
    orSel.value = orModel;
  }
  document.getElementById('apiSettingsOverlay').style.display = 'flex';
}
function closeApiSettings() {
  document.getElementById('apiSettingsOverlay').style.display = 'none';
}
function selectProvider(p, btn) {
  document.querySelectorAll('.provider-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('geminiSettings').style.display     = p==='gemini'     ? '' : 'none';
  document.getElementById('openrouterSettings').style.display = p==='openrouter' ? '' : 'none';
}
function toggleInputVis(id) {
  const el = document.getElementById(id);
  if (el) el.type = el.type === 'password' ? 'text' : 'password';
}
function saveApiSettings() {
  const activeTab = document.querySelector('.provider-tab.active');
  const provider  = activeTab?.dataset.provider || 'gemini';
  setChatProvider(provider);

  if (provider === 'gemini') {
    const key = document.getElementById('settingsGeminiKey')?.value.trim();
    if (key) saveGeminiKey(key);
  } else {
    const key   = document.getElementById('settingsORKey')?.value.trim();
    const model = document.getElementById('settingsORModel')?.value;
    if (key)   setORKey(key);
    if (model) setORModel(model);
  }

  closeApiSettings();
  updateProviderUI();
  showToast('API settings saved ✓', 'success');

  // If chat has key setup screen, clear it
  const box  = document.getElementById('chatMessages');
  const setup = box?.querySelector('.chat-key-setup');
  if (setup) clearChat();
}

/* ── Key setup in chat (if no key set) ── */
function showChatKeySetup() {
  const provider = getChatProvider();
  const isGemini = provider === 'gemini';
  document.getElementById('chatMessages').innerHTML = `
    <div class="chat-key-setup">
      <div class="chat-key-setup-title">⚡ Connect ${isGemini ? 'Gemini' : 'OpenRouter'} AI</div>
      <div class="chat-key-setup-sub">
        ${isGemini
          ? `Free key from <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--accent)">aistudio.google.com/app/apikey</a>`
          : `Free key from <a href="https://openrouter.ai/keys" target="_blank" style="color:var(--accent)">openrouter.ai/keys</a>`}
        — no credit card needed.
      </div>
      <div class="chat-key-input-row">
        <input type="password" id="chatKeyInput" class="chat-key-input"
          placeholder="${isGemini ? 'AIza…' : 'sk-or-v1-…'}"
          autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();saveChatKey()}">
        <button class="chat-key-save-btn" onclick="saveChatKey()">Save</button>
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:6px">Or click ⚙ to switch provider / manage all keys</div>
    </div>`;
  setTimeout(() => document.getElementById('chatKeyInput')?.focus(), 100);
}

function saveChatKey() {
  const input    = document.getElementById('chatKeyInput');
  const key      = input?.value.trim() || '';
  const provider = getChatProvider();
  if (!key) { showToast('Please paste your API key.', 'error'); return; }

  if (provider === 'gemini') {
    if (!key.startsWith('AIza')) { showToast('Gemini keys start with "AIza"', 'error'); return; }
    saveGeminiKey(key);
  } else {
    if (!key.startsWith('sk-or')) { showToast('OpenRouter keys start with "sk-or"', 'error'); return; }
    setORKey(key);
  }
  showToast('Key saved! ✓', 'success');
  clearChat();
}

/* ── changeGeminiKey (called from AI analysis panel too) ── */
function changeGeminiKey() {
  if (chatIsOpen) {
    openChatSettings();
  } else {
    openChat();
    setTimeout(openChatSettings, 320);
  }
}

/* ── Chip / suggestion ── */
function useChip(btn) {
  const text  = btn.textContent;
  const input = document.getElementById('chatInput');
  if (input) { input.value = text.replace('💡 ',''); autoResizeChat(input); input.focus(); }
}

/* ── Keyboard ── */
function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
}
function autoResizeChat(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

/* ── UNIFIED API CALL — patient, waits for full response ── */
async function callAI(messages, systemPrompt, maxTokens = 700) {
  const provider = getChatProvider();

  if (provider === 'gemini') {
    // Gemini format
    const key      = getGeminiKey();
    if (!key) throw new Error('NO_KEY');

    // Inject system as first user message
    const contents = messages.map((m, i) => {
      if (i === 0 && m.role === 'user') {
        return { role:'user', parts:[{ text: systemPrompt + '\n\nUser: ' + m.parts[0].text }] };
      }
      return m;
    });

    const res = await fetch(geminiURL(key), {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig:{ temperature:0.8, maxOutputTokens: maxTokens }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      const msg = err?.error?.message || `HTTP ${res.status}`;
      if (res.status===429 || msg.toLowerCase().includes('quota')) throw new Error('QUOTA');
      if (res.status===400 || res.status===403) throw new Error('INVALID_KEY');
      throw new Error(msg);
    }
    const data  = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  } else {
    // OpenRouter format
    const key   = getORKey();
    const model = getORModel();
    if (!key) throw new Error('NO_KEY');

    // Convert Gemini-style history to OpenAI-style messages
    const oaiMessages = [
      { role:'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.parts[0].text
      }))
    ];

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'IdeaForge Pro'
      },
      body: JSON.stringify({
        model,
        messages: oaiMessages,
        max_tokens: maxTokens,
        temperature: 0.8
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      const msg = err?.error?.message || `HTTP ${res.status}`;
      if (res.status===429) throw new Error('QUOTA');
      if (res.status===401) throw new Error('INVALID_KEY');
      throw new Error(msg);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  }
}

/* ── SEND CHAT MESSAGE ── */
async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text  = input?.value?.trim();
  if (!text || chatInFlight) return;

  // Check key
  const provider = getChatProvider();
  const hasKey   = provider==='gemini' ? !!getGeminiKey() : !!getORKey();
  if (!hasKey) { showChatKeySetup(); return; }

  // Detect "fill form" intent
  const formFillTriggers = ['fill idea form','fill form','fill the form','auto fill','create idea form','build my idea','evaluate my idea','fill startup form','help me fill'];
  const isFormFill = formFillTriggers.some(t => text.toLowerCase().includes(t));

  input.value = '';
  input.style.height = 'auto';
  appendChatMsg('user', text);
  chatHistory.push({ role:'user', parts:[{ text }] });

  if (isFormFill) {
    chatHistory.pop(); // handle separately
    await handleFormFill(text);
    return;
  }

  const typingId = showTyping();
  chatInFlight   = true;
  const sendBtn  = document.getElementById('chatSendBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const reply = await callAI(chatHistory, buildChatSystemContext(), 700);
    removeTyping(typingId);

    if (!reply) {
      appendChatMsg('ai', "I couldn't generate a response. Please try again.");
      chatHistory.pop();
    } else {
      appendChatMsg('ai', reply);
      chatHistory.push({ role:'model', parts:[{ text: reply }] });
      if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
    }
  } catch(e) {
    removeTyping(typingId);
    chatHistory.pop();
    handleChatError(e);
  }

  chatInFlight = false;
  if (sendBtn) sendBtn.disabled = false;
  document.getElementById('chatInput')?.focus();
}

function handleChatError(e) {
  const msg = e.message;
  if (msg === 'NO_KEY') {
    showChatKeySetup();
  } else if (msg === 'QUOTA') {
    appendChatMsg('ai', `⚠️ **Daily quota exceeded.**\n\nYour free API key has hit its daily limit.\n- **Gemini:** Create a new key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)\n- **OpenRouter:** Use a different free model or get a new key at [openrouter.ai/keys](https://openrouter.ai/keys)\n\nClick **⚙** above to update your key.`);
  } else if (msg === 'INVALID_KEY') {
    appendChatMsg('ai', `⚠️ **Invalid API key.** Click **⚙** above to enter a valid key.`);
    const k = getChatProvider()==='gemini'
      ? (currentUser ? 'if_gemini_key_'+currentUser.uid : 'if_gemini_key')
      : (currentUser ? 'if_or_key_'+currentUser.uid : 'if_or_key');
    localStorage.removeItem(k);
  } else if (msg?.includes('NetworkError') || msg?.includes('Failed to fetch')) {
    appendChatMsg('ai', `⚠️ **Network error.** Please check your internet connection.`);
  } else {
    appendChatMsg('ai', `⚠️ **Error:** ${msg}`);
  }
}

/* ── FORM FILL FROM CHAT ── */
let formFillState = null; // tracks multi-turn form fill conversation

async function handleFormFill(userText) {
  if (!formFillState) {
    // First message — ask AI if it has enough info or needs clarification
    formFillState = { stage:'clarify', description: userText, clarifications:[] };

    const typingId = showTyping();
    chatInFlight   = true;

    try {
      const clarifyPrompt = `You are a startup idea analyst. A user wants to evaluate their startup idea. They said: "${userText}"

Your job: Determine if you have ENOUGH information to fill a comprehensive startup evaluation form, OR if you need to ask 1-3 clarifying questions.

The form requires: idea name, domain, problem statement, target user, solution, business model (who pays, pricing), technologies, market path, and moats.

If you have enough info → reply ONLY with this JSON:
{"ready": true, "summary": "brief summary of what you understood"}

If you need clarification → reply ONLY with this JSON:
{"ready": false, "questions": ["question 1", "question 2"]}

Reply with ONLY valid JSON — no markdown, no explanation.`;

      const reply = await callAI(
        [{ role:'user', parts:[{ text: clarifyPrompt }] }],
        'You are a startup idea analyst. Reply only with valid JSON.',
        300
      );
      removeTyping(typingId);
      chatInFlight = false;

      const clean  = reply.replace(/```json|```/gi,'').trim();
      const parsed = JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || clean);

      if (parsed.ready) {
        appendChatMsg('ai', `✅ Great! I have enough information. Let me fill your startup evaluation form now…\n\n*"${parsed.summary}"*`);
        await executFormFill(userText, []);
      } else {
        const qText = (parsed.questions||[]).map((q,i) => `${i+1}. ${q}`).join('\n');
        appendChatMsg('ai', `To fill your form accurately, I need a few more details:\n\n${qText}\n\nPlease answer these and I'll fill the entire form automatically!`);
        formFillState.pendingQuestions = parsed.questions;
        // Push to chat history so next message is treated as answers
        chatHistory.push({ role:'user', parts:[{ text: userText }] });
        chatHistory.push({ role:'model', parts:[{ text: qText }] });
      }
    } catch(e) {
      removeTyping(typingId);
      chatInFlight = false;
      formFillState = null;
      handleChatError(e);
    }
    document.getElementById('chatSendBtn').disabled = false;

  } else if (formFillState.stage === 'clarify') {
    // User answered the clarification questions
    appendChatMsg('user', userText);
    formFillState.answers = userText;
    formFillState.stage   = 'filling';
    appendChatMsg('ai', `Perfect! Now let me fill your complete startup evaluation form…`);
    await executFormFill(formFillState.description, [userText]);
  }
}

async function executFormFill(description, answers) {
  // Show progress overlay
  const overlay  = document.getElementById('formFillOverlay');
  const statusEl = document.getElementById('formFillStatus');
  const barEl    = document.getElementById('formFillBar');
  const stepsEl  = document.getElementById('formFillSteps');
  overlay.style.display = 'flex';

  const STEPS = [
    'Understanding your idea…',
    'Identifying the problem & user…',
    'Designing solution framework…',
    'Building market & business model…',
    'Evaluating moats & risks…',
    'Writing startup thesis…',
    'Calculating scores…',
    'Saving to your portfolio…'
  ];

  function setStep(i) {
    if (statusEl) statusEl.textContent = STEPS[i];
    if (barEl)    barEl.style.width    = ((i+1)/STEPS.length*100) + '%';
    if (stepsEl) {
      const div = document.createElement('div');
      div.className = 'form-fill-step active';
      div.innerHTML = `<span class="form-fill-step-dot"></span>${STEPS[i]}`;
      stepsEl.appendChild(div);
      stepsEl.scrollTop = stepsEl.scrollHeight;
      // Mark previous as done
      const prev = stepsEl.querySelectorAll('.form-fill-step.active');
      prev.forEach((el, idx) => { if (idx < prev.length-1) { el.classList.remove('active'); el.classList.add('done'); } });
    }
  }

  try {
    setStep(0);

    const answerText = answers.length ? `\n\nAdditional clarifications from user: ${answers.join(' | ')}` : '';
    const today_str  = today();

    const fillPrompt = `You are an expert startup evaluator. Based on the following idea description, generate a COMPLETE startup evaluation form with realistic, specific, detailed data.

IDEA DESCRIPTION: "${description}"${answerText}

Return ONLY a valid JSON object with ALL these fields:
{
  "name": "Catchy startup name with tagline",
  "domains": ["Primary domain"],
  "tags": ["tag1","tag2","tag3"],
  "valueChain": "How the current system works today (2-3 sentences)",
  "frictions": ["friction 1","friction 2","friction 3","friction 4"],
  "commonBelief": "What most people assume about this space",
  "contrarian": "It turns out that... (contrarian insight)",
  "contrarian2": "because... (reason for the contrarian insight)",
  "evidence": "Evidence supporting this insight",
  "insight": "Full contrarian insight statement in one sentence",
  "problemUser": "Type of user who has this problem",
  "problemBecause": "main struggle or pain",
  "problemDef": "root cause of the problem",
  "scores": {"pain":4,"urgency":4,"budget":3,"alternatives":4,"awareness":3},
  "targetRole": "Specific target user role/title",
  "targetContext": "Context where they face this problem",
  "dimensions": ["Speed","Cost"],
  "solution": "First-principles solution description (2-3 sentences)",
  "solutionHelp": "who you help",
  "solutionAchieve": "what they achieve",
  "solutionBy": "how your solution works",
  "solutionUnlike": "what you're different from",
  "technologies": "Key technologies used",
  "mvp": "Yes",
  "beachheadWho": "Smallest specific niche you can dominate",
  "beachheadUseCase": "Specific use case in this niche",
  "beachheadWin": "Why you can win in this niche",
  "marketPath": ["Initial niche","Next market","Long-term vision"],
  "bizWho": "Who pays",
  "bizWhat": "What they pay for",
  "bizPricing": "Pricing model (e.g. per seat/month)",
  "recurring": "Yes",
  "bizPrice": "Price point (e.g. $X/month)",
  "bizCosts": "Main costs",
  "grossMargin": "High",
  "ltv": "LTV estimate vs CAC estimate",
  "channels": ["Primary channel","Secondary channel"],
  "channelExplain": "How to acquire first 1000 customers",
  "q1": "Why 10x better than alternatives",
  "q2": "Why now — timing reason",
  "q3": "Niche dominance strategy",
  "q4": "Team/founder advantage",
  "q5": "Distribution strategy",
  "q6": "Long-term durability",
  "q7": "The secret/insight others don't have",
  "overallFilter": "Strong",
  "moats": ["Proprietary tech","Data advantage"],
  "moatExplain": "Explanation of strongest moat",
  "risks": ["Risk 1","Risk 2","Risk 3","Risk 4","Risk 5"],
  "risksControl": "Mostly",
  "asymmetricWork": "Yes",
  "asymmetricFail": "Yes",
  "asymmetricExplain": "Why this is an asymmetric bet",
  "assumptions": ["Problem is real","Willingness to pay"],
  "assumptionList": ["Assumption 1","Assumption 2","Assumption 3"],
  "experiments": ["Customer interviews","Prototype"],
  "experimentDesc": "Validation experiments to run",
  "evidence2": "Evidence collected so far",
  "summaryInsight": "Core insight in one sentence",
  "summaryProblem": "Core problem in one sentence",
  "summarySolution": "Solution in one sentence",
  "summaryUser": "Target user",
  "summaryMarket": "Market path (niche → mid → large)",
  "summaryBiz": "Business model summary",
  "summaryDist": "Distribution summary",
  "summaryMoat": "Moat summary",
  "summaryWhy": "Why now",
  "summaryVision": "10-year vision",
  "conviction": 8,
  "finalDecision": "Keep exploring",
  "finalNotes": "Key next step or observation"
}

Be specific, realistic and detailed. The scores should reflect the actual strength of the idea. Return ONLY the JSON object — no markdown, no code fences.`;

    setStep(1);
    await new Promise(r => setTimeout(r, 400));
    setStep(2);

    const reply = await callAI(
      [{ role:'user', parts:[{ text: fillPrompt }] }],
      'You are a startup evaluation expert. Return only valid JSON.',
      2000  // higher token limit for form fill
    );

    setStep(3); await new Promise(r => setTimeout(r, 300));
    setStep(4); await new Promise(r => setTimeout(r, 300));
    setStep(5); await new Promise(r => setTimeout(r, 300));

    const clean  = reply.replace(/```json|```/gi,'').trim();
    const data   = JSON.parse(clean.match(/\{[\s\S]*\}/)?.[0] || clean);

    setStep(6);

    // Build full idea object
    const newIdea = {
      ...blank(),
      ...data,
      id:   Date.now().toString(),
      date: today_str,
      // Ensure arrays are arrays
      domains:       Array.isArray(data.domains)       ? data.domains       : [data.domains||'Other'],
      tags:          Array.isArray(data.tags)           ? data.tags           : [],
      frictions:     Array.isArray(data.frictions)      ? data.frictions      : ['','','',''],
      dimensions:    Array.isArray(data.dimensions)     ? data.dimensions     : [],
      channels:      Array.isArray(data.channels)       ? data.channels       : [],
      moats:         Array.isArray(data.moats)          ? data.moats          : [],
      risks:         Array.isArray(data.risks)          ? data.risks          : ['','','','',''],
      assumptions:   Array.isArray(data.assumptions)    ? data.assumptions    : [],
      assumptionList:Array.isArray(data.assumptionList) ? data.assumptionList : ['','',''],
      experiments:   Array.isArray(data.experiments)    ? data.experiments    : [],
      marketPath:    Array.isArray(data.marketPath)     ? data.marketPath     : ['','',''],
      scores:        (data.scores && typeof data.scores==='object')
                      ? data.scores
                      : {pain:3,urgency:3,budget:3,alternatives:3,awareness:3},
      conviction:    typeof data.conviction==='number' ? data.conviction : 7,
    };

    setStep(7);
    ideas.push(newIdea);
    await saveIdeaToDB(newIdea);
    renderAll();

    // Hide overlay
    overlay.style.display = 'none';
    formFillState = null;

    // Chat confirmation
    const score = totalScore(newIdea);
    appendChatMsg('ai', `✅ **Done! "${newIdea.name}" has been saved to your portfolio.**\n\n**Problem Score:** ${score}/25 · **Conviction:** ${newIdea.conviction}/10 · **Decision:** ${newIdea.finalDecision}\n\nClick the idea card on the dashboard to view the full evaluation, or ask me anything about it!`);
    chatHistory.push({ role:'model', parts:[{ text: `Form filled and saved: ${newIdea.name}` }] });

    showToast(`"${newIdea.name}" saved to portfolio! ✓`, 'success');

  } catch(e) {
    overlay.style.display = 'none';
    formFillState = null;
    if (e.message === 'NO_KEY') { showChatKeySetup(); return; }
    appendChatMsg('ai', `⚠️ **Form fill failed.**\n\n${e.message === 'QUOTA' ? 'Daily quota exceeded — try a different API key.' : 'Could not parse AI response. Try describing your idea more clearly and try again.'}`);
  }
  chatInFlight = false;
  document.getElementById('chatSendBtn').disabled = false;
}

function buildChatSystemContext() {
  const selId     = document.getElementById('chatIdeaContext')?.value || '';
  const focusIdea = selId ? ideas.find(i => i.id === selId) : null;
  let ctx = `You are an expert startup advisor and VC mentor inside IdeaForge Pro. Be specific, actionable, honest, concise. Use markdown: **bold** for key points, bullet lists for clarity. Under 250 words unless detail is needed.\n`;
  if (focusIdea) {
    const s = totalScore(focusIdea);
    ctx += `\nFOCUSED IDEA: "${focusIdea.name}"
Domain: ${(focusIdea.domains||[]).join(', ')||'N/A'} | Score: ${s}/25 | Conviction: ${focusIdea.conviction}/10 | Decision: ${focusIdea.finalDecision||'Undecided'}
Problem: ${focusIdea.problemUser} struggles with ${focusIdea.problemBecause} because ${focusIdea.problemDef}
Solution: We help ${focusIdea.solutionHelp} achieve ${focusIdea.solutionAchieve} by ${focusIdea.solutionBy}
Market: ${focusIdea.beachheadWho} → ${(focusIdea.marketPath||[]).join(' → ')}
Biz: ${focusIdea.bizWho} pays ${focusIdea.bizPrice} for ${focusIdea.bizWhat}. Margin: ${focusIdea.grossMargin}
Moats: ${(focusIdea.moats||[]).join(', ')||'None'} | Tech: ${focusIdea.technologies||'N/A'} | MVP: ${focusIdea.mvp||'?'}
Risks: ${(focusIdea.risks||[]).filter(Boolean).join('; ')||'None'}`;
  } else if (ideas.length) {
    ctx += `\nPORTFOLIO (${ideas.length} ideas):\n`;
    ideas.forEach((idea, i) => {
      ctx += `${i+1}. "${idea.name||'Untitled'}" — Score:${totalScore(idea)}/25, Conviction:${idea.conviction||'?'}/10, Decision:${idea.finalDecision||'Undecided'}\n`;
    });
  } else {
    ctx += `\nUser has no ideas yet. Help them get started.`;
  }
  return ctx;
}

/* ── DOM helpers ── */
function appendChatMsg(role, text) {
  const box = document.getElementById('chatMessages');
  const old = box.querySelector('.chat-welcome, .chat-key-setup');
  if (old) old.remove();
  const div  = document.createElement('div');
  div.className = `chat-msg ${role}`;
  const time = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  const av   = role==='ai' ? `<div class="chat-avatar ai">AI</div>` : `<div class="chat-avatar user-av">You</div>`;
  const bub  = role==='ai'
    ? `<div class="chat-bubble">${markdownToHTML(text)}</div>`
    : `<div class="chat-bubble">${escHTML(text)}</div>`;
  div.innerHTML = av + `<div style="min-width:0">${bub}<div class="chat-meta">${time}</div></div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function showTyping() {
  const box = document.getElementById('chatMessages');
  const id  = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'chat-msg ai'; div.id = id;
  div.innerHTML = `<div class="chat-avatar ai">AI</div><div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return id;
}
function removeTyping(id) { document.getElementById(id)?.remove(); }

function clearChat() {
  chatHistory = [];
  formFillState = null;
  document.getElementById('chatMessages').innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">✦</div>
      <div class="chat-welcome-title">Chat cleared</div>
      <div class="chat-welcome-sub">Start a new conversation. Say <strong>"Fill idea form"</strong> to auto-fill a startup evaluation.</div>
    </div>`;
}

/* ── markdown → HTML ── */
function markdownToHTML(raw) {
  let t = raw
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/^#{1,4}\s+(.+)$/gm,'<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'<a href="$2" target="_blank" style="color:var(--accent)">$1</a>');
  const lines = t.split('\n'); const out = []; let inList = false;
  for (const line of lines) {
    const li = line.match(/^\s*[-*•]\s+(.+)/); const ol = line.match(/^\s*\d+\.\s+(.+)/);
    if (li||ol) { if(!inList){out.push('<ul style="padding-left:16px;margin:4px 0">');inList=true;} out.push(`<li style="margin-bottom:3px">${(li||ol)[1]}</li>`); }
    else { if(inList){out.push('</ul>');inList=false;} out.push(line); }
  }
  if(inList)out.push('</ul>');
  return out.join('\n').replace(/\n\n/g,'</p><p>').replace(/^(?!<[uop\/]|<li|<st|<em|<co|<a\s)(.+)$/gm,'<p>$1</p>').replace(/<p><\/p>/g,'').trim();
}
function escHTML(t) {
  return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// ===================== PRESET SAMPLE (first-time user only) =====================
async function loadPreset() {
  // Only load sample if user has zero ideas (new account)
  if (ideas.length) return;

  const s = blank();
  Object.assign(s, {
    id:'sample-sf', name:'SmartFleet — AI Logistics', date:'2025-12-25',
    domains:['Logistics'], tags:['ai','b2b','saas'],
    valueChain:'Manual route planning, multiple trucks per hub, delayed deliveries.',
    frictions:['High fuel costs from bad routes','Manual dispatch causes delays','Underutilized vehicle capacity','No real-time adaptive routing'],
    commonBelief:'Route planning needs human dispatchers.',
    contrarian:'AI can optimize multi-vehicle logistics 30% better than humans',
    contrarian2:'real-time data + modern ML are now mature',
    evidence:'Existing logistics firms waste 20-30% on inefficient routing.',
    insight:'AI-based route optimization reduces cost, delays, and improves fleet utilization beyond traditional human methods.',
    problemUser:'Logistics managers', problemBecause:'high costs and delays', problemDef:'manual route planning is inefficient',
    scores:{pain:5,urgency:5,budget:4,alternatives:5,awareness:3},
    targetRole:'Fleet operators', targetContext:'Daily route planning',
    dimensions:['Speed','Quality','Reliability'],
    solution:'AI integrates GPS, traffic, weather, and vehicle data to compute optimal routes in real-time.',
    solutionHelp:'fleet operators', solutionAchieve:'reduce delays and fuel costs',
    solutionBy:'AI-powered real-time route optimization', solutionUnlike:'manual dispatch software',
    technologies:'AI/ML, Cloud, GPS IoT', mvp:'Yes',
    beachheadWho:'Mid-size logistics (50-200 trucks)', beachheadUseCase:'Route optimization',
    beachheadWin:'Existing solutions are fragmented, expensive, non-real-time',
    marketPath:['Mid-size fleets','Large logistics companies','Global enterprise'],
    bizWho:'Logistics companies', bizWhat:'AI route optimization platform',
    bizPricing:'Per-vehicle per-month', recurring:'Yes', bizPrice:'$500/mo/fleet',
    bizCosts:'Cloud, AI dev, support', grossMargin:'High', ltv:'LTV $50k vs CAC $5k',
    channels:['Direct sales','Partnerships'], channelExplain:'Direct outreach + pilot programs',
    q1:'20-30% efficiency gain from AI vs human planning.',
    q2:'Real-time data, mature ML, logistics fragmentation.',
    q3:'Mid-size fleet real-time route AI — underserved niche.',
    q4:'AI engineers + logistics veterans + enterprise sales.',
    q5:'Direct sales → pilots → partnerships.',
    q6:'Proprietary data + switching costs = 10yr moat.',
    q7:'Real-time AI outperforms humans on dynamic routing.',
    overallFilter:'Strong',
    moats:['Proprietary tech','Data advantage','Network effects'],
    moatExplain:'Fleet data compounds — more trucks = better AI = harder to leave.',
    risks:['Prediction accuracy','Low adoption','Integration complexity','Competing AI','Regulation'],
    risksControl:'Mostly', asymmetricWork:'Yes', asymmetricFail:'Yes',
    asymmetricExplain:'Potential $1B+ market; downside capped at pilot costs.',
    assumptions:['Problem is real','Users care enough','Willingness to pay','Solution gets used','Channel works'],
    assumptionList:['Operators will adopt AI tools','AI gives measurable cost savings','Willingness to pay $500/mo/fleet'],
    experiments:['Customer interviews','Demo/prototype','Concierge MVP'],
    experimentDesc:'3-fleet pilot, 90 days, measure delivery time and fuel.',
    evidence2:'Pilot: 25% faster deliveries, 15% fuel savings. 3/3 willing to pay.',
    summaryInsight:'AI route optimization is radically better than human planning.',
    summaryProblem:'Manual routing wastes 20-30% of logistics costs.',
    summarySolution:'Real-time AI fleet optimization platform.',
    summaryUser:'Fleet operators & logistics companies.',
    summaryMarket:'Mid-size → Large → Enterprise globally.',
    summaryBiz:'$500/mo per fleet, SaaS recurring.',
    summaryDist:'Direct sales, enterprise pilots.',
    summaryMoat:'Data flywheel + proprietary AI + switching costs.',
    summaryWhy:'Real-time data + AI maturity = right moment.',
    summaryVision:'Global logistics intelligence platform.',
    conviction:9, finalDecision:'Commit fully',
    finalNotes:'Pilot validated — strong product-market fit. Ready to build.',
  });

  ideas.push(s);
  // Save sample idea to Firestore for new users
  if (currentUser) await saveIdeaToDB(s);
}
