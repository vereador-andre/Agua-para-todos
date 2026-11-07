import { auth, db, firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, signOut as signOutSecondary } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, query, where, limit, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const state = { user: null, profile: null, households: [], deliveries: [], drivers: [], activeTab: "all" };

let secondaryApp = null, secondaryAuth = null;
try {
  secondaryApp = initializeApp(firebaseConfig, "DriverRegistrationApp");
  secondaryAuth = getAuth(secondaryApp);
} catch (e) {}

function normalizePhone(val) {
  let d = String(val || "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d;
}

function recipientAuthEmail(phone) {
  const d = normalizePhone(phone);
  if (d.length < 10 || d.length > 11) throw new Error("Informe um telefone com DDD válido.");
  return `beneficiario.${d}@agua-para-todos.app`;
}

function loginIdentifierToEmail(id) {
  const v = String(id || "").trim();
  return v.includes("@") ? v.toLowerCase() : recipientAuthEmail(v);
}

function updateConnectionStatus() {
  const el = $("connectionStatus");
  if (!el) return;
  if (navigator.onLine) {
    el.textContent = "Online • Sistema Conectado";
    el.classList.add("ok");
  } else {
    el.textContent = "Sem Internet • Modo Offline Ativo";
    el.classList.remove("ok");
  }
}
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
updateConnectionStatus();

if ($("logoutBtn")) $("logoutBtn").onclick = () => signOut(auth);
if ($("closeModal")) $("closeModal").onclick = closeModal;
if ($("modal")) $("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };

function toast(msg) {
  if (!$("toast")) return;
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 3500);
}

function openModal(html) {
  $("modalContent").innerHTML = html;
  $("modal").classList.remove("hidden");
  document.body.classList.add("no-scroll");
}

function closeModal() {
  if ($("modal")) $("modal").classList.add("hidden");
  if ($("modalContent")) $("modalContent").innerHTML = "";
  document.body.classList.remove("no-scroll");
}

function esc(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
}

function dateOnly(v) {
  if (!v) return "—";
  return new Date(v + "T12:00:00").toLocaleDateString("pt-BR");
}

/* LOGIN */
if ($("loginForm")) {
  $("loginForm").onsubmit = async e => {
    e.preventDefault();
    if ($("loginMsg")) $("loginMsg").textContent = "";
    try {
      const email = loginIdentifierToEmail($("loginEmail").value.trim());
      await signInWithEmailAndPassword(auth, email, $("loginPassword").value);
    } catch (err) {
      if ($("loginMsg")) $("loginMsg").textContent = "Acesso negado: Verifique os dados.";
    }
  };
}

/* AUTHENTICATION */
onAuthStateChanged(auth, async user => {
  if (!user) {
    state.user = null; state.profile = null;
    if ($("loginView")) $("loginView").classList.remove("hidden");
    if ($("appView")) $("appView").classList.add("hidden");
    return;
  }

  state.user = user;
  if ($("loginView")) $("loginView").classList.add("hidden");
  if ($("appView")) $("appView").classList.remove("hidden");

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) state.profile = { id: snap.id, ...snap.data() };
    if (!state.profile) { toast("Usuário sem perfil cadastrado."); return; }

    if ($("userName")) $("userName").textContent = state.profile.name || "Usuário";
    if ($("userRole")) $("userRole").textContent = state.profile.role === "admin" ? "Administrador" : state.profile.role === "driver" ? "Motorista" : "Beneficiário";
    if ($("userAvatar")) $("userAvatar").textContent = (state.profile.name || "U").charAt(0).toUpperCase();

    await renderByRole();
  } catch (err) {
    toast("Erro ao carregar sessão.");
  }
});

async function renderByRole() {
  ["adminPanel", "driverPanel", "recipientPanel"].forEach(id => { if ($(id)) $(id).classList.add("hidden"); });
  if (state.profile.role === "admin") {
    if ($("adminPanel")) $("adminPanel").classList.remove("hidden");
    await renderAdmin();
  } else if (state.profile.role === "driver") {
    if ($("driverPanel")) $("driverPanel").classList.remove("hidden");
    await renderDriver();
  } else if (state.profile.role === "recipient") {
    if ($("recipientPanel")) $("recipientPanel").classList.remove("hidden");
    await renderRecipient();
  }
}

/* ADMIN DASHBOARD */
async function renderAdmin() {
  try {
    const [snapF, snapD, snapM] = await Promise.all([
      getDocs(collection(db, "households")),
      getDocs(query(collection(db, "deliveries"), limit(100))),
      getDocs(query(collection(db, "users"), where("role", "==", "driver")))
    ]);

    state.households = snapF.docs.map(d => ({ id: d.id, ...d.data() }));
    state.deliveries = snapD.docs.map(d => ({ id: d.id, ...d.data() }));
    state.drivers = snapM.docs.map(d => ({ id: d.id, ...d.data() }));

    renderAdminDashboard();
  } catch (err) {
    console.error(err);
  }
}

