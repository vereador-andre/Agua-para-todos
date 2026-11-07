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
  filters: { category: null, driver: "todos", vehicle: "todos", date: "" },
  hasSearched: false
};

let secondaryApp = null, secondaryAuth = null;
try {
  secondaryApp = initializeApp(firebaseConfig, "DriverRegistrationApp");
  secondaryAuth = getAuth(secondaryApp);
} catch (e) {}

/* MÁSCARAS E HIGIENIZAÇÃO DE TEXTO (MAIÚSCULAS SEM ACENTOS) */
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
      if ($("loginMsg")) $("loginMsg").textContent = "Acesso negado: Verifique suas credenciais.";
    }
  };
}

/* AUTENTICAÇÃO */
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

    if ($("userName")) $("userName").textContent = state.profile.name || "ADMINISTRADOR";
    if ($("userRole")) $("userRole").textContent = state.profile.role === "admin" ? "Administrador" : state.profile.role === "driver" ? "Motorista" : "Beneficiário";
    if ($("userAvatar")) $("userAvatar").textContent = state.profile.role === "admin" ? "🛡️" : state.profile.role === "driver" ? "🚚" : "🏡";

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

/* PAINEL DO ADMINISTRADOR */
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
    <!-- VISÃO GERAL DAS ESTATÍSTICAS -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <h2 style="font-size: 18px; font-weight: 800; color: var(--text-title);">Visão Geral do Programa</h2>
          <p class="small">Areia Branca/RN • Painel de Controle</p>
        </div>
        <button class="accent small" id="btnAuditoria">📊 Auditoria Geral</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><span class="icon">🏡</span><div class="title">Famílias</div><div class="value">${state.households.length}</div></div>
        <div class="stat-card"><span class="icon">🚚</span><div class="title">Motoristas</div><div class="value">${state.drivers.length}</div></div>
        <div class="stat-card"><span class="icon">🚛</span><div class="title">Veículos</div><div class="value">${state.vehicles.length}</div></div>
        
        <div class="stat-card" style="background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%); border-color: #7dd3fc;">
          <span class="icon">💧</span>
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

    <!-- BOTÕES DE CADASTRAR -->
    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Cadastros e Operações</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px;">
        <button class="primary" id="btnNewFam">🏡 Família</button>
        <button class="primary" id="btnNewMot">🚚 Motorista</button>
        <button class="primary" id="btnNewVei">🚛 Veículo</button>
        <button class="accent" id="btnNewAg">💧 Agendar</button>
      </div>
    </div>

    <!-- CONSULTA E FILTROS COMBINADOS -->
    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Filtrar Registros</h2>

      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
        <button class="filter-tab-btn" data-cat="familias">🏡 Famílias</button>
        <button class="filter-tab-btn" data-cat="motoristas">🚚 Motoristas</button>
        <button class="filter-tab-btn" data-cat="veiculos">🚛 Veículos</button>
        <button class="filter-tab-btn" data-cat="entregas">💧 Entregas</button>
      </div>

      <div id="filterOptionsContainer" class="hidden" style="background: #f8fafc; padding: 14px; border-radius: 14px; border: 1px solid var(--border); margin-bottom: 16px;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin-bottom: 12px;">
          <div>
            <label>Motorista</label>
            <select id="filterDriver" style="margin-bottom:0;">
              <option value="todos">Todos os Motoristas</option>
              ${state.drivers.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Veículo</label>
            <select id="filterVehicle" style="margin-bottom:0;">
              <option value="todos">Todos os Veículos</option>
              ${state.vehicles.map(v => `<option value="${esc(v.plate)}">${esc(v.plate)}</option>`).join("")}
            </select>
          </div>

          <div>
            <label>Data Prevista</label>
            <input id="filterDate" type="date" style="margin-bottom:0;">
          </div>
        </div>

        <button class="primary full-width" id="btnExecutarPesquisa" style="width: 100%;">🔎 Pesquisar Registros</button>
      </div>

      <div id="dynamicRecords" class="records-grid">
        <p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Selecione uma categoria acima e clique em "Pesquisar Registros".</p>
      </div>
    </div>
  `;

  $("btnAuditoria").onclick = showAuditModal;
  $("btnNewFam").onclick = () => showHouseholdForm();
  $("btnNewMot").onclick = () => showDriverForm();
  $("btnNewVei").onclick = () => showVehicleForm();
  $("btnNewAg").onclick = () => showDeliveryForm();

  document.querySelectorAll(".filter-tab-btn").forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll(".filter-tab-btn").forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      state.filters.category = e.currentTarget.dataset.cat;
      state.hasSearched = false;
      $("filterOptionsContainer").classList.remove("hidden");
      $("dynamicRecords").innerHTML = `<p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Clique em "Pesquisar Registros" para carregar os dados.</p>`;
    };
  });

  $("btnExecutarPesquisa").onclick = () => {
    state.filters.driver = $("filterDriver").value;
    state.filters.vehicle = $("filterVehicle").value;
    state.filters.date = $("filterDate").value;
    state.hasSearched = true;
    renderDynamicRecords();
  };
}

function renderDynamicRecords() {
  const container = $("dynamicRecords");
  if (!container || !state.hasSearched) return;
  container.innerHTML = "";

  const { category, driver, vehicle, date } = state.filters;
  let count = 0;

  if (category === "familias") {
    state.households.forEach(h => {
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
    state.drivers.filter(d => driver === "todos" || d.name === driver).forEach(m => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = "#bae6fd";
      el.innerHTML = `
        <div class="record-header"><div class="record-title">🚚 ${esc(m.name)}</div><span class="pill scheduled">Ativo</span></div>
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
    state.vehicles.filter(v => vehicle === "todos" || v.plate === vehicle).forEach(v => {
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
      .filter(d => driver === "todos" || d.driverName === driver)
      .filter(d => vehicle === "todos" || d.vehiclePlate === vehicle)
      .filter(d => !date || d.scheduledDate === date)
      .forEach(d => {
        count++;
        const statusClass = d.status === 'completed' ? 'completed' : d.status === 'pending' ? 'pending' : 'scheduled';
        const statusText = d.status === 'completed' ? 'Realizada' : d.status === 'pending' ? 'Pendente / PIN' : 'Programada';

        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = d.status === "completed" ? "#a7f3d0" : d.status === "pending" ? "#fca5a5" : "#fef08a";
        el.innerHTML = `
          <div class="record-header"><div class="record-title">💧 ${esc(d.recipientName)}</div><span class="pill ${statusClass}">${statusText}</span></div>
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
    container.innerHTML = `<p class="small" style="grid-column: 1/-1; text-align: center; padding: 20px;">Nenhum registro encontrado para esta combinação.</p>`;
  }
}

/* MODAL DE AUDITORIA COMPLETA DE ENTREGAS */
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
          <p class="small"><b>Data Agendada:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
          <p class="small" style="color:var(--primary); font-weight:700;"><b>PIN do Registro:</b> ${d.pin || 'Não gerado'}</p>
          ${d.lat && d.lng ? `<p class="small" style="color:var(--success); font-weight:700;">📍 GPS: Lat ${d.lat.toFixed(5)}, Lng ${d.lng.toFixed(5)}</p>` : '<p class="small">📍 GPS: Sem registro</p>'}
          ${d.note ? `<p class="small" style="color:var(--danger); font-weight:700;">⚠️ Obs: ${esc(d.note)}</p>` : ''}
        </div>
      `).join("") || "<p class='small'>Nenhuma entrega cadastrada.</p>"}
    </div>
  `);
}

/* MODAIS DE CADASTRO COM MAIÚSCULAS E LISTA DE SUGESTÕES */
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
        const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pass);
        const ref = await addDoc(collection(db, "households"), { ...payload, recipientUid: cred.user.uid, active: true, createdAt: serverTimestamp() });
        await setDoc(doc(db, "users", cred.user.uid), { name: payload.name, phone, authEmail, role: "recipient", active: true, householdId: ref.id, createdAt: serverTimestamp() });
        try { await signOutSecondary(secondaryAuth); } catch(e){}
        toast("Família cadastrada!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDriverForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🚚 ${editId ? 'Editar' : 'Cadastrar'} Motorista</h2>
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
        box.innerHTML = matches.map(m => `<div class="live-suggestion-item">🚚 ${esc(m.name)}</div>`).join("");
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
        const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, pass);
        await setDoc(doc(db, "users", cred.user.uid), { ...payload, authEmail, role: "driver", active: true, createdAt: serverTimestamp() });
        try { await signOutSecondary(secondaryAuth); } catch(e){}
        toast("Motorista cadastrado!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
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
    } catch(err) { alert("Erro: " + err.message); }
  };
}

function showDeliveryForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">💧 ${editId ? 'Editar' : 'Programar'} Entrega</h2>
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

/* PAINÉIS SECUNDÁRIOS */
async function renderDriver() {}
async function renderRecipient() {}
