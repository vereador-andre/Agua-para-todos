import { auth, db, firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, signOut as signOutSecondary } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const state = { 
  user: null, 
  profile: null, 
  households: [], 
  deliveries: [], 
  drivers: [], 
  vehicles: [],
  filters: { category: null, searchTerm: "" }
};

let secondaryApp = null, secondaryAuth = null;
try {
  secondaryApp = initializeApp(firebaseConfig, "DriverRegistrationApp");
  secondaryAuth = getAuth(secondaryApp);
} catch (e) {}

/* HIGIENIZAÇÃO E MÁSCARAS */
function sanitizeText(str = "") {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function attachUppercaseNoAccent(input) {
  input.oninput = e => {
    const cursor = e.target.selectionStart;
    e.target.value = sanitizeText(e.target.value);
    e.target.setSelectionRange(cursor, cursor);
  };
}

function applyPhoneMask(input) {
  input.oninput = e => {
    let v = e.target.value.replace(/\D/g, "").slice(0, 11);
    if (v.length > 10) {
      v = v.replace(/^(\d{2})(\d{5})(\d{4}).*/, "($1) $2-$3");
    } else if (v.length > 6) {
      v = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
    } else if (v.length > 2) {
      v = v.replace(/^(\d{2})(\d{0,5})/, "($1) $2");
    } else if (v.length > 0) {
      v = v.replace(/^(\d*)/, "($1");
    }
    e.target.value = v;
  };
}

function applyPlateMask(input) {
  input.oninput = e => {
    let v = sanitizeText(e.target.value).replace(/[^A-Z0-9]/g, "").slice(0, 7);
    if (v.length > 3) {
      v = v.slice(0, 3) + "-" + v.slice(3);
    }
    e.target.value = v;
  };
}

function normalizePhone(val) {
  return String(val || "").replace(/\D/g, "");
}

function phoneAuthEmail(phone) {
  const d = normalizePhone(phone);
  if (d.length < 10 || d.length > 11) throw new Error("Informe um telefone com DDD válido.");
  return `usuario.${d}@agua-para-todos.app`;
}

function loginIdentifierToEmail(id) {
  const v = String(id || "").trim();
  if (v.includes("@")) return v.toLowerCase();
  return phoneAuthEmail(v);
}

function updateConnectionStatus() {
  const el = $("connectionStatus");
  if (!el) return;
  if (!state.user) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
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
      if ($("loginMsg")) $("loginMsg").textContent = "Acesso negado: Verifique seu telefone/e-mail e senha de 6 dígitos.";
    }
  };
}