function renderAdminDashboard() {
  const pending = state.deliveries.filter(d => d.status === "scheduled").length;
  const completed = state.deliveries.filter(d => d.status === "completed").length;

  $("adminPanel").innerHTML = `
    <!-- CARDS DE ESTATÍSTICA -->
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: var(--text-title);">Painel Geral de Abastecimento</h2>
          <p class="small">Sistema de Monitoramento • Areia Branca/RN</p>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <span class="icon">🏡</span>
          <div class="title">Famílias</div>
          <div class="value">${state.households.length}</div>
        </div>
        <div class="stat-card">
          <span class="icon">🚚</span>
          <div class="title">Motoristas</div>
          <div class="value">${state.drivers.length}</div>
        </div>
        <div class="stat-card">
          <span class="icon">⏳</span>
          <div class="title">Agendados</div>
          <div class="value">${pending}</div>
        </div>
        <div class="stat-card">
          <span class="icon">✅</span>
          <div class="title">Entregues</div>
          <div class="value">${completed}</div>
        </div>
      </div>
    </div>

    <!-- NAVEGAÇÃO DE OPERAÇÃO (CHIPS/TABS) -->
    <div class="card">
      <div style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 20px;">
        <button class="primary" id="btnNewFam">🏡 + Família</button>
        <button class="primary" id="btnNewMot">🚚 + Motorista</button>
        <button class="accent" id="btnNewAg">💧 Agendar Pipa</button>
      </div>

      <div style="display: flex; gap: 8px; border-bottom: 1.5px solid var(--border); padding-bottom: 12px; margin-bottom: 20px; overflow-x: auto;">
        <button class="secondary small" data-tab="all" style="font-weight: 800;">Todos os Registros</button>
        <button class="secondary small" data-tab="familias">Famílias Rurais</button>
        <button class="secondary small" data-tab="motoristas">Motoristas</button>
        <button class="secondary small" data-tab="entregas">Entregas</button>
      </div>

      <div id="dynamicRecords" class="records-grid"></div>
    </div>
  `;

  $("btnNewFam").onclick = showHouseholdForm;
  $("btnNewMot").onclick = showDriverForm;
  $("btnNewAg").onclick = showDeliveryForm;

  document.querySelectorAll("[data-tab]").forEach(b => {
    b.onclick = () => {
      state.activeTab = b.dataset.tab;
      renderDynamicRecords();
    };
  });

  renderDynamicRecords();
}

