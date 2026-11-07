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

/* HIGIENIZAÇÃO DE TEXTO E MÁSCARAS */
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
      const rawInput = $("loginEmail").value.trim();
      const email = loginIdentifierToEmail(rawInput);
      await signInWithEmailAndPassword(auth, email, $("loginPassword").value);
    } catch (err) {
      console.error(err);
      if ($("loginMsg")) $("loginMsg").textContent = "Acesso negado: Verifique o telefone/e-mail e a senha de 6 dígitos.";
    }
  };
}

/* AUTENTICAÇÃO COM BUSCA RECURSIVA DE PERFIL */
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
    let snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      state.profile = { id: snap.id, ...snap.data() };
    } else {
      const qUser = query(collection(db, "users"), where("authEmail", "==", user.email));
      const snapQ = await getDocs(qUser);
      if (!snapQ.empty) {
        state.profile = { id: snapQ.docs[0].id, ...snapQ.docs[0].data() };
      }
    }

    if (!state.profile) { toast("Usuário autenticado, mas perfil não encontrado."); return; }

    if ($("userName")) $("userName").textContent = state.profile.name || "USUÁRIO";
    if ($("userRole")) $("userRole").textContent = state.profile.role === "admin" ? "Administrador" : state.profile.role === "driver" ? "Motorista" : "Beneficiário";
    if ($("userAvatar")) $("userAvatar").textContent = state.profile.role === "admin" ? "🛡️" : state.profile.role === "driver" ? "👤" : "🏡";

    await renderByRole();
  } catch (err) {
    console.error(err);
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
  const pendingCount = state.deliveries.filter(d => d.status === "pending" || d.status === "disputed").length;

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
        const statusClass = d.status === 'completed' ? 'completed' : d.status === 'disputed' ? 'danger' : 'scheduled';
        const statusText = d.status === 'completed' ? 'Realizada' : d.status === 'disputed' ? 'Contestado pelo Morador' : d.status === 'pending' ? 'Ausência (Pendente)' : 'Programada';

        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = d.status === "completed" ? "#a7f3d0" : d.status === "disputed" ? "#fca5a5" : "#fef08a";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">🌊 ${esc(d.recipientName)}</div><span class="pill ${statusClass}">${statusText}</span></div>
          <p class="small"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')}</p>
          ${d.pin ? `<p class="small" style="color:var(--primary); font-weight:700; margin-top:2px;">PIN: ${d.pin}</p>` : ''}
          ${d.disputeReason ? `<p class="small" style="color:var(--danger); font-weight:700;">❌ Contestação: ${esc(d.disputeReason)}</p>` : ''}
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
    container.innerHTML = `<p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Nenhum registro encontrado para esta busca.</p>`;
  }
}