/* AUTENTICAÇÃO E CARREGAMENTO POR CARGO */
onAuthStateChanged(auth, async user => {
  if (!user) {
    state.user = null; state.profile = null;
    updateConnectionStatus();
    if ($("loginView")) $("loginView").classList.remove("hidden");
    if ($("appView")) $("appView").classList.add("hidden");
    return;
  }

  state.user = user;
  updateConnectionStatus();
  if ($("loginView")) $("loginView").classList.add("hidden");
  if ($("appView")) $("appView").classList.remove("hidden");

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) state.profile = { id: snap.id, ...snap.data() };
    if (!state.profile) { toast("Usuário sem perfil cadastrado."); return; }

    if ($("userName")) $("userName").textContent = state.profile.name || "USUÁRIO";
    if ($("userRole")) $("userRole").textContent = state.profile.role === "admin" ? "Administrador" : state.profile.role === "driver" ? "Motorista" : "Beneficiário";
    if ($("userAvatar")) $("userAvatar").textContent = state.profile.role === "admin" ? "🛡️" : state.profile.role === "driver" ? "👤" : "🏡";

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

/* =========================================================
   PAINEL DO ADMINISTRADOR
========================================================= */
async function renderAdmin() {
  try {
    const [snapF, snapD, snapM, snapV] = await Promise.all([
      getDocs(collection(db, "households")),
      getDocs(query(collection(db, "deliveries"), limit(100))),
      getDocs(query(collection(db, "users"), where("role", "==", "driver"))),
      getDocs(collection(db, "vehicles"))
    ]);

    state.households = snapF.docs.map(d => ({ id: d.id, ...d.data() }));
    state.deliveries = snapD.docs.map(d => ({ id: d.id, ...d.data() }));
    state.drivers = snapM.docs.map(d => ({ id: d.id, ...d.data() }));
    state.vehicles = snapV.docs.map(d => ({ id: d.id, ...d.data() }));

    renderAdminDashboard();
  } catch (err) {
    console.error(err);
  }
}

function renderAdminDashboard() {
  const scheduledCount = state.deliveries.filter(d => d.status === "scheduled").length;
  const completedCount = state.deliveries.filter(d => d.status === "completed").length;
  const pendingCount = state.deliveries.filter(d => d.status === "pending" || d.status === "awaiting_approval").length;

  $("adminPanel").innerHTML = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <h2 style="font-size: 18px; font-weight: 800; color: var(--text-title);">Visão Geral do Programa</h2>
          <p class="small">Areia Branca/RN • Clique nos quadros para ver os dados</p>
        </div>
        <button class="accent small" id="btnAuditoria">📊 Auditoria Geral</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card" id="cardFamilias"><span class="icon">🏡</span><div class="title">Famílias</div><div class="value">${state.households.length}</div></div>
        <div class="stat-card" id="cardMotoristas"><span class="icon">👤</span><div class="title">Motoristas</div><div class="value">${state.drivers.length}</div></div>
        <div class="stat-card" id="cardVeiculos"><span class="icon">🚛</span><div class="title">Veículos</div><div class="value">${state.vehicles.length}</div></div>
        
        <div class="stat-card" id="cardEntregas" style="background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); border-color: #7dd3fc;">
          <span class="icon">🌊</span>
          <div class="title" style="color: #0369a1;">Total Entregas</div>
          <div class="value" style="color: #0c4a6e;">${state.deliveries.length}</div>
          <div style="margin-top: 6px; font-size: 10px; font-weight: 800; color: #0284c7; border-top: 1px dashed #7dd3fc; padding-top: 4px;">
            <span>📅 Prog: ${scheduledCount}</span> • 
            <span style="color:#059669;">✅ Real: ${completedCount}</span> • 
            <span style="color:#dc2626;">⏳ Pend: ${pendingCount}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Cadastros e Agendamentos</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">
        <button class="primary" id="btnNewFam">🏡 Família</button>
        <button class="primary" id="btnNewMot">👤 Motorista</button>
        <button class="primary" id="btnNewVei">🚛 Veículo</button>
        <button class="accent" id="btnNewAg">🌊 Agendar</button>
      </div>
    </div>

    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Filtrar e Pesquisar Registros</h2>

      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
        <button class="filter-tab-btn" data-cat="familias">🏡 Famílias</button>
        <button class="filter-tab-btn" data-cat="motoristas">👤 Motoristas</button>
        <button class="filter-tab-btn" data-cat="veiculos">🚛 Veículos</button>
        <button class="filter-tab-btn" data-cat="entregas">🌊 Entregas</button>
      </div>

      <div id="filterOptionsContainer" class="hidden" style="background: #f8fafc; padding: 14px; border-radius: 14px; border: 1px solid var(--border); margin-bottom: 14px;">
        <label id="searchLabel">Digite para filtrar:</label>
        <input id="searchInput" type="text" placeholder="Digite o nome, placa ou comunidade..." style="margin-bottom:0;">
      </div>

      <div id="dynamicRecords" class="records-grid">
        <p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Selecione uma categoria acima para iniciar a busca.</p>
      </div>
    </div>
  `;

  $("cardFamilias").onclick = () => showCategoryModal("familias");
  $("cardMotoristas").onclick = () => showCategoryModal("motoristas");
  $("cardVeiculos").onclick = () => showCategoryModal("veiculos");
  $("cardEntregas").onclick = () => showCategoryModal("entregas");

  $("btnAuditoria").onclick = showAuditModal;
  $("btnNewFam").onclick = () => showHouseholdForm();
  $("btnNewMot").onclick = () => showDriverForm();
  $("btnNewVei").onclick = () => showVehicleForm();
  $("btnNewAg").onclick = () => showDeliveryForm();

  document.querySelectorAll(".filter-tab-btn").forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll(".filter-tab-btn").forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      const cat = e.currentTarget.dataset.cat;
      state.filters.category = cat;
      state.filters.searchTerm = "";
      
      $("filterOptionsContainer").classList.remove("hidden");
      const sInput = $("searchInput");
      sInput.value = "";
      sInput.placeholder = cat === "familias" ? "Digite o nome da família ou comunidade..." :
                           cat === "motoristas" ? "Digite o nome do motorista..." :
                           cat === "veiculos" ? "Digite a placa ou modelo do veículo..." :
                           "Digite o nome do morador ou motorista...";
      
      renderDynamicRecords();
    };
  });

  $("searchInput").oninput = (e) => {
    state.filters.searchTerm = sanitizeText(e.target.value);
    renderDynamicRecords();
  };
}

function renderDynamicRecords() {
  const container = $("dynamicRecords");
  if (!container) return;
  container.innerHTML = "";

  const { category, searchTerm } = state.filters;
  if (!category) return;
  let count = 0;

  if (category === "familias") {
    state.households
      .filter(h => !searchTerm || sanitizeText(h.name).includes(searchTerm) || sanitizeText(h.community).includes(searchTerm))
      .forEach(h => {
        count++;
        const el = document.createElement("div");
        el.className = "record-card";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">🏡 ${esc(h.name)}</div><span class="pill completed">Ativa</span></div>
          <p class="small"><b>Telefone:</b> ${esc(h.phone)} · <b>Comunidade:</b> ${esc(h.community)}</p>
          <p class="small"><b>Endereço:</b> ${esc(h.address || '—')}</p>
          <p class="small"><b>Cisterna:</b> ${h.defaultLiters || 5000} L</p>
          <div style="display: flex; gap: 6px; margin-top: 12px;">
            <button class="secondary small" data-edit-fam="${h.id}">✏️ Alterar</button>
            <button class="danger small" data-del-fam="${h.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-fam]").onclick = () => showHouseholdForm(h.id, h);
        el.querySelector("[data-del-fam]").onclick = async () => {
          if (confirm(`Excluir a família ${h.name}?`)) {
            await deleteDoc(doc(db, "households", h.id));
            toast("Família excluída!");
            renderAdmin();
          }
        };
        container.appendChild(el);
      });
  } else if (category === "motoristas") {
    state.drivers
      .filter(d => !searchTerm || sanitizeText(d.name).includes(searchTerm))
      .forEach(m => {
        count++;
        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = "#bae6fd";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">👤 ${esc(m.name)}</div><span class="pill scheduled">Ativo</span></div>
          <p class="small"><b>Telefone:</b> ${esc(m.phone || '—')}</p>
          <p class="small"><b>Veículo:</b> ${esc(m.vehiclePlate || 'Nenhum')}</p>
          <div style="display: flex; gap: 6px; margin-top: 12px;">
            <button class="secondary small" data-edit-mot="${m.id}">✏️ Alterar</button>
            <button class="danger small" data-del-mot="${m.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-mot]").onclick = () => showDriverForm(m.id, m);
        el.querySelector("[data-del-mot]").onclick = async () => {
          if (confirm(`Excluir o motorista ${m.name}?`)) {
            await deleteDoc(doc(db, "users", m.id));
            toast("Motorista excluído!");
            renderAdmin();
          }
        };
        container.appendChild(el);
      });
  } else if (category === "veiculos") {
    state.vehicles
      .filter(v => !searchTerm || sanitizeText(v.plate).includes(searchTerm) || sanitizeText(v.model).includes(searchTerm))
      .forEach(v => {
        count++;
        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = "#cbd5e1";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">🚛 ${esc(v.plate)}</div><span class="pill scheduled">${v.capacity || 15000} L</span></div>
          <p class="small"><b>Modelo:</b> ${esc(v.model)}</p>
          <p class="small"><b>Motorista:</b> ${esc(v.driverName || 'Nenhum')}</p>
          <div style="display: flex; gap: 6px; margin-top: 12px;">
            <button class="secondary small" data-edit-vei="${v.id}">✏️ Alterar</button>
            <button class="danger small" data-del-vei="${v.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-vei]").onclick = () => showVehicleForm(v.id, v);
        el.querySelector("[data-del-vei]").onclick = async () => {
          if (confirm(`Excluir o veículo ${v.plate}?`)) {
            await deleteDoc(doc(db, "vehicles", v.id));
            toast("Veículo excluído!");
            renderAdmin();
          }
        };
        container.appendChild(el);
      });
  } else if (category === "entregas") {
    state.deliveries
      .filter(d => !searchTerm || sanitizeText(d.recipientName).includes(searchTerm) || sanitizeText(d.driverName).includes(searchTerm))
      .forEach(d => {
        count++;
        const statusClass = d.status === 'completed' ? 'completed' : d.status === 'pending' ? 'pending' : 'scheduled';
        const statusText = d.status === 'completed' ? 'Realizada' : d.status === 'pending' ? 'Pendente / PIN' : 'Programada';

        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = d.status === "completed" ? "#a7f3d0" : d.status === "pending" ? "#fca5a5" : "#fef08a";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">🌊 ${esc(d.recipientName)}</div><span class="pill ${statusClass}">${statusText}</span></div>
          <p class="small"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')}</p>
          ${d.pin ? `<p class="small" style="color:var(--primary); font-weight:700; margin-top:2px;">PIN: ${d.pin}</p>` : ''}
          <div style="display: flex; gap: 6px; margin-top: 12px;">
            <button class="secondary small" data-edit-del="${d.id}">✏️ Alterar</button>
            <button class="danger small" data-del-del="${d.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-del]").onclick = () => showDeliveryForm(d.id, d);
        el.querySelector("[data-del-del]").onclick = async () => {
          if (confirm("Excluir esta entrega?")) {
            await deleteDoc(doc(db, "deliveries", d.id));
            toast("Entrega excluída!");
            renderAdmin();
          }
        };
        container.appendChild(el);
      });
  }

  if (count === 0) {
    container.innerHTML = `<p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Nenhum registro encontrado.</p>`;
  }
}

function showCategoryModal(type) {
  let title = "", html = "";
  if (type === "familias") {
    title = "🏡 Famílias Cadastradas";
    html = state.households.map(h => `<div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;"><b style="color:var(--text-title);">${esc(h.name)}</b><p class="small"><b>Telefone:</b> ${esc(h.phone)} · <b>Comunidade:</b> ${esc(h.community)}</p><p class="small"><b>Endereço:</b> ${esc(h.address || '—')}</p></div>`).join("") || "<p class='small'>Nenhuma.</p>";
  } else if (type === "motoristas") {
    title = "👤 Motoristas Cadastrados";
    html = state.drivers.map(m => `<div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;"><b style="color:var(--text-title);">${esc(m.name)}</b><p class="small"><b>Telefone:</b> ${esc(m.phone)} · <b>Veículo:</b> ${esc(m.vehiclePlate || 'Nenhum')}</p></div>`).join("") || "<p class='small'>Nenhum.</p>";
  } else if (type === "veiculos") {
    title = "🚛 Veículos Cadastrados";
    html = state.vehicles.map(v => `<div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;"><b style="color:var(--text-title);">${esc(v.plate)}</b><p class="small"><b>Modelo:</b> ${esc(v.model)} · <b>Capacidade:</b> ${v.capacity} L</p></div>`).join("") || "<p class='small'>Nenhum.</p>";
  } else if (type === "entregas") {
    title = "🌊 Lista Geral de Entregas";
    html = state.deliveries.map(d => `<div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;"><b style="color:var(--text-title);">${esc(d.recipientName)}</b><span class="pill ${d.status}">${d.status}</span><p class="small" style="margin-top:4px;"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p></div>`).join("") || "<p class='small'>Nenhuma.</p>";
  }
  openModal(`<h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">${title}</h2><div style="max-height: 65vh; overflow-y: auto;">${html}</div>`);
}

