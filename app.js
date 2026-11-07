import {
  auth,
  db,
  storage,
  firebaseConfig
} from "./firebase-config.js";

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  signOut as signOutSecondary
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  query,
  where,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

/* =========================================================
   ESTADO DA APLICAÇÃO
========================================================= */

const $ = id => document.getElementById(id);

const state = {
  user: null,
  profile: null,
  households: [],
  deliveries: [],
  drivers: []
};

/* =========================================================
   FIREBASE SECUNDÁRIO PARA CADASTROS
========================================================= */

let secondaryApp = null;
let secondaryAuth = null;

try {
  secondaryApp = initializeApp(firebaseConfig, "DriverRegistrationApp");
  secondaryAuth = getAuth(secondaryApp);
} catch (error) {
  console.error("Erro ao inicializar Firebase secundário:", error);
}

/* =========================================================
   ACESSO POR TELEFONE DO BENEFICIÁRIO
========================================================= */

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits;
}

function recipientAuthEmail(phone) {
  const digits = normalizePhone(phone);
  if (digits.length < 10 || digits.length > 11) {
    throw new Error("Informe um telefone brasileiro válido, com DDD.");
  }
  return `beneficiario.${digits}@agua-para-todos.app`;
}

function loginIdentifierToEmail(identifier) {
  const value = String(identifier || "").trim();
  if (value.includes("@")) {
    return value.toLowerCase();
  }
  return recipientAuthEmail(value);
}

if ($("loginEmail")) {
  $("loginEmail").type = "text";
  $("loginEmail").inputMode = "text";
  $("loginEmail").autocomplete = "username";
  $("loginEmail").placeholder = "E-mail ou telefone (com DDD)";
}

/* =========================================================
   CONEXÃO E EVENTOS GERAIS
========================================================= */

function updateConnectionStatus() {
  const el = $("connectionStatus");
  if (!el) return;

  if (navigator.onLine) {
    el.textContent = "Online • Sistema Conectado";
    el.classList.add("ok");
  } else {
    el.textContent = "Sem internet • Modo Offline Ativo";
    el.classList.remove("ok");
  }
}

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
updateConnectionStatus();

if ($("logoutBtn")) {
  $("logoutBtn").onclick = () => signOut(auth);
}

if ($("closeModal")) {
  $("closeModal").onclick = closeModal;
}

if ($("modal")) {
  $("modal").onclick = event => {
    if (event.target.id === "modal") closeModal();
  };
}

function toast(message) {
  if (!$("toast")) return;
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => {
    $("toast").classList.remove("show");
  }, 3500);
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

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function dateOnly(value) {
  if (!value) return "—";
  return new Date(value + "T12:00:00").toLocaleDateString("pt-BR");
}

/* =========================================================
   LOGIN
========================================================= */

if ($("loginForm")) {
  $("loginForm").onsubmit = async event => {
    event.preventDefault();
    if ($("loginMsg")) $("loginMsg").textContent = "";

    try {
      const identifier = $("loginEmail").value.trim();
      const email = loginIdentifierToEmail(identifier);

      await signInWithEmailAndPassword(auth, email, $("loginPassword").value);
    } catch (error) {
      console.error("Erro no login:", error);
      if ($("loginMsg")) {
        $("loginMsg").textContent = `Falha ao entrar: Verifique seu telefone/e-mail e senha.`;
      }
    }
  };
}

/* =========================================================
   AUTENTICAÇÃO E CARREGAMENTO DO PERFIL
========================================================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    state.user = null;
    state.profile = null;
    if ($("loginView")) $("loginView").classList.remove("hidden");
    if ($("appView")) $("appView").classList.add("hidden");
    return;
  }

  state.user = user;
  if ($("loginView")) $("loginView").classList.add("hidden");
  if ($("appView")) $("appView").classList.remove("hidden");

  updateConnectionStatus();

  try {
    let profile = null;
    const snapshot = await getDoc(doc(db, "users", user.uid));

    if (snapshot.exists()) {
      profile = { id: snapshot.id, ...snapshot.data() };
    }

    if (!profile) {
      toast("Usuário autenticado, mas sem perfil cadastrado.");
      return;
    }

    if (profile.active === false) {
      toast("Este usuário está inativo.");
      await signOut(auth);
      return;
    }

    state.profile = profile;

    if ($("userName")) {
      $("userName").textContent = profile.name || user.email || "Usuário";
    }

    if ($("userRole")) {
      $("userRole").textContent = roleLabel(profile.role);
    }

    await renderByRole();
  } catch (error) {
    console.error("Erro ao carregar perfil:", error);
    toast("Erro ao carregar seu perfil.");
  }
});

function roleLabel(role) {
  return ({
    admin: "Administrador",
    driver: "Motorista",
    recipient: "Beneficiário"
  })[role] || role || "Usuário";
}

async function renderByRole() {
  ["adminPanel", "driverPanel", "recipientPanel"].forEach(id => {
    if ($(id)) $(id).classList.add("hidden");
  });

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

/* =========================================================
   PAINEL ADMINISTRATIVO COM BOTÕES MODERNOS E FIGURINHAS
========================================================= */

