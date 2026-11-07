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
  filters: { category: "todos", driver: "todos", vehicle: "todos", date: "" }
};

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
  if (!state.user) {
    el.classList.add("hidden");
    return;
  }
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
      if ($("loginMsg")) $("loginMsg").textContent = "Acesso negado: Verifique seu telefone/senha.";
    }
  };
}

/* AUTHENTICATION */
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

    if ($("userName")) $("userName").textContent = state.profile.name || "Usuário";
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

/* ADMIN DASHBOARD */
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
  const pending = state.deliveries.filter(d => d.status === "scheduled").length;
  const completed = state.deliveries.filter(d => d.status === "completed").length;

  $("adminPanel").innerHTML = `
    <div class="card">
      <div style="margin-bottom: 14px;">
        <h2 style="font-size: 18px; font-weight: 800; color: var(--text-title);">Visão Geral do Programa</h2>
        <p class="small">Areia Branca/RN • Indicadores do Sistema</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><span class="icon">🏡</span><div class="title">Famílias</div><div class="value">${state.households.length}</div></div>
        <div class="stat-card"><span class="icon">🚚</span><div class="title">Motoristas</div><div class="value">${state.drivers.length}</div></div>
        <div class="stat-card"><span class="icon">🚛</span><div class="title">Veículos</div><div class="value">${state.vehicles.length}</div></div>
        <div class="stat-card"><span class="icon">💧</span><div class="title">Entregas</div><div class="value">${state.deliveries.length}</div></div>
      </div>
    </div>

    <!-- BOTÕES DE CADASTRO -->
    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Cadastros e Operações</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px;">
        <button class="primary" id="btnNewFam">🏡 Família</button>
        <button class="primary" id="btnNewMot">🚚 Motorista</button>
        <button class="primary" id="btnNewVei">🚛 Veículo</button>
        <button class="accent" id="btnNewAg">💧 Agendar</button>
      </div>
    </div>

    <!-- FILTROS AVANÇADOS -->
    <div class="card">
      <h2 style="font-size: 16px; font-weight: 800; margin-bottom: 14px;">Filtrar Registros</h2>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; background: #f8fafc; padding: 14px; border-radius: 14px; border: 1px solid var(--border); margin-bottom: 16px;">
        <div>
          <label>Categoria</label>
          <select id="filterCategory" style="margin-bottom:0;">
            <option value="todos">Todas</option>
            <option value="familias">Famílias</option>
            <option value="motoristas">Motoristas</option>
            <option value="veiculos">Veículos</option>
            <option value="entregas">Entregas</option>
          </select>
        </div>

        <div>
          <label>Motorista</label>
          <select id="filterDriver" style="margin-bottom:0;">
            <option value="todos">Todos</option>
            ${state.drivers.map(d => `<option value="${d.name}">${esc(d.name)}</option>`).join("")}
          </select>
        </div>

        <div>
          <label>Veículo</label>
          <select id="filterVehicle" style="margin-bottom:0;">
            <option value="todos">Todos</option>
            ${state.vehicles.map(v => `<option value="${v.plate}">${esc(v.plate)}</option>`).join("")}
          </select>
        </div>

        <div>
          <label>Data</label>
          <input id="filterDate" type="date" style="margin-bottom:0;">
        </div>
      </div>

      <div id="dynamicRecords" class="records-grid"></div>
    </div>
  `;

  $("btnNewFam").onclick = () => showHouseholdForm();
  $("btnNewMot").onclick = () => showDriverForm();
  $("btnNewVei").onclick = () => showVehicleForm();
  $("btnNewAg").onclick = () => showDeliveryForm();

  $("filterCategory").onchange = (e) => { state.filters.category = e.target.value; renderDynamicRecords(); };
  $("filterDriver").onchange = (e) => { state.filters.driver = e.target.value; renderDynamicRecords(); };
  $("filterVehicle").onchange = (e) => { state.filters.vehicle = e.target.value; renderDynamicRecords(); };
  $("filterDate").onchange = (e) => { state.filters.date = e.target.value; renderDynamicRecords(); };

  renderDynamicRecords();
}