function showAuditModal() {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">📊 Auditoria Completa de Entregas</h2>
    <div style="max-height: 70vh; overflow-y: auto;">
      ${state.deliveries.map(d => `
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:12px; padding:14px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between;"><b style="color:var(--text-title);">${esc(d.recipientName)}</b><span class="pill ${d.status}">${d.status}</span></div>
          <p class="small" style="margin-top:4px;"><b>Comunidade:</b> ${esc(d.community)} · <b>Endereço:</b> ${esc(d.address || '—')}</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')}</p>
          <p class="small"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L ${d.originalLiters ? `(Original: ${d.originalLiters}L - Motivo: ${esc(d.litersReason)})` : ''}</p>
          <p class="small" style="color:var(--primary); font-weight:700;"><b>PIN:</b> ${d.pin || 'Não gerado'}</p>
          ${d.lat && d.lng ? `<p class="small" style="color:var(--success); font-weight:700;">📍 GPS: Lat ${d.lat.toFixed(5)}, Lng ${d.lng.toFixed(5)}</p>` : '<p class="small">📍 GPS: Sem registro</p>'}
          ${d.note ? `<p class="small" style="color:var(--danger); font-weight:700;">⚠️ Obs Ausência: ${esc(d.note)}</p>` : ''}
        </div>
      `).join("") || "<p class='small'>Nenhuma entrega cadastrada.</p>"}
    </div>
  `);
}

function showHouseholdForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🏡 ${editId ? 'Editar' : 'Cadastrar'} Família Rural</h2>
    <form id="hForm">
      <label>Nome do Responsável <input id="hName" value="${data?.name || ''}" required></label>
      <div id="hNameSuggestions" class="live-suggestions-box hidden"></div>
      <label>Telefone / WhatsApp (Login) <input id="hPhone" type="tel" value="${data?.phone || ''}" placeholder="(84) 99999-9999" required></label>
      <label>Senha ${editId ? '(6 dígitos)' : 'Inicial (6 dígitos)'} <input id="hPassword" type="password" maxlength="6" placeholder="123456" ${editId ? '' : 'required'}></label>
      <label>Comunidade <input id="hComm" value="${data?.community || ''}" required></label>
      <label>Endereço / Ponto de Referência <input id="hAddr" value="${data?.address || ''}" required></label>
      <label>Volume Cisterna (Litros) <input id="hLit" type="number" value="${data?.defaultLiters || 5000}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;"><button type="button" class="secondary" id="canH" style="flex: 1;">Voltar</button><button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Cadastrar'}</button></div>
    </form>
  `);
  attachUppercaseNoAccent($("hName")); attachUppercaseNoAccent($("hComm")); attachUppercaseNoAccent($("hAddr")); applyPhoneMask($("hPhone"));
  $("hName").oninput = e => {
    attachUppercaseNoAccent(e.target);
    const val = e.target.value.trim(), box = $("hNameSuggestions");
    if (val.length > 0) {
      const matches = state.households.filter(h => h.name.startsWith(val));
      if (matches.length > 0) { box.classList.remove("hidden"); box.innerHTML = matches.map(m => `<div class="live-suggestion-item">🏡 ${esc(m.name)}</div>`).join(""); } else box.classList.add("hidden");
    } else box.classList.add("hidden");
  };
  $("canH").onclick = closeModal;
  $("hForm").onsubmit = async e => {
    e.preventDefault();
    const phone = $("hPhone").value.trim(), pass = $("hPassword").value.trim();
    if (pass && (pass.length !== 6 || !/^\d+$/.test(pass))) return alert("A senha deve conter exatamente 6 números.");
    const payload = { name: $("hName").value.trim(), phone, community: $("hComm").value.trim(), address: $("hAddr").value.trim(), defaultLiters: Number($("hLit").value) };
    try {
      if (editId) { await updateDoc(doc(db, "households", editId), payload); toast("Atualizado!"); }
      else {
        const authEmail = phoneAuthEmail(phone);
        let uid = "rec_" + Date.now();
        try { const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pass); uid = cred.user.uid; await signOutSecondary(secondaryAuth); } catch(e){}
        const ref = await addDoc(collection(db, "households"), { ...payload, recipientUid: uid, active: true, createdAt: serverTimestamp() });
        await setDoc(doc(db, "users", uid), { name: payload.name, phone, authEmail, role: "recipient", active: true, householdId: ref.id, createdAt: serverTimestamp() });
        toast("Cadastrado!");
      }
      closeModal(); renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDriverForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">👤 ${editId ? 'Editar' : 'Cadastrar'} Motorista</h2>
    <form id="mForm">
      <label>Nome Completo <input id="mName" value="${data?.name || ''}" required></label>
      <div id="mNameSuggestions" class="live-suggestions-box hidden"></div>
      <label>Telefone / WhatsApp (Login) <input id="mPhone" type="tel" value="${data?.phone || ''}" placeholder="(84) 99999-9999" required></label>
      <label>Senha ${editId ? '(6 dígitos)' : 'Inicial (6 dígitos)'} <input id="mPass" type="password" maxlength="6" placeholder="123456" ${editId ? '' : 'required'}></label>
      <label>Vincular Veículo (Placa) <select id="mVei"><option value="">Nenhum</option>${state.vehicles.map(v => `<option value="${esc(v.plate)}" ${data?.vehiclePlate === v.plate ? 'selected' : ''}>${esc(v.plate)}</option>`).join("")}</select></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;"><button type="button" class="secondary" id="canM" style="flex: 1;">Voltar</button><button type="submit" class="primary" style="flex: 2;">Salvar</button></div>
    </form>
  `);
  attachUppercaseNoAccent($("mName")); applyPhoneMask($("mPhone"));
  $("mName").oninput = e => {
    attachUppercaseNoAccent(e.target);
    const val = e.target.value.trim(), box = $("mNameSuggestions");
    if (val.length > 0) {
      const matches = state.drivers.filter(d => d.name.startsWith(val));
      if (matches.length > 0) { box.classList.remove("hidden"); box.innerHTML = matches.map(m => `<div class="live-suggestion-item">👤 ${esc(m.name)}</div>`).join(""); } else box.classList.add("hidden");
    } else box.classList.add("hidden");
  };
  $("canM").onclick = closeModal;
  $("mForm").onsubmit = async e => {
    e.preventDefault();
    const phone = $("mPhone").value.trim(), pass = $("mPass").value.trim();
    if (pass && (pass.length !== 6 || !/^\d+$/.test(pass))) return alert("A senha deve conter exatamente 6 números.");
    const payload = { name: $("mName").value.trim(), phone, vehiclePlate: $("mVei").value || "" };
    try {
      if (editId) { await updateDoc(doc(db, "users", editId), payload); toast("Atualizado!"); }
      else {
        const authEmail = phoneAuthEmail(phone);
        let uid = "drv_" + Date.now();
        try { const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pass); uid = cred.user.uid; await signOutSecondary(secondaryAuth); } catch(e){}
        await setDoc(doc(db, "users", uid), { ...payload, authEmail, role: "driver", active: true, createdAt: serverTimestamp() });
        toast("Cadastrado!");
      }
      closeModal(); renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showVehicleForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🚛 ${editId ? 'Editar' : 'Cadastrar'} Veículo</h2>
    <form id="vForm">
      <label>Placa <input id="vPlate" value="${data?.plate || ''}" placeholder="ABC-1234" required></label>
      <label>Modelo <input id="vModel" value="${data?.model || ''}" required></label>
      <label>Capacidade (Litros) <input id="vCap" type="number" value="${data?.capacity || 15000}" required></label>
      <label>Motorista <select id="vMot"><option value="">Nenhum</option>${state.drivers.map(m => `<option value="${esc(m.name)}" ${data?.driverName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join("")}</select></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;"><button type="button" class="secondary" id="canV" style="flex: 1;">Voltar</button><button type="submit" class="primary" style="flex: 2;">Salvar</button></div>
    </form>
  `);
  applyPlateMask($("vPlate")); attachUppercaseNoAccent($("vModel"));
  $("canV").onclick = closeModal;
  $("vForm").onsubmit = async e => {
    e.preventDefault();
    const payload = { plate: $("vPlate").value.trim().toUpperCase(), model: $("vModel").value.trim(), capacity: Number($("vCap").value), driverName: $("vMot").value || "" };
    try {
      if (editId) await updateDoc(doc(db, "vehicles", editId), payload);
      else await addDoc(collection(db, "vehicles"), { ...payload, createdAt: serverTimestamp() });
      toast("Salvo!"); closeModal(); renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDeliveryForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🌊 ${editId ? 'Editar' : 'Programar'} Entrega</h2>
    <form id="dForm">
      <label>Família <select id="sFam" required><option value="">Selecione...</option>${state.households.map(h => `<option value="${h.id}" ${data?.householdId === h.id ? 'selected' : ''}>${esc(h.name)} - ${esc(h.community)}</option>`).join("")}</select></label>
      <label>Motorista <select id="sMot" required><option value="">Selecione...</option>${state.drivers.map(m => `<option value="${esc(m.name)}" ${data?.driverName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join("")}</select></label>
      <label>Veículo <select id="sVei" required><option value="">Selecione...</option>${state.vehicles.map(v => `<option value="${esc(v.plate)}" ${data?.vehiclePlate === v.plate ? 'selected' : ''}>${esc(v.plate)}</option>`).join("")}</select></label>
      <label>Data Prevista <input id="sDate" type="date" value="${data?.scheduledDate || ''}" required></label>
      <label>Volume (Litros) <input id="sLit" type="number" value="${data?.plannedLiters || 5000}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;"><button type="button" class="secondary" id="canD" style="flex: 1;">Voltar</button><button type="submit" class="primary" style="flex: 2;">Salvar</button></div>
    </form>
  `);
  $("canD").onclick = closeModal;
  $("sFam").onchange = e => { if (!editId) { const f = state.households.find(h => h.id === e.target.value); if (f) $("sLit").value = f.defaultLiters || 5000; } };
  $("dForm").onsubmit = async e => {
    e.preventDefault();
    const f = state.households.find(h => h.id === $("sFam").value);
    const payload = { householdId: f.id, recipientName: f.name, community: f.community, address: f.address, driverName: $("sMot").value, vehiclePlate: $("sVei").value, scheduledDate: $("sDate").value, plannedLiters: Number($("sLit").value), status: "scheduled" };
    try {
      if (editId) await updateDoc(doc(db, "deliveries", editId), payload);
      else await addDoc(collection(db, "deliveries"), { ...payload, createdAt: serverTimestamp() });
      toast("Salvo!"); closeModal(); renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

/* =========================================================
   PAINEL DO MOTORISTA (ATUALIZADO CONFORME REQUISITOS)
========================================================= */
async function renderDriver() {
  $("driverPanel").innerHTML = `
    <div class="card">
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">👤 Minhas Entregas • Abastecimento (🌊)</h2>
      <div id="dList" class="records-grid"></div>
    </div>
  `;
  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("driverName", "==", state.profile.name)));
    const deliveries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const container = $("dList");
    container.innerHTML = "";

    deliveries.forEach(item => {
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = item.status === 'completed' ? '#a7f3d0' : item.status === 'pending' ? '#fca5a5' : '#fef08a';
      el.innerHTML = `
        <div class="record-header"><div class="record-title">🌊 ${esc(item.recipientName)}</div><span class="pill ${item.status}">${item.status}</span></div>
        <p class="small"><b>Data:</b> ${dateOnly(item.scheduledDate)} · <b>Comunidade:</b> ${esc(item.community)}</p>
        <p class="small"><b>Endereço:</b> ${esc(item.address || '—')}</p>
        
        <!-- ALTERAÇÃO DE LITRAGEM COM JUSTIFICATIVA OBRIGATÓRIA -->
        <div style="margin: 10px 0; background: #f8fafc; padding: 10px; border-radius: 10px; border: 1.5px solid var(--border);">
          <label style="font-size: 11px;">Volume de Água (Litros)</label>
          <input type="number" id="litersInput_${item.id}" value="${item.plannedLiters}" style="margin-bottom:6px;">
          <div id="reasonBox_${item.id}" class="hidden">
            <label style="font-size: 11px; color: var(--danger);">Justificativa da Alteração (Obrigatório) *</label>
            <input type="text" id="reasonInput_${item.id}" placeholder="Ex: Cisterna comportou menos água..." style="margin-bottom:0;">
          </div>
        </div>

        ${item.status === 'scheduled' || item.status === 'pending' ? `
          <div style="background: #ffffff; padding: 10px; border-radius: 10px; border: 1px solid var(--border);">
            <label style="font-size: 11px; margin-bottom: 4px;">PIN do Morador</label>
            <input type="text" maxlength="4" placeholder="4 dígitos" id="pinInput_${item.id}" style="margin-bottom: 8px; text-align: center; font-size: 16px; font-weight: 800; letter-spacing: 3px;">
            <button class="primary small" style="width: 100%; margin-bottom: 6px;" id="confPin_${item.id}">✅ Confirmar com PIN + GPS</button>
            <button class="danger small" style="width: 100%;" id="ausenteBtn_${item.id}">⚠️ Morador Ausente / Ocorrência</button>
          </div>
        ` : `<p class="small" style="color:var(--success); font-weight:700; margin-top:8px;">✅ Concluído com Sucesso</p>`}
      `;

      const litersField = el.querySelector(`#litersInput_${item.id}`);
      const reasonBox = el.querySelector(`#reasonBox_${item.id}`);
      litersField.oninput = e => {
        const val = Number(e.target.value);
        if (val !== item.plannedLiters) {
          reasonBox.classList.remove("hidden");
        } else {
          reasonBox.classList.add("hidden");
        }
      };

      if (item.status === 'scheduled' || item.status === 'pending') {
        el.querySelector(`#confPin_${item.id}`).onclick = () => confirmDeliveryWithPin(item, litersField.value);
        el.querySelector(`#ausenteBtn_${item.id}`).onclick = () => showAbsentModal(item.id);
      }
      container.appendChild(el);
    });

    if (deliveries.length === 0) container.innerHTML = `<p class="small">Nenhuma entrega atribuída.</p>`;
  } catch(e){}
}