function renderDynamicRecords() {
  const container = $("dynamicRecords");
  if (!container) return;
  container.innerHTML = "";

  const tab = state.activeTab;

  // 1. Famílias
  if (tab === "all" || tab === "familias") {
    state.households.forEach(h => {
      const el = document.createElement("div");
      el.className = "record-card";
      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🏡 ${esc(h.name)}</div>
          <span class="pill completed">Ativa</span>
        </div>
        <p class="small"><b>Telefone:</b> ${esc(h.phone)}</p>
        <p class="small"><b>Comunidade:</b> ${esc(h.community)}</p>
        <p class="small"><b>Cisterna:</b> ${h.defaultLiters || 5000} Litros</p>
      `;
      container.appendChild(el);
    });
  }

  // 2. Motoristas
  if (tab === "all" || tab === "motoristas") {
    state.drivers.forEach(m => {
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = "#bae6fd";
      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🚚 ${esc(m.name)}</div>
          <span class="pill scheduled">Motorista</span>
        </div>
        <p class="small"><b>E-mail:</b> ${esc(m.email)}</p>
        <p class="small"><b>Telefone:</b> ${esc(m.phone || '—')}</p>
      `;
      container.appendChild(el);
    });
  }

  // 3. Entregas
  if (tab === "all" || tab === "entregas") {
    state.deliveries.forEach(d => {
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = d.status === "completed" ? "#a7f3d0" : "#fef08a";
      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">💧 ${esc(d.recipientName)}</div>
          <span class="pill ${d.status === 'completed' ? 'completed' : 'scheduled'}">${d.status === 'completed' ? 'Entregue' : 'Agendada'}</span>
        </div>
        <p class="small"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters}L</p>
        <p class="small"><b>Motorista:</b> ${esc(d.driverName || 'Não atribuído')}</p>
      `;
      container.appendChild(el);
    });
  }
}

/* MODAIS */
function showHouseholdForm() {
  openModal(`
    <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 18px;">🏡 Cadastrar Família Rural</h2>
    <form id="hForm">
      <label>Nome do Responsável <input id="hName" required></label>
      <label>Telefone / WhatsApp (Login) <input id="hPhone" type="tel" placeholder="84999999999" required></label>
      <label>Senha Inicial <input id="hPassword" type="password" minlength="6" placeholder="Mínimo 6 caracteres" required></label>
      <label>Comunidade <input id="hComm" placeholder="Ex: Ponta do Mel" required></label>
      <label>Endereço / Referência <input id="hAddr" required></label>
      <label>Volume Cisterna (Litros) <input id="hLit" type="number" value="5000" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canH" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">Confirmar Cadastro</button>
      </div>
    </form>
  `);
  $("canH").onclick = closeModal;

  $("hForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const authEmail = recipientAuthEmail($("hPhone").value.trim());
      const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, $("hPassword").value);
      
      const ref = await addDoc(collection(db, "households"), {
        name: $("hName").value.trim(), phone: $("hPhone").value.trim(), recipientUid: cred.user.uid,
        community: $("hComm").value.trim(), address: $("hAddr").value.trim(), defaultLiters: Number($("hLit").value),
        active: true, createdAt: serverTimestamp()
      });

      await setDoc(doc(db, "users", cred.user.uid), {
        name: $("hName").value.trim(), phone: $("hPhone").value.trim(), authEmail, role: "recipient", active: true, householdId: ref.id, createdAt: serverTimestamp()
      });

      try { await signOutSecondary(secondaryAuth); } catch(e){}
      closeModal();
      toast("Família cadastrada com sucesso!");
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDriverForm() {
  openModal(`
    <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 18px;">🚚 Cadastrar Motorista</h2>
    <form id="mForm">
      <label>Nome Completo <input id="mName" required></label>
      <label>E-mail de Login <input id="mEmail" type="email" required></label>
      <label>Telefone <input id="mPhone" type="tel" required></label>
      <label>Senha Inicial <input id="mPass" type="password" minlength="6" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canM" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">Salvar Motorista</button>
      </div>
    </form>
  `);
  $("canM").onclick = closeModal;

  $("mForm").onsubmit = async e => {
    e.preventDefault();
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, $("mEmail").value.trim().toLowerCase(), $("mPass").value);
      await setDoc(doc(db, "users", cred.user.uid), {
        name: $("mName").value.trim(), email: $("mEmail").value.trim().toLowerCase(), phone: $("mPhone").value.trim(), role: "driver", active: true, createdAt: serverTimestamp()
      });
      try { await signOutSecondary(secondaryAuth); } catch(e){}
      closeModal();
      toast("Motorista cadastrado!");
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDeliveryForm() {
  openModal(`
    <h2 style="font-size: 20px; font-weight: 800; margin-bottom: 18px;">💧 Programar Entrega</h2>
    <form id="dForm">
      <label>Família <select id="sFam" required><option value="">Selecione...</option>${state.households.map(h => `<option value="${h.id}">${esc(h.name)} - ${esc(h.community)}</option>`).join("")}</select></label>
      <label>Motorista <select id="sMot" required><option value="">Selecione...</option>${state.drivers.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select></label>
      <label>Data Prevista <input id="sDate" type="date" required></label>
      <label>Volume (Litros) <input id="sLit" type="number" value="5000" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canD" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">Confirmar Agendamento</button>
      </div>
    </form>
  `);
  $("canD").onclick = closeModal;

  $("sFam").onchange = e => {
    const f = state.households.find(h => h.id === e.target.value);
    if (f && f.defaultLiters) $("sLit").value = f.defaultLiters;
  };

  $("dForm").onsubmit = async e => {
    e.preventDefault();
    const f = state.households.find(h => h.id === $("sFam").value);
    const m = state.drivers.find(d => d.id === $("sMot").value);
    try {
      await addDoc(collection(db, "deliveries"), {
        householdId: f.id, recipientName: f.name, community: f.community, address: f.address,
        driverUid: m.id, driverName: m.name, scheduledDate: $("sDate").value, plannedLiters: Number($("sLit").value),
        status: "scheduled", createdAt: serverTimestamp()
      });
      closeModal();
      toast("Entrega agendada!");
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

/* PAINÉIS SECUNDÁRIOS */
async function renderDriver() {
  $("driverPanel").innerHTML = `<div class="card"><h2 style="font-size: 20px; font-weight: 800;">🚚 Minhas Entregas</h2><div id="dList" class="records-grid" style="margin-top:16px;"></div></div>`;
  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("driverUid", "==", state.user.uid)));
    $("dList").innerHTML = snap.docs.map(d => {
      const item = d.data();
      return `<div class="record-card"><div class="record-header"><div class="record-title">💧 ${esc(item.recipientName)}</div><span class="pill ${item.status}">${item.status}</span></div><p class="small"><b>Data:</b> ${dateOnly(item.scheduledDate)} · <b>Litros:</b> ${item.plannedLiters}L</p></div>`;
    }).join("") || "<p class='small'>Nenhuma entrega atribuída.</p>";
  } catch(e){}
}

async function renderRecipient() {
  $("recipientPanel").innerHTML = `<div class="card"><h2 style="font-size: 20px; font-weight: 800;">🏡 Abastecimentos da Família</h2><div id="rList" class="records-grid" style="margin-top:16px;"></div></div>`;
  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("householdId", "==", state.profile.householdId)));
    $("rList").innerHTML = snap.docs.map(d => {
      const item = d.data();
      return `<div class="record-card"><div class="record-header"><div class="record-title">💧 Entrega em ${dateOnly(item.scheduledDate)}</div><span class="pill ${item.status}">${item.status}</span></div><p class="small"><b>Volume:</b> ${item.plannedLiters}L · <b>Motorista:</b> ${esc(item.driverName || '—')}</p></div>`;
    }).join("") || "<p class='small'>Nenhum abastecimento encontrado.</p>";
  } catch(e){}
}