function showCategoryModal(type) {
  let title = "", html = "";

  if (type === "familias") {
    title = "🏡 Famílias Cadastradas";
    html = state.households.map(h => `
      <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;">
        <b style="color:var(--text-title);">${esc(h.name)}</b>
        <p class="small"><b>Telefone:</b> ${esc(h.phone)} · <b>Comunidade:</b> ${esc(h.community)}</p>
        <p class="small"><b>Endereço:</b> ${esc(h.address || '—')}</p>
        <p class="small"><b>Cisterna:</b> ${h.defaultLiters || 5000} L</p>
      </div>
    `).join("") || "<p class='small'>Nenhuma família cadastrada.</p>";
  } else if (type === "motoristas") {
    title = "👤 Motoristas Cadastrados";
    html = state.drivers.map(m => `
      <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;">
        <b style="color:var(--text-title);">${esc(m.name)}</b>
        <p class="small"><b>Telefone/WhatsApp:</b> ${esc(m.phone)}</p>
        <p class="small"><b>Veículo Vinculado:</b> ${esc(m.vehiclePlate || 'Nenhum')}</p>
      </div>
    `).join("") || "<p class='small'>Nenhum motorista cadastrado.</p>";
  } else if (type === "veiculos") {
    title = "🚛 Veículos Cadastrados";
    html = state.vehicles.map(v => `
      <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;">
        <b style="color:var(--text-title);">${esc(v.plate)}</b>
        <p class="small"><b>Modelo:</b> ${esc(v.model)} · <b>Capacidade:</b> ${v.capacity} L</p>
        <p class="small"><b>Motorista:</b> ${esc(v.driverName || 'Nenhum')}</p>
      </div>
    `).join("") || "<p class='small'>Nenhum veículo cadastrado.</p>";
  } else if (type === "entregas") {
    title = "🌊 Lista Geral de Entregas";
    html = state.deliveries.map(d => `
      <div style="background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:12px; margin-bottom:10px;">
        <b style="color:var(--text-title);">${esc(d.recipientName)}</b>
        <span class="pill ${d.status === 'completed' ? 'completed' : 'scheduled'}">${d.status}</span>
        <p class="small" style="margin-top:4px;"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
        <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')}</p>
      </div>
    `).join("") || "<p class='small'>Nenhuma entrega cadastrada.</p>";
  }

  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">${title}</h2>
    <div style="max-height: 65vh; overflow-y: auto;">${html}</div>
  `);
}

function showAuditModal() {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">📊 Auditoria Completa de Entregas</h2>
    <div style="max-height: 70vh; overflow-y: auto;">
      ${state.deliveries.map(d => `
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:12px; padding:14px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between;">
            <b style="color:var(--text-title);">${esc(d.recipientName)}</b>
            <span class="pill ${d.status === 'completed' ? 'completed' : 'scheduled'}">${d.status}</span>
          </div>
          <p class="small" style="margin-top:4px;"><b>Comunidade:</b> ${esc(d.community)} · <b>Endereço:</b> ${esc(d.address || '—')}</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')}</p>
          <p class="small"><b>Data Agendada:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L ${d.alterReason ? `(Alterado: ${d.alterReason})` : ''}</p>
          <p class="small" style="color:var(--primary); font-weight:700;"><b>PIN do Registro:</b> ${d.pin || 'Não gerado'}</p>
          ${d.lat && d.lng ? `<p class="small" style="color:var(--success); font-weight:700;">📍 GPS: Lat ${d.lat.toFixed(5)}, Lng ${d.lng.toFixed(5)}</p>` : '<p class="small" style="color:var(--danger); font-weight:700;">📍 GPS: Não registrado</p>'}
          ${d.note ? `<p class="small" style="color:var(--danger); font-weight:700;">⚠️ Obs Ausência: ${esc(d.note)}</p>` : ''}
          ${d.disputeReason ? `<p class="small" style="color:var(--danger); font-weight:700;">❌ Contestação Morador: ${esc(d.disputeReason)}</p>` : ''}
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
      <label>Senha ${editId ? '(6 dígitos para alterar)' : 'Inicial (6 dígitos)'} <input id="hPassword" type="password" maxlength="6" placeholder="123456" ${editId ? '' : 'required'}></label>
      <label>Comunidade <input id="hComm" value="${data?.community || ''}" required></label>
      <label>Endereço / Ponto de Referência <input id="hAddr" value="${data?.address || ''}" required></label>
      <label>Volume Cisterna (Litros) <input id="hLit" type="number" value="${data?.defaultLiters || 5000}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canH" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Cadastrar'}</button>
      </div>
    </form>
  `);

  attachUppercaseNoAccent($("hName"));
  attachUppercaseNoAccent($("hComm"));
  attachUppercaseNoAccent($("hAddr"));
  applyPhoneMask($("hPhone"));

  $("hName").oninput = (e) => {
    attachUppercaseNoAccent(e.target);
    const val = e.target.value.trim();
    const box = $("hNameSuggestions");
    if (val.length > 0) {
      const matches = state.households.filter(h => h.name.startsWith(val));
      if (matches.length > 0) {
        box.classList.remove("hidden");
        box.innerHTML = matches.map(m => `<div class="live-suggestion-item">🏡 ${esc(m.name)} (${esc(m.community)})</div>`).join("");
      } else box.classList.add("hidden");
    } else box.classList.add("hidden");
  };

  $("canH").onclick = closeModal;

  $("hForm").onsubmit = async e => {
    e.preventDefault();
    const phone = $("hPhone").value.trim();
    const pass = $("hPassword").value.trim();

    if (pass && (pass.length !== 6 || !/^\d+$/.test(pass))) {
      return alert("A senha deve conter exatamente 6 números.");
    }

    const exists = state.households.some(h => h.phone === phone && h.id !== editId);
    if (exists) return alert("Já existe uma família cadastrada com este telefone!");

    const payload = {
      name: $("hName").value.trim(),
      phone,
      community: $("hComm").value.trim(),
      address: $("hAddr").value.trim(),
      defaultLiters: Number($("hLit").value)
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "households", editId), payload);
        toast("Família atualizada!");
      } else {
        const authEmail = phoneAuthEmail(phone);
        let uid = null;
        try {
          const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pass);
          uid = cred.user.uid;
          await signOutSecondary(secondaryAuth);
        } catch(authErr) {
          uid = "rec_" + Date.now();
        }
        const ref = await addDoc(collection(db, "households"), { ...payload, recipientUid: uid, active: true, createdAt: serverTimestamp() });
        await setDoc(doc(db, "users", uid), { name: payload.name, phone, authEmail, role: "recipient", active: true, householdId: ref.id, createdAt: serverTimestamp() });
        toast("Família cadastrada com sucesso!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro ao salvar: " + err.message); }
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
      <label>Vincular Veículo (Placa) 
        <select id="mVei">
          <option value="">Nenhum veículo vinculado</option>
          ${state.vehicles.map(v => `<option value="${esc(v.plate)}" ${data?.vehiclePlate === v.plate ? 'selected' : ''}>${esc(v.plate)} - ${esc(v.model)}</option>`).join("")}
        </select>
      </label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canM" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Salvar Motorista'}</button>
      </div>
    </form>
  `);

  attachUppercaseNoAccent($("mName"));
  applyPhoneMask($("mPhone"));

  $("mName").oninput = (e) => {
    attachUppercaseNoAccent(e.target);
    const val = e.target.value.trim();
    const box = $("mNameSuggestions");
    if (val.length > 0) {
      const matches = state.drivers.filter(d => d.name.startsWith(val));
      if (matches.length > 0) {
        box.classList.remove("hidden");
        box.innerHTML = matches.map(m => `<div class="live-suggestion-item">👤 ${esc(m.name)}</div>`).join("");
      } else box.classList.add("hidden");
    } else box.classList.add("hidden");
  };

  $("canM").onclick = closeModal;

  $("mForm").onsubmit = async e => {
    e.preventDefault();
    const phone = $("mPhone").value.trim();
    const pass = $("mPass").value.trim();

    if (pass && (pass.length !== 6 || !/^\d+$/.test(pass))) {
      return alert("A senha deve conter exatamente 6 números.");
    }

    const exists = state.drivers.some(d => d.phone === phone && d.id !== editId);
    if (exists) return alert("Já existe um motorista cadastrado com este telefone!");

    const payload = {
      name: $("mName").value.trim(),
      phone,
      vehiclePlate: $("mVei").value || ""
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "users", editId), payload);
        toast("Motorista atualizado!");
      } else {
        const authEmail = phoneAuthEmail(phone);
        let uid = null;
        try {
          const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pass);
          uid = cred.user.uid;
          await signOutSecondary(secondaryAuth);
        } catch(authErr) {
          uid = "drv_" + Date.now();
        }
        await setDoc(doc(db, "users", uid), { ...payload, authEmail, role: "driver", active: true, createdAt: serverTimestamp() });
        toast("Motorista cadastrado!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro ao salvar: " + err.message); }
  };
}

function showVehicleForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🚛 ${editId ? 'Editar' : 'Cadastrar'} Veículo</h2>
    <form id="vForm">
      <label>Placa do Veículo <input id="vPlate" value="${data?.plate || ''}" placeholder="ABC-1234" required></label>
      <div id="vPlateSuggestions" class="live-suggestions-box hidden"></div>

      <label>Modelo / Descrição <input id="vModel" value="${data?.model || ''}" placeholder="MERCEDES 15.000L" required></label>
      <label>Capacidade (Litros) <input id="vCap" type="number" value="${data?.capacity || 15000}" required></label>
      <label>Vincular Motorista 
        <select id="vMot">
          <option value="">Nenhum motorista vinculado</option>
          ${state.drivers.map(m => `<option value="${esc(m.name)}" ${data?.driverName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join("")}
        </select>
      </label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canV" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Cadastrar Veículo'}</button>
      </div>
    </form>
  `);

  applyPlateMask($("vPlate"));
  attachUppercaseNoAccent($("vModel"));

  $("vPlate").oninput = (e) => {
    applyPlateMask(e.target);
    const val = e.target.value.trim();
    const box = $("vPlateSuggestions");
    if (val.length > 0) {
      const matches = state.vehicles.filter(v => v.plate.startsWith(val));
      if (matches.length > 0) {
        box.classList.remove("hidden");
        box.innerHTML = matches.map(m => `<div class="live-suggestion-item">🚛 ${esc(m.plate)} - ${esc(m.model)}</div>`).join("");
      } else box.classList.add("hidden");
    } else box.classList.add("hidden");
  };

  $("canV").onclick = closeModal;

  $("vForm").onsubmit = async e => {
    e.preventDefault();
    const plate = $("vPlate").value.trim().toUpperCase();

    const exists = state.vehicles.some(v => v.plate === plate && v.id !== editId);
    if (exists) return alert("Já existe um veículo cadastrado com esta placa!");

    const payload = {
      plate,
      model: $("vModel").value.trim(),
      capacity: Number($("vCap").value),
      driverName: $("vMot").value || ""
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "vehicles", editId), payload);
        toast("Veículo atualizado!");
      } else {
        await addDoc(collection(db, "vehicles"), { ...payload, createdAt: serverTimestamp() });
        toast("Veículo cadastrado!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro ao salvar: " + err.message); }
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
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canD" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar Alterações' : 'Confirmar Agendamento'}</button>
      </div>
    </form>
  `);
  $("canD").onclick = closeModal;

  $("sFam").onchange = e => {
    if (!editId) {
      const f = state.households.find(h => h.id === e.target.value);
      if (f && f.defaultLiters) $("sLit").value = f.defaultLiters;
    }
  };

  $("dForm").onsubmit = async e => {
    e.preventDefault();
    const f = state.households.find(h => h.id === $("sFam").value);
    const payload = {
      householdId: f.id, 
      recipientName: f.name, 
      community: f.community, 
      address: f.address,
      driverName: $("sMot").value,
      vehiclePlate: $("sVei").value,
      scheduledDate: $("sDate").value, 
      plannedLiters: Number($("sLit").value),
      status: "scheduled"
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "deliveries", editId), payload);
        toast("Entrega atualizada!");
      } else {
        await addDoc(collection(db, "deliveries"), { ...payload, createdAt: serverTimestamp() });
        toast("Entrega agendada!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

/* =========================================================
   PAINEL DO MOTORISTA
========================================================= */
async function renderDriver() {
  $("driverPanel").innerHTML = `
    <div class="card">
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">👤 Minhas Entregas e Operações</h2>
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
      el.innerHTML = `
        <div class="record-header"><div class="record-title">🌊 ${esc(item.recipientName)}</div><span class="pill ${item.status}">${item.status}</span></div>
        <p class="small"><b>Data:</b> ${dateOnly(item.scheduledDate)} · <b>Comunidade:</b> ${esc(item.community)}</p>
        <p class="small"><b>Endereço:</b> ${esc(item.address || '—')}</p>

        <div style="margin-top: 12px; background: #f8fafc; padding: 10px; border-radius: 10px; border: 1px solid var(--border);">
          <label style="font-size: 11px; margin-bottom: 4px;">Volume de Água (Litros)</label>
          <input type="number" id="volInput_${item.id}" value="${item.plannedLiters}" style="margin-bottom: 8px;">
          <div id="justDiv_${item.id}" class="hidden">
            <label style="font-size: 11px; margin-bottom: 4px; color: var(--danger);">Justificativa da Alteração</label>
            <input type="text" id="justInput_${item.id}" placeholder="Motivo da alteração de volume..." style="margin-bottom: 8px;">
          </div>
          <button class="secondary small" style="width:100%; margin-bottom:6px;" id="saveVol_${item.id}">💾 Atualizar Volume / Justificativa</button>
        </div>

        ${item.status === 'scheduled' || item.status === 'pending' ? `
          <div style="margin-top: 12px; background: #f1f5f9; padding: 12px; border-radius: 12px; border: 1px solid var(--border);">
            <label style="font-size: 11px; margin-bottom: 4px;">PIN do Morador</label>
            <input type="text" maxlength="4" placeholder="4 dígitos" id="pinInput_${item.id}" style="margin-bottom: 8px; text-align: center; font-size: 18px; font-weight: 800; letter-spacing: 4px;">
            <button class="primary small" style="width: 100%; margin-bottom: 6px;" id="confPin_${item.id}">✅ Confirmar Entrega (PIN + GPS)</button>
            <button class="danger small" style="width: 100%;" id="ausenteBtn_${item.id}">⚠️ Morador Ausente (Ausência + Câmera)</button>
          </div>
        ` : `<p class="small" style="color:var(--success); font-weight:700; margin-top:10px;">✅ Entrega Finalizada</p>`}
      `;

      const volInput = el.querySelector(`#volInput_${item.id}`);
      const justDiv = el.querySelector(`#justDiv_${item.id}`);
      volInput.oninput = () => {
        if (Number(volInput.value) !== Number(item.plannedLiters)) {
          justDiv.classList.remove("hidden");
        } else {
          justDiv.classList.add("hidden");
        }
      };

      el.querySelector(`#saveVol_${item.id}`).onclick = async () => {
        const newVol = Number(volInput.value);
        let alterReason = item.alterReason || "";
        if (newVol !== Number(item.plannedLiters)) {
          const just = el.querySelector(`#justInput_${item.id}`).value.trim();
          if (!just) return alert("Você alterou o volume. É obrigatório informar o motivo da alteração.");
          alterReason = just;
        }
        await updateDoc(doc(db, "deliveries", item.id), { plannedLiters: newVol, alterReason });
        toast("Volume atualizado!");
        renderDriver();
      };

      if (item.status === 'scheduled' || item.status === 'pending') {
        el.querySelector(`#confPin_${item.id}`).onclick = () => confirmDeliveryWithPin(item.id, item.pin);
        el.querySelector(`#ausenteBtn_${item.id}`).onclick = () => showAbsentModal(item.id);
      }
      container.appendChild(el);
    });

    if (deliveries.length === 0) container.innerHTML = `<p class="small">Nenhuma entrega atribuída a você.</p>`;
  } catch(e){}
}