function renderDynamicRecords() {
  const container = $("dynamicRecords");
  if (!container) return;
  container.innerHTML = "";

  const { category, driver, vehicle, date } = state.filters;
  let count = 0;

  // 1. Famílias
  if (category === "todos" || category === "familias") {
    state.households.forEach(h => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🏡 Família: ${esc(h.name)}</div>
          <span class="pill completed">Ativa</span>
        </div>
        <p class="small"><b>Telefone:</b> ${esc(h.phone)} · <b>Comunidade:</b> ${esc(h.community)}</p>
        <p class="small"><b>Cisterna:</b> ${h.defaultLiters || 5000} L</p>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
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
  }

  // 2. Motoristas
  if (category === "todos" || category === "motoristas") {
    state.drivers.filter(d => driver === "todos" || d.name === driver).forEach(m => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = "#bae6fd";
      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🚚 Motorista: ${esc(m.name)}</div>
          <span class="pill scheduled">Ativo</span>
        </div>
        <p class="small"><b>Telefone:</b> ${esc(m.phone || '—')}</p>
        <p class="small"><b>Veículo Vinculado:</b> ${esc(m.vehiclePlate || 'Nenhum')}</p>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
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
  }

  // 3. Veículos
  if (category === "todos" || category === "veiculos") {
    state.vehicles.filter(v => vehicle === "todos" || v.plate === vehicle).forEach(v => {
      count++;
      const el = document.createElement("div");
      el.className = "record-card";
      el.style.borderColor = "#cbd5e1";
      el.innerHTML = `
        <div class="record-header">
          <div class="record-title">🚛 Veículo: ${esc(v.plate)}</div>
          <span class="pill scheduled">${v.capacity || 15000} L</span>
        </div>
        <p class="small"><b>Modelo:</b> ${esc(v.model)}</p>
        <p class="small"><b>Motorista Vinculado:</b> ${esc(v.driverName || 'Nenhum')}</p>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
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
  }

  // 4. Entregas (com múltiplos filtros funcionais)
  if (category === "todos" || category === "entregas") {
    state.deliveries
      .filter(d => driver === "todos" || d.driverName === driver)
      .filter(d => vehicle === "todos" || d.vehiclePlate === vehicle)
      .filter(d => !date || d.scheduledDate === date)
      .forEach(d => {
        count++;
        const el = document.createElement("div");
        el.className = "record-card";
        el.style.borderColor = d.status === "completed" ? "#a7f3d0" : "#fef08a";
        el.innerHTML = `
          <div class="record-header">
            <div class="record-title">💧 Entrega: ${esc(d.recipientName)}</div>
            <span class="pill ${d.status === 'completed' ? 'completed' : 'scheduled'}">${d.status === 'completed' ? 'Entregue' : 'Agendada'}</span>
          </div>
          <p class="small"><b>Data:</b> ${dateOnly(d.scheduledDate)} · <b>Volume:</b> ${d.plannedLiters} L</p>
          <p class="small"><b>Motorista:</b> ${esc(d.driverName || '—')} · <b>Veículo:</b> ${esc(d.vehiclePlate || '—')}</p>
          <div style="display: flex; gap: 8px; margin-top: 12px;">
            <button class="secondary small" data-edit-del="${d.id}">✏️ Alterar</button>
            <button class="danger small" data-del-del="${d.id}">🗑️ Excluir</button>
          </div>
        `;
        el.querySelector("[data-edit-del]").onclick = () => showDeliveryForm(d.id, d);
        el.querySelector("[data-del-del]").onclick = async () => {
          if (confirm("Excluir esta entrega agendada?")) {
            await deleteDoc(doc(db, "deliveries", d.id));
            toast("Entrega excluída!");
            renderAdmin();
          }
        };
        container.appendChild(el);
      });
  }

  if (count === 0) {
    container.innerHTML = `<p class="small" style="grid-column: 1/-1;">Nenhum registro encontrado para a combinação de filtros selecionada.</p>`;
  }
}

/* MODAIS COM CADASTRO EXCLUSIVO POR TELEFONE E VÍNCULOS */
function showHouseholdForm(editId = null, data = null) {
  openModal(`
    <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">🏡 ${editId ? 'Editar' : 'Cadastrar'} Família Rural</h2>
    <form id="hForm">
      <label>Nome do Responsável <input id="hName" value="${data?.name || ''}" required></label>
      <label>Telefone / WhatsApp (Login) <input id="hPhone" type="tel" value="${data?.phone || ''}" placeholder="84999999999" required></label>
      <label>Senha ${editId ? '(Preencha apenas para alterar)' : 'Inicial'} <input id="hPassword" type="password" minlength="6" ${editId ? '' : 'required'}></label>
      <label>Comunidade <input id="hComm" value="${data?.community || ''}" required></label>
      <label>Endereço / Referência <input id="hAddr" value="${data?.address || ''}" required></label>
      <label>Volume Cisterna (Litros) <input id="hLit" type="number" value="${data?.defaultLiters || 5000}" required></label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canH" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Cadastrar'}</button>
      </div>
    </form>
  `);
  $("canH").onclick = closeModal;

  $("hForm").onsubmit = async e => {
    e.preventDefault();
    const payload = {
      name: $("hName").value.trim(),
      phone: $("hPhone").value.trim(),
      community: $("hComm").value.trim(),
      address: $("hAddr").value.trim(),
      defaultLiters: Number($("hLit").value)
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "households", editId), payload);
        toast("Família atualizada!");
      } else {
        const authEmail = phoneAuthEmail(payload.phone);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, $("hPassword").value);
        const ref = await addDoc(collection(db, "households"), { ...payload, recipientUid: cred.user.uid, active: true, createdAt: serverTimestamp() });
        await setDoc(doc(db, "users", cred.user.uid), { name: payload.name, phone: payload.phone, authEmail, role: "recipient", active: true, householdId: ref.id, createdAt: serverTimestamp() });
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
      <label>Telefone / WhatsApp (Login) <input id="mPhone" type="tel" value="${data?.phone || ''}" placeholder="84999999999" required></label>
      <label>Senha ${editId ? '(Preencha para alterar)' : 'Inicial'} <input id="mPass" type="password" minlength="6" ${editId ? '' : 'required'}></label>
      <label>Vincular Veículo (Placa) 
        <select id="mVei">
          <option value="">Nenhum veículo vinculado</option>
          ${state.vehicles.map(v => `<option value="${v.plate}" ${data?.vehiclePlate === v.plate ? 'selected' : ''}>${v.plate} - ${v.model}</option>`).join("")}
        </select>
      </label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canM" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Salvar Motorista'}</button>
      </div>
    </form>
  `);
  $("canM").onclick = closeModal;

  $("mForm").onsubmit = async e => {
    e.preventDefault();
    const payload = {
      name: $("mName").value.trim(),
      phone: $("mPhone").value.trim(),
      vehiclePlate: $("mVei").value || ""
    };

    try {
      if (editId) {
        await updateDoc(doc(db, "users", editId), payload);
        toast("Motorista atualizado!");
      } else {
        const authEmail = phoneAuthEmail(payload.phone);
        const cred = await createUserWithEmailAndPassword(secondaryAuth, authEmail, $("mPass").value);
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
      <label>Modelo / Descrição <input id="vModel" value="${data?.model || ''}" placeholder="Mercedes 15.000L" required></label>
      <label>Capacidade (Litros) <input id="vCap" type="number" value="${data?.capacity || 15000}" required></label>
      <label>Vincular Motorista 
        <select id="vMot">
          <option value="">Nenhum motorista vinculado</option>
          ${state.drivers.map(m => `<option value="${m.name}" ${data?.driverName === m.name ? 'selected' : ''}>${m.name}</option>`).join("")}
        </select>
      </label>
      <div style="display: flex; gap: 10px; margin-top: 10px;">
        <button type="button" class="secondary" id="canV" style="flex: 1;">Voltar</button>
        <button type="submit" class="primary" style="flex: 2;">${editId ? 'Salvar' : 'Cadastrar Veículo'}</button>
      </div>
    </form>
  `);
  $("canV").onclick = closeModal;

  $("vForm").onsubmit = async e => {
    e.preventDefault();
    const payload = {
      plate: $("vPlate").value.trim().toUpperCase(),
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
      <label>Motorista <select id="sMot" required><option value="">Selecione...</option>${state.drivers.map(m => `<option value="${m.name}" ${data?.driverName === m.name ? 'selected' : ''}>${esc(m.name)}</option>`).join("")}</select></label>
      <label>Veículo <select id="sVei" required><option value="">Selecione...</option>${state.vehicles.map(v => `<option value="${v.plate}" ${data?.vehiclePlate === v.plate ? 'selected' : ''}>${esc(v.plate)}</option>`).join("")}</select></label>
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
        toast("Entrega atualizada com sucesso!");
      } else {
        await addDoc(collection(db, "deliveries"), { ...payload, createdAt: serverTimestamp() });
        toast("Entrega agendada com sucesso!");
      }
      closeModal();
      renderAdmin();
    } catch(err) { alert("Erro: " + err.message); }
  };
}

/* PAINÉIS SECUNDÁRIOS */
async function renderDriver() {
  $("driverPanel").innerHTML = `<div class="card"><h2 style="font-size: 18px; font-weight: 800;">🚚 Minhas Entregas Atribuídas</h2><div id="dList" class="records-grid" style="margin-top:16px;"></div></div>`;
  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("driverName", "==", state.profile.name)));
    $("dList").innerHTML = snap.docs.map(d => {
      const item = d.data();
      return `<div class="record-card"><div class="record-header"><div class="record-title">💧 ${esc(item.recipientName)}</div><span class="pill ${item.status}">${item.status}</span></div><p class="small"><b>Data:</b> ${dateOnly(item.scheduledDate)} · <b>Litros:</b> ${item.plannedLiters}L</p><p class="small"><b>Comunidade:</b> ${esc(item.community)}</p></div>`;
    }).join("") || "<p class='small'>Nenhuma entrega programada no momento.</p>";
  } catch(e){}
}

async function renderRecipient() {
  $("recipientPanel").innerHTML = `<div class="card"><h2 style="font-size: 18px; font-weight: 800;">🏡 Abastecimentos da Família</h2><div id="rList" class="records-grid" style="margin-top:16px;"></div></div>`;
  try {
    const snap = await getDocs(query(collection(db, "deliveries"), where("householdId", "==", state.profile.householdId)));
    $("rList").innerHTML = snap.docs.map(d => {
      const item = d.data();
      return `<div class="record-card"><div class="record-header"><div class="record-title">💧 Entrega em ${dateOnly(item.scheduledDate)}</div><span class="pill ${item.status}">${item.status}</span></div><p class="small"><b>Volume:</b> ${item.plannedLiters}L · <b>Motorista:</b> ${esc(item.driverName || '—')}</p></div>`;
    }).join("") || "<p class='small'>Nenhum abastecimento encontrado.</p>";
  } catch(e){}
}