async function confirmDeliveryWithPin(item, newLitersVal) {
  const enteredPin = $(`pinInput_${item.id}`).value.trim();
  const liters = Number(newLitersVal);
  const reasonInput = $(`reasonInput_${item.id}`);
  const reason = reasonInput ? reasonInput.value.trim() : "";

  if (liters !== item.plannedLiters && !reason) {
    return alert("Você alterou o volume de água. É obrigatório informar a justificativa!");
  }

  if (!enteredPin || enteredPin.length !== 4) {
    return alert("Informe o PIN de 4 dígitos fornecido pelo morador.");
  }

  // Verifica se o PIN confere (seja o PIN original ou o PIN gerado por ausência)
  if (item.pin && enteredPin !== String(item.pin)) {
    return alert("PIN incorreto! Confirme o código de 4 dígitos com o morador.");
  }

  if (!navigator.geolocation) {
    return alert("Geolocalização não suportada pelo aparelho.");
  }

  toast("Capturando geolocalização GPS...");

  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    const updatePayload = {
      status: "completed",
      plannedLiters: liters,
      lat,
      lng,
      completedAt: serverTimestamp()
    };

    if (liters !== item.plannedLiters) {
      updatePayload.originalLiters = item.plannedLiters;
      updatePayload.litersReason = reason;
    }

    try {
      await updateDoc(doc(db, "deliveries", item.id), updatePayload);
      toast("Entrega confirmada com PIN e GPS!");
      renderDriver();
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
    }
  }, () => {
    alert("Não foi possível obter o GPS. Ative a localização do aparelho.");
  }, { enableHighAccuracy: true });
}