async function renderAdmin() {
  try {
    const householdSnapshot = await getDocs(collection(db, "households"));
    state.households = householdSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));

    const deliverySnapshot = await getDocs(query(collection(db, "deliveries"), limit(100)));
    state.deliveries = deliverySnapshot.docs.map(item => ({ id: item.id, ...item.data() }));

    await loadDriversList();
    renderAdminMenu();
  } catch (error) {
    console.error("Erro no painel administrativo:", error);
  }
}

async function loadDriversList() {
  try {
    const driverSnapshot = await getDocs(query(collection(db, "users"), where("role", "==", "driver")));
    state.drivers = driverSnapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  } catch (e) {
    state.drivers = [];
  }
}

function renderAdminMenu() {
  const pending = state.deliveries.filter(item => item.status === "scheduled").length;
  const completed = state.deliveries.filter(item => item.status === "completed").length;

  $("adminPanel").innerHTML = `
    <div class="card">
      <div class="panel-title">
        <div>
          <h2>Gestão de Abastecimento</h2>
          <p class="small">Programa Municipal • Areia Branca-RN</p>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><span>Famílias</span><b>${state.households.length}</b></div>
        <div class="stat"><span>Programadas</span><b>${pending}</b></div>
        <div class="stat"><span>Concluídas</span><b>${completed}</b></div>
      </div>
    </div>

    <!-- BOTÕES FLUIDOS COM FIGURINHAS E PADRÃO MODERNO -->
    <div class="card">
      <div class="panel-title"><h2>Menu de Operações</h2></div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
        <button class="primary" data-admin-menu="households" style="justify-content: flex-start; padding: 16px;">
          <span style="font-size: 20px;">🏡</span> Famílias / Imóveis
        </button>
        <button class="primary" data-admin-menu="drivers" style="justify-content: flex-start; padding: 16px;">
          <span style="font-size: 20px;">🚚</span> Motoristas de Pipa
        </button>
        <button class="primary" data-admin-menu="new-delivery" style="justify-content: flex-start; padding: 16px; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);">
          <span style="font-size: 20px;">📅</span> Programar Entrega
        </button>
        <button class="secondary" data-admin-menu="history" style="justify-content: flex-start; padding: 16px;">
          <span style="font-size: 20px;">📋</span> Histórico Geral
        </button>
      </div>
    </div>

    <div id="adminContent" style="margin-top: 20px;"></div>
  `;

  document.querySelectorAll("[data-admin-menu]").forEach(button => {
    button.onclick = () => handleAdminMenu(button.dataset.adminMenu);
  });
}

async function handleAdminMenu(section) {
  if (section === "households") return renderAdminHouseholds();
  if (section === "drivers") return renderAdminDrivers();
  if (section === "new-delivery") return showDeliveryForm();
  if (section === "history") return renderAdminDeliveries("all", "Histórico Geral de Entregas");
}

function renderAdminHouseholds() {
  const content = $("adminContent");
  if (!content) return;
  content.innerHTML = `
    <div class="card">
      <div class="panel-title">
        <h2>Famílias Rurais Cadastradas</h2>
        <button class="primary small" id="adminNewHousehold">➕ Nova Família</button>
      </div>
      <div class="grid">
        ${state.households.map(h => `
          <div class="item">
            <h3>🏡 ${esc(h.name)}</h3>
            <p style="margin-top: 6px;"><b>Telefone:</b> ${esc(h.phone)} · <b>Comunidade:</b> ${esc(h.community)}</p>
            <p><b>Volume Cisterna:</b> ${h.defaultLiters || 5000} L · <b>Ref:</b> ${esc(h.address || '—')}</p>
          </div>
        `).join("") || "<p class='small'>Nenhuma família cadastrada ainda.</p>"}
      </div>
    </div>
  `;
  $("adminNewHousehold").onclick = showHouseholdForm;
}