async function confirmDeliveryWithPin(deliveryId, expectedPin) {
  const enteredPin = $(`pinInput_${deliveryId}`).value.trim();
  if (expectedPin && enteredPin !== String(expectedPin)) {
    return alert("PIN incorreto! Solicite o código correto de 4 dígitos ao morador.");
  }

  if (!navigator.geolocation) {
    return alert("Geolocalização não suportada pelo navegador.");
  }

  toast("Capturando localização GPS...");

  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    try {
      await updateDoc(doc(db, "deliveries", deliveryId), {
        status: "completed",
        lat,
        lng,
        completedAt: serverTimestamp()
      });
      toast("Entrega confirmada com sucesso!");
      renderDriver();
    } catch (err) {
      alert("Erro ao salvar: " + err.message);
    }
  }, () => {
    alert("Não foi possível obter a localização GPS. Ative o GPS do aparelho.");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function showAbsentModal(deliveryId) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">⚠️ Registro de Morador Ausente</h2>
    <form id="absentForm">
      <label>Observação da Ocorrência <textarea id="obsText" rows="3" placeholder="Ex: Casa fechada, morador viajou..." required></textarea></label>
      
      <label>Foto do Local (Obrigatório Direto da Câmera) 
        <input id="obsPhoto" type="file" accept="image/*" capture="environment" required>
      </label>
      <p class="small" style="color:var(--danger); margin-bottom:14px;">Nota: Use a câmera do aparelho para tirar a foto no local (fotos salvas na galeria são bloqueadas).</p>

      <button type="submit" class="primary full-width" style="width:100%;">📤 Registrar Ausência com GPS e Gerar PIN</button>
    </form>
  `);

  $("absentForm").onsubmit = async e => {
    e.preventDefault();
    const note = $("obsText").value.trim() || "Morador ausente";

    if (!navigator.geolocation) {
      return alert("Geolocalização obrigatória não suportada.");
    }

    toast("Capturando GPS e registrando ausência...");

    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const pin = Math.floor(1000 + Math.random() * 9000);

      try {
        await updateDoc(doc(db, "deliveries", deliveryId), {
          status: "pending",
          pin,
          lat,
          lng,
          note,
          updatedAt: serverTimestamp()
        });
        closeModal();
        toast("Ausência registrada com GPS e PIN gerado com sucesso!");
        renderDriver();
      } catch (err) {
        alert("Erro ao salvar: " + err.message);
      }
    }, () => {
      alert("Erro ao capturar GPS. Verifique se o GPS está ativado no aparelho.");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  };
}

/* =========================================================
   PAINEL DA FAMÍLIA / BENEFICIÁRIO (DUPLO FLUXO: PRESENTE OU AUSENTE)
========================================================= */
async function renderRecipient() {
  const userPhone = normalizePhone(state.profile.phone);
  
  let household = state.households.find(h => h.id === state.profile.householdId || normalizePhone(h.phone) === userPhone);
  
  if (!household && userPhone) {
    try {
      const snapH = await getDocs(query(collection(db, "households"), where("phone", "==", state.profile.phone)));
      if (!snapH.empty) {
        household = { id: snapH.docs[0].id, ...snapH.docs[0].data() };
      }
    } catch (e) {}
  }

  household = household || {};

  $("recipientPanel").innerHTML = `
    <div class="card">
      <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 12px;">🏡 Cadastro da Família Rural</h2>
      <p class="small"><b>Responsável:</b> ${esc(state.profile.name || household.name || '—')}</p>
      <p class="small"><b>Telefone/WhatsApp:</b> ${esc(state.profile.phone || household.phone || '—')}</p>
      <p class="small"><b>Comunidade Rural:</b> ${esc(household.community || '—')}</p>
      <p class="small"><b>Endereço / Ponto de Ref.:</b> ${esc(household.address || '—')}</p>
      <p class="small"><b>Capacidade da Cisterna:</b> ${household.defaultLiters || 5000} Litros</p>
    </div>

    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">🌊 Meus Abastecimentos e Confirmação de PIN</h2>
      <div id="rList" class="records-grid"></div>
    </div>
  `;

  try {
    let qDeliveries;
    if (household.id) {
      qDeliveries = query(collection(db, "deliveries"), where("householdId", "==", household.id));
    } else {
      qDeliveries = query(collection(db, "deliveries"), where("recipientName", "==", state.profile.name));
    }

    const snap = await getDocs(qDeliveries);
    const container = $("rList");
    container.innerHTML = "";

    snap.docs.forEach(docSnap => {
      const item = docSnap.data();
      const deliveryId = docSnap.id;
      const statusClass = item.status === 'completed' ? 'completed' : item.status === 'disputed' ? 'danger' : item.status === 'pending' ? 'pending' : 'scheduled';
      const statusText = item.status === 'completed' ? 'Realizada' : item.status === 'disputed' ? 'Contestado (Não Recebido)' : item.status === 'pending' ? 'Ausência Registrada' : 'Programada';

      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = item.status === "completed" ? "#a7f3d0" : item.status === "disputed" ? "#fca5a5" : item.status === "pending" ? "#fbcfe8" : "#bae6fd";
      
      let actionHtml = "";

      if (item.status === 'completed') {
        actionHtml = `
          <div style="margin-top:10px; background:#d1fae5; border:1px solid #6ee7b7; padding:8px 12px; border-radius:10px; text-align:center;">
            <p class="small" style="color:#065f46; font-weight:800;">✅ Abastecimento Concluído e Confirmado</p>
          </div>
        `;
      } else if (item.status === 'disputed') {
        actionHtml = `
          <div style="margin-top:10px; background:#fee2e2; border:1px solid #fca5a5; padding:8px 12px; border-radius:10px; text-align:center;">
            <p class="small" style="color:#991b1b; font-weight:800;">❌ Não Recebimento Registrado</p>
            <p class="small" style="color:#7f1d1d; margin-top:2px;">Motivo: ${esc(item.disputeReason)}</p>
          </div>
        `;
      } else if (item.status === 'pending') {
        // CASO 1: Motorista marcou ausência e gerou PIN retrospectivo
        actionHtml = `
          <div style="background:#fef3c7; border:1px solid #fde68a; padding:12px; border-radius:12px; margin-top:12px;">
            <p class="small" style="color:#92400e; font-weight:800; text-align:center;">⚠️ MOTORISTA REGISTROU AUSÊNCIA</p>
            <p class="small" style="margin-top:4px;"><b>Obs:</b> ${esc(item.note)}</p>
            <p class="small" style="margin-top:2px; color:var(--primary);"><b>PIN de Confirmação:</b> <span style="font-size:16px; font-weight:900;">${item.pin}</span></p>
            
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button class="primary small" style="flex:1;" id="confirmAbsent_${deliveryId}">✅ Confirmar Recebimento</button>
              <button class="danger small" style="flex:1;" id="disputeAbsent_${deliveryId}">❌ Não Recebi</button>
            </div>
            
            <div id="disputeBox_${deliveryId}" class="hidden" style="margin-top:10px;">
              <input type="text" id="disputeInput_${deliveryId}" placeholder="Informe o motivo do não recebimento..." style="margin-bottom:6px;">
              <button class="danger small" style="width:100%;" id="sendDispute_${deliveryId}">📤 Enviar Contestação ao Admin</button>
            </div>
          </div>
        `;
      } else {
        // CASO 2: Morador em casa (Gera PIN para passar ao motorista)
        actionHtml = item.pin ? `
          <div class="pin-display-box">
            <p class="small" style="color:#047857; font-weight:800;">SEU CÓDIGO PIN PARA O MOTORISTA:</p>
            <div class="pin-code-badge">${item.pin}</div>
            <p class="small" style="color:#065f46; margin-top:4px;">Passe este número de 4 dígitos para o motorista no momento da entrega.</p>
          </div>
        ` : `
          <div style="margin-top:12px;">
            <label style="font-size:11px; margin-bottom:4px;">Observação Opcional para a Entrega</label>
            <input type="text" id="moradorObs_${deliveryId}" placeholder="Ex: Portão lateral aberto..." style="margin-bottom:8px;">
            <button class="primary small" style="width:100%;" id="genPin_${deliveryId}">🔑 Gerar PIN para o Motorista</button>
          </div>
        `;
      }

      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🌊 Entrega: ${dateOnly(item.scheduledDate)}</div>
          <span class="pill ${statusClass}">${statusText}</span>
        </div>
        <p class="small"><b>Volume Agendado:</b> ${item.plannedLiters} L</p>
        <p class="small"><b>Motorista:</b> ${esc(item.driverName || '—')} (${esc(item.vehiclePlate || '—')})</p>
        ${item.alterReason ? `<p class="small" style="color:var(--warning); font-weight:700; margin-top:2px;">ℹ️ Ajuste de Volume: ${esc(item.alterReason)}</p>` : ''}
        ${actionHtml}
      `;

      // Eventos para PIN gerado pelo morador em casa
      if (!item.pin && item.status === 'scheduled') {
        el.querySelector(`#genPin_${deliveryId}`).onclick = async () => {
          const obsMorador = el.querySelector(`#moradorObs_${deliveryId}`).value.trim();
          const pin = Math.floor(1000 + Math.random() * 9000);
          await updateDoc(doc(db, "deliveries", deliveryId), { pin, moradorObs: obsMorador });
          toast(`PIN gerado: ${pin}`);
          renderRecipient();
        };
      }

      // Eventos para o caso de Ausência Registrada pelo Motorista
      if (item.status === 'pending') {
        el.querySelector(`#confirmAbsent_${deliveryId}`).onclick = async () => {
          if (confirm("Deseja confirmar que a água foi efetivamente entregue?")) {
            await updateDoc(doc(db, "deliveries", deliveryId), { status: "completed", completedAt: serverTimestamp() });
            toast("Entrega confirmada com sucesso!");
            renderRecipient();
          }
        };

        const dispBox = el.querySelector(`#disputeBox_${deliveryId}`);
        el.querySelector(`#disputeAbsent_${deliveryId}`).onclick = () => {
          dispBox.classList.toggle("hidden");
        };

        el.querySelector(`#sendDispute_${deliveryId}`).onclick = async () => {
          const reason = el.querySelector(`#disputeInput_${deliveryId}`).value.trim();
          if (!reason) return alert("Informe o motivo do não recebimento.");
          await updateDoc(doc(db, "deliveries", deliveryId), { status: "disputed", disputeReason: reason });
          toast("Contestação enviada ao administrador!");
          renderRecipient();
        };
      }

      container.appendChild(el);
    });

    if (snap.docs.length === 0) {
      container.innerHTML = `<p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Nenhum agendamento de abastecimento encontrado para seu cadastro.</p>`;
    }
  } catch(e) {
    console.error(e);
  }
}