function showAbsentModal(deliveryId) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">⚠️ Registrar Morador Ausente</h2>
    <form id="absentForm">
      <label>Observação da Ocorrência <textarea id="obsText" rows="3" placeholder="Ex: Morador não estava em casa no momento..." required></textarea></label>
      <label>Foto do Local / Comprovante <input id="obsPhoto" type="file" accept="image/*" required></label>
      <button type="submit" class="primary full-width">Registrar e Gerar PIN para o Morador</button>
    </form>
  `);

  $("absentForm").onsubmit = async e => {
    e.preventDefault();
    const note = $("obsText").value.trim();
    // Gera PIN automático para quando o morador chegar
    const newPin = Math.floor(1000 + Math.random() * 9000);

    try {
      await updateDoc(doc(db, "deliveries", deliveryId), {
        status: "pending",
        pin: newPin,
        note,
        updatedAt: serverTimestamp()
      });
      closeModal();
      toast(`Ocorrência registrada! PIN gerado para o morador: ${newPin}`);
      renderDriver();
    } catch (err) {
      alert("Erro: " + err.message);
    }
  };
}

/* =========================================================
   PAINEL DO BENEFICIÁRIO
========================================================= */
async function renderRecipient() {
  const hId = state.profile.householdId;
  const household = state.households.find(h => h.id === hId) || {};

  $("recipientPanel").innerHTML = `
    <div class="card">
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 12px;">🏡 Meus Dados e Abastecimentos</h2>
      <p class="small"><b>Responsável:</b> ${esc(state.profile.name)}</p>
      <p class="small"><b>Comunidade:</b> ${esc(household.community || '—')}</p>
      <p class="small"><b>Endereço:</b> ${esc(household.address || '—')}</p>
      <p class="small"><b>Capacidade Cisterna:</b> ${household.defaultLiters || 5000} Litros</p>
    </div>

    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">🌊 Entregas Programadas</h2>
      <div id="rList" class="records-grid"></div>
    </div>
  `;

  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("householdId", "==", hId)));
    const container = $("rList");
    container.innerHTML = "";

    snap.docs.forEach(docSnap => {
      const item = docSnap.data();
      const deliveryId = docSnap.id;

      const el = document.createElement("div");
      el.className = "record-card";
      el.innerHTML = `
        <div class="record-header"><div class="record-title">🌊 Entrega em ${dateOnly(item.scheduledDate)}</div><span class="pill ${item.status}">${item.status}</span></div>
        <p class="small"><b>Volume:</b> ${item.plannedLiters} L · <b>Motorista:</b> ${esc(item.driverName || '—')}</p>
        ${item.note ? `<p class="small" style="color:var(--danger); font-weight:700; margin-top:4px;">⚠️ ${esc(item.note)}</p>` : ''}
        ${item.pin ? `<div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:10px; border-radius:10px; margin-top:10px; text-align:center;"><p class="small" style="color:#166534; font-weight:700;">Seu PIN de Confirmação: <span style="font-size:18px; letter-spacing:3px;">${item.pin}</span></p></div>` : `
          <button class="primary small" style="width:100%; margin-top:12px;" id="genPin_${deliveryId}">🔑 Gerar PIN de Confirmação</button>
        `}
      `;

      if (!item.pin) {
        el.querySelector(`#genPin_${deliveryId}`).onclick = async () => {
          const pin = Math.floor(1000 + Math.random() * 9000);
          await updateDoc(doc(db, "deliveries", deliveryId), { pin });
          toast(`PIN gerado: ${pin}`);
          renderRecipient();
        };
      }
      container.appendChild(el);
    });

    if (snap.docs.length === 0) container.innerHTML = `<p class="small">Nenhum abastecimento encontrado.</p>`;
  } catch(e){}
}