function showHouseholdForm() {
  openModal(`
    <h2>🏡 Cadastrar Família Rural</h2>
    <form id="householdForm" style="margin-top: 15px;">
      <label>Nome do Responsável <input id="hName" required></label>
      <label>Telefone / WhatsApp (Login) <input id="hPhone" type="tel" placeholder="84999999999" required></label>
      <label>Senha Inicial <input id="hPassword" type="password" minlength="6" placeholder="Mínimo 6 dígitos" required></label>
      <label>Comunidade / Assentamento <input id="hCommunity" placeholder="Ex: Ponta do Mel" required></label>
      <label>Endereço / Ponto de Referência <input id="hAddress" placeholder="Próximo à caixa d'água" required></label>
      <label>Litros por Entrega <input id="hLiters" type="number" value="5000" required></label>
      <div class="actions" style="margin-top: 20px;">
        <button type="button" class="secondary" id="cancelH" style="flex: 1;">Cancelar</button>
        <button type="submit" class="primary" style="flex: 2;">Salvar Família</button>
      </div>
    </form>
  `);
  $("cancelH").onclick = closeModal;

  $("householdForm").onsubmit = async e => {
    e.preventDefault();
    const name = $("hName").value.trim();
    const phone = $("hPhone").value.trim();
    const password = $("hPassword").value;
    const community = $("hCommunity").value.trim();
    const address = $("hAddress").value.trim();
    const defaultLiters = Number($("hLiters").value);

    try {
      const authEmail = recipientAuthEmail(phone);
      const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, password);
      
      const ref = await addDoc(collection(db, "households"), {
        name, phone, recipientUid: cred.user.uid, community, address, defaultLiters, active: true, createdAt: serverTimestamp()
      });

      await setDoc(doc(db, "users", cred.user.uid), {
        name, phone, authEmail, role: "recipient", active: true, householdId: ref.id, createdAt: serverTimestamp()
      });

      try { await signOutSecondary(secondaryAuth); } catch(_){}
      closeModal();
      toast("Família cadastrada com sucesso!");
      renderAdmin();
    } catch(err) {
      alert("Erro ao cadastrar: " + err.message);
    }
  };
}

function renderAdminDrivers() {
  const content = $("adminContent");
  if (!content) return;
  content.innerHTML = `
    <div class="card">
      <div class="panel-title">
        <h2>Motoristas Cadastrados</h2>
        <button class="primary small" id="adminNewDriver">➕ Novo Motorista</button>
      </div>
      <div class="grid">
        ${state.drivers.map(d => `
          <div class="item">
            <h3>🚚 ${esc(d.name)}</h3>
            <p style="margin-top: 6px;"><b>E-mail:</b> ${esc(d.email)} · <b>Telefone:</b> ${esc(d.phone || '—')}</p>
          </div>
        `).join("") || "<p class='small'>Nenhum motorista cadastrado ainda.</p>"}
      </div>
    </div>
  `;
  $("adminNewDriver").onclick = showDriverForm;
}

function showDriverForm() {
  openModal(`
    <h2>🚚 Cadastrar Motorista</h2>
    <form id="driverForm" style="margin-top: 15px;">
      <label>Nome Completo <input id="dName" required></label>
      <label>E-mail de Acesso <input id="dEmail" type="email" placeholder="motorista@agua.com" required></label>
      <label>Telefone <input id="dPhone" type="tel" required></label>
      <label>Senha Inicial <input id="dPassword" type="password" minlength="6" required></label>
      <div class="actions" style="margin-top: 20px;">
        <button type="button" class="secondary" id="cancelD" style="flex: 1;">Cancelar</button>
        <button type="submit" class="primary" style="flex: 2;">Salvar Motorista</button>
      </div>
    </form>
  `);
  $("cancelD").onclick = closeModal;

  $("driverForm").onsubmit = async e => {
    e.preventDefault();
    const name = $("dName").value.trim();
    const email = $("dEmail").value.trim().toLowerCase();
    const phone = $("dPhone").value.trim();
    const password = $("dPassword").value;

    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), {
        name, email, phone, role: "driver", active: true, createdAt: serverTimestamp()
      });
      try { await signOutSecondary(secondaryAuth); } catch(_){}
      closeModal();
      toast("Motorista cadastrado com sucesso!");
      renderAdmin();
    } catch(err) {
      alert("Erro ao cadastrar motorista: " + err.message);
    }
  };
}

function showDeliveryForm() {
  const content = $("adminContent");
  if (!content) return;
  content.innerHTML = `
    <div class="card">
      <h2>📅 Programar Entrega de Pipa</h2>
      <form id="delForm" style="margin-top: 15px;">
        <label>Selecione a Família <select id="selFam" required>
          <option value="">Escolha a família...</option>
          ${state.households.map(h => `<option value="${h.id}">${esc(h.name)} - ${esc(h.community)}</option>`).join("")}
        </select></label>

        <label>Selecione o Motorista <select id="selMot" required>
          <option value="">Escolha o motorista...</option>
          ${state.drivers.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}
        </select></label>

        <label>Data Prevista <input id="selDate" type="date" required></label>
        <label>Volume (Litros) <input id="selLit" type="number" value="5000" required></label>
        
        <div class="actions" style="margin-top: 20px;">
          <button type="submit" class="primary full-width">Confirmar Agendamento</button>
        </div>
      </form>
    </div>
  `;

  $("selFam").onchange = e => {
    const fam = state.households.find(h => h.id === e.target.value);
    if (fam && fam.defaultLiters) $("selLit").value = fam.defaultLiters;
  };

  $("delForm").onsubmit = async e => {
    e.preventDefault();
    const famId = $("selFam").value;
    const motId = $("selMot").value;
    const fam = state.households.find(h => h.id === famId);
    const mot = state.drivers.find(d => d.id === motId);

    if (!fam || !mot) {
      alert("Selecione a família e o motorista.");
      return;
    }

    try {
      await addDoc(collection(db, "deliveries"), {
        householdId: famId,
        recipientName: fam.name,
        community: fam.community,
        address: fam.address,
        driverUid: motId,
        driverName: mot.name,
        scheduledDate: $("selDate").value,
        plannedLiters: Number($("selLit").value),
        status: "scheduled",
        createdAt: serverTimestamp()
      });
      toast("Entrega agendada com sucesso!");
      renderAdmin();
    } catch(err) {
      alert("Erro ao agendar: " + err.message);
    }
  };
}

function renderAdminDeliveries(statusFilter, title) {
  const content = $("adminContent");
  if (!content) return;
  content.innerHTML = `
    <div class="card">
      <h2>📋 ${title}</h2>
      <div class="grid" style="margin-top: 15px;">
        ${state.deliveries.map(d => `
          <div class="item">
            <h3>💧 ${esc(d.recipientName)}</h3>
            <p style="margin-top: 6px;"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
            <p><b>Motorista:</b> ${esc(d.driverName || '—')} · <span class="pill ${d.status}">${d.status}</span></p>
          </div>
        `).join("") || "<p class='small'>Nenhuma entrega encontrada.</p>"}
      </div>
    </div>
  `;
}

/* =========================================================
   PAINEL DO MOTORISTA E BENEFICIÁRIO
========================================================= */

async function renderDriver() {
  $("driverPanel").innerHTML = `
    <div class="card">
      <h2>🚚 Minhas Entregas Atribuídas</h2>
      <div id="driverList" style="margin-top: 15px;"><p class="small">Carregando entregas...</p></div>
    </div>
  `;
  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("driverUid", "==", state.user.uid)));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    $("driverList").innerHTML = items.map(d => `
      <div class="item">
        <h3>💧 ${esc(d.recipientName)}</h3>
        <p style="margin-top: 6px;"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
        <span class="pill ${d.status}">${d.status}</span>
      </div>
    `).join("") || "<p class='small'>Nenhuma entrega programada para você no momento.</p>";
  } catch(e) {}
}

async function renderRecipient() {
  $("recipientPanel").innerHTML = `
    <div class="card">
      <h2>🏡 Minhas Entregas de Água</h2>
      <div id="recList" style="margin-top: 15px;"><p class="small">Buscando histórico...</p></div>
    </div>
  `;
  try {
    const hId = state.profile.householdId;
    const snap = await getDocs(query(collection(db, "deliveries"), where("householdId", "==", hId)));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    $("recList").innerHTML = items.map(d => `
      <div class="item">
        <h3>💧 Abastecimento em ${dateOnly(d.scheduledDate)}</h3>
        <p style="margin-top: 6px;"><b>Volume:</b> ${d.plannedLiters} L · <b>Motorista:</b> ${esc(d.driverName || "—")}</p>
        <span class="pill ${d.status}">${d.status}</span>
      </div>
    `).join("") || "<p class='small'>Nenhum abastecimento registrado para sua família ainda.</p>";
  } catch(e) {}
}
